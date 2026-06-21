import { db } from '../firebase';
import { doc, runTransaction, collection } from 'firebase/firestore';
import type { UserProfile, WalletLedgerEntry } from '../types';

/**
 * Calculates hourly rewards due for a profile.
 * Does not write to DB; returns modified profile and ledger entries to write.
 */
export function calculateHourlyReward(
  profile: UserProfile,
  nowMs: number,
  config?: { hourlyRewardAmount: number; maxHourlyRewardLimit: number; hourlyRewardIntervalMinutes: number }
): {
  updatedProfile: UserProfile;
  ledgerEntries: Omit<WalletLedgerEntry, 'id'>[];
} {
  const amount = config?.hourlyRewardAmount ?? 100;
  const limit = config?.maxHourlyRewardLimit ?? 1000;
  const intervalMins = config?.hourlyRewardIntervalMinutes ?? 60;

  const updatedProfile = { ...profile };
  const ledgerEntries: Omit<WalletLedgerEntry, 'id'>[] = [];

  // Ensure balance and timestamps are valid numbers
  const baseBalance = typeof profile.currentBalance === 'number' && !isNaN(profile.currentBalance)
    ? profile.currentBalance
    : (typeof profile.bankBalance === 'number' && !isNaN(profile.bankBalance) ? profile.bankBalance : limit);

  const lastHourlyRewardAt = typeof profile.lastHourlyRewardAt === 'number' && !isNaN(profile.lastHourlyRewardAt)
    ? profile.lastHourlyRewardAt
    : (profile.createdAt && !isNaN(profile.createdAt) ? profile.createdAt : nowMs);

  // Apply default fallbacks directly to the updatedProfile copy
  updatedProfile.currentBalance = baseBalance;
  updatedProfile.bankBalance = baseBalance; // compatibility
  updatedProfile.lastHourlyRewardAt = lastHourlyRewardAt;
  updatedProfile.zeroBalanceAt = null; // We remove zero-balance recovery since hourly reward covers it

  // Hourly Reward: amount coins for every interval user's balance is below limit, capped at limit.
  const intervalMs = intervalMins * 60 * 1000;
  const elapsedMs = nowMs - lastHourlyRewardAt;
  const elapsedHours = isNaN(elapsedMs) || elapsedMs <= 0 ? 0 : Math.floor(elapsedMs / intervalMs);

  if (elapsedHours > 0) {
    let currentBalance = baseBalance;
    let totalCoinsEarned = profile.totalCoinsEarned || baseBalance;
    let earnedThisSession = 0;

    // Loop through each full interval to apply the reward
    for (let i = 0; i < elapsedHours; i++) {
      if (currentBalance < limit) {
        const increment = Math.min(amount, limit - currentBalance);
        if (increment > 0) {
          currentBalance = Math.round((currentBalance + increment) * 10000) / 10000;
          totalCoinsEarned = Math.round((totalCoinsEarned + increment) * 10000) / 10000;
          earnedThisSession += increment;
        }
      }
    }

    if (earnedThisSession > 0) {
      updatedProfile.currentBalance = currentBalance;
      updatedProfile.bankBalance = currentBalance; // compatibility
      updatedProfile.totalCoinsEarned = totalCoinsEarned;

      ledgerEntries.push({
        uid: profile.uid,
        userId: profile.uid,
        type: 'reward',
        coins: earnedThisSession,
        amount: 0,
        currency: 'INR',
        status: 'processed',
        processedAt: nowMs,
        matchId: null,
        balanceBefore: baseBalance,
        balanceAfter: currentBalance,
        createdAt: nowMs,
      } as any);
    }

    // Advance the hourly reward timestamp by the number of intervals processed
    updatedProfile.lastHourlyRewardAt = lastHourlyRewardAt + (elapsedHours * intervalMs);
  }

  return { updatedProfile, ledgerEntries };
}

/**
 * Runs a Firestore transaction to apply hourly rewards.
 */
export async function applyLazyHourlyRewardTx(uid: string): Promise<UserProfile> {
  const userDocRef = doc(db, 'users', uid);
  const ledgerColRef = collection(db, 'transactions');
  const gameConfigRef = doc(db, 'config', 'game');

  return runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userDocRef);
    if (!userDoc.exists()) {
      throw new Error(`User profile for ${uid} does not exist`);
    }

    const gameConfigSnap = await transaction.get(gameConfigRef);
    const configData = gameConfigSnap.exists() ? gameConfigSnap.data() : null;
    const config = configData ? {
      hourlyRewardAmount: configData.hourlyRewardAmount ?? 100,
      maxHourlyRewardLimit: configData.maxHourlyRewardLimit ?? 1000,
      hourlyRewardIntervalMinutes: configData.hourlyRewardIntervalMinutes ?? 60
    } : undefined;

    const currentProfile = userDoc.data() as UserProfile;
    const now = Date.now();

    const { updatedProfile, ledgerEntries } = calculateHourlyReward(currentProfile, now, config);

    // If changes occurred, commit them
    const balanceChanged = updatedProfile.currentBalance !== currentProfile.currentBalance;
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
