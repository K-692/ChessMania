import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { signInWithPopup, signOut, setPersistence, browserSessionPersistence, type User as FirebaseUser } from 'firebase/auth';
import { auth, googleProvider, db, rtdb } from '../firebase';
import type { UserProfile } from '../types';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { ref as rRef, set as rSet, onDisconnect, onValue, serverTimestamp } from 'firebase/database';

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  isLoggingOut: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  updateCachedProfile: (updates: Partial<UserProfile>) => void;
  refetchProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const profileUnsubRef = useRef<(() => void) | null>(null);

  // Expose cache update helpers to components
  const updateCachedProfile = async (updates: Partial<UserProfile>) => {
    if (!user) return;
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, updates, { merge: true });
      setProfile((prev) => (prev ? { ...prev, ...updates } : null));
    } catch (err) {
      console.error('Failed to update user profile in Firestore:', err);
    }
  };

  const refetchProfile = async () => {
    if (!auth.currentUser) return;
    try {
      const userDocRef = doc(db, 'users', auth.currentUser.uid);
      const docSnap = await getDoc(userDocRef);
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
      }
    } catch (err) {
      console.error('Failed to refetch user profile:', err);
    }
  };

  // Sign in with Google
  const login = async () => {
    try {
      setLoading(true);
      await setPersistence(auth, browserSessionPersistence);
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error('Login error:', error);
      setLoading(false);
      if (error?.code === 'auth/operation-not-allowed') {
        alert("Google Sign-In is not enabled yet in your Firebase console. Please go to the Firebase Console -> Authentication -> Sign-in method -> enable 'Google' and set the Support Email.");
      } else {
        alert(`Login failed: ${error?.message || error}`);
      }
      throw error;
    }
  };

  // Sign out
  const logout = async () => {
    try {
      setIsLoggingOut(true);
      setLoading(true);
      
      if (auth.currentUser) {
        // Mark user offline in RTDB explicitly
        try {
          const statusRef = rRef(rtdb, `status/${auth.currentUser.uid}`);
          await rSet(statusRef, {
            state: 'offline',
            lastChanged: serverTimestamp()
          });
        } catch (err) {
          console.warn("Failed to mark user offline in RTDB on logout:", err);
        }
      }

      await signOut(auth);
      setProfile(null);
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    } finally {
      setIsLoggingOut(false);
      setLoading(false);
    }
  };

  // Bootstrap user profile document
  const bootstrapProfile = async (firebaseUser: FirebaseUser) => {
    const userDocRef = doc(db, 'users', firebaseUser.uid);
    const now = Date.now();

    try {
      const docSnap = await getDoc(userDocRef);

      if (!docSnap.exists()) {
        const actualName = firebaseUser.displayName || 'Player';
        // Clean display name of symbols
        let alphanumericName = actualName.replace(/[^a-zA-Z0-9]/g, '');
        if (alphanumericName.length < 3) {
          alphanumericName = 'Player';
        }
        
        // Ensure name is unique
        let candidate = alphanumericName;
        let attempts = 0;
        let isUnique = false;
        while (!isUnique && attempts < 10) {
          const suffix = attempts === 0 ? '' : Math.floor(100 + Math.random() * 900);
          candidate = `${alphanumericName}${suffix}`;
          // Let's assume unique or let Firestore update succeed
          isUnique = true; 
          attempts++;
        }

        const newProfile: UserProfile = {
          uid: firebaseUser.uid,
          displayName: candidate,
          photoURL: firebaseUser.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop',
          rating: 1200,
          createdAt: now,
          wins: 0,
          losses: 0,
          draws: 0,
          totalGamesPlayed: 0,
          lastUsernameChangedAt: null,
          settings: {
            musicEnabled: true,
            musicVolume: 0.5,
            soundEffectsEnabled: true,
            legalMoveHintsEnabled: true,
            boardTheme: 'green',
            pieceStyle: 'neo'
          }
        };

        await setDoc(userDocRef, newProfile);
        setProfile(newProfile);
      } else {
        const existingData = docSnap.data() as UserProfile;
        // Merge compatible settings if missing
        if (!existingData.settings) {
          existingData.settings = {
            musicEnabled: true,
            musicVolume: 0.5,
            soundEffectsEnabled: true,
            legalMoveHintsEnabled: true,
            boardTheme: 'green',
            pieceStyle: 'neo'
          };
          await setDoc(userDocRef, { settings: existingData.settings }, { merge: true });
        }
        setProfile(existingData);
      }
    } catch (error) {
      console.error('Error bootstrapping profile:', error);
    }
  };

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged(async (firebaseUser) => {
      if (profileUnsubRef.current) {
        profileUnsubRef.current();
        profileUnsubRef.current = null;
      }

      if (firebaseUser) {
        setUser(firebaseUser);
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        
        // Listen to profile document in real-time
        profileUnsubRef.current = onSnapshot(userDocRef, async (docSnap) => {
          if (!docSnap.exists()) {
            await bootstrapProfile(firebaseUser);
            return;
          }

          const rawData = docSnap.data() as UserProfile;
          setProfile(rawData);
          setLoading(false);
        });
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (profileUnsubRef.current) {
        profileUnsubRef.current();
      }
    };
  }, []);

  // Presence status registration in RTDB
  useEffect(() => {
    if (!user) return;
    
    const statusRef = rRef(rtdb, `status/${user.uid}`);
    const connectedRef = rRef(rtdb, '.info/connected');
    let heartbeatInterval: any;

    const isOfflineForDatabase = {
      state: 'offline',
      lastChanged: serverTimestamp()
    };
    const isOnlineForDatabase = {
      state: 'online',
      lastChanged: serverTimestamp()
    };

    // Re-register presence on (re)connect
    const unsubConnected = onValue(connectedRef, async (snapshot) => {
      if (snapshot.val() === false) return;

      try {
        await onDisconnect(statusRef).set(isOfflineForDatabase);
        await rSet(statusRef, isOnlineForDatabase);
      } catch (err) {
        console.warn("Failed to register presence on (re)connect:", err);
      }
    });

    // Heartbeat every 20 seconds
    heartbeatInterval = setInterval(async () => {
      try {
        await rSet(statusRef, isOnlineForDatabase);
      } catch (e) {
        console.warn("Heartbeat presence write failed:", e);
      }
    }, 20000);

    return () => {
      unsubConnected();
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      rSet(statusRef, isOfflineForDatabase).catch(err => 
        console.warn("Failed to clean up presence on logout/unmount:", err)
      );
    };
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isLoggingOut,
        login,
        logout,
        updateCachedProfile,
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
