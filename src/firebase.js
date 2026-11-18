/**
 * Ringkasku — Firebase wiring.
 *
 * Services used (all from the Firebase JS SDK):
 *  - Firebase AI Logic (Hybrid Inference): Gemini Nano on-device via
 *    `InferenceMode.PREFER_ON_DEVICE`, cloud fallback Gemini 2.5 Flash.
 *  - Cloud Firestore: saved summaries (per anonymous user).
 *  - Remote Config: summary defaults, cloud threshold, welcome message.
 *  - App Check: reCAPTCHA Enterprise in production, debug provider on localhost.
 *  - Anonymous Auth: gives each device a stable uid for its own history.
 *
 * CONFIG: read from (in order)
 *   1. Vite env vars at build time (VITE_FIREBASE_API_KEY, …) — see .env.example
 *   2. window.__FIREBASE_CONFIG__ from public/firebase-config.js
 * If the apiKey is still the placeholder, the app runs in DEMO MODE:
 * the UI works end-to-end with a local extractive summarizer and no
 * Firebase calls are made. No production keys are ever stored in this repo.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app-check.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import {
  getRemoteConfig,
  fetchAndActivate,
  getString,
  getNumber,
  getBoolean,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-remote-config.js";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  Schema,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js";

export const PLACEHOLDER_API_KEY = "YOUR_API_KEY";

function readConfig() {
  const env = import.meta.env || {};
  const win = (typeof window !== "undefined" && window.__FIREBASE_CONFIG__) || {};
  const pick = (envKey, winKey) => env[envKey] || win[winKey] || "";
  return {
    apiKey: pick("VITE_FIREBASE_API_KEY", "apiKey"),
    authDomain: pick("VITE_FIREBASE_AUTH_DOMAIN", "authDomain"),
    projectId: pick("VITE_FIREBASE_PROJECT_ID", "projectId"),
    storageBucket: pick("VITE_FIREBASE_STORAGE_BUCKET", "storageBucket"),
    messagingSenderId: pick("VITE_FIREBASE_MESSAGING_SENDER_ID", "messagingSenderId"),
    appId: pick("VITE_FIREBASE_APP_ID", "appId"),
    measurementId: pick("VITE_FIREBASE_MEASUREMENT_ID", "measurementId"),
    recaptchaSiteKey: pick("VITE_RECAPTCHA_SITE_KEY", "recaptchaSiteKey"),
  };
}

export const firebaseConfig = readConfig();
export const isConfigured =
  Boolean(firebaseConfig.apiKey) && firebaseConfig.apiKey !== PLACEHOLDER_API_KEY;

/** Remote Config defaults — the app works even before a fetch succeeds. */
export const RC_DEFAULTS = {
  summary_default_length: "medium",
  summary_max_chars: 20000,
  cloud_threshold_chars: 6000,
  enable_cloud_fallback: true,
  welcome_message:
    "Tip: short notes stay private on your device with Gemini Nano; long documents use the cloud.",
};

export const remoteConfigValues = { ...RC_DEFAULTS };

let app = null;
let db = null;
let auth = null;
let remoteConfig = null;
let hybridModel = null;
let cloudModel = null;
let currentUser = null;

export const onAuthReadyCallbacks = [];
export function onAuthReady(cb) {
  if (currentUser) cb(currentUser);
  else onAuthReadyCallbacks.push(cb);
}

/** Structured-output schema for every summary (works on-device and in cloud). */
export const summarySchema = Schema.object({
  properties: {
    title: Schema.string({
      description: "A short, clear title for the notes (max 10 words).",
    }),
    summary: Schema.string({
      description: "The summary itself, in the requested language and length.",
    }),
    keyPoints: Schema.array({
      items: Schema.string(),
      description: "The most important points, each one short sentence.",
    }),
    actionItems: Schema.array({
      items: Schema.string(),
      description: "Concrete follow-ups / tasks mentioned in the notes, if any.",
    }),
    language: Schema.string({
      description: "ISO code of the language used in the summary: 'id' or 'en'.",
    }),
  },
  required: ["title", "summary", "keyPoints", "actionItems", "language"],
});

export function initFirebase() {
  if (!isConfigured) return { configured: false };
  app = initializeApp(firebaseConfig);

  // App Check: reCAPTCHA Enterprise in production; debug provider on localhost.
  // (Set self.FIREBASE_APPCHECK_DEBUG_TOKEN = true BEFORE initializeAppCheck
  // on localhost, then register the printed debug token in the console.)
  try {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    if (firebaseConfig.recaptchaSiteKey) {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(firebaseConfig.recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    }
  } catch (e) {
    console.warn("[ringkasku] App Check init skipped:", e?.message || e);
  }

  auth = getAuth(app);
  db = getFirestore(app);
  remoteConfig = getRemoteConfig(app);
  remoteConfig.settings = { minimumFetchIntervalMillis: 3600000, fetchTimeoutMillis: 10000 };
  remoteConfig.defaultConfig = RC_DEFAULTS;

  signInAnonymously(auth).catch((e) =>
    console.warn("[ringkasku] Anonymous sign-in failed (Auth may be disabled):", e?.message || e),
  );
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) onAuthReadyCallbacks.splice(0).forEach((cb) => cb(user));
  });

  // --- Firebase AI Logic (Hybrid Inference) ---
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  // Short notes: prefer on-device Gemini Nano, fall back to cloud Gemini.
  hybridModel = getGenerativeModel(ai, {
    model: "gemini-2.5-flash",
    mode: InferenceMode.PREFER_ON_DEVICE,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: summarySchema,
    },
  });
  // Long documents: cloud only (on-device Nano is small and single-turn).
  cloudModel = getGenerativeModel(ai, {
    model: "gemini-2.5-flash",
    mode: InferenceMode.ONLY_IN_CLOUD,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: summarySchema,
    },
  });

  return { configured: true };
}

export async function loadRemoteConfig() {
  if (!remoteConfig) return remoteConfigValues;
  try {
    await fetchAndActivate(remoteConfig);
    remoteConfigValues.summary_default_length =
      getString(remoteConfig, "summary_default_length") || RC_DEFAULTS.summary_default_length;
    remoteConfigValues.summary_max_chars =
      getNumber(remoteConfig, "summary_max_chars") || RC_DEFAULTS.summary_max_chars;
    remoteConfigValues.cloud_threshold_chars =
      getNumber(remoteConfig, "cloud_threshold_chars") || RC_DEFAULTS.cloud_threshold_chars;
    remoteConfigValues.enable_cloud_fallback = getBoolean(
      remoteConfig,
      "enable_cloud_fallback",
    );
    remoteConfigValues.welcome_message =
      getString(remoteConfig, "welcome_message") || RC_DEFAULTS.welcome_message;
  } catch (e) {
    console.warn("[ringkasku] Remote Config fetch failed, using defaults:", e?.message || e);
  }
  return remoteConfigValues;
}

/** Chrome Prompt API availability (Gemini Nano). Returns one of the spec strings. */
export async function checkOnDeviceAvailability() {
  try {
    if (typeof LanguageModel === "undefined") return "unsupported";
    return await LanguageModel.availability();
  } catch (e) {
    console.warn("[ringkasku] LanguageModel.availability() failed:", e?.message || e);
    return "unavailable";
  }
}

/**
 * Summarize via Firebase AI Logic.
 * @param {string} prompt
 * @param {'hybrid'|'cloud'} route
 * @param {(p:number)=>void} onDeviceProgress — download progress 0..1 (hybrid only)
 * @returns {Promise<{data: object, routeUsed: 'on-device'|'cloud'}>}
 */
export async function summarizeWithAI(prompt, route, onDeviceProgress) {
  const model = route === "cloud" ? cloudModel : hybridModel;
  if (!model) throw new Error("AI model is not initialized (no Firebase config).");

  if (route === "hybrid" && typeof model.initializeDeviceModel === "function") {
    // Must be called after/on a user gesture and before generateContent.
    model.initializeDeviceModel((v) => onDeviceProgress && onDeviceProgress(v));
  }

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  // The SDK reports the actual inference route on the enhanced response:
  // "on_device" (Gemini Nano) or "in_cloud" (Gemini 2.5 Flash).
  const source = result.response.inferenceSource;
  const routeUsed =
    source === "on_device" ? "on-device" : source === "in_cloud" ? "cloud" : route;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // If the model ignored the JSON schema, keep the raw text as the summary.
    data = { title: "Ringkasan", summary: text, keyPoints: [], actionItems: [], language: "?" };
  }
  return { data, routeUsed };
}

// ---------- Firestore: saved summaries ----------

export async function saveSummary(record) {
  if (!db || !currentUser) throw new Error("Firestore unavailable (no user session).");
  const ref = await addDoc(collection(db, "summaries"), {
    ...record,
    uid: currentUser.uid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listSummaries(max = 20) {
  if (!db || !currentUser) return [];
  const q = query(
    collection(db, "summaries"),
    where("uid", "==", currentUser.uid),
    orderBy("createdAt", "desc"),
    limit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function deleteSummary(id) {
  if (!db) return;
  await deleteDoc(doc(db, "summaries", id));
}
