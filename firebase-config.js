/**
 * Ringkasku — Firebase web app configuration.
 *
 * PLACEHOLDER ONLY. Replace these values with your own Firebase project's
 * web app config (Firebase console → Project settings → Your apps → Web app).
 *
 * DO NOT commit production API keys or Google Cloud secrets to this repo.
 * For deployment, either edit this file on the deploy machine or inject
 * the config via environment variables at build/serve time — see README.md
 * and .env.example.
 *
 * To get a real config:
 *   1. Create a Firebase project at https://console.firebase.google.com
 *   2. Add a Web app, enable AI Logic (Gemini Developer API), Firestore,
 *      Remote Config, App Check, and Anonymous Auth.
 *   3. Paste the config object here.
 */
window.__FIREBASE_CONFIG__ = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "",
  // reCAPTCHA v3 site key for App Check in production (optional for local demo).
  recaptchaSiteKey: "",
};
