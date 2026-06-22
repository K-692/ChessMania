import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'dummy-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'check-mate-6e0a7.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'check-mate-6e0a7',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'check-mate-6e0a7.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || 'dummy-sender-id',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || 'dummy-app-id',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://check-mate-6e0a7-default-rtdb.firebaseio.com',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Configure Google Auth provider options
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export default app;
