import React, { createContext, useContext, useEffect, useState } from 'react';
import { signInWithPopup, signOut, setPersistence, browserSessionPersistence, type User as FirebaseUser } from 'firebase/auth';
import { auth, googleProvider, db } from '../firebase';
import type { UserProfile } from '../types';
import { doc, getDoc, setDoc, runTransaction, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { applyLazyHourlyRewardTx } from '../wallet/walletService';

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  updateCachedProfile: (updates: Partial<UserProfile>) => void;
  addCachedTransaction: (tx: any) => void;
  addCachedEloHistory: (elo: any) => void;
  addCachedMatch: (match: any) => void;
  addCachedFriendUpdate: (friendUid: string, stats: any) => void;
  writeBackToFirestore: (userId: string) => Promise<void>;
  refetchProfile: () => Promise<void>;
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

  let bankBalance = data?.currentBalance !== undefined ? data.currentBalance : data?.bankBalance;
  if (typeof bankBalance !== 'number' || isNaN(bankBalance)) {
    const parsed = Number(bankBalance);
    bankBalance = (typeof bankBalance === 'string' && !isNaN(parsed)) ? parsed : 1000;
    hasChanges = true;
  }

  let rating = data?.currentEloRating !== undefined ? data.currentEloRating : data?.rating;
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

  let lastHourlyRewardAt = data?.lastHourlyRewardAt;
  if (typeof lastHourlyRewardAt !== 'number' || isNaN(lastHourlyRewardAt)) {
    lastHourlyRewardAt = createdAt;
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

  const wins = typeof data?.wins === 'number' && !isNaN(data.wins) ? data.wins : (typeof data?.totalWins === 'number' && !isNaN(data.totalWins) ? data.totalWins : 0);
  const losses = typeof data?.losses === 'number' && !isNaN(data.losses) ? data.losses : (typeof data?.totalLosses === 'number' && !isNaN(data.totalLosses) ? data.totalLosses : 0);
  const draws = typeof data?.draws === 'number' && !isNaN(data.draws) ? data.draws : (typeof data?.totalDraws === 'number' && !isNaN(data.totalDraws) ? data.totalDraws : 0);
  const totalGamesPlayed = wins + losses + draws;
  const winRateRatio = totalGamesPlayed > 0 ? Math.round((wins / totalGamesPlayed) * 100) : 0;

  // Settings preferences map bootstrapping
  let settings = data?.settings;
  if (!settings || typeof settings !== 'object') {
    let localSaved: any = {};
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('checkmate_sound_settings');
        if (saved) localSaved = JSON.parse(saved);
      } catch (e) {}
    }
    settings = {
      musicEnabled: !(localSaved.muted ?? false),
      musicVolume: localSaved.musicVolume ?? 0.5,
      soundEffectsEnabled: localSaved.effectsEnabled ?? true,
      legalMoveHintsEnabled: localSaved.showLegalMoves ?? true,
      preMovesEnabled: localSaved.preMoveEnabled ?? true,
      boardTheme: localSaved.boardTheme ?? '8_bit',
      pieceStyle: localSaved.pieceTheme ?? 'neo'
    };
    hasChanges = true;
  }

  const sanitized: UserProfile = {
    uid: targetUid,
    displayName,
    photoURL,
    currentEloRating: rating,
    rating, // compatibility
    currentBalance: bankBalance,
    bankBalance, // compatibility
    createdAt,
    lastActiveAt,
    zeroBalanceAt,
    lastHourlyRewardAt,
    lastUsernameChangedAt: data?.lastUsernameChangedAt || null,
    totalCoinsEarned,
    gameplayCounts: data?.gameplayCounts || {},
    wins,
    losses,
    draws,
    totalGamesPlayed,
    totalWins: wins,
    totalLosses: losses,
    totalDraws: draws,
    winRateRatio,
    lastLoginAt: data?.lastLoginAt || now,
    updatedAt: data?.updatedAt || now,
    country: country || '',
    lastCountryChangedAt: data?.lastCountryChangedAt || null,
    settings
  };

  if (
    sanitized.displayName !== data?.displayName ||
    sanitized.photoURL !== data?.photoURL ||
    sanitized.currentEloRating !== data?.currentEloRating ||
    sanitized.currentBalance !== data?.currentBalance ||
    sanitized.lastUsernameChangedAt !== data?.lastUsernameChangedAt ||
    sanitized.lastHourlyRewardAt !== data?.lastHourlyRewardAt ||
    JSON.stringify(sanitized.gameplayCounts) !== JSON.stringify(data?.gameplayCounts) ||
    sanitized.totalGamesPlayed !== data?.totalGamesPlayed ||
    sanitized.totalWins !== data?.totalWins ||
    sanitized.totalLosses !== data?.totalLosses ||
    sanitized.totalDraws !== data?.totalDraws ||
    sanitized.winRateRatio !== data?.winRateRatio ||
    sanitized.country !== data?.country ||
    sanitized.lastCountryChangedAt !== data?.lastCountryChangedAt ||
    JSON.stringify(sanitized.settings) !== JSON.stringify(data?.settings)
  ) {
    hasChanges = true;
  }

  return { sanitized, hasChanges };
}

interface CacheData {
  profileUpdates: Partial<UserProfile>;
  transactions: any[];
  eloHistory: any[];
  matches: any[];
  friendsUpdates?: { friendUid: string; stats: any }[];
}

function getUnsavedCache(): CacheData {
  try {
    const data = localStorage.getItem('checkmate_unsaved_cache');
    if (data) {
      const parsed = JSON.parse(data);
      if (!parsed.friendsUpdates) parsed.friendsUpdates = [];
      return parsed;
    }
  } catch (e) {}
  return { profileUpdates: {}, transactions: [], eloHistory: [], matches: [], friendsUpdates: [] };
}

function saveUnsavedCache(cache: CacheData) {
  try {
    localStorage.setItem('checkmate_unsaved_cache', JSON.stringify(cache));
  } catch (e) {}
}

function clearUnsavedCache() {
  try {
    localStorage.removeItem('checkmate_unsaved_cache');
  } catch (e) {}
}

export const writeBackToFirestore = async (userId: string) => {
  const cache = getUnsavedCache();
  const friendsUpdates = cache.friendsUpdates || [];
  if (
    Object.keys(cache.profileUpdates).length === 0 &&
    cache.transactions.length === 0 &&
    cache.eloHistory.length === 0 &&
    cache.matches.length === 0 &&
    friendsUpdates.length === 0
  ) {
    return;
  }

  console.log('Writing back session cache to Firestore in a batch...', cache);
  const batch = writeBatch(db);

  // 1. Profile updates
  if (Object.keys(cache.profileUpdates).length > 0) {
    const userDocRef = doc(db, 'users', userId);
    batch.update(userDocRef, cache.profileUpdates);

    // Update global leaderboard
    const leaderboardDocRef = doc(db, 'leaderboards', 'global', 'players', userId);
    const lbUpdates: any = {};
    if (cache.profileUpdates.displayName !== undefined) lbUpdates.displayName = cache.profileUpdates.displayName;
    if (cache.profileUpdates.photoURL !== undefined) lbUpdates.photoURL = cache.profileUpdates.photoURL;
    if (cache.profileUpdates.currentEloRating !== undefined) lbUpdates.eloRating = cache.profileUpdates.currentEloRating;
    if (cache.profileUpdates.totalCoinsEarned !== undefined) lbUpdates.coinsEarned = cache.profileUpdates.totalCoinsEarned;
    if (cache.profileUpdates.totalGamesPlayed !== undefined) lbUpdates.totalGamesPlayed = cache.profileUpdates.totalGamesPlayed;
    if (cache.profileUpdates.winRateRatio !== undefined) lbUpdates.winRateRatio = cache.profileUpdates.winRateRatio;
    if (cache.profileUpdates.gameplayCounts !== undefined) lbUpdates.gameplayCounts = cache.profileUpdates.gameplayCounts;
    lbUpdates.updatedAt = Date.now();

    batch.set(leaderboardDocRef, lbUpdates, { merge: true });
  }

  // 2. Transactions
  cache.transactions.forEach((tx) => {
    const txRef = doc(collection(db, 'transactions'));
    batch.set(txRef, tx);
  });

  // 3. Elo History
  cache.eloHistory.forEach((elo) => {
    const eloRef = doc(collection(db, 'users', userId, 'eloHistory'));
    batch.set(eloRef, elo);
  });

  // 4. Matches (like finished practice matches)
  cache.matches.forEach((m) => {
    const matchRef = doc(db, 'matches', m.id);
    batch.set(matchRef, m, { merge: true });
  });

  // 5. Friends H2H updates
  friendsUpdates.forEach((f: any) => {
    const friendDocRef = doc(db, 'users', userId, 'friends', f.friendUid);
    batch.set(friendDocRef, { stats: f.stats }, { merge: true });
  });

  try {
    await batch.commit();
    clearUnsavedCache();
    console.log('Session cache successfully committed.');
  } catch (err) {
    console.error('Failed to commit session cache:', err);
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Expose cache update helpers to components
  const updateCachedProfile = (updates: Partial<UserProfile>) => {
    setProfile((prev) => {
      if (!prev) return null;
      const next = { ...prev, ...updates };

      const cache = getUnsavedCache();
      cache.profileUpdates = { ...cache.profileUpdates, ...updates };
      saveUnsavedCache(cache);

      return next;
    });
  };

  const addCachedTransaction = (tx: any) => {
    const cache = getUnsavedCache();
    cache.transactions.push(tx);
    saveUnsavedCache(cache);
  };

  const addCachedEloHistory = (elo: any) => {
    const cache = getUnsavedCache();
    cache.eloHistory.push(elo);
    saveUnsavedCache(cache);
  };

  const addCachedMatch = (match: any) => {
    const cache = getUnsavedCache();
    cache.matches = cache.matches.filter((m) => m.id !== match.id);
    cache.matches.push(match);
    saveUnsavedCache(cache);
  };

  const addCachedFriendUpdate = (friendUid: string, stats: any) => {
    const cache = getUnsavedCache();
    if (!cache.friendsUpdates) {
      cache.friendsUpdates = [];
    }
    cache.friendsUpdates = cache.friendsUpdates.filter((f) => f.friendUid !== friendUid);
    cache.friendsUpdates.push({ friendUid, stats });
    saveUnsavedCache(cache);
  };

  const refetchProfile = async () => {
    if (!auth.currentUser) return;
    const userDocRef = doc(db, 'users', auth.currentUser.uid);
    const docSnap = await getDoc(userDocRef);
    if (docSnap.exists()) {
      const rawData = docSnap.data();
      const { sanitized } = sanitizeProfile(
        rawData,
        auth.currentUser.uid,
        auth.currentUser.displayName || undefined,
        auth.currentUser.photoURL || undefined
      );
      const unsaved = getUnsavedCache();
      const mergedProfile = { ...sanitized, ...unsaved.profileUpdates };
      setProfile(mergedProfile);
    }
  };

  // Sign in with Google
  const login = async () => {
    try {
      setLoading(true);
      sessionStorage.setItem('checkmate_is_logging_in', 'true');
      await setPersistence(auth, browserSessionPersistence);
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
      if (auth.currentUser) {
        await writeBackToFirestore(auth.currentUser.uid);
      }
      await signOut(auth);
      setProfile(null);
      clearUnsavedCache();
    } catch (error) {
      console.error('Logout error:', error);
      setLoading(false);
      throw error;
    }
  };

  // Bootstrap user profile document
  const bootstrapProfile = async (firebaseUser: FirebaseUser) => {
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      const supportConfigRef = doc(db, 'config', 'support');
      const supportSnap = await getDoc(supportConfigRef);
      if (!supportSnap.exists()) {
        await setDoc(supportConfigRef, {
          adminEmail: 'krishnendu.pal.work@gmail.com',
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

      const chatConfigRef = doc(db, 'config', 'chat');
      const chatSnap = await getDoc(chatConfigRef);
      if (!chatSnap.exists()) {
        await setDoc(chatConfigRef, {
          historyExpiryHours: 24,
          createdAt: Date.now()
        });
        console.log('Bootstrapped config/chat document.');
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
            const ledgerEntry = {
              uid: firebaseUser.uid,
              userId: firebaseUser.uid,
              type: 'reward',
              amount: 0,
              coins: 1000,
              currency: 'INR',
              status: 'processed',
              processedAt: now,
              createdAt: now,
              matchId: null,
              balanceBefore: 0,
              balanceAfter: 1000,
            };
            const newLedgerDocRef = doc(collection(db, 'transactions'));
            transaction.set(newLedgerDocRef, ledgerEntry);
          }
          transaction.set(userDocRef, sanitized, { merge: true });
        });
      }

      const leaderboardDocRef = doc(db, 'leaderboards', 'global', 'players', firebaseUser.uid);
      await setDoc(leaderboardDocRef, {
        uid: firebaseUser.uid,
        displayName: sanitized.displayName,
        photoURL: sanitized.photoURL,
        eloRating: sanitized.currentEloRating,
        coinsEarned: sanitized.totalCoinsEarned,
        totalGamesPlayed: sanitized.totalGamesPlayed || 0,
        winRateRatio: sanitized.winRateRatio || 0,
        gameplayCounts: sanitized.gameplayCounts || {},
        updatedAt: now
      }, { merge: true });

      if (docSnap.exists() && profileData) {
        const lastReward = profileData.lastHourlyRewardAt;
        const timeDiff = Date.now() - (lastReward || 0);

        if (!lastReward || timeDiff >= 3600000) {
          await applyLazyHourlyRewardTx(firebaseUser.uid);
        }

        const docSnapAfterInterest = await getDoc(userDocRef);
        if (docSnapAfterInterest.exists()) {
          const profileData = docSnapAfterInterest.data() as UserProfile;
          if (profileData.rating === 1200) {
            const eloHistoryRef = collection(db, 'users', firebaseUser.uid, 'eloHistory');
            const eloHistorySnap = await getDocs(eloHistoryRef);
            if (eloHistorySnap.empty) {
              await setDoc(userDocRef, { currentEloRating: 0, rating: 0 }, { merge: true });
              await setDoc(leaderboardDocRef, { eloRating: 0 }, { merge: true });
            }
          }
        }
      }
      
      await setDoc(userDocRef, { lastLoginAt: now }, { merge: true });
      localStorage.setItem(`checkmate_session_login_time_${firebaseUser.uid}`, now.toString());
      setProfile(sanitized);

    } catch (error) {
      console.error('Error bootstrapping profile:', error);
    }
  };

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        const lastActivity = parseInt(localStorage.getItem('checkmate_last_activity') || '0');
        const timeSinceLastActivity = Date.now() - lastActivity;

        if (lastActivity > 0 && timeSinceLastActivity > 5 * 60 * 1000) {
          console.log('Detected inactivity over 5 minutes on startup. Logging out...');
          await writeBackToFirestore(firebaseUser.uid);
          await signOut(auth);
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }

        setUser(firebaseUser);

        // Commit any cached changes from previous tab/session first
        await writeBackToFirestore(firebaseUser.uid);

        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const docSnap = await getDoc(userDocRef);
        if (docSnap.exists()) {
          const rawData = docSnap.data();

          // New device detection check
          const localLoginTime = parseInt(localStorage.getItem(`checkmate_session_login_time_${firebaseUser.uid}`) || '0');
          const serverLoginTime = rawData.lastLoginAt || 0;
          if (localLoginTime > 0 && serverLoginTime > localLoginTime + 2000) {
            console.log('Detected newer login on another device. Logging out...');
            await signOut(auth);
            setUser(null);
            setProfile(null);
            setLoading(false);
            alert('You have been logged out because a new sign-in was detected on another device.');
            return;
          }

          if (localLoginTime === 0) {
            localStorage.setItem(`checkmate_session_login_time_${firebaseUser.uid}`, serverLoginTime.toString());
          }

          // Handle if user is logging in now vs refreshing
          const isLoggingIn = sessionStorage.getItem('checkmate_is_logging_in') === 'true';
          sessionStorage.removeItem('checkmate_is_logging_in');
          const now = Date.now();

          if (isLoggingIn) {
            await setDoc(userDocRef, { lastLoginAt: now }, { merge: true });
            localStorage.setItem(`checkmate_session_login_time_${firebaseUser.uid}`, now.toString());
            rawData.lastLoginAt = now;
          }

          const { sanitized, hasChanges } = sanitizeProfile(
            rawData,
            firebaseUser.uid,
            firebaseUser.displayName || undefined,
            firebaseUser.photoURL || undefined
          );
          
          // Apply unsaved profile modifications to the loaded profile state
          const unsaved = getUnsavedCache();
          const mergedProfile = { ...sanitized, ...unsaved.profileUpdates };
          setProfile(mergedProfile);

          if (hasChanges && isLoggingIn) {
            await setDoc(userDocRef, sanitized, { merge: true });
          }
        } else {
          await bootstrapProfile(firebaseUser);
        }
        setLoading(false);
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // Inactivity auto-logout after 10 seconds and online reconnection logout
  useEffect(() => {
    if (!user) return;

    let timeoutId: any;

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      localStorage.setItem('checkmate_last_activity', Date.now().toString());

      timeoutId = setTimeout(async () => {
        console.log('Inactivity timeout reached (5 minutes). Logging out...');
        try {
          await logout();
          alert('You have been logged out due to 5 minutes of inactivity.');
        } catch (e) {
          console.warn('Failed to logout on inactivity timeout:', e);
        }
      }, 5 * 60 * 1000); // 5 minutes
    };

    const activityEvents = [
      'mousedown', 'mousemove', 'keypress',
      'scroll', 'touchstart', 'click'
    ];

    resetTimer();

    activityEvents.forEach((event) => {
      window.addEventListener(event, resetTimer);
    });

    const handleOnline = async () => {
      console.log('Reconnected network event. Logging out...');
      try {
        await logout();
        alert('You have been logged out because you reconnected. Please sign in again.');
      } catch (e) {
        console.warn('Failed to logout on reconnect:', e);
      }
    };
    window.addEventListener('online', handleOnline);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      activityEvents.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
      window.removeEventListener('online', handleOnline);
    };
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        login,
        logout,
        updateCachedProfile,
        addCachedTransaction,
        addCachedEloHistory,
        addCachedMatch,
        addCachedFriendUpdate,
        writeBackToFirestore,
        refetchProfile
      }}
    >
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
