/* ==========================================================
   Firebase bootstrap for TOURNAMENT MODE only.

   This module is only ever imported from the lazy-loaded tournament
   pages, so local mode never initializes Firebase or touches the
   network. Config comes from Vite env vars (see .env.example).

   Firestore is opened with a persistent local cache: if a referee
   loses signal on court, score writes queue locally and sync the
   moment the connection returns.
   ========================================================== */
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = () =>
  !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

let app = null, db = null, auth = null;

export function getDb() {
  if (!db) {
    app = initializeApp(firebaseConfig);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  return db;
}

/* anonymous sign-in: the referee/admin gets a stable uid without
   creating an account; resolves with the current or new user */
export function ensureAuth() {
  getDb();
  auth = auth || getAuth(app);
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      if (user) resolve(user);
      else signInAnonymously(auth).then((cred) => resolve(cred.user), reject);
    }, reject);
  });
}
