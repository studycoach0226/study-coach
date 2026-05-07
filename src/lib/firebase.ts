// src/lib/firebase.ts
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const env = (import.meta as any).env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "YOUR_AUTH_DOMAIN",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "YOUR_STORAGE_BUCKET",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "YOUR_MESSAGING_SENDER_ID",
  appId: env.VITE_FIREBASE_APP_ID || "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);

console.log('[DEBUG] Firebase Config Check:');
console.log('- API_KEY:', env.VITE_FIREBASE_API_KEY ? `Loaded (${env.VITE_FIREBASE_API_KEY.substring(0, 5)}...)` : 'Missing');
console.log('- AUTH_DOMAIN:', env.VITE_FIREBASE_AUTH_DOMAIN || 'Missing');
console.log('- PROJECT_ID:', env.VITE_FIREBASE_PROJECT_ID || 'Missing');
console.log('- STORAGE_BUCKET:', env.VITE_FIREBASE_STORAGE_BUCKET || 'Missing');
console.log('- MESSAGING_SENDER_ID:', env.VITE_FIREBASE_MESSAGING_SENDER_ID || 'Missing');
console.log('- APP_ID:', env.VITE_FIREBASE_APP_ID || 'Missing');
console.log('[DEBUG] Storage Bucket Used:', firebaseConfig.storageBucket);

export const firestore = getFirestore(app);
export const storage = getStorage(app);
