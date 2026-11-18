/**
 * Ringkasku — Firebase web app configuration.
 *
 * REAL project config for the "ringkasku" Firebase project (Spark plan,
 * created 18 Nov 2026 for the #BuildHybridAI submission). The apiKey and
 * reCAPTCHA site key below are public client identifiers — they ship in
 * the web bundle by design. Real security comes from Firestore rules,
 * App Check enforcement and Anonymous Auth, not from hiding these values.
 *
 * App Check uses the reCAPTCHA Enterprise provider: the Firebase console
 * no longer accepts new reCAPTCHA Classic (v3) registrations, so the app
 * was registered with the Fraud Defense (Enterprise) provider instead.
 */
window.__FIREBASE_CONFIG__ = {
  apiKey: "AIzaSyBKOIkSPpz7fZPL9ABub8exog-2ZcY45SU",
  authDomain: "ringkasku.firebaseapp.com",
  projectId: "ringkasku",
  storageBucket: "ringkasku.firebasestorage.app",
  messagingSenderId: "409614680711",
  appId: "1:409614680711:web:1e7f8b08c91227a89dae22",
  measurementId: "",
  // reCAPTCHA Enterprise site key for App Check in production (optional for local demo).
  recaptchaSiteKey: "6LdK3yUuAAAAAALy5shEFkk6aaQP1tfwGtM10UOw",
};
