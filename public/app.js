// =====================================================
// Lumen — camera capture + report rendering
// =====================================================

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const frozenFrame = document.getElementById("frozenFrame");
const scanLine = document.getElementById("scanLine");
const viewfinderStatus = document.getElementById("viewfinderStatus");

const captureBtn = document.getElementById("captureBtn");
const retryBtn = document.getElementById("retryBtn");
const errorRetryBtn = document.getElementById("errorRetryBtn");
const hint = document.getElementById("hint");

const reportPanel = document.getElementById("reportPanel");
const errorPanel = document.getElementById("errorPanel");
const errorText = document.getElementById("errorText");

let stream = null;

// ------------------- Camera -------------------
async function startCamera() {
  resetToScanState();
  viewfinderStatus.hidden = false;
  viewfinderStatus.textContent = "Requesting camera access…";

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    video.hidden = false;
    frozenFrame.hidden = true;
    viewfinderStatus.hidden = true;
    captureBtn.disabled = false;
  } catch (err) {
    console.error("Camera error:", err);
    viewfinderStatus.hidden = false;
    viewfinderStatus.textContent = "Camera access denied — allow it in your browser to continue.";
    captureBtn.disabled = true;
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
}

function resetToScanState() {
  reportPanel.hidden = true;
  errorPanel.hidden = true;
  retryBtn.hidden = true;
  scanLine.hidden = true;
  hint.hidden = false;
  captureBtn.hidden = false;
  captureBtn.textContent = "";
  const dot = document.createElement("span");
  dot.className = "btn-dot";
  captureBtn.appendChild(dot);
  captureBtn.append("Capture & analyze");
}

// ------------------- Capture -> analyze flow -------------------
async function captureAndAnalyze() {
  if (!stream) return;

  // Draw the current video frame to canvas (mirrored, matching the preview).
  const w = video.videoWidth || 720;
  const h = video.videoHeight || 900;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

  // Freeze the viewfinder on the captured photo and stop the live stream.
  frozenFrame.src = dataUrl;
  frozenFrame.hidden = false;
  video.hidden = true;
  stopCamera();

  // Enter "scanning" state.
  scanLine.hidden = false;
  captureBtn.disabled = true;
  captureBtn.textContent = "Analyzing…";
  hint.hidden = true;

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    });

    const payload = await res.json();

    if (!res.ok) {
      throw new Error(payload.error || "The analysis failed. Please try again.");
    }

    renderReport(payload.report);
  } catch (err) {
    console.error("Analyze request failed:", err);
    showError(err.message || "Something went wrong. Please try again.");
  } finally {
    scanLine.hidden = true;
  }
}

// ------------------- Rendering -------------------
function renderReport(report) {
  captureBtn.hidden = true;
  retryBtn.hidden = false;
  errorPanel.hidden = true;
  reportPanel.hidden = false;

  const skinType = report.skin_type || "unclear";
  document.getElementById("skinTypeHeading").textContent =
    skinType === "unclear" ? "No clear read" : `${skinType} skin`;
  document.getElementById("confidenceValue").textContent = report.confidence || "—";
  document.getElementById("summaryText").textContent = report.summary || "";

  const obsContainer = document.getElementById("observations");
  obsContainer.innerHTML = "";
  (report.observations || []).forEach((obs) => {
    const card = document.createElement("div");
    card.className = "observation";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = obs.label || "";
    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent = obs.detail || "";
    card.appendChild(label);
    card.appendChild(detail);
    obsContainer.appendChild(card);
  });

  const tipsList = document.getElementById("careTipsList");
  tipsList.innerHTML = "";
  (report.care_tips || []).forEach((tip) => {
    const li = document.createElement("li");
    li.textContent = tip;
    tipsList.appendChild(li);
  });

  document.getElementById("caveatsText").textContent = report.caveats || "";

  reportPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showError(message) {
  reportPanel.hidden = true;
  errorPanel.hidden = false;
  errorText.textContent = message;
  captureBtn.hidden = true;
  retryBtn.hidden = true;
}

// ------------------- Booth display mode -------------------
// When opened as `?display`, this screen doesn't capture anything itself.
// It connects to the backend over a WebSocket and renders reports pushed
// from the Flutter phone app — the big screen the crowd watches.
const IS_DISPLAY = new URLSearchParams(location.search).has("display");

function enterDisplayMode() {
  // No local camera on the booth screen — stop it and reshape the UI.
  stopCamera();
  video.hidden = true;
  frozenFrame.hidden = true;
  scanLine.hidden = true;
  captureBtn.hidden = true;
  retryBtn.hidden = true;
  hint.hidden = true;
  reportPanel.hidden = true;
  errorPanel.hidden = true;
  document.body.classList.add("display-mode");
  showIdle("Connecting to scanner…");
  connectDisplaySocket();
}

function showIdle(message) {
  reportPanel.hidden = true;
  frozenFrame.hidden = true;
  scanLine.hidden = true;
  viewfinderStatus.hidden = false;
  viewfinderStatus.textContent = message;
}

function connectDisplaySocket() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/display`);

  ws.addEventListener("open", () => showIdle("Ready — waiting for the next scan…"));

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "hello") {
      showIdle("Ready — waiting for the next scan…");
    } else if (msg.type === "report") {
      showDisplayReport(msg.report, msg.image);
    }
  });

  // Auto-reconnect so the booth screen survives a server restart / Wi-Fi blip.
  ws.addEventListener("close", () => {
    showIdle("Reconnecting…");
    setTimeout(connectDisplaySocket, 2000);
  });
  ws.addEventListener("error", () => ws.close());
}

let idleTimer = null;
function showDisplayReport(report, image) {
  clearTimeout(idleTimer);
  viewfinderStatus.hidden = true;

  // Show the captured photo in the viewfinder frame with a scan sweep,
  // then render the report using the shared renderer.
  if (image) {
    frozenFrame.src = image;
    frozenFrame.hidden = false;
    video.hidden = true;
  }
  scanLine.hidden = false;
  setTimeout(() => {
    scanLine.hidden = true;
    renderReport(report);
    captureBtn.hidden = true; // renderReport unhides some controls; keep them off
    retryBtn.hidden = true;
  }, 1600);

  // Return to the idle "waiting" state so the booth is ready for the next person.
  idleTimer = setTimeout(() => showIdle("Ready — waiting for the next scan…"), 30000);
}

// ------------------- Events / boot -------------------
if (IS_DISPLAY) {
  enterDisplayMode();
} else {
  captureBtn.addEventListener("click", captureAndAnalyze);
  retryBtn.addEventListener("click", startCamera);
  errorRetryBtn.addEventListener("click", startCamera);
  startCamera();
}
