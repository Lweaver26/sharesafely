/* ==========================================================
   ShareSafely – front-end logic
   ----------------------------------------------------------
   Everything you need to change to hook this up to your
   back end is in CONFIG below. See README.md for the contract.
   ========================================================== */

const CONFIG = {
  // Set to false once your back end is running. While true, uploads are
  // simulated in the browser and a fake link is returned (nothing is sent).
  mockMode: true,

  // Endpoint that receives the file and returns the time-limited link.
  uploadUrl: "/api/upload",

  // Form field names sent in the multipart/form-data request.
  fileField: "file",
  expiryField: "expiryMinutes",

  // Max file size in MB (checked in the browser before uploading; enforce it
  // server-side too). Set to 0 for no limit.
  maxFileSizeMB: 100,

  // Choices shown in the "Link expires after" dropdown (value in minutes).
  expiryOptions: [
    { label: "15 minutes", minutes: 15 },
    { label: "1 hour",     minutes: 60, default: true },
    { label: "24 hours",   minutes: 1440 },
    { label: "7 days",     minutes: 10080 },
  ],
};

/* ---------- Element lookups ---------- */
const $ = (id) => document.getElementById(id);
const el = {
  demoBadge: $("demo-badge"),
  uploadView: $("upload-view"),
  resultView: $("result-view"),
  form: $("upload-form"),
  dropZone: $("drop-zone"),
  fileInput: $("file-input"),
  sizeHint: $("size-hint"),
  preview: $("file-preview"),
  fileName: $("file-name"),
  fileSize: $("file-size"),
  removeFile: $("remove-file"),
  expiry: $("expiry"),
  progress: $("progress"),
  progressBar: $("progress-bar"),
  progressText: $("progress-text"),
  error: $("error"),
  uploadBtn: $("upload-btn"),
  resultFile: $("result-file"),
  shareLink: $("share-link"),
  copyBtn: $("copy-btn"),
  expiryAbs: $("expiry-abs"),
  expiryCountdown: $("expiry-countdown"),
  newUpload: $("new-upload"),
  toast: $("toast"),
};

let selectedFile = null;
let countdownTimer = null;
let uploading = false;

/* ---------- Setup ---------- */
function init() {
  el.demoBadge.hidden = !CONFIG.mockMode;

  for (const opt of CONFIG.expiryOptions) {
    const o = new Option(opt.label, opt.minutes, opt.default, opt.default);
    el.expiry.add(o);
  }

  el.sizeHint.textContent = CONFIG.maxFileSizeMB
    ? `Maximum file size: ${CONFIG.maxFileSizeMB} MB`
    : "";

  el.fileInput.addEventListener("change", () => selectFile(el.fileInput.files[0]));
  el.removeFile.addEventListener("click", clearFile);
  el.form.addEventListener("submit", onSubmit);
  el.copyBtn.addEventListener("click", copyLink);
  el.shareLink.addEventListener("focus", () => el.shareLink.select());
  el.newUpload.addEventListener("click", resetToUpload);

  // Drag & drop
  ["dragenter", "dragover"].forEach((evt) =>
    el.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      if (!uploading) el.dropZone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    el.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropZone.classList.remove("dragover");
    })
  );
  el.dropZone.addEventListener("drop", (e) => {
    if (!uploading && e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]);
  });

  // Stop the browser opening a file dropped outside the drop zone
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
}

/* ---------- File selection ---------- */
function selectFile(file) {
  hideError();
  if (!file) return;

  if (CONFIG.maxFileSizeMB && file.size > CONFIG.maxFileSizeMB * 1024 * 1024) {
    showError(`"${file.name}" is ${formatBytes(file.size)}. The maximum is ${CONFIG.maxFileSizeMB} MB.`);
    el.fileInput.value = "";
    return;
  }

  selectedFile = file;
  el.fileName.textContent = file.name;
  el.fileName.title = file.name;
  el.fileSize.textContent = formatBytes(file.size);
  el.dropZone.hidden = true;
  el.preview.hidden = false;
  el.uploadBtn.disabled = false;
}

function clearFile() {
  selectedFile = null;
  el.fileInput.value = "";
  el.preview.hidden = true;
  el.dropZone.hidden = false;
  el.uploadBtn.disabled = true;
  hideError();
}

/* ---------- Upload ---------- */
async function onSubmit(e) {
  e.preventDefault();
  if (!selectedFile || uploading) return;

  const minutes = Number(el.expiry.value);
  setUploading(true);
  hideError();

  try {
    const result = CONFIG.mockMode
      ? await mockUpload(selectedFile, minutes, setProgress)
      : await realUpload(selectedFile, minutes, setProgress);
    showResult(result, minutes);
  } catch (err) {
    showError(err.message || "Upload failed. Please try again.");
  } finally {
    setUploading(false);
  }
}

function realUpload(file, minutes, onProgress) {
  // XMLHttpRequest is used instead of fetch() because it reports upload progress.
  return new Promise((resolve, reject) => {
    const data = new FormData();
    data.append(CONFIG.fileField, file, file.name);
    data.append(CONFIG.expiryField, String(minutes));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", CONFIG.uploadUrl);
    xhr.responseType = "json";

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });

    xhr.addEventListener("load", () => {
      const body = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) {
        const url = body.url || body.sasUrl || body.link;
        if (!url) return reject(new Error("The server didn't return a link."));
        resolve({ url, expiresOn: body.expiresOn || body.expiresAt || null });
      } else {
        reject(new Error(body.error || body.message || `Upload failed (HTTP ${xhr.status}).`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error. Check your connection and try again.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload was cancelled.")));

    xhr.send(data);
  });
}

function mockUpload(file, minutes, onProgress) {
  return new Promise((resolve) => {
    let p = 0;
    const timer = setInterval(() => {
      p = Math.min(1, p + 0.04 + Math.random() * 0.08);
      onProgress(p);
      if (p >= 1) {
        clearInterval(timer);
        const expiresOn = new Date(Date.now() + minutes * 60000).toISOString();
        const name = encodeURIComponent(file.name);
        setTimeout(() => resolve({
          url: `https://examplestorage.blob.core.windows.net/uploads/${name}?sv=2024-11-04&se=${encodeURIComponent(expiresOn)}&sr=b&sp=r&sig=DEMO`,
          expiresOn,
        }), 300);
      }
    }, 120);
  });
}

/* ---------- UI state ---------- */
function setUploading(on) {
  uploading = on;
  el.uploadBtn.disabled = on || !selectedFile;
  el.uploadBtn.classList.toggle("loading", on);
  el.uploadBtn.querySelector(".btn-label").textContent = on ? "Uploading…" : "Upload & generate link";
  el.expiry.disabled = on;
  el.removeFile.disabled = on;
  el.progress.hidden = !on;
  if (on) setProgress(0);
}

function setProgress(fraction) {
  const pct = Math.round(fraction * 100);
  el.progressBar.style.width = pct + "%";
  el.progressText.textContent = pct + "%";
}

function showResult({ url, expiresOn }, minutes) {
  const expires = expiresOn ? new Date(expiresOn) : new Date(Date.now() + minutes * 60000);

  el.resultFile.textContent = selectedFile.name;
  el.shareLink.value = url;
  el.expiryAbs.textContent = expires.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  const tick = () => {
    const ms = expires - Date.now();
    el.expiryCountdown.textContent = ms > 0 ? `in ${formatDuration(ms)}` : "expired";
    if (ms <= 0) clearInterval(countdownTimer);
  };
  clearInterval(countdownTimer);
  tick();
  countdownTimer = setInterval(tick, 1000);

  el.uploadView.hidden = true;
  el.resultView.hidden = false;
  el.copyBtn.focus();
}

function resetToUpload() {
  clearInterval(countdownTimer);
  clearFile();
  el.resultView.hidden = true;
  el.uploadView.hidden = false;
  el.copyBtn.textContent = "Copy";
  el.copyBtn.classList.remove("copied");
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(el.shareLink.value);
  } catch {
    // Fallback for non-HTTPS pages where the Clipboard API is unavailable
    el.shareLink.select();
    document.execCommand("copy");
  }
  el.copyBtn.textContent = "Copied!";
  el.copyBtn.classList.add("copied");
  showToast("Link copied to clipboard");
  setTimeout(() => {
    el.copyBtn.textContent = "Copy";
    el.copyBtn.classList.remove("copied");
  }, 2000);
}

function showError(msg) {
  el.error.textContent = msg;
  el.error.hidden = false;
}

function hideError() {
  el.error.hidden = true;
}

let toastTimer;
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2000);
}

/* ---------- Formatting helpers ---------- */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { bytes /= 1024; i++; } while (bytes >= 1024 && i < units.length - 1);
  return `${bytes.toFixed(bytes < 10 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

init();
