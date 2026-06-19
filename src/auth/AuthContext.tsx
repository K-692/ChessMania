import React, { createContext, useContext, useEffect, useState } from 'react';
import { signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth';
import { auth, googleProvider, db } from '../firebase';
import type { UserProfile, WalletLedgerEntry } from '../types';
import { doc, getDoc, setDoc, runTransaction, collection, onSnapshot, query, where, getDocs } from 'firebase/firestore';
import { applyLazyHourlyRewardTx } from '../wallet/walletService';

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function detectCountryFromTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return '';
    const lowerTz = tz.toLowerCase();
    if (lowerTz.includes('calcutta') || lowerTz.includes('kolkata')) return 'India';
    if (lowerTz.includes('america')) return 'United States';
    if (lowerTz.includes('london')) return 'United Kingdom';
    if (lowerTz.includes('berlin')) return 'Germany';
    if (lowerTz.includes('paris')) return 'France';
    if (lowerTz.includes('tokyo')) return 'Japan';
    if (lowerTz.includes('shanghai') || lowerTz.includes('beijing')) return 'China';
    if (lowerTz.includes('toronto') || lowerTz.includes('vancouver') || lowerTz.includes('montreal')) return 'Canada';
    if (lowerTz.includes('sydney') || lowerTz.includes('melbourne') || lowerTz.includes('brisbane')) return 'Australia';
    if (lowerTz.includes('rome')) return 'Italy';
    if (lowerTz.includes('madrid')) return 'Spain';
    if (lowerTz.includes('amsterdam')) return 'Netherlands';
    if (lowerTz.includes('zurich')) return 'Switzerland';
    if (lowerTz.includes('stockholm')) return 'Sweden';
    if (lowerTz.includes('oslo')) return 'Norway';
    if (lowerTz.includes('helsinki')) return 'Finland';
    if (lowerTz.includes('copenhagen')) return 'Denmark';
    if (lowerTz.includes('singapore')) return 'Singapore';
    if (lowerTz.includes('auckland')) return 'New Zealand';
    if (lowerTz.includes('johannesburg')) return 'South Africa';
    if (lowerTz.includes('seoul')) return 'South Korea';
    if (lowerTz.includes('sao_paulo')) return 'Brazil';
    if (lowerTz.includes('moscow')) return 'Russia';
    if (lowerTz.includes('mexico_city')) return 'Mexico';
  } catch (e) {
    console.error('Error detecting country:', e);
  }
  return '';
}

export function sanitizeProfile(
  data: any,
  uid: string,
  googleDisplayName?: string,
  googlePhotoURL?: string
): { sanitized: UserProfile; hasChanges: boolean } {
  let hasChanges = false;
  const now = Date.now();

  const targetUid = data?.uid || uid;
  if (data?.uid !== targetUid) hasChanges = true;

  let displayName = data?.displayName;
  if (!displayName || displayName === 'Chess Player') {
    if (googleDisplayName && googleDisplayName !== 'Chess Player') {
      displayName = googleDisplayName;
      hasChanges = true;
    } else if (!displayName) {
      displayName = 'Chess Player';
      hasChanges = true;
    }
  }

  let photoURL = data?.photoURL;
  const defaultPhoto = 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop';
  if (!photoURL || photoURL === defaultPhoto) {
    if (googlePhotoURL && googlePhotoURL !== defaultPhoto) {
      photoURL = googlePhotoURL;
      hasChanges = true;
    } else if (!photoURL) {
      photoURL = defaultPhoto;
      hasChanges = true;
    }
  }

  let bankBalance = data?.bankBalance;
  if (typeof bankBalance !== 'number' || isNaN(bankBalance)) {
    const parsed = Number(bankBalance);
    bankBalance = (typeof bankBalance === 'string' && !isNaN(parsed)) ? parsed : 1000;
    hasChanges = true;
  }

  let rating = data?.rating;
  if (typeof rating !== 'number' || isNaN(rating)) {
    const parsed = Number(rating);
    rating = (typeof rating === 'string' && !isNaN(parsed)) ? parsed : 0;
    hasChanges = true;
  }

  let createdAt = data?.createdAt;
  if (typeof createdAt !== 'number' || isNaN(createdAt)) {
    createdAt = now;
    hasChanges = true;
  }

  let lastActiveAt = data?.lastActiveAt;
  if (typeof lastActiveAt !== 'number' || isNaN(lastActiveAt)) {
    lastActiveAt = now;
    hasChanges = true;
  }

  let zeroBalanceAt = data?.zeroBalanceAt;
  if (zeroBalanceAt !== null && zeroBalanceAt !== undefined) {
    if (typeof zeroBalanceAt !== 'number' || isNaN(zeroBalanceAt)) {
      zeroBalanceAt = null;
      hasChanges = true;
    }
  } else if (zeroBalanceAt === undefined) {
    zeroBalanceAt = null;
    hasChanges = true;
  }

  let lastInterestAppliedAt = data?.lastInterestAppliedAt;
  if (typeof lastInterestAppliedAt !== 'number' || isNaN(lastInterestAppliedAt)) {
    lastInterestAppliedAt = createdAt;
    hasChanges = true;
  }

  let lastHourlyRewardAt = data?.lastHourlyRewardAt;
  if (typeof lastHourlyRewardAt !== 'number' || isNaN(lastHourlyRewardAt)) {
    lastHourlyRewardAt = data?.lastInterestAppliedAt || createdAt;
    hasChanges = true;
  }

  let totalCoinsEarned = data?.totalCoinsEarned;
  if (typeof totalCoinsEarned !== 'number' || isNaN(totalCoinsEarned)) {
    const parsed = Number(totalCoinsEarned);
    totalCoinsEarned = (typeof totalCoinsEarned === 'string' && !isNaN(parsed)) ? parsed : Math.max(1000, bankBalance);
    hasChanges = true;
  }

  let country = data?.country;
  if (!country) {
    country = detectCountryFromTimezone() || '';
    if (country) {
      hasChanges = true;
    }
  }

  const sanitized: UserProfile = {
    uid: targetUid,
    displayName,
    photoURL,
    rating,
    bankBalance,
    createdAt,
    lastActiveAt,
    zeroBalanceAt,
    lastInterestAppliedAt,
    lastHourlyRewardAt,
    lastUsernameChangedAt: data?.lastUsernameChangedAt || null,
    totalCoinsEarned,
    gameplayCounts: data?.gameplayCounts || {},
    wins: typeof data?.wins === 'number' && !isNaN(data.wins) ? data.wins : 0,
    losses: typeof data?.losses === 'number' && !isNaN(data.losses) ? data.losses : 0,
    draws: typeof data?.draws === 'number' && !isNaN(data.draws) ? data.draws : 0,
    country: country || '',
    lastCountryChangedAt: data?.lastCountryChangedAt || null,
  };

  if (
    sanitized.displayName !== data?.displayName ||
    sanitized.photoURL !== data?.photoURL ||
    sanitized.lastUsernameChangedAt !== data?.lastUsernameChangedAt ||
    sanitized.lastHourlyRewardAt !== data?.lastHourlyRewardAt ||
    JSON.stringify(sanitized.gameplayCounts) !== JSON.stringify(data?.gameplayCounts) ||
    sanitized.wins !== data?.wins ||
    sanitized.losses !== data?.losses ||
    sanitized.draws !== data?.draws ||
    sanitized.country !== data?.country ||
    sanitized.lastCountryChangedAt !== data?.lastCountryChangedAt
  ) {
    hasChanges = true;
  }

  return { sanitized, hasChanges };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Sign in with Google
  const login = async () => {
    try {
      setLoading(true);
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error('Login error:', error);
      setLoading(false);
      if (error?.code === 'auth/operation-not-allowed') {
        alert("Google Sign-In is not enabled yet in your Firebase console. Please go to the Firebase Console -> Authentication -> Sign-in method -> Add new provider -> enable 'Google' and set the Support Email.");
      } else {
        alert(`Login failed: ${error?.message || error}`);
      }
      throw error;
    }
  };

  // Sign out
  const logout = async () => {
    try {
      setLoading(true);
      await signOut(auth);
      setProfile(null);
    } catch (error) {
      console.error('Logout error:', error);
      setLoading(false);
      throw error;
    }
  };

  // Bootstrap user profile document
  const bootstrapProfile = async (firebaseUser: FirebaseUser) => {
    // Wait 500ms to ensure Firestore client is fully authenticated and synchronized
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Ensure key Firestore configurations exist
    try {
      const supportConfigRef = doc(db, 'config', 'support');
      const supportSnap = await getDoc(supportConfigRef);
      if (!supportSnap.exists()) {
        await setDoc(supportConfigRef, {
          adminEmail: 'developer@checkmate.com',
          createdAt: Date.now()
        });
        console.log('Bootstrapped config/support document.');
      }

      const gameConfigRef = doc(db, 'config', 'game');
      const gameSnap = await getDoc(gameConfigRef);
      if (!gameSnap.exists()) {
        await setDoc(gameConfigRef, {
          hourlyRewardAmount: 100,
          maxHourlyRewardLimit: 1000,
          createdAt: Date.now()
        });
        console.log('Bootstrapped config/game document.');
      }
    } catch (e) {
      console.warn('Error checking/creating start configuration collections:', e);
    }

    const userDocRef = doc(db, 'users', firebaseUser.uid);
    
    try {
      const docSnap = await getDoc(userDocRef);
      const now = Date.now();

      let profileData = docSnap.exists() ? docSnap.data() as UserProfile : null;
      let forceHasChanges = false;

      if (!docSnap.exists()) {
        // First time sign-in: generate a unique, alphanumeric username based on Google name
        const actualName = firebaseUser.displayName || 'Player';
        let alphanumericName = actualName.replace(/[^a-zA-Z0-9]/g, '');
        if (alphanumericName.length < 3) {
          alphanumericName = 'Player';
        }

        let candidate = alphanumericName;
        const checkUnique = async (name: string) => {
          const q = query(collection(db, 'users'), where('displayName', '==', name));
          const snap = await getDocs(q);
          return snap.empty;
        };

        let isUnique = await checkUnique(candidate);
        let attempts = 0;
        while (!isUnique && attempts < 50) {
          const randomSuffix = Math.floor(100 + Math.random() * 900);
          candidate = `${alphanumericName}${randomSuffix}`;
          isUnique = await checkUnique(candidate);
          attempts++;
        }
        if (!isUnique) {
          candidate = `${alphanumericName}${Date.now().toString().slice(-4)}`;
        }

        profileData = {
          displayName: candidate,
        } as any;
        forceHasChanges = true;
      }

      const { sanitized, hasChanges } = sanitizeProfile(
        profileData,
        firebaseUser.uid,
        firebaseUser.displayName || undefined,
        firebaseUser.photoURL || undefined
      );

      if (!docSnap.exists() || hasChanges || forceHasChanges) {
        await runTransaction(db, async (transaction) => {
          if (!docSnap.exists()) {
            const ledgerEntry: Omit<WalletLedgerEntry, 'id'> = {
              uid: firebaseUser.uid,
              type: 'seed',
              amount: 1000,
              matchId: null,
              balanceBefore: 0,
              balanceAfter: 1000,
              createdAt: now,
            };
            const newLedgerDocRef = doc(collection(db, 'walletLedger'));
            transaction.set(newLedgerDocRef, ledgerEntry);
          }
          transaction.set(userDocRef, sanitized, { merge: true });
        });
      }

      if (docSnap.exists()) {
        // Profile exists, apply hourly rewards lazily
        await applyLazyHourlyRewardTx(firebaseUser.uid);

        // Correct legacy profile rating from 1200 to 0 if they haven't played any games
        const docSnapAfterInterest = await getDoc(userDocRef);
        if (docSnapAfterInterest.exists()) {
          const profileData = docSnapAfterInterest.data() as UserProfile;
          if (profileData.rating === 1200) {
            const ratingLedgerRef = collection(db, 'ratingLedger');
            const q = query(ratingLedgerRef, where('uid', '==', firebaseUser.uid));
            const ratingLedgerSnap = await getDocs(q);
            if (ratingLedgerSnap.empty) {
              await setDoc(userDocRef, { rating: 0 }, { merge: true });
            }
          }
        }
      }
      
      // Update last active timestamp
      await setDoc(userDocRef, { lastActiveAt: now }, { merge: true });

    } catch (error) {
      console.error('Error bootstrapping profile:', error);
    }
  };

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged(async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        await bootstrapProfile(firebaseUser);

        // Listen for realtime updates to the user profile
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const unsubscribeProfile = onSnapshot(userDocRef, async (docSnap) => {
          if (docSnap.exists()) {
            const rawData = docSnap.data();
            const { sanitized, hasChanges } = sanitizeProfile(
              rawData,
              firebaseUser.uid,
              firebaseUser.displayName || undefined,
              firebaseUser.photoURL || undefined
            );
            setProfile(sanitized);
            if (hasChanges) {
              console.log('Self-healing: fixing invalid profile values in Firestore:', rawData);
              try {
                await setDoc(userDocRef, sanitized, { merge: true });
              } catch (e) {
                console.error('Self-healing update failed:', e);
              }
            }
          }
          setLoading(false);
        });

        return () => unsubscribeProfile();
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
