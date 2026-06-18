import React, { createContext, useContext, useEffect, useState } from 'react';
import { signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth';
import { auth, googleProvider, db } from '../firebase';
import type { UserProfile, WalletLedgerEntry } from '../types';
import { doc, getDoc, setDoc, runTransaction, collection, onSnapshot, query, where, getDocs } from 'firebase/firestore';
import { applyLazyInterestAndTopUpTx } from '../wallet/walletService';

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
    const userDocRef = doc(db, 'users', firebaseUser.uid);
    
    try {
      const docSnap = await getDoc(userDocRef);
      const now = Date.now();

      if (!docSnap.exists()) {
        // Run atomic transaction to create profile and initial ledger record
        await runTransaction(db, async (transaction) => {
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            displayName: firebaseUser.displayName || 'Chess Player',
            photoURL: firebaseUser.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop',
            rating: 0,
            bankBalance: 1000,
            createdAt: now,
            lastActiveAt: now,
            zeroBalanceAt: null,
            lastInterestAppliedAt: now,
            lastUsernameChangedAt: null,
            totalCoinsEarned: 1000,
            gameplayCounts: {},
            wins: 0,
            losses: 0,
            draws: 0,
          };

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
          
          transaction.set(userDocRef, newProfile);
          transaction.set(newLedgerDocRef, ledgerEntry);
        });
      } else {
        // Profile exists, apply daily interest and recovery top-ups lazily
        await applyLazyInterestAndTopUpTx(firebaseUser.uid);

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
        const unsubscribeProfile = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
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
