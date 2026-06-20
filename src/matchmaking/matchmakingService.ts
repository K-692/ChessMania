import { db } from '../firebase';
import {
  collection,
  doc,
  runTransaction,
  getDocs,
  query,
  where,
  limit,
  setDoc,
  updateDoc
} from 'firebase/firestore';
import type { UserProfile, MatchQueueEntry, Match, GameMode } from '../types';

export const STANDARD_TIME_CONTROLS: Record<GameMode, string> = {
  beginner: '15 min',
  casual_rapid: '10 min',
  standard_rapid: '10 | 5',
  competitive_rapid: '15 | 10',
  classical_lite: '20 | 10',
  blitz: '5 | 3',
  competitive_blitz: '3 | 2',
  bullet: '1 | 1',
  arena_bullet: '1 min',
  championship: '30 | 20',
  all_in: '30 | 10',
  practice: '10 | 5'
};

export function getInitialTimeForMode(mode: GameMode): number {
  return parseTimeControl(STANDARD_TIME_CONTROLS[mode]).initialTime;
}

export function parseTimeControl(tc: string): { initialTime: number; increment: number } {
  if (tc.includes('|')) {
    const parts = tc.split('|');
    const mins = parseInt(parts[0].trim(), 10);
    const secs = parseInt(parts[1].trim(), 10);
    return {
      initialTime: mins * 60 * 1000,
      increment: secs * 1000
    };
  } else {
    const val = parseInt(tc.replace(/min/g, '').trim(), 10);
    return {
      initialTime: val * 60 * 1000,
      increment: 0
    };
  }
}

/**
 * Enters the matchmaking queue.
 */
export async function joinQueue(
  uid: string,
  rating: number,
  stake: number,
  mode: GameMode,
  timeControl?: string
): Promise<string> {
  const queueCol = collection(db, 'matchQueues');
  const newQueueRef = doc(queueCol);

  const entry: MatchQueueEntry = {
    uid,
    rating,
    stake,
    mode,
    queuedAt: Date.now(),
    createdAt: Date.now(), // compatibility
    status: 'waiting',
    ...(timeControl ? { timeControl } : {})
  };

  await setDoc(newQueueRef, entry);
  return newQueueRef.id;
}

/**
 * Removes the user from the matchmaking queue.
 */
export async function leaveQueue(queueId: string): Promise<void> {
  const queueRef = doc(db, 'matchQueues', queueId);
  await updateDoc(queueRef, { status: 'cancelled' });
}

/**
 * Searches for a compatible opponent and initializes a match atomically.
 * If paired, escrow stakes are deducted, ledger logged, and match seeded.
 */
export async function findMatch(
  myQueueId: string,
  myUid: string,
  myRating: number,
  myStake: number,
  mode: GameMode,
  ratingBand: number,
  timeControl?: string
): Promise<string | null> {
  try {
    let q;
    if (mode === 'all_in' && timeControl) {
      q = query(
        collection(db, 'matchQueues'),
        where('status', '==', 'waiting'),
        where('mode', '==', mode),
        where('timeControl', '==', timeControl),
        limit(40)
      );
    } else {
      q = query(
        collection(db, 'matchQueues'),
        where('status', '==', 'waiting'),
        where('mode', '==', mode),
        limit(40)
      );
    }

    const querySnapshot = await getDocs(q);
    const candidates: MatchQueueEntry[] = [];
    
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data() as MatchQueueEntry;
      data.id = docSnap.id;
      if (data.uid !== myUid) {
        candidates.push(data);
      }
    });

    // Filter candidates by rating band - unless it is all_in mode!
    const eligibleCandidates = mode === 'all_in'
      ? candidates
      : candidates.filter((c) => {
          const ratingDiff = Math.abs(c.rating - myRating);
          return ratingDiff <= ratingBand;
        });

    if (eligibleCandidates.length === 0) {
      return null;
    }

    // Sort to prioritize closest stake (except in all_in), then oldest queue entry
    eligibleCandidates.sort((a, b) => {
      const aTime = a.queuedAt !== undefined ? a.queuedAt : a.createdAt;
      const bTime = b.queuedAt !== undefined ? b.queuedAt : b.createdAt;
      if (mode === 'all_in') {
        return aTime - bTime;
      }
      const aStakeDiff = Math.abs(a.stake - myStake);
      const bStakeDiff = Math.abs(b.stake - myStake);
      if (aStakeDiff !== bStakeDiff) {
        return aStakeDiff - bStakeDiff;
      }
      return aTime - bTime;
    });

    const opponent = eligibleCandidates[0];
    const finalStake = Math.min(myStake, opponent.stake);

    // Run transaction for atomic escrow lock and game setup
    const matchId = await runTransaction(db, async (transaction) => {
      const myQueueRef = doc(db, 'matchQueues', myQueueId);
      const oppQueueRef = doc(db, 'matchQueues', opponent.id!);
      const myUserRef = doc(db, 'users', myUid);
      const oppUserRef = doc(db, 'users', opponent.uid);

      const myQueueSnap = await transaction.get(myQueueRef);
      const oppQueueSnap = await transaction.get(oppQueueRef);
      const myUserSnap = await transaction.get(myUserRef);
      const oppUserSnap = await transaction.get(oppUserRef);

      if (!myQueueSnap.exists() || !oppQueueSnap.exists() || !myUserSnap.exists() || !oppUserSnap.exists()) {
        throw new Error('Required documents vanished during pairing');
      }

      const myQueueData = myQueueSnap.data() as MatchQueueEntry;
      const oppQueueData = oppQueueSnap.data() as MatchQueueEntry;
      const myUser = myUserSnap.data() as UserProfile;
      const oppUser = oppUserSnap.data() as UserProfile;

      // Verify that neither player is already paired/cancelled
      if (myQueueData.status !== 'waiting' || oppQueueData.status !== 'waiting') {
        throw new Error('One of the queue entries has already been paired');
      }

      const myBalance = myUser.currentBalance !== undefined ? myUser.currentBalance : myUser.bankBalance;
      const oppBalance = oppUser.currentBalance !== undefined ? oppUser.currentBalance : oppUser.bankBalance;

      // Check balance constraints
      const myEscrow = mode === 'all_in' ? myBalance : finalStake;
      const oppEscrow = mode === 'all_in' ? oppBalance : finalStake;

      if (myBalance < myEscrow || myEscrow <= 0) {
        throw new Error('Insufficient coins to cover the minimum stake');
      }
      if (oppBalance < oppEscrow || oppEscrow <= 0) {
        throw new Error('Opponent has insufficient coins to cover the minimum stake');
      }

      const now = Date.now();
      const updatedMyBalance = Math.round((myBalance - myEscrow) * 100) / 100;
      const updatedOppBalance = Math.round((oppBalance - oppEscrow) * 100) / 100;

      // Seed match ID
      const matchesCol = collection(db, 'matches');
      const matchDocRef = doc(matchesCol);
      const mId = matchDocRef.id;

      // Commit profile balances
      transaction.update(myUserRef, {
        currentBalance: updatedMyBalance,
        bankBalance: updatedMyBalance, // compatibility
        zeroBalanceAt: updatedMyBalance <= 0 ? now : null,
      });
      transaction.update(oppUserRef, {
        currentBalance: updatedOppBalance,
        bankBalance: updatedOppBalance, // compatibility
        zeroBalanceAt: updatedOppBalance <= 0 ? now : null,
      });

      // Write transaction entries
      const transactionCol = collection(db, 'transactions');
      
      const myLedgerRef = doc(transactionCol);
      const myLedger = {
        uid: myUid,
        userId: myUid,
        type: 'stakeDebit',
        amount: 0,
        coins: -myEscrow,
        currency: 'INR',
        status: 'processed',
        processedAt: now,
        matchId: mId,
        balanceBefore: myBalance,
        balanceAfter: updatedMyBalance,
        createdAt: now,
      };
      transaction.set(myLedgerRef, myLedger);

      const oppLedgerRef = doc(transactionCol);
      const oppLedger = {
        uid: opponent.uid,
        userId: opponent.uid,
        type: 'stakeDebit',
        amount: 0,
        coins: -oppEscrow,
        currency: 'INR',
        status: 'processed',
        processedAt: now,
        matchId: mId,
        balanceBefore: oppBalance,
        balanceAfter: updatedOppBalance,
        createdAt: now,
      };
      transaction.set(oppLedgerRef, oppLedger);

      // Setup match room
      const isMyWhite = Math.random() < 0.5;
      const whiteUid = isMyWhite ? myUid : opponent.uid;
      const blackUid = isMyWhite ? opponent.uid : myUid;
      
      let initialClockTime = getInitialTimeForMode(mode);
      let matchTimeControl: string;
      
      if (mode === 'all_in') {
        matchTimeControl = opponent.timeControl || '30 | 10';
        initialClockTime = parseTimeControl(matchTimeControl).initialTime;
      } else {
        const standardTCs: Record<GameMode, string> = {
          beginner: '15 min',
          casual_rapid: '10 min',
          standard_rapid: '10 | 5',
          competitive_rapid: '15 | 10',
          classical_lite: '20 | 10',
          blitz: '5 | 3',
          competitive_blitz: '3 | 2',
          bullet: '1 | 1',
          arena_bullet: '1 min',
          championship: '30 | 20',
          all_in: '30 | 10',
          practice: '10 | 5'
        };
        matchTimeControl = standardTCs[mode];
      }

      const newMatch: Match = {
        id: mId,
        players: [myUid, opponent.uid],
        playerPair: [myUid, opponent.uid].sort().join('_'),
        whiteUid,
        blackUid,
        stake: mode === 'all_in' ? 0 : finalStake,
        mode,
        boardFEN: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        turn: 'w',
        clocks: {
          [whiteUid]: initialClockTime,
          [blackUid]: initialClockTime,
        },
        status: 'active',
        winnerUid: null,
        createdAt: now,
        finishedAt: null,
        moves: [],
        lastMoveAt: now,
        timeControl: matchTimeControl,
        ...(mode === 'all_in' ? { allInStakes: { [myUid]: myEscrow, [opponent.uid]: oppEscrow } } : {})
      };

      transaction.set(matchDocRef, newMatch);

      // Lock queues
      transaction.update(myQueueRef, {
        status: 'matched',
        matchId: mId,
        matchedAt: now
      });
      transaction.update(oppQueueRef, {
        status: 'matched',
        matchId: mId,
        matchedAt: now
      });

      return mId;
    });

    return matchId;
  } catch (error: any) {
    console.warn('Pairing failed (transaction abort/race):', error.message || error);
    return null;
  }
}
