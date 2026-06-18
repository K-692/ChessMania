import { db } from '../firebase';
import { doc, runTransaction, collection } from 'firebase/firestore';
import type { UserProfile, WalletLedgerEntry } from '../types';

/**
 * Calculates interest and top-ups due for a profile.
 * Does not write to DB; returns modified profile and ledger entries to write.
 */
export function calculateInterestAndTopUp(
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
  const lastInterestAppliedAt = typeof profile.lastInterestAppliedAt === 'number' && !isNaN(profile.lastInterestAppliedAt) 
    ? profile.lastInterestAppliedAt 
    : (profile.createdAt || nowMs);

  // Apply default fallbacks directly to the updatedProfile copy
  updatedProfile.bankBalance = baseBalance;
  updatedProfile.lastInterestAppliedAt = lastInterestAppliedAt;

  // 1. Daily Interest: 1% per day (compounded daily or simple interest per day elapsed)
  // We use fractional days for continuous lazy interest updates down to the millisecond
  const elapsedMs = nowMs - lastInterestAppliedAt;
  const dayMs = 24 * 60 * 60 * 1000;
  const elapsedDays = elapsedMs / dayMs;

  if (elapsedMs > 0 && baseBalance > 0) {
    const rawInterest = baseBalance * 0.01 * elapsedDays;
    // Keep 4 decimal places of precision for granular coins
    const interestEarned = Math.round(rawInterest * 10000) / 10000;

    if (interestEarned > 0.0001) {
      const balanceBefore = baseBalance;
      updatedProfile.bankBalance = Math.round((baseBalance + interestEarned) * 10000) / 10000;
      updatedProfile.totalCoinsEarned = Math.round(((profile.totalCoinsEarned || baseBalance) + interestEarned) * 10000) / 10000;
      updatedProfile.lastInterestAppliedAt = nowMs; // Reset timer to current check

      ledgerEntries.push({
        uid: profile.uid,
        type: 'interest',
        amount: interestEarned,
        matchId: null,
        balanceBefore,
        balanceAfter: updatedProfile.bankBalance,
        createdAt: nowMs,
      });
    }
  } else if (elapsedMs > 0) {
    updatedProfile.lastInterestAppliedAt = nowMs;
  }

  // 2. Zero-Balance Recovery: 100 coins after 1 hour of zero balance
  if (updatedProfile.bankBalance <= 0) {
    if (updatedProfile.zeroBalanceAt === null || updatedProfile.zeroBalanceAt === undefined) {
      updatedProfile.zeroBalanceAt = nowMs;
    } else {
      const zeroElapsed = nowMs - updatedProfile.zeroBalanceAt;
      const hourMs = 60 * 60 * 1000;
      if (zeroElapsed >= hourMs) {
        const balanceBefore = updatedProfile.bankBalance;
        updatedProfile.bankBalance = 100;
        updatedProfile.zeroBalanceAt = null;
        updatedProfile.totalCoinsEarned = (updatedProfile.totalCoinsEarned || 0) + 100;

        ledgerEntries.push({
          uid: profile.uid,
          type: 'topup',
          amount: 100,
          matchId: null,
          balanceBefore,
          balanceAfter: 100,
          createdAt: nowMs,
        });
      }
    }
  } else {
    // If balance is positive, zeroBalanceAt should be null
    updatedProfile.zeroBalanceAt = null;
  }

  return { updatedProfile, ledgerEntries };
}

/**
 * Runs a Firestore transaction to apply daily interest and zero-balance recovery top-ups.
 */
export async function applyLazyInterestAndTopUpTx(uid: string): Promise<UserProfile> {
  const userDocRef = doc(db, 'users', uid);
  const ledgerColRef = collection(db, 'walletLedger');

  return runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userDocRef);
    if (!userDoc.exists()) {
      throw new Error(`User profile for ${uid} does not exist`);
    }

    const currentProfile = userDoc.data() as UserProfile;
    const now = Date.now();

    const { updatedProfile, ledgerEntries } = calculateInterestAndTopUp(currentProfile, now);

    // If changes occurred, commit them
    const balanceChanged = updatedProfile.bankBalance !== currentProfile.bankBalance;
    const interestTimestampChanged = updatedProfile.lastInterestAppliedAt !== currentProfile.lastInterestAppliedAt;
    const zeroBalanceTimestampChanged = updatedProfile.zeroBalanceAt !== currentProfile.zeroBalanceAt;

    if (balanceChanged || interestTimestampChanged || zeroBalanceTimestampChanged) {
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
