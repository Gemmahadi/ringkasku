/**
 * Ringkasku — UI logic.
 * Zero-build static app. Firebase wiring lives in ./firebase.js,
 * summarization helpers in ./summarizer.js.
 */
import {
  firebaseConfig,
  isConfigured,
  RC_DEFAULTS,
  remoteConfigValues,
  initFirebase,
  loadRemoteConfig,
  checkOnDeviceAvailability,
  summarizeWithAI,
  saveSummary,
  listSummaries,
  deleteSummary,
  onAuthReady,
} from "./firebase.js";
import { buildPrompt, summarizeLocally, SAMPLE_ID, SAMPLE_EN } from "./summarizer.js";

const $ = (id) => document.getElementById(id);
const els = {
  pillFirebase: $("pillFirebase"),
  pillDevice: $("pillDevice"),
  pillRoute: $("pillRoute"),
  inputText: $("inputText"),
  charCount: $("charCount"),
  routeHint: $("routeHint"),
  langSelect: $("langSelect"),
  lengthSelect: $("lengthSelect"),
  styleSelect: $("styleSelect"),
  summarizeBtn: $("summarizeBtn"),
  sampleIdBtn: $("sampleIdBtn"),
  sampleEnBtn: $("sampleEnBtn"),
  clearBtn: $("clearBtn"),
  fileInput: $("fileInput"),
  deviceProgress: $("deviceProgress"),
  deviceProgressFill: $("deviceProgressFill"),
  deviceProgressText: $("deviceProgressText"),
  statusLine: $("statusLine"),
  welcomeMessage: $("welcomeMessage"),
  emptyState: $("emptyState"),
  resultCard: $("resultCard"),
  resultTitle: $("resultTitle"),
  resultRouteBadge: $("resultRouteBadge"),
  resultSummary: $("resultSummary"),
  resultKeyPointsWrap: $("resultKeyPointsWrap"),
  resultKeyPoints: $("resultKeyPoints"),
  resultActionsWrap: $("resultActionsWrap"),
  resultActions: $("resultActions"),
  resultMeta: $("resultMeta"),
  resultSaved: $("resultSaved"),
  copyBtn: $("copyBtn"),
  downloadBtn: $("downloadBtn"),
  historyList: $("historyList"),
  historyCount: $("historyCount"),
  historyEmpty: $("historyEmpty"),
  historyHint: $("historyHint"),
  configNote: $("configNote"),
};

let onDeviceStatus = "unknown";
let lastResult = null;
let deviceModelWarmedUp = false;

function setStatus(msg, kind = "") {
  els.statusLine.textContent = msg;
  els.statusLine.className = "status-line" + (kind ? " " + kind : "");
}

function setPill(el, text, kind = "") {
  el.textContent = text;
  el.className = "pill" + (kind ? " " + kind : "");
}

function updateCharCount() {
  const n = els.inputText.value.length;
  els.charCount.textContent = `${n.toLocaleString("id-ID")} karakter / maks ${Number(
    remoteConfigValues.summary_max_chars,
  ).toLocaleString("id-ID")}`;
  const threshold = remoteConfigValues.cloud_threshold_chars;
  els.routeHint.textContent =
    n > threshold
      ? `Rute: cloud Gemini (melewati ambang ${threshold.toLocaleString("id-ID")} karakter)`
      : `Rute: on-device Gemini Nano (di bawah ambang cloud ${threshold.toLocaleString("id-ID")} karakter)`;
}

function renderResult(data, routeLabel, badgeClass, meta, savedNote) {
  lastResult = { data, routeLabel, meta };
  els.emptyState.hidden = true;
  els.resultCard.hidden = false;
  els.resultTitle.textContent = data.title || "Ringkasan";
  els.resultSummary.textContent = data.summary || "";
  els.resultRouteBadge.textContent = routeLabel;
  els.resultRouteBadge.className = "badge" + (badgeClass ? " " + badgeClass : "");

  const kp = data.keyPoints || [];
  els.resultKeyPointsWrap.hidden = kp.length === 0;
  els.resultKeyPoints.innerHTML = kp.map((p) => `<li></li>`).join("");
  [...els.resultKeyPoints.children].forEach((li, i) => (li.textContent = kp[i]));

  const acts = data.actionItems || [];
  els.resultActionsWrap.hidden = acts.length === 0;
  els.resultActions.innerHTML = acts.map(() => `<li></li>`).join("");
  [...els.resultActions.children].forEach((li, i) => (li.textContent = acts[i]));

  els.resultMeta.textContent = meta;
  els.resultSaved.textContent = savedNote || "";
  els.resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderHistory(items) {
  els.historyCount.textContent = items.length ? `(${items.length})` : "";
  els.historyEmpty.hidden = items.length > 0;
  els.historyList.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    const title = document.createElement("div");
    title.className = "h-title";
    title.textContent = item.title || "Ringkasan";
    const meta = document.createElement("div");
    meta.className = "h-meta";
    const date = item.createdAt?.toDate
      ? item.createdAt.toDate().toLocaleString("id-ID")
      : "";
    meta.textContent = `${item.route === "cloud" ? "☁ Cloud" : item.route === "demo" ? "◐ Demo" : "⬢ On-device"} · ${item.language || ""} · ${date}`;
    const actions = document.createElement("div");
    actions.className = "h-actions";
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "Buka";
    openBtn.addEventListener("click", () => {
      renderResult(
        item,
        item.route === "cloud"
          ? "Cloud · Gemini 2.5 Flash"
          : item.route === "demo"
            ? "Demo · local extractive"
            : "On-device · Gemini Nano",
        item.route === "cloud" ? "cloud" : item.route === "demo" ? "demo" : "",
        `${(item.sourceChars || 0).toLocaleString("id-ID")} karakter sumber`,
        "Dari riwayat tersimpan",
      );
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "Hapus";
    delBtn.addEventListener("click", async () => {
      try {
        await deleteSummary(item.id);
        await refreshHistory();
      } catch (e) {
        setStatus("Gagal menghapus: " + (e?.message || e), "error");
      }
    });
    actions.append(openBtn, delBtn);
    li.append(title, meta, actions);
    els.historyList.appendChild(li);
  }
}

async function refreshHistory() {
  if (!isConfigured) return;
  try {
    renderHistory(await listSummaries(20));
  } catch (e) {
    console.warn("[ringkasku] History load failed:", e?.message || e);
  }
}

async function onSummarize() {
  const text = els.inputText.value.trim();
  if (text.length < 50) {
    setStatus("Tulis atau tempel catatan dulu (minimal 50 karakter).", "error");
    els.inputText.focus();
    return;
  }
  if (text.length > remoteConfigValues.summary_max_chars) {
    setStatus(
      `Catatan terlalu panjang (maks ${remoteConfigValues.summary_max_chars} karakter, dari Remote Config).`,
      "error",
    );
    return;
  }

  const opts = {
    lang: els.langSelect.value,
    length: els.lengthSelect.value,
    style: els.styleSelect.value,
  };
  els.summarizeBtn.disabled = true;
  els.summarizeBtn.textContent = "⏳ Meringkas…";
  setStatus("");

  const useCloud =
    remoteConfigValues.enable_cloud_fallback &&
    text.length > remoteConfigValues.cloud_threshold_chars;
  const route = useCloud ? "cloud" : "hybrid";

  try {
    if (!isConfigured) {
      // DEMO MODE — no Firebase project configured.
      setStatus("Mode demo: meringkas secara lokal (tanpa Firebase)…");
      await new Promise((r) => setTimeout(r, 350)); // let the UI paint
      const data = summarizeLocally(text, opts);
      renderResult(
        data,
        "Demo · local extractive",
        "demo",
        `${text.length.toLocaleString("id-ID")} karakter sumber · ${data.language === "id" ? "Bahasa Indonesia" : "English"}`,
        "Tidak tersimpan (mode demo — sambungkan Firebase untuk menyimpan ke Firestore)",
      );
      setPill(els.pillRoute, "Route: Demo (local)", "warn");
      setStatus(data._note || "", "ok");
      return;
    }

    if (route === "hybrid" && !deviceModelWarmedUp) {
      els.deviceProgress.hidden = false;
      els.deviceProgressText.textContent = "Menyiapkan model on-device (Gemini Nano)…";
    }
    setStatus(
      route === "cloud"
        ? "Dokumen panjang — meringkas via cloud Gemini 2.5 Flash…"
        : "Meringkas on-device (Gemini Nano) bila tersedia, fallback cloud bila tidak…",
    );

    let result;
    try {
      result = await summarizeWithAI(buildPrompt(text, opts), route, (p) => {
        els.deviceProgressFill.style.width = `${Math.round(p * 100)}%`;
        els.deviceProgressText.textContent = `Mengunduh model on-device: ${Math.round(p * 100)}%`;
      });
    } catch (e) {
      // Hybrid failed (e.g. on-device unavailable and cloud fallback off) —
      // retry once in the cloud if fallback is enabled.
      if (route === "hybrid" && remoteConfigValues.enable_cloud_fallback) {
        setStatus("On-device gagal — mencoba ulang via cloud Gemini…");
        result = await summarizeWithAI(buildPrompt(text, opts), "cloud");
      } else {
        throw e;
      }
    }
    deviceModelWarmedUp = true;
    els.deviceProgress.hidden = true;

    // Route label: authoritative — the SDK reports the actual inference
    // source on the response ("on_device" / "in_cloud").
    const onDevice = result.routeUsed === "on-device";
    const routeLabel = onDevice
      ? "On-device · Gemini Nano"
      : "Cloud · Gemini 2.5 Flash";
    const badgeClass = onDevice ? "" : "cloud";

    const data = result.data;
    renderResult(
      data,
      routeLabel,
      badgeClass,
      `${text.length.toLocaleString("id-ID")} karakter sumber · ${data.language === "id" ? "Bahasa Indonesia" : "English"} · ${opts.length}`,
      "",
    );
    setPill(els.pillRoute, `Route: ${routeLabel}`, onDevice ? "ok" : "warn");
    setStatus("Ringkasan selesai.", "ok");

    // Save to Firestore (best effort — history is a bonus, not a blocker).
    try {
      await saveSummary({
        title: data.title,
        summary: data.summary,
        keyPoints: data.keyPoints || [],
        actionItems: data.actionItems || [],
        language: data.language || opts.lang,
        length: opts.length,
        style: opts.style,
        route: onDevice ? "on-device" : "cloud",
        sourceChars: text.length,
        sourcePreview: text.slice(0, 300),
      });
      els.resultSaved.textContent = "✓ Tersimpan di Firestore";
      await refreshHistory();
    } catch (e) {
      els.resultSaved.textContent = "Tidak tersimpan: " + (e?.message || e);
    }
  } catch (e) {
    console.error("[ringkasku] Summarize failed:", e);
    setStatus("Gagal meringkas: " + (e?.message || e), "error");
    els.deviceProgress.hidden = true;
  } finally {
    els.summarizeBtn.disabled = false;
    els.summarizeBtn.textContent = "✦ Ringkas";
  }
}

// ---------- events ----------

els.inputText.addEventListener("input", updateCharCount);
els.summarizeBtn.addEventListener("click", onSummarize);
els.sampleIdBtn.addEventListener("click", () => {
  els.inputText.value = SAMPLE_ID;
  els.langSelect.value = "id";
  updateCharCount();
  setStatus("Contoh catatan Bahasa Indonesia dimuat.");
});
els.sampleEnBtn.addEventListener("click", () => {
  els.inputText.value = SAMPLE_EN;
  els.langSelect.value = "en";
  updateCharCount();
  setStatus("English sample notes loaded.");
});
els.clearBtn.addEventListener("click", () => {
  els.inputText.value = "";
  updateCharCount();
  setStatus("");
});
els.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  els.inputText.value = text.slice(0, remoteConfigValues.summary_max_chars);
  updateCharCount();
  setStatus(`Dimuat dari ${file.name} (${text.length.toLocaleString("id-ID")} karakter).`);
  e.target.value = "";
});
els.copyBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  const d = lastResult.data;
  const md = `# ${d.title}\n\n${d.summary}\n\n${
    (d.keyPoints || []).length ? "## Poin penting\n" + d.keyPoints.map((p) => `- ${p}`).join("\n") + "\n\n" : ""
  }${(d.actionItems || []).length ? "## Yang perlu dilakukan\n" + d.actionItems.map((p) => `- [ ] ${p}`).join("\n") + "\n" : ""}`;
  try {
    await navigator.clipboard.writeText(md);
    setStatus("Ringkasan disalin ke clipboard.", "ok");
  } catch {
    setStatus("Clipboard tidak tersedia di browser ini.", "error");
  }
});
els.downloadBtn.addEventListener("click", () => {
  if (!lastResult) return;
  const d = lastResult.data;
  const md = `# ${d.title}\n\n${d.summary}\n\n${
    (d.keyPoints || []).length ? "## Poin penting\n" + d.keyPoints.map((p) => `- ${p}`).join("\n") + "\n\n" : ""
  }${(d.actionItems || []).length ? "## Yang perlu dilakukan\n" + d.actionItems.map((p) => `- [ ] ${p}`).join("\n") + "\n" : ""}`;
  const blob = new Blob([md], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ringkasan.md";
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- init ----------

async function init() {
  updateCharCount();
  els.welcomeMessage.textContent = RC_DEFAULTS.welcome_message;

  if (!isConfigured) {
    setPill(els.pillFirebase, "Firebase: Demo mode (no config)", "warn");
    setPill(els.pillDevice, "On-device: —", "");
    setPill(els.pillRoute, "Route: Demo", "warn");
    els.configNote.textContent =
      "Demo mode: no Firebase project is configured — summaries are produced locally in your browser and nothing is uploaded. To enable AI summaries, add your Firebase web app config (see README.md).";
    els.historyHint.textContent = "Riwayat membutuhkan Firebase project (Firestore).";
  } else {
    setPill(els.pillFirebase, "Firebase: connecting…", "");
    initFirebase();
    const rc = await loadRemoteConfig();
    els.lengthSelect.value = rc.summary_default_length || "medium";
    els.welcomeMessage.textContent = rc.welcome_message || "";
    updateCharCount();
    setPill(els.pillFirebase, `Firebase: connected (${firebaseConfig.projectId})`, "ok");
    els.configNote.textContent = `Connected to Firebase project "${firebaseConfig.projectId}".`;
    onAuthReady(() => refreshHistory());
  }

  // On-device (Gemini Nano) availability via the Chrome Prompt API.
  onDeviceStatus = await checkOnDeviceAvailability();
  const deviceLabel = {
    available: "On-device: Gemini Nano available ✓",
    downloading: "On-device: Gemini Nano downloading…",
    downloadable: "On-device: Gemini Nano downloadable",
    unavailable: "On-device: unavailable (cloud fallback)",
    unsupported: "On-device: not supported in this browser",
    unknown: "On-device: unknown",
  }[onDeviceStatus];
  setPill(
    els.pillDevice,
    deviceLabel,
    onDeviceStatus === "available" ? "ok" : onDeviceStatus === "unsupported" || onDeviceStatus === "unavailable" ? "warn" : "",
  );
}

init();

// ---------- scripted demo (for the demo video only) ----------
// Open the app with ?autodemo=1 and it types the Indonesian sample,
// summarizes it, then the English sample, and marks document.title DONE
// when finished. Real app, real clicks — just scripted for the camera.
if (new URLSearchParams(location.search).get("autodemo") === "1") {
  (async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitForResult = async (oldTitle) => {
      for (let i = 0; i < 40; i++) {
        if (!els.resultCard.hidden && els.resultTitle.textContent !== oldTitle) return true;
        await sleep(500);
      }
      return false;
    };
    const typeSample = async (text, lang) => {
      els.inputText.value = "";
      const chunk = 60;
      for (let i = 0; i < text.length; i += chunk) {
        els.inputText.value = text.slice(0, i + chunk);
        updateCharCount();
        await sleep(60);
      }
      els.langSelect.value = lang;
    };
    await sleep(1500);
    document.title = "RINGKASKU_AUTODEMO_TYPING";
    await typeSample(SAMPLE_ID, "id");
    await sleep(800);
    document.title = "RINGKASKU_AUTODEMO_SUMMARIZING";
    els.summarizeBtn.click();
    await waitForResult("");
    await sleep(4000); // let the viewer read the Indonesian summary
    document.title = "RINGKASKU_AUTODEMO_TYPING_EN";
    const oldTitle = els.resultTitle.textContent;
    await typeSample(SAMPLE_EN, "en");
    await sleep(800);
    els.summarizeBtn.click();
    await waitForResult(oldTitle);
    await sleep(4000); // let the viewer read the English summary
    window.scrollTo({ top: 0, behavior: "smooth" });
    await sleep(1200);
    document.title = "RINGKASKU_AUTODEMO_DONE";
  })();
}
