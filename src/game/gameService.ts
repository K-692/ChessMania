import { db } from '../firebase';
import { doc, runTransaction, collection, getDoc } from 'firebase/firestore';
import type { Match, UserProfile, GameMode } from '../types';
import { parseTimeControl, STANDARD_TIME_CONTROLS } from '../matchmaking/matchmakingService';

export function getIncrementForMode(mode: GameMode): number {
  return parseTimeControl(STANDARD_TIME_CONTROLS[mode]).increment;
}

/**
 * Computes Elo rating changes based on standard expectation formula.
 */
export function calculateElo(
  currentRating: number,
  opponentRating: number,
  actualScore: number // 1 for win, 0.5 for draw, 0 for loss
): { delta: number; expectedScore: number } {
  const K = 20; // Default K-factor
  const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - currentRating) / 400));
  const delta = Math.round(K * (actualScore - expectedScore));
  return { delta, expectedScore };
}

/**
 * Executes a move, updating the board FEN, move log, active turn, and clocks.
 */
export async function makeMove(
  matchId: string,
  playerUid: string,
  newFen: string,
  sanMove: string
): Promise<void> {
  const matchDocRef = doc(db, 'matches', matchId);
  const now = Date.now();

  await runTransaction(db, async (transaction) => {
    const matchSnap = await transaction.get(matchDocRef);
    if (!matchSnap.exists()) {
      throw new Error('Match does not exist');
    }

    const matchData = matchSnap.data() as Match;

    // Guard: Ensure match is still active
    if (matchData.status !== 'active') {
      throw new Error('Match has already finished');
    }

    // Guard: Ensure correct player turn
    const expectedPlayer = matchData.turn === 'w' ? matchData.whiteUid : matchData.blackUid;
    if (playerUid !== expectedPlayer) {
      throw new Error('Not your turn');
    }

    // Compute clock elapsed time and add timeControl increment
    const elapsed = now - matchData.lastMoveAt;
    const increment = matchData.timeControl 
      ? parseTimeControl(matchData.timeControl).increment 
      : getIncrementForMode(matchData.mode);
    const remainingTime = Math.max(0, matchData.clocks[playerUid] - elapsed) + increment;

    const updatedClocks = {
      ...matchData.clocks,
      [playerUid]: remainingTime,
    };

    // If clock hit 0, settle the match as a timeout
    if (remainingTime <= 0) {
      const opponentUid = playerUid === matchData.whiteUid ? matchData.blackUid : matchData.whiteUid;
      transaction.update(matchDocRef, {
        clocks: updatedClocks,
        status: 'timeout',
        winnerUid: opponentUid,
        finishedAt: now,
      });
      return;
    }

    // Update state for next turn
    const nextTurn = matchData.turn === 'w' ? 'b' : 'w';
    const updatedMoves = [...matchData.moves, sanMove];

    transaction.update(matchDocRef, {
      boardFEN: newFen,
      turn: nextTurn,
      moves: updatedMoves,
      clocks: updatedClocks,
      lastMoveAt: now,
    });

    const nextMoveIndex = matchData.moves.length;
    const moveDocRef = doc(collection(db, 'matches', matchId, 'moves'), String(nextMoveIndex));
    transaction.set(moveDocRef, {
      san: sanMove,
      fen: newFen,
      playedBy: playerUid,
      playedAt: now,
      index: nextMoveIndex
    });
  });
}

/**
 * Offers a draw or handles resignation/draw agreements.
 */
export async function submitGameAction(
  matchId: string,
  playerUid: string,
  action: 'resign' | 'offer-draw' | 'accept-draw'
): Promise<void> {
  const matchDocRef = doc(db, 'matches', matchId);

  await runTransaction(db, async (transaction) => {
    const matchSnap = await transaction.get(matchDocRef);
    if (!matchSnap.exists()) {
      throw new Error('Match does not exist');
    }

    const matchData = matchSnap.data() as Match;
    if (matchData.status !== 'active') {
      throw new Error('Match is not active');
    }

    const opponentUid = playerUid === matchData.whiteUid ? matchData.blackUid : matchData.whiteUid;
    const now = Date.now();

    if (action === 'resign') {
      // Direct opponent win
      transaction.update(matchDocRef, {
        status: 'resigned',
        winnerUid: opponentUid,
        finishedAt: now,
      });
    } else if (action === 'offer-draw') {
      const currentOffers = matchData.drawOffers || [];
      if (!currentOffers.includes(playerUid)) {
        transaction.update(matchDocRef, {
          drawOffers: [...currentOffers, playerUid],
        });
      }
    } else if (action === 'accept-draw') {
      const currentOffers = matchData.drawOffers || [];
      if (currentOffers.includes(opponentUid)) {
        transaction.update(matchDocRef, {
          status: 'draw',
          winnerUid: null,
          finishedAt: now,
        });
      }
    }
  });
}

/**
 * Atomically settles the coin payouts and Elo updates of a completed game.
 * Guarantees idempotency by checking and switching match.status from active/resigned/timeout/etc.
 * to settled, or using a settled flag. Let's add 'settled' to the transaction checks.
 */
export async function settleMatchPayoutAndElo(
  matchId: string,
  currentUserId: string,
  currentUserProfile: UserProfile,
  addCachedFriendUpdate?: (friendUid: string, stats: any) => void
): Promise<{
  profileUpdates?: Partial<UserProfile>;
  transactionRecord?: any;
  eloHistoryRecord?: any;
  practice?: boolean;
  matchRecord?: any;
} | null> {
  const matchDocRef = doc(db, 'matches', matchId);
  const now = Date.now();

  let matchData: any = null;

  // Atomically mark match as settled
  await runTransaction(db, async (transaction) => {
    const matchSnap = await transaction.get(matchDocRef);
    if (!matchSnap.exists()) return;

    const data = matchSnap.data() as Match;

    // Guard: Only settle if ended and not yet settled
    if ((data as any).settled === true) {
      return;
    }

    const isDraw = data.status === 'draw' || data.status === 'stalemate';
    const hasWinner = !!data.winnerUid;

    if (!isDraw && !hasWinner) {
      return;
    }

    matchData = data;
    transaction.update(matchDocRef, {
      settled: true,
      finishedAt: now,
    });
  });

  if (!matchData) return null;

  if (matchData.mode === 'practice') {
    return { practice: true };
  }

  const myUid = currentUserId;
  if (!matchData.players.includes(myUid)) return null;

  const opponentUid = myUid === matchData.whiteUid ? matchData.blackUid : matchData.whiteUid;

  // Fetch opponent profile from Firestore to get their Elo rating
  const opponentDocRef = doc(db, 'users', opponentUid);
  const opponentSnap = await getDoc(opponentDocRef);
  if (!opponentSnap.exists()) {
    throw new Error('Opponent profile was not found');
  }
  const opponentProfile = opponentSnap.data() as UserProfile;

  const myRating = currentUserProfile.currentEloRating !== undefined ? currentUserProfile.currentEloRating : (currentUserProfile.rating || 0);
  const opponentRating = opponentProfile.currentEloRating !== undefined ? opponentProfile.currentEloRating : (opponentProfile.rating || 0);
  const myBalance = currentUserProfile.currentBalance !== undefined ? currentUserProfile.currentBalance : (currentUserProfile.bankBalance || 0);

  const isDraw = matchData.status === 'draw' || matchData.status === 'stalemate';
  let myScore = 0.5;
  if (!isDraw) {
    myScore = matchData.winnerUid === myUid ? 1 : 0;
  }

  const { delta, expectedScore } = calculateElo(myRating, opponentRating, myScore);
  let newRating = myRating;
  if (matchData.stake > 0) {
    if (myScore === 0) {
      const finalDelta = delta > 0 ? -delta : delta;
      newRating = Math.max(0, myRating + finalDelta);
    } else {
      newRating = Math.max(0, myRating + delta);
    }
  }

  // Calculate payouts
  let myPayout = 0;
  let myEarned = 0;

  if (matchData.mode === 'all_in' && matchData.allInStakes) {
    const myStakeVal = matchData.allInStakes[myUid] || 0;
    const oppStakeVal = matchData.allInStakes[opponentUid] || 0;
    const totalPool = myStakeVal + oppStakeVal;

    if (isDraw) {
      myPayout = myStakeVal;
    } else if (matchData.winnerUid === myUid) {
      myPayout = totalPool;
      myEarned = oppStakeVal;
    }
  } else {
    if (isDraw) {
      myPayout = matchData.stake;
    } else if (matchData.winnerUid === myUid) {
      myPayout = matchData.stake * 2;
      myEarned = matchData.stake;
    }
  }

  const newBalance = Math.round((myBalance + myPayout) * 100) / 100;
  const newTotalCoins = Math.round(((currentUserProfile.totalCoinsEarned || myBalance) + myEarned) * 100) / 100;

  // Increments: only increment play count if the match was won by current user
  const myCounts = currentUserProfile.gameplayCounts || {};
  const wonMatch = matchData.winnerUid === myUid;
  const newMyCounts = wonMatch
    ? { ...myCounts, [matchData.mode]: (myCounts[matchData.mode] || 0) + 1 }
    : myCounts;

  let myWins = currentUserProfile.totalWins !== undefined ? currentUserProfile.totalWins : (currentUserProfile.wins || 0);
  let myLosses = currentUserProfile.totalLosses !== undefined ? currentUserProfile.totalLosses : (currentUserProfile.losses || 0);
  let myDraws = currentUserProfile.totalDraws !== undefined ? currentUserProfile.totalDraws : (currentUserProfile.draws || 0);

  if (isDraw) myDraws++;
  else if (matchData.winnerUid === myUid) myWins++;
  else myLosses++;

  const myTotalGamesPlayed = myWins + myLosses + myDraws;
  const myWinRateRatio = myTotalGamesPlayed > 0 ? Math.round((myWins / myTotalGamesPlayed) * 100) : 0;

  const profileUpdates: Partial<UserProfile> = {
    currentEloRating: newRating,
    rating: newRating,
    currentBalance: newBalance,
    bankBalance: newBalance,
    zeroBalanceAt: newBalance <= 0 ? now : null,
    totalCoinsEarned: newTotalCoins,
    gameplayCounts: newMyCounts,
    wins: myWins,
    losses: myLosses,
    draws: myDraws,
    totalWins: myWins,
    totalLosses: myLosses,
    totalDraws: myDraws,
    totalGamesPlayed: myTotalGamesPlayed,
    winRateRatio: myWinRateRatio,
    updatedAt: now
  };

  // Reset hourly reward timer if balance fell below 1000 from >= 1000
  if (newBalance < 1000 && myBalance >= 1000) {
    profileUpdates.lastHourlyRewardAt = now;
  }

  let transactionRecord = null;
  if (myPayout > 0 || matchData.stake === 0) {
    transactionRecord = {
      id: myUid + '_' + matchData.id + '_' + (isDraw ? 'refund' : 'credit'),
      uid: myUid,
      userId: myUid,
      type: isDraw ? 'refund' : 'stakeCredit',
      amount: 0,
      coins: myPayout,
      currency: 'INR',
      status: 'processed',
      processedAt: now,
      matchId: matchData.id,
      balanceBefore: myBalance,
      balanceAfter: newBalance,
      createdAt: now,
      opponentUid: opponentUid,
    };
  }

  let eloHistoryRecord = null;
  if (matchData.stake > 0 || matchData.stake === 0) {
    eloHistoryRecord = {
      beforeRating: myRating,
      afterRating: newRating,
      delta: matchData.stake === 0 ? 0 : (newRating - myRating),
      expectedScore,
      actualScore: myScore,
      kFactor: 20,
      createdAt: now,
      opponentUid: opponentUid,
      matchId: matchData.id,
      mode: matchData.mode
    };
  }

  // Handle H2H Friend Stats Update
  if (addCachedFriendUpdate) {
    const friendDocRef = doc(db, 'users', myUid, 'friends', opponentUid);
    const friendSnap = await getDoc(friendDocRef);
    if (friendSnap.exists()) {
      const stats = friendSnap.data().stats || {};
      if (!stats[myUid]) stats[myUid] = { wins: 0, losses: 0, draws: 0 };
      if (!stats[opponentUid]) stats[opponentUid] = { wins: 0, losses: 0, draws: 0 };

      if (isDraw) {
        stats[myUid].draws += 1;
        stats[opponentUid].draws += 1;
      } else if (matchData.winnerUid === myUid) {
        stats[myUid].wins += 1;
        stats[opponentUid].losses += 1;
      } else {
        stats[myUid].losses += 1;
        stats[opponentUid].wins += 1;
      }
      addCachedFriendUpdate(opponentUid, stats);
    }
  }

  const matchRecord = {
    ...matchData,
    settled: true,
    finishedAt: now
  };

  return {
    profileUpdates,
    transactionRecord,
    eloHistoryRecord,
    matchRecord
  };
}

/**
 * Accept a friendly challenge atomically. Deducts stakes, writes ledgers, and seeds match document.
 */
export async function acceptFriendlyChallenge(
  challengeId: string,
  challengerUid: string,
  challengedUid: string,
  mode: GameMode,
  stake: number
): Promise<string> {
  const challengeDocRef = doc(db, 'challenges', challengeId);
  const challengerUserRef = doc(db, 'users', challengerUid);
  const challengedUserRef = doc(db, 'users', challengedUid);
  const matchesCol = collection(db, 'matches');
  const newMatchDocRef = doc(matchesCol);
  const mId = newMatchDocRef.id;
  const now = Date.now();

  return await runTransaction(db, async (transaction) => {
    const challengeSnap = await transaction.get(challengeDocRef);
    if (!challengeSnap.exists()) {
      return { error: 'Challenge does not exist' };
    }
    const challengeData = challengeSnap.data();
    if (challengeData.status !== 'pending') {
      return { error: 'Challenge is no longer pending' };
    }

    const challengerSnap = await transaction.get(challengerUserRef);
    const challengedSnap = await transaction.get(challengedUserRef);

    if (!challengerSnap.exists() || !challengedSnap.exists()) {
      return { error: 'One of the player profiles was not found' };
    }

    const challenger = challengerSnap.data() as UserProfile;
    const challenged = challengedSnap.data() as UserProfile;

    const challengerBalance = challenger.currentBalance !== undefined ? challenger.currentBalance : challenger.bankBalance;
    const challengedBalance = challenged.currentBalance !== undefined ? challenged.currentBalance : challenged.bankBalance;

    // Check balances
    const challengerStake = mode === 'all_in' ? challengerBalance : stake;
    const challengedStake = mode === 'all_in' ? challengedBalance : stake;

    const isFriendly = stake === 0;

    if (!isFriendly) {
      if (challengerBalance < challengerStake || challengerStake <= 0) {
        transaction.update(challengeDocRef, { status: 'declined' });
        return { error: `Challenger "${challenger.displayName}" has insufficient coins.` };
      }
      if (challengedBalance < challengedStake || challengedStake <= 0) {
        transaction.update(challengeDocRef, { status: 'declined' });
        return { error: `You have insufficient coins to play this match.` };
      }

      const updatedChallengerBalance = Math.round((challengerBalance - challengerStake) * 100) / 100;
      const updatedChallengedBalance = Math.round((challengedBalance - challengedStake) * 100) / 100;

      // Commit profile balances
      transaction.update(challengerUserRef, {
        currentBalance: updatedChallengerBalance,
        bankBalance: updatedChallengerBalance, // compatibility
        zeroBalanceAt: updatedChallengerBalance <= 0 ? now : null,
      });
      transaction.update(challengedUserRef, {
        currentBalance: updatedChallengedBalance,
        bankBalance: updatedChallengedBalance, // compatibility
        zeroBalanceAt: updatedChallengedBalance <= 0 ? now : null,
      });

      // Write transaction entries
      const challengerLedgerRef = doc(db, 'transactions', challengerUid + '_' + mId + '_debit');
      transaction.set(challengerLedgerRef, {
        id: challengerUid + '_' + mId + '_debit',
        uid: challengerUid,
        userId: challengerUid,
        type: 'stakeDebit',
        amount: 0,
        coins: -challengerStake,
        currency: 'INR',
        status: 'processed',
        processedAt: now,
        matchId: mId,
        balanceBefore: challengerBalance,
        balanceAfter: updatedChallengerBalance,
        createdAt: now,
        opponentUid: challengedUid,
      });

      const challengedLedgerRef = doc(db, 'transactions', challengedUid + '_' + mId + '_debit');
      transaction.set(challengedLedgerRef, {
        id: challengedUid + '_' + mId + '_debit',
        uid: challengedUid,
        userId: challengedUid,
        type: 'stakeDebit',
        amount: 0,
        coins: -challengedStake,
        currency: 'INR',
        status: 'processed',
        processedAt: now,
        matchId: mId,
        balanceBefore: challengedBalance,
        balanceAfter: updatedChallengedBalance,
        createdAt: now,
        opponentUid: challengerUid,
      });
    }

    // Setup match room
    const colorChoice = challengeData?.colorChoice || 'random';
    let isChallengerWhite = Math.random() < 0.5;
    if (colorChoice === 'white') {
      isChallengerWhite = true;
    } else if (colorChoice === 'black') {
      isChallengerWhite = false;
    }
    const whiteUid = isChallengerWhite ? challengerUid : challengedUid;
    const blackUid = isChallengerWhite ? challengedUid : challengerUid;

    let initialClockTime: number;
    let matchTimeControl: string;
    
    if (mode === 'all_in') {
      matchTimeControl = '10 | 5'; // Default for friendly All-In challenge
      initialClockTime = parseTimeControl(matchTimeControl).initialTime;
    } else {
      matchTimeControl = STANDARD_TIME_CONTROLS[mode];
      initialClockTime = parseTimeControl(matchTimeControl).initialTime;
    }

    const newMatch: Match = {
      id: mId,
      players: [challengerUid, challengedUid],
      playerPair: [challengerUid, challengedUid].sort().join('_'),
      challengeId,
      whiteUid,
      blackUid,
      stake: mode === 'all_in' ? 0 : stake,
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
      ...(mode === 'all_in' ? { allInStakes: { [challengerUid]: challengerStake, [challengedUid]: challengedStake } } : {})
    };

    transaction.set(newMatchDocRef, newMatch);

    // Update challenge status
    transaction.update(challengeDocRef, {
      status: 'accepted',
      matchId: mId,
      acceptedAt: now
    });

    // Mirror to subcollections users/{uid}/friendlyChallenges/{challengeId}
    const challengerFC = doc(db, 'users', challengerUid, 'friendlyChallenges', challengeId);
    const challengedFC = doc(db, 'users', challengedUid, 'friendlyChallenges', challengeId);
    const mirrorChallenge = {
      challengeId,
      challengerUid,
      challengedUid,
      mode,
      stake,
      status: 'accepted',
      matchId: mId,
      createdAt: challengeData.createdAt || now,
      acceptedAt: now
    };
    transaction.set(challengerFC, mirrorChallenge, { merge: true });
    transaction.set(challengedFC, mirrorChallenge, { merge: true });

    return { matchId: mId };
  }).then((res) => {
    if (res.error) {
      throw new Error(res.error);
    }
    return res.matchId!;
  });
}

/**
 * Seeding a practice match against a bot engine locally.
 */
export function createPracticeMatchObject(
  userUid: string,
  botElo: number,
  userColor: 'white' | 'black' | 'random'
): Match {
  const matchesCol = collection(db, 'matches');
  const newMatchDocRef = doc(matchesCol);
  const mId = newMatchDocRef.id;
  const now = Date.now();

  const botUid = `bot_${botElo}`;

  let isUserWhite = Math.random() < 0.5;
  if (userColor === 'white') {
    isUserWhite = true;
  } else if (userColor === 'black') {
    isUserWhite = false;
  }

  const whiteUid = isUserWhite ? userUid : botUid;
  const blackUid = isUserWhite ? botUid : userUid;

  const initialClockTime = 10 * 60 * 1000; // 10 minutes default
  const matchTimeControl = '10 | 5';

  return {
    id: mId,
    players: [userUid, botUid],
    playerPair: [userUid, botUid].sort().join('_'),
    whiteUid,
    blackUid,
    stake: 0,
    mode: 'practice',
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
  };
}
