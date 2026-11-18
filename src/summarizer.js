/**
 * Ringkasku — summarization helpers.
 *
 * Two paths:
 *  1. buildPrompt() — prompt sent to Firebase AI Logic (Gemini Nano on-device
 *     or cloud Gemini). Asks for structured JSON matching summarySchema.
 *  2. summarizeLocally() — DEMO MODE fallback. A dependency-free extractive
 *     summarizer used ONLY when no Firebase project is configured, so the
 *     full UI flow (input → summary → history) can be exercised and demoed
 *     without any backend. It is clearly labelled "Demo" in the UI and is
 *     never presented as an AI summary.
 */

// ---------- Prompt for Firebase AI Logic ----------

const LENGTH_GUIDE = {
  short: {
    id: "Buat ringkasan SINGKAT: 3-5 kalimat saja, hanya hal terpenting.",
    en: "Write a SHORT summary: only 3-5 sentences, the most important points.",
  },
  medium: {
    id: "Buat ringkasan SEDANG: satu paragraf padat, lalu 3-5 poin penting.",
    en: "Write a MEDIUM summary: one dense paragraph, then 3-5 key points.",
  },
  detailed: {
    id: "Buat ringkasan DETAIL: dua paragraf, sampai 8 poin penting, dan daftar semua hal yang perlu ditindaklanjuti.",
    en: "Write a DETAILED summary: two paragraphs, up to 8 key points, and list every follow-up action.",
  },
};

const STYLE_GUIDE = {
  bullets: {
    id: "Gaya: poin-poin yang jelas dan ringkas.",
    en: "Style: clear, concise bullet points.",
  },
  paragraph: {
    id: "Gaya: paragraf mengalir seperti narasi.",
    en: "Style: flowing narrative paragraphs.",
  },
  study: {
    id: "Gaya: catatan belajar — jelaskan definisi istilah penting dan beri contoh bila ada.",
    en: "Style: study notes — define key terms and give examples when present.",
  },
};

export function buildPrompt(text, { lang, length, style }) {
  const target =
    lang === "en"
      ? "English"
      : lang === "id"
        ? "Bahasa Indonesia"
        : "the same language as the notes (Indonesian or English)";
  const guide = (table) => table[lang === "en" ? "en" : "id"];
  const instruction =
    lang === "en"
      ? `Summarize the following notes in ${target}. ${guide(LENGTH_GUIDE)} ${guide(STYLE_GUIDE)} Respond with JSON matching the requested schema: title, summary, keyPoints, actionItems, language ("id" or "en").`
      : `Ringkas catatan berikut dalam ${target}. ${guide(LENGTH_GUIDE)} ${guide(STYLE_GUIDE)} Jawab dengan JSON sesuai skema yang diminta: title, summary, keyPoints, actionItems, language ("id" atau "en").`;
  return `${instruction}\n\n--- CATATAN / NOTES ---\n${text}`;
}

// ---------- Demo-mode extractive summarizer ----------

const STOPWORDS = new Set(
  ("yang dan di ke dari untuk dengan pada adalah ini itu sebagai oleh karena juga atau tidak ada akan bisa harus dapat mereka kita saya kamu dia mereka dalam sebuah serta saat setelah sebelum antara maupun namun jika kalau agar supaya lalu kemudian sangat lebih paling hanya saja pun".split(
    " ",
  )),
);
const STOPWORDS_EN = new Set(
  "the a an and or of to in on for with is are was were be been it this that as by at from we you they he she i our your their not no but so if then than when after before about into over under more most only also very just can could should would will".split(
    " ",
  ),
);
const ACTION_HINTS_ID = [
  "harus",
  "perlu",
  "lakukan",
  "tugas",
  "deadline",
  "segera",
  "akan ",
  "rencana",
  "tindak lanjut",
  "tolong",
  "mohon",
  "jadwal",
];
const ACTION_HINTS_EN = [
  "must",
  "should",
  "need to",
  "todo",
  "action",
  "deadline",
  "asap",
  "will ",
  "plan",
  "follow up",
  "schedule",
  "please",
];

function splitSentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);
}

function detectLang(text) {
  const idHits = (text.toLowerCase().match(/\b(yang|dan|untuk|dengan|adalah|ini|itu|dari|dalam|akan|harus|perlu)\b/g) || []).length;
  return idHits >= 3 ? "id" : "en";
}

export function summarizeLocally(text, { lang, length, style }) {
  const detected = detectLang(text);
  const outLang = lang === "auto" ? detected : lang;
  const stop = outLang === "id" ? STOPWORDS : STOPWORDS_EN;
  const actionHints = outLang === "id" ? ACTION_HINTS_ID : ACTION_HINTS_EN;

  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return {
      title: outLang === "id" ? "Catatan singkat" : "Short note",
      summary: text.trim(),
      keyPoints: [],
      actionItems: [],
      language: outLang,
    };
  }

  // Word-frequency scoring (classic extractive summarization).
  const freq = new Map();
  for (const s of sentences) {
    for (const w of s.toLowerCase().replace(/[^a-zà-ÿ0-9 ]/gi, "").split(" ")) {
      if (w.length > 3 && !stop.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  const score = (s) => {
    const words = s.toLowerCase().replace(/[^a-zà-ÿ0-9 ]/gi, "").split(" ");
    let total = 0;
    let n = 0;
    for (const w of words) {
      if (w.length > 3 && !stop.has(w)) {
        total += freq.get(w) || 0;
        n++;
      }
    }
    return n ? total / Math.sqrt(n) : 0;
  };

  const ranked = sentences
    .map((s, i) => ({ s, i, sc: score(s) }))
    .sort((a, b) => b.sc - a.sc);

  const keepCount = length === "short" ? 3 : length === "detailed" ? 8 : 5;
  const picked = ranked
    .slice(0, Math.min(keepCount, ranked.length))
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);

  const keyPoints = ranked
    .slice(0, Math.min(5, ranked.length))
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);

  const lower = text.toLowerCase();
  const actionItems = sentences
    .filter((s) => actionHints.some((h) => s.toLowerCase().includes(h)))
    .slice(0, 5);

  const firstWords = sentences[0].split(" ").slice(0, 8).join(" ");
  const title =
    firstWords.length > 60 ? firstWords.slice(0, 57) + "…" : firstWords;

  let summary;
  if (style === "paragraph") {
    summary = picked.join(" ");
  } else if (length === "short") {
    summary = picked.join(" ");
  } else {
    summary = picked.join(" ");
  }

  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    summary,
    keyPoints: style === "paragraph" ? [] : keyPoints,
    actionItems,
    language: outLang,
    _demo: true,
    _note:
      outLang === "id"
        ? "Mode demo: ringkasan ekstraktif lokal (tanpa Firebase). Sambungkan Firebase project untuk ringkasan AI (Gemini Nano / cloud)."
        : "Demo mode: local extractive summary (no Firebase). Connect a Firebase project for AI summaries (Gemini Nano / cloud).",
  };
}

// ---------- Built-in samples (also used by the video demo) ----------

export const SAMPLE_ID = `Notulen Rapat — Peluncuran Aplikasi "WarungKu" (Senin, 10 November 2026)

Hadir: Adi (Product), Sari (Design), Budi (Engineering), Maya (Marketing).
Tujuan rapat: menyepakati tanggal peluncuran dan pembagian tugas akhir sebelum rilis.

Adi membuka rapat dengan menyampaikan bahwa aplikasi sudah 90 persen selesai. Fitur utama seperti katalog produk, keranjang belanja, dan pembayaran QRIS sudah diuji dan berjalan baik. Namun masih ada dua masalah: halaman checkout terkadang lambat saat koneksi lemah, dan notifikasi pesanan belum muncul di beberapa HP Android lama.

Budi menjelaskan bahwa lambatnya checkout disebabkan gambar produk yang terlalu besar. Solusinya adalah mengompres semua gambar dan mengaktifkan cache. Budi berjanji perbaikan ini selesai pada hari Rabu. Untuk notifikasi, Budi akan memeriksa izin notifikasi di Android 12 dan memperbarui pustaka yang dipakai.

Sari mempresentasikan desain banner promosi dan halaman utama yang baru. Tim sepakat memakai warna hijau sebagai warna utama karena memberi kesan segar dan ramah. Sari harus mengirim aset final ke Budi paling lambat hari Selasa sore.

Maya mengusulkan peluncuran dilakukan pada tanggal 24 November 2026 agar bertepatan dengan gajian dan ada momentum belanja. Maya akan menyiapkan kampanye media sosial dan bekerja sama dengan lima warung mitra untuk promosi awal. Anggaran promosi yang disetujui adalah lima juta rupiah.

Keputusan akhir: tanggal peluncuran ditetapkan 24 November 2026. Budi harus menyelesaikan perbaikan performa sebelum hari Jumat dan melakukan uji akhir bersama Sari. Maya harus mengirim draf kampanye ke Adi pada hari Kamis untuk disetujui. Rapat berikutnya dijadwalkan hari Jumat pukul 10 pagi untuk memeriksa kesiapan peluncuran.`;

export const SAMPLE_EN = `Meeting Notes — "Neighborhood Library" App Launch (Monday, Nov 10, 2026)

Attendees: Adi (Product), Sari (Design), Budi (Engineering), Maya (Marketing).
Goal: agree on the launch date and final task split before release.

Adi opened the meeting by reporting that the app is 90 percent complete. Core features — the book catalog, borrowing cart, and QRIS payments — have been tested and work well. Two issues remain: the checkout page is sometimes slow on weak connections, and order notifications do not appear on some older Android phones.

Budi explained that the slow checkout is caused by oversized product images. The fix is to compress all images and enable caching. Budi promised this will be done by Wednesday. For notifications, Budi will check notification permissions on Android 12 and update the library in use.

Sari presented the new promo banner and home page design. The team agreed to use green as the primary color because it feels fresh and friendly. Sari must send the final assets to Budi by Tuesday afternoon.

Maya proposed launching on November 24, 2026, to coincide with payday and catch a shopping moment. Maya will prepare the social media campaign and work with five partner shops for the initial promotion. The approved promotion budget is five million rupiah.

Final decisions: the launch date is set for November 24, 2026. Budi must finish the performance fixes before Friday and run a final test with Sari. Maya must send the campaign draft to Adi on Thursday for approval. The next meeting is scheduled for Friday at 10 AM to check launch readiness.`;
