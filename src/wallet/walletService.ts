import { db } from '../firebase';
import { doc, runTransaction, collection } from 'firebase/firestore';
import type { UserProfile, WalletLedgerEntry } from '../types';

/**
 * Calculates hourly rewards due for a profile.
 * Does not write to DB; returns modified profile and ledger entries to write.
 */
export function calculateHourlyReward(
  profile: UserProfile,
  nowMs: number
): {
  updatedProfile: UserProfile;
  ledgerEntries: Omit<WalletLedgerEntry, 'id'>[];
} {
  const updatedProfile = { ...profile };
  const ledgerEntries: Omit<WalletLedgerEntry, 'id'>[] = [];

  // Ensure balance and timestamps are valid numbers
  const baseBalance = typeof profile.bankBalance === 'number' && !isNaN(profile.bankBalance) ? profile.bankBalance : 1000;
  const lastHourlyRewardAt = typeof profile.lastHourlyRewardAt === 'number' && !isNaN(profile.lastHourlyRewardAt)
    ? profile.lastHourlyRewardAt
    : (profile.createdAt && !isNaN(profile.createdAt) ? profile.createdAt : nowMs);

  // Apply default fallbacks directly to the updatedProfile copy
  updatedProfile.bankBalance = baseBalance;
  updatedProfile.lastHourlyRewardAt = lastHourlyRewardAt;
  updatedProfile.zeroBalanceAt = null; // We remove zero-balance recovery since hourly reward covers it

  // Hourly Reward: 100 coins for every hour the user's balance is below 1000, capped at 1000.
  const hourMs = 60 * 60 * 1000;
  const elapsedMs = nowMs - lastHourlyRewardAt;
  const elapsedHours = isNaN(elapsedMs) || elapsedMs <= 0 ? 0 : Math.floor(elapsedMs / hourMs);

  if (elapsedHours > 0) {
    let currentBalance = baseBalance;
    let totalCoinsEarned = profile.totalCoinsEarned || baseBalance;
    let earnedThisSession = 0;

    // Loop through each full hour to apply the reward
    for (let i = 0; i < elapsedHours; i++) {
      if (currentBalance < 1000) {
        const increment = Math.min(100, 1000 - currentBalance);
        if (increment > 0) {
          currentBalance = Math.round((currentBalance + increment) * 10000) / 10000;
          totalCoinsEarned = Math.round((totalCoinsEarned + increment) * 10000) / 10000;
          earnedThisSession += increment;
        }
      }
    }

    if (earnedThisSession > 0) {
      updatedProfile.bankBalance = currentBalance;
      updatedProfile.totalCoinsEarned = totalCoinsEarned;

      ledgerEntries.push({
        uid: profile.uid,
        type: 'hourly_reward',
        amount: earnedThisSession,
        matchId: null,
        balanceBefore: baseBalance,
        balanceAfter: currentBalance,
        createdAt: nowMs,
      });
    }

    // Advance the hourly reward timestamp by the number of hours processed
    updatedProfile.lastHourlyRewardAt = lastHourlyRewardAt + (elapsedHours * hourMs);
  }

  return { updatedProfile, ledgerEntries };
}

/**
 * Runs a Firestore transaction to apply hourly rewards.
 */
export async function applyLazyHourlyRewardTx(uid: string): Promise<UserProfile> {
  const userDocRef = doc(db, 'users', uid);
  const ledgerColRef = collection(db, 'walletLedger');

  return runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userDocRef);
    if (!userDoc.exists()) {
      throw new Error(`User profile for ${uid} does not exist`);
    }

    const currentProfile = userDoc.data() as UserProfile;
    const now = Date.now();

    const { updatedProfile, ledgerEntries } = calculateHourlyReward(currentProfile, now);

    // If changes occurred, commit them
    const balanceChanged = updatedProfile.bankBalance !== currentProfile.bankBalance;
    const rewardTimestampChanged = updatedProfile.lastHourlyRewardAt !== currentProfile.lastHourlyRewardAt;
    const zeroBalanceChanged = updatedProfile.zeroBalanceAt !== currentProfile.zeroBalanceAt;

    if (balanceChanged || rewardTimestampChanged || zeroBalanceChanged) {
      transaction.set(userDocRef, updatedProfile);

      // Write ledger entries
      for (const entry of ledgerEntries) {
        const newLedgerDocRef = doc(ledgerColRef);
        transaction.set(newLedgerDocRef, entry);
      }
    }

    return updatedProfile;
  });
}

