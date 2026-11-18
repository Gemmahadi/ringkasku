# Ringkasku — Bilingual Note Summarizer

> **Ringkasku** ("my summary" in Indonesian) turns long notes — meeting minutes,
> lectures, articles — into short, structured summaries in **Bahasa Indonesia or
> English**. Short notes are summarized **on-device with Gemini Nano** (private,
> offline, free); long documents are routed to **cloud Gemini**. Summaries are
> saved to Cloud Firestore and the app's behaviour is tuned via Remote Config.

Built for **#BuildHybridAI 2026** (Devpost × Google Firebase) and also submitted
to **SLAY HACKS 2026**. License: **Apache-2.0**.

---

## Why it fits #BuildHybridAI

| Hackathon requirement | How Ringkasku meets it |
|---|---|
| Built with Firebase AI Logic **Hybrid Inference SDK** | `getGenerativeModel(ai, { model: "gemini-2.5-flash", mode: InferenceMode.PREFER_ON_DEVICE })` — Nano on-device when available, seamless cloud fallback otherwise. Long docs use a second `ONLY_IN_CLOUD` model. |
| On-device via Gemini Nano | Chrome desktop 139+ Prompt API; `model.initializeDeviceModel()` is called on the user's click (user-activation requirement) with a download-progress bar. |
| Also uses other Firebase products | **Cloud Firestore** (saved summaries, per-user), **Remote Config** (length default, max chars, cloud threshold, welcome message), **App Check** (reCAPTCHA v3 prod / debug provider localhost), **Anonymous Auth** (per-device history). |
| Public repo + open-source license | This repo, Apache-2.0. |
| Demo video (≤ 3 min) | `../video/ringkasku-demo.mp4` (also linked in the submission text). |
| Hosted demo URL | Deploy with `firebase deploy --only hosting` (see below) — needs a real Firebase project (see **Setup**). |

## How the hybrid routing works

```
User pastes notes ──► length > cloud_threshold_chars (Remote Config, default 6000)?
                      ├─ YES ──► cloud model (ONLY_IN_CLOUD, gemini-2.5-flash)
                      └─ NO  ──► hybrid model (PREFER_ON_DEVICE)
                                   ├─ Gemini Nano available → on-device summary
                                   └─ otherwise → cloud fallback (same call)
```

Every summary is requested as **structured JSON** (`responseMimeType:
"application/json"` + a `responseSchema`: title, summary, keyPoints,
actionItems, language) — supported both on-device and in the cloud. The UI
shows the **actual inference route** reported by the SDK
(`response.inferenceSource`: `on_device` / `in_cloud`) as a badge on every
summary — no guessing.

## Demo mode (no Firebase project yet)

Without a Firebase config the app runs in **clearly labelled Demo mode**: the
full UI flow (input → summary → copy/download) works with a dependency-free
local extractive summarizer, and nothing is uploaded. Demo summaries are
badged "Demo · local extractive" and are never saved. Connect a Firebase
project to get real AI summaries.

## Run locally

No build step, no bundler — plain static files. The Firebase JS SDK (v13.4.0)
loads from the official Google CDN.

```bash
# from this folder
python3 -m http.server 8080
# open http://localhost:8080
```

Requirements for on-device inference: **Chrome desktop 139+** with the flag
`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled, and
enough disk space for the first Nano model download.

## Setup — connect a real Firebase project

> ⚠️ This is the one step that needs a Google account with Firebase access
> (the builder VM has no Firebase project and no Google login).

1. Create a project at <https://console.firebase.google.com> and add a **Web app**.
2. In the console: **AI Logic → Get started** (choose the **Gemini Developer
   API** provider — free tier), which also enforces App Check.
3. Enable **Firestore** (production mode), **Remote Config**, **App Check**,
   and **Authentication → Anonymous**.
4. In App Check, add a **reCAPTCHA v3** site key and register it; for local
   development, the app sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` on
   localhost — copy the debug token from the browser console and register it
   under App Check → Apps → Manage debug tokens.
5. Deploy the rules/indexes/template in this repo:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,remoteconfig,hosting
   ```
6. Paste your web app config into `firebase-config.js` (or inject it
   at deploy time). **Never commit production API keys or Google Cloud
   secrets** — the placeholder file in this repo is safe to share.

Remote Config keys (defaults live in `src/firebase.js`, template in
`remote-config-template.json`):

| Key | Default | Meaning |
|---|---|---|
| `summary_default_length` | `medium` | short / medium / detailed |
| `summary_max_chars` | `20000` | max input length |
| `cloud_threshold_chars` | `6000` | above this → cloud model |
| `enable_cloud_fallback` | `true` | allow cloud fallback |
| `welcome_message` | … | empty-state message |

## Project structure

```
ringkasku/
├── index.html                  # App shell + UI
├── firebase-config.js          # PLACEHOLDER Firebase config (replace on deploy)
├── favicon.svg
├── src/
│   ├── main.js                 # UI logic, history, copy/download, ?autodemo=1
│   ├── firebase.js             # App init, App Check, Auth, Firestore,
│   │                           # Remote Config, AI Logic models
│   ├── summarizer.js           # AI prompt builder + demo-mode extractive
│   │                           # summarizer + built-in ID/EN samples
│   └── styles.css
├── firestore.rules             # per-user summaries, immutable once written
├── firestore.indexes.json      # uid + createdAt desc (history query)
├── firebase.json               # Hosting + Firestore + Remote Config deploy
├── remote-config-template.json
├── .env.example / .gitignore
└── LICENSE (Apache-2.0)
```

## Verification status (honest)

Verified in the build VM (2026-11-18, Chromium 157):

- ✅ App serves and renders; all controls work (sample load, file upload,
  char counter, route hint, copy/download buttons).
- ✅ Demo-mode summarization works end-to-end for the ID + EN samples
  (see `../video/ringkasku-demo.mp4`).
- ✅ Firebase JS SDK v13.4.0 modules load from the CDN; `InferenceMode`,
  `initializeDeviceModel`, and `response.inferenceSource` confirmed present
  in the shipped SDK build.
- ✅ `LanguageModel.availability()` probed in this Chromium (see
  `../verification.md`) — on-device Nano model download is environment
  dependent (see below).
- ⏳ **Needs a real Firebase project** (parent's step): AI summaries via
  Firebase AI Logic, Firestore save/history, Remote Config fetch, App Check
  attestation, and anonymous sign-in. Code paths are written exactly per the
  official Firebase docs; they cannot be exercised without project
  credentials, and no credentials exist in this repo by design.

## Credits

- Built by **GEMMA WORKS** (Adi, gemmahadi@gmail.com) for #BuildHybridAI 2026.
- Firebase AI Logic docs: <https://firebase.google.com/docs/ai-logic/hybrid/web/get-started>
- Sample meeting notes are original fiction written for this demo.
