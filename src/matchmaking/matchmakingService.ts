import { db, rtdb } from '../firebase';
import {
  doc,
  runTransaction
} from 'firebase/firestore';
import {
  ref,
  set,
  get,
  update,
  remove,
  runTransaction as rtdbTransaction
} from 'firebase/database';
import type { UserProfile, MatchQueueEntry, Match, GameMode } from '../types';

export const STANDARD_TIME_CONTROLS: Record<GameMode, string> = {
  classical: '10 | 5',
  practice: '10 | 5',
  all_in: '10 | 5',
  beginner: '15 min',
  casual_rapid: '10 min',
  standard_rapid: '10 | 5',
  competitive_rapid: '15 | 10',
  classical_lite: '20 | 10',
  blitz: '5 | 3',
  competitive_blitz: '3 | 2',
  bullet: '1 | 1',
  arena_bullet: '1 min',
  championship: '30 | 20'
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

export function getQueueKey(timeControl?: string): string {
  if (!timeControl) return 'standard';
  return timeControl.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Enters the matchmaking queue in Realtime Database.
 */
export async function joinQueue(
  uid: string,
  rating: number,
  stake: number,
  mode: GameMode,
  timeControl?: string
): Promise<string> {
  const queueKey = getQueueKey(timeControl);
  const entryPath = `match_queue/${queueKey}/${uid}`;
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

  await set(ref(rtdb, entryPath), entry);
  return `${queueKey}/${uid}`;
}

/**
 * Removes the user from the matchmaking queue in Realtime Database.
 */
export async function leaveQueue(queueId: string): Promise<void> {
  const parts = queueId.split('/');
  if (parts.length === 2) {
    const [queueKey, uid] = parts;
    await remove(ref(rtdb, `match_queue/${queueKey}/${uid}`));
  }
}

/**
 * Searches for a compatible opponent and initializes a match atomically in RTDB.
 * If paired, escrow stakes are deducted in Firestore, ledger logged, and match seeded in RTDB.
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
  const parts = myQueueId.split('/');
  if (parts.length !== 2) return null;
  const [queueKey] = parts;

  try {
    // 1. Fetch candidates from RTDB match queue
    const queueRef = ref(rtdb, `match_queue/${queueKey}`);
    const snapshot = await get(queueRef);
    if (!snapshot.exists()) return null;

    const queueData = snapshot.val();
    const candidates: MatchQueueEntry[] = [];

    for (const uid in queueData) {
      if (uid !== myUid) {
        const entry = queueData[uid];
        if (entry.status === 'waiting') {
          candidates.push({ ...entry, id: `${queueKey}/${uid}` });
        }
      }
    }

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
    const opponentUid = opponent.uid;
    const finalStake = Math.min(myStake, opponent.stake);

    // Generate new match ID
    const mId = 'match_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();

    // 2. Try to lock opponent's queue entry using RTDB transaction
    const opponentQueueRef = ref(rtdb, `match_queue/${queueKey}/${opponentUid}`);
    let lockedOpponent = false;

    const oppTxResult = await rtdbTransaction(opponentQueueRef, (currentData) => {
      if (currentData && currentData.status === 'waiting') {
        currentData.status = 'matched';
        currentData.matchId = mId;
        currentData.matchedAt = Date.now();
        return currentData;
      }
      return undefined; // abort transaction
    });

    if (oppTxResult.committed) {
      lockedOpponent = true;
    }

    if (!lockedOpponent) {
      return null; // opponent was already matched/taken
    }

    // 3. Lock our own queue entry
    await set(ref(rtdb, `match_queue/${queueKey}/${myUid}`), {
      uid: myUid,
      rating: myRating,
      stake: myStake,
      mode,
      queuedAt: Date.now(),
      createdAt: Date.now(),
      status: 'matched',
      matchId: mId,
      timeControl: timeControl || '',
      matchedAt: Date.now()
    });

    // 4. Run Firestore transaction for atomic balances lock and escrow updates
    try {
      await runTransaction(db, async (transaction) => {
        const myUserRef = doc(db, 'users', myUid);
        const oppUserRef = doc(db, 'users', opponentUid);

        const myUserSnap = await transaction.get(myUserRef);
        const oppUserSnap = await transaction.get(oppUserRef);

        if (!myUserSnap.exists() || !oppUserSnap.exists()) {
          throw new Error('Required user profiles vanished during pairing');
        }

        const myUser = myUserSnap.data() as UserProfile;
        const oppUser = oppUserSnap.data() as UserProfile;

        const myBalance = myUser.currentBalance !== undefined ? myUser.currentBalance : myUser.bankBalance;
        const oppBalance = oppUser.currentBalance !== undefined ? oppUser.currentBalance : oppUser.bankBalance;

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

        // Commit profile balances
        transaction.update(myUserRef, {
          currentBalance: updatedMyBalance,
          bankBalance: updatedMyBalance,
          zeroBalanceAt: updatedMyBalance <= 0 ? now : null,
        });
        transaction.update(oppUserRef, {
          currentBalance: updatedOppBalance,
          bankBalance: updatedOppBalance,
          zeroBalanceAt: updatedOppBalance <= 0 ? now : null,
        });

        // Write transactions logs
        const myLedgerRef = doc(db, 'transactions', myUid + '_' + mId + '_debit');
        transaction.set(myLedgerRef, {
          id: myUid + '_' + mId + '_debit',
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
          opponentUid: opponentUid,
        });

        const oppLedgerRef = doc(db, 'transactions', opponentUid + '_' + mId + '_debit');
        transaction.set(oppLedgerRef, {
          id: opponentUid + '_' + mId + '_debit',
          uid: opponentUid,
          userId: opponentUid,
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
          opponentUid: myUid,
        });
      });
    } catch (firestoreError) {
      // Revert RTDB queue statuses back to waiting on failure
      await update(ref(rtdb, `match_queue/${queueKey}`), {
        [`${opponentUid}/status`]: 'waiting',
        [`${opponentUid}/matchId`]: null,
        [`${opponentUid}/matchedAt`]: null,
        [`${myUid}/status`]: 'waiting',
        [`${myUid}/matchId`]: null,
        [`${myUid}/matchedAt`]: null,
      });
      throw firestoreError;
    }

    // 5. Setup and write match room in RTDB
    const now = Date.now();
    const isMyWhite = Math.random() < 0.5;
    const whiteUid = isMyWhite ? myUid : opponentUid;
    const blackUid = isMyWhite ? opponentUid : myUid;
    
    const matchTimeControl = timeControl || opponent.timeControl || '10 | 5';
    const initialClockTime = parseTimeControl(matchTimeControl).initialTime;

    const myBalanceVal = myStake; // fallback
    const oppBalanceVal = opponent.stake;

    const newMatch: Match = {
      id: mId,
      players: [myUid, opponentUid],
      playerPair: [myUid, opponentUid].sort().join('_'),
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
      ...(mode === 'all_in' ? { allInStakes: { [myUid]: myBalanceVal, [opponentUid]: oppBalanceVal } } : {})
    };

    await set(ref(rtdb, `matches/${mId}`), newMatch);
    return mId;

  } catch (error: any) {
    console.warn('Pairing failed (transaction abort/race):', error.message || error);
    return null;
  }
}
