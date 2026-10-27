import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, ref, onValue, get, set, remove } from 'firebase/database';

// Firebase web configuration. The API key identifies the Firebase project;
// database access is protected by the Realtime Database rules in database.rules.json.
const firebaseConfig = {
  apiKey: 'AIzaSyDE1nWKsBcfcjN-1iBCsLZbB3cNGKfYd6V0',
  authDomain: 'forum-bb6bd.firebaseapp.com',
  databaseURL: 'https://forum-bb6bd-default-rtdb.firebaseio.com',
  projectId: 'forum-bb6bd',
  storageBucket: 'forum-bb6bd.firebasestorage.app',
  messagingSenderId: '340776346318',
  appId: '1:340776346318:web:8584871aba2d9ef0a8269f',
  measurementId: 'G-C9DLRTXM1H',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export { signInAnonymously, onAuthStateChanged, ref, onValue, get, set, remove };
