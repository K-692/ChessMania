import { db } from '../firebase';
import { doc, runTransaction, collection, getDoc, getDocs, query, where, setDoc } from 'firebase/firestore';
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
export async function settleMatchPayoutAndElo(matchId: string): Promise<void> {
  const matchDocRef = doc(db, 'matches', matchId);
  const ledgerCol = collection(db, 'transactions');

  // Query friendship document before transaction (use single-field queries to avoid composite index requirement)
  const matchSnapOuter = await getDoc(matchDocRef);
  let friendshipDocRef: any = null;
  if (matchSnapOuter.exists()) {
    const matchData = matchSnapOuter.data() as Match;
    const p1Uid = matchData.players[0];
    const p2Uid = matchData.players[1];
    if (p1Uid && p2Uid) {
      const friendshipsRef = collection(db, 'friendships');
      // Query by requesterUid only, then filter client-side for receiverUid and status
      const q1 = query(friendshipsRef, where('requesterUid', '==', p1Uid));
      const q2 = query(friendshipsRef, where('requesterUid', '==', p2Uid));
      const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);

      // Find the doc where p1 requested p2 and it's accepted
      const doc1 = snap1.docs.find(d => d.data().receiverUid === p2Uid && d.data().status === 'accepted');
      if (doc1) {
        friendshipDocRef = doc(db, 'friendships', doc1.id);
      } else {
        // Find the doc where p2 requested p1 and it's accepted
        const doc2 = snap2.docs.find(d => d.data().receiverUid === p1Uid && d.data().status === 'accepted');
        if (doc2) {
          friendshipDocRef = doc(db, 'friendships', doc2.id);
        }
      }
    }
  }

  await runTransaction(db, async (transaction) => {
    const matchSnap = await transaction.get(matchDocRef);
    if (!matchSnap.exists()) return;

    const matchData = matchSnap.data() as Match;

    // Guard: Only settle if match state indicates game has ended but is not yet settled
    // We can use a custom field on match like "settled: true" to ensure idempotency.
    if ((matchData as any).settled === true) {
      console.log('Match already settled');
      return;
    }

    const isDraw = matchData.status === 'draw' || matchData.status === 'stalemate';
    const hasWinner = !!matchData.winnerUid;

    if (!isDraw && !hasWinner) {
      // Game is still active; don't settle yet
      return;
    }

    const now = Date.now();

    if (matchData.mode === 'practice') {
      transaction.update(matchDocRef, {
        settled: true,
        finishedAt: now,
      });
      return;
    }
    const p1Uid = matchData.players[0];
    const p2Uid = matchData.players[1];

    const p1UserRef = doc(db, 'users', p1Uid);
    const p2UserRef = doc(db, 'users', p2Uid);

    const p1Snap = await transaction.get(p1UserRef);
    const p2Snap = await transaction.get(p2UserRef);

    if (!p1Snap.exists() || !p2Snap.exists()) {
      throw new Error('One of the player profiles was not found');
    }

    const p1Profile = p1Snap.data() as UserProfile;
    const p2Profile = p2Snap.data() as UserProfile;

    const p1Rating = p1Profile.currentEloRating !== undefined ? p1Profile.currentEloRating : p1Profile.rating;
    const p2Rating = p2Profile.currentEloRating !== undefined ? p2Profile.currentEloRating : p2Profile.rating;
    const p1Balance = p1Profile.currentBalance !== undefined ? p1Profile.currentBalance : p1Profile.bankBalance;
    const p2Balance = p2Profile.currentBalance !== undefined ? p2Profile.currentBalance : p2Profile.bankBalance;

    // Calculate Elo changes
    // Determine actual score for p1 and p2
    let p1Score = 0.5;
    let p2Score = 0.5;

    if (hasWinner) {
      p1Score = matchData.winnerUid === p1Uid ? 1 : 0;
      p2Score = matchData.winnerUid === p2Uid ? 1 : 0;
    }

    const p1Elo = calculateElo(p1Rating, p2Rating, p1Score);
    const p2Elo = calculateElo(p2Rating, p1Rating, p2Score);

    const newP1Rating = matchData.stake === 0 ? p1Rating : Math.max(100, p1Rating + p1Elo.delta);
    const newP2Rating = matchData.stake === 0 ? p2Rating : Math.max(100, p2Rating + p2Elo.delta);

    // Calculate payouts (escrow returns/winnings)
    let p1Payout = 0;
    let p2Payout = 0;
    let p1Earned = 0;
    let p2Earned = 0;

    if (matchData.mode === 'all_in' && matchData.allInStakes) {
      const p1StakeVal = matchData.allInStakes[p1Uid] || 0;
      const p2StakeVal = matchData.allInStakes[p2Uid] || 0;
      const totalPool = p1StakeVal + p2StakeVal;

      if (isDraw) {
        p1Payout = p1StakeVal;
        p2Payout = p2StakeVal;
      } else if (matchData.winnerUid === p1Uid) {
        p1Payout = totalPool;
        p1Earned = p2StakeVal; // Net coins won
      } else {
        p2Payout = totalPool;
        p2Earned = p1StakeVal; // Net coins won
      }
    } else {
      // Standard match payout
      if (isDraw) {
        p1Payout = matchData.stake;
        p2Payout = matchData.stake;
      } else if (matchData.winnerUid === p1Uid) {
        p1Payout = matchData.stake * 2;
        p1Earned = matchData.stake;
      } else {
        p2Payout = matchData.stake * 2;
        p2Earned = matchData.stake;
      }
    }

    const newP1Balance = Math.round((p1Balance + p1Payout) * 100) / 100;
    const newP2Balance = Math.round((p2Balance + p2Payout) * 100) / 100;

    const newP1TotalCoins = Math.round(((p1Profile.totalCoinsEarned || p1Balance) + p1Earned) * 100) / 100;
    const newP2TotalCoins = Math.round(((p2Profile.totalCoinsEarned || p2Balance) + p2Earned) * 100) / 100;

    // Increment game counts and win/loss/draw stats
    const p1Counts = p1Profile.gameplayCounts || {};
    const newP1Counts = { ...p1Counts, [matchData.mode]: (p1Counts[matchData.mode] || 0) + 1 };
    let p1Wins = p1Profile.totalWins !== undefined ? p1Profile.totalWins : (p1Profile.wins || 0);
    let p1Losses = p1Profile.totalLosses !== undefined ? p1Profile.totalLosses : (p1Profile.losses || 0);
    let p1Draws = p1Profile.totalDraws !== undefined ? p1Profile.totalDraws : (p1Profile.draws || 0);
    if (isDraw) p1Draws++;
    else if (matchData.winnerUid === p1Uid) p1Wins++;
    else p1Losses++;
    const p1TotalGamesPlayed = p1Wins + p1Losses + p1Draws;
    const p1WinRateRatio = p1TotalGamesPlayed > 0 ? p1Wins / p1TotalGamesPlayed : 0;

    const p2Counts = p2Profile.gameplayCounts || {};
    const newP2Counts = { ...p2Counts, [matchData.mode]: (p2Counts[matchData.mode] || 0) + 1 };
    let p2Wins = p2Profile.totalWins !== undefined ? p2Profile.totalWins : (p2Profile.wins || 0);
    let p2Losses = p2Profile.totalLosses !== undefined ? p2Profile.totalLosses : (p2Profile.losses || 0);
    let p2Draws = p2Profile.totalDraws !== undefined ? p2Profile.totalDraws : (p2Profile.draws || 0);
    if (isDraw) p2Draws++;
    else if (matchData.winnerUid === p2Uid) p2Wins++;
    else p2Losses++;
    const p2TotalGamesPlayed = p2Wins + p2Losses + p2Draws;
    const p2WinRateRatio = p2TotalGamesPlayed > 0 ? p2Wins / p2TotalGamesPlayed : 0;

    // Update profiles
    transaction.update(p1UserRef, {
      currentEloRating: newP1Rating,
      rating: newP1Rating, // compatibility
      currentBalance: newP1Balance,
      bankBalance: newP1Balance, // compatibility
      zeroBalanceAt: newP1Balance <= 0 ? now : null,
      totalCoinsEarned: newP1TotalCoins,
      gameplayCounts: newP1Counts,
      wins: p1Wins,
      losses: p1Losses,
      draws: p1Draws,
      totalWins: p1Wins,
      totalLosses: p1Losses,
      totalDraws: p1Draws,
      totalGamesPlayed: p1TotalGamesPlayed,
      winRateRatio: p1WinRateRatio,
      updatedAt: now
    });

    transaction.update(p2UserRef, {
      currentEloRating: newP2Rating,
      rating: newP2Rating, // compatibility
      currentBalance: newP2Balance,
      bankBalance: newP2Balance, // compatibility
      zeroBalanceAt: newP2Balance <= 0 ? now : null,
      totalCoinsEarned: newP2TotalCoins,
      gameplayCounts: newP2Counts,
      wins: p2Wins,
      losses: p2Losses,
      draws: p2Draws,
      totalWins: p2Wins,
      totalLosses: p2Losses,
      totalDraws: p2Draws,
      totalGamesPlayed: p2TotalGamesPlayed,
      winRateRatio: p2WinRateRatio,
      updatedAt: now
    });

    // Write payout transaction records (transactions collection)
    if (p1Payout > 0 || matchData.stake === 0) {
      const p1LedgerRef = doc(ledgerCol);
      transaction.set(p1LedgerRef, {
        uid: p1Uid,
        userId: p1Uid,
        type: isDraw ? 'refund' : 'stakeCredit',
        amount: 0,
        coins: p1Payout,
        currency: 'INR',
        status: 'processed',
        processedAt: now,
        matchId: matchData.id,
        balanceBefore: p1Balance,
        balanceAfter: newP1Balance,
        createdAt: now,
        opponentUid: p2Uid,
      });
    }

    if (p2Payout > 0 || matchData.stake === 0) {
      const p2LedgerRef = doc(ledgerCol);
      transaction.set(p2LedgerRef, {
        uid: p2Uid,
        userId: p2Uid,
        type: isDraw ? 'refund' : 'stakeCredit',
        amount: 0,
        coins: p2Payout,
        currency: 'INR',
        status: 'processed',
        processedAt: now,
        matchId: matchData.id,
        balanceBefore: p2Balance,
        balanceAfter: newP2Balance,
        createdAt: now,
        opponentUid: p1Uid,
      });
    }

    // Write Elo history subcollection records (users/{uid}/eloHistory)
    if (matchData.stake > 0 || matchData.stake === 0) {
      const p1RatingLedgerRef = doc(collection(db, 'users', p1Uid, 'eloHistory'));
      transaction.set(p1RatingLedgerRef, {
        beforeRating: p1Rating,
        afterRating: newP1Rating,
        delta: matchData.stake === 0 ? 0 : p1Elo.delta,
        expectedScore: p1Elo.expectedScore,
        actualScore: p1Score,
        kFactor: 20,
        createdAt: now,
        opponentUid: p2Uid,
        matchId: matchData.id,
        mode: matchData.mode
      });

      const p2RatingLedgerRef = doc(collection(db, 'users', p2Uid, 'eloHistory'));
      transaction.set(p2RatingLedgerRef, {
        beforeRating: p2Rating,
        afterRating: newP2Rating,
        delta: matchData.stake === 0 ? 0 : p2Elo.delta,
        expectedScore: p2Elo.expectedScore,
        actualScore: p2Score,
        kFactor: 20,
        createdAt: now,
        opponentUid: p1Uid,
        matchId: matchData.id,
        mode: matchData.mode
      });
    }

    // Sync leaderboards
    const p1LeaderboardRef = doc(db, 'leaderboards', 'global', 'players', p1Uid);
    transaction.set(p1LeaderboardRef, {
      uid: p1Uid,
      displayName: p1Profile.displayName,
      photoURL: p1Profile.photoURL,
      eloRating: newP1Rating,
      coinsEarned: newP1TotalCoins,
      totalGamesPlayed: p1TotalGamesPlayed,
      winRateRatio: p1WinRateRatio,
      gameplayCounts: newP1Counts,
      updatedAt: now
    }, { merge: true });

    const p2LeaderboardRef = doc(db, 'leaderboards', 'global', 'players', p2Uid);
    transaction.set(p2LeaderboardRef, {
      uid: p2Uid,
      displayName: p2Profile.displayName,
      photoURL: p2Profile.photoURL,
      eloRating: newP2Rating,
      coinsEarned: newP2TotalCoins,
      totalGamesPlayed: p2TotalGamesPlayed,
      winRateRatio: p2WinRateRatio,
      gameplayCounts: newP2Counts,
      updatedAt: now
    }, { merge: true });

    // Update friendship H2H statistics if friendship exists
    if (friendshipDocRef) {
      const friendshipSnap = await transaction.get(friendshipDocRef);
      if (friendshipSnap.exists()) {
        const stats = (friendshipSnap.data() as any).stats || {};
        if (!stats[p1Uid]) stats[p1Uid] = { wins: 0, losses: 0, draws: 0 };
        if (!stats[p2Uid]) stats[p2Uid] = { wins: 0, losses: 0, draws: 0 };

        if (isDraw) {
          stats[p1Uid].draws += 1;
          stats[p2Uid].draws += 1;
        } else if (matchData.winnerUid === p1Uid) {
          stats[p1Uid].wins += 1;
          stats[p2Uid].losses += 1;
        } else if (matchData.winnerUid === p2Uid) {
          stats[p2Uid].wins += 1;
          stats[p1Uid].losses += 1;
        }

        transaction.update(friendshipDocRef, { stats });
      }
    }

    // Mark match as settled to guarantee idempotency on retries
    transaction.update(matchDocRef, {
      settled: true,
      finishedAt: now,
    });
  });
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
  const ledgerCol = collection(db, 'transactions');
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
      const challengerLedgerRef = doc(ledgerCol);
      transaction.set(challengerLedgerRef, {
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
      });

      const challengedLedgerRef = doc(ledgerCol);
      transaction.set(challengedLedgerRef, {
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

    let initialClockTime = 10 * 60 * 1000;
    let matchTimeControl = '';
    
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
 * Seeding a practice match against a bot engine.
 */
export async function createPracticeMatch(
  userUid: string,
  botElo: number,
  userColor: 'white' | 'black' | 'random'
): Promise<string> {
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

  const newMatch: Match = {
    id: mId,
    players: [userUid, botUid],
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

  await setDoc(newMatchDocRef, newMatch);
  return mId;
}
