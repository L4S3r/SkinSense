// =====================================================
// Lumen — camera capture + report rendering
// =====================================================

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const frozenFrame = document.getElementById("frozenFrame");
const scanLine = document.getElementById("scanLine");
const viewfinder = document.getElementById("viewfinder");
const viewfinderStatus = document.getElementById("viewfinderStatus");

const captureBtn = document.getElementById("captureBtn");
const retryBtn = document.getElementById("retryBtn");
const errorRetryBtn = document.getElementById("errorRetryBtn");
const pdfBtn = document.getElementById("pdfBtn");
const hint = document.getElementById("hint");

const reportPanel = document.getElementById("reportPanel");
const errorPanel = document.getElementById("errorPanel");
const errorText = document.getElementById("errorText");

let stream = null;
let lastCapturedPhoto = null; // natural-orientation dataURL of the most recent shot, used by the PDF export

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
  document.body.removeAttribute("data-skin-type");
  document.body.classList.remove("bg-oily", "bg-dry", "bg-combination", "bg-sensitive", "bg-normal", "bg-unclear", "is-scanning");
  reportPanel.hidden = true;
  reportPanel.classList.remove("reveal");
  errorPanel.hidden = true;
  retryBtn.hidden = true;
  pdfBtn.hidden = true;
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
  lastCapturedPhoto = dataUrl;

  // Quick shutter feedback right as the photo is taken.
  if (viewfinder) {
    viewfinder.classList.add("flash");
    setTimeout(() => viewfinder.classList.remove("flash"), 450);
  }

  // Freeze the viewfinder on the captured photo and stop the live stream.
  frozenFrame.src = dataUrl;
  frozenFrame.hidden = false;
  video.hidden = true;
  stopCamera();

  // Enter "scanning" state.
  document.body.classList.add("is-scanning");
  scanLine.hidden = false;
  captureBtn.disabled = true;
  captureBtn.textContent = "Analyzing…";
  hint.hidden = true;

  let success = false;
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

    success = true;
    const morphShimmer = document.getElementById("uiMorphShimmer");
    if (morphShimmer) {
      morphShimmer.classList.add("active");
      setTimeout(() => {
        scanLine.hidden = true;
        document.body.classList.remove("is-scanning");
        renderReport(payload.report);
      }, 200);
      setTimeout(() => {
        morphShimmer.classList.remove("active");
      }, 800);
    } else {
      scanLine.hidden = true;
      document.body.classList.remove("is-scanning");
      renderReport(payload.report);
    }
  } catch (err) {
    console.error("Analyze request failed:", err);
    showError(err.message || "Something went wrong. Please try again.");
  } finally {
    if (!success) {
      scanLine.hidden = true;
      document.body.classList.remove("is-scanning");
    }
  }
}

// ------------------- Rendering -------------------
function renderReport(report) {
  const skinType = report.skin_type || "unclear";
  document.body.dataset.skinType = skinType;
  document.body.classList.remove("bg-oily", "bg-dry", "bg-combination", "bg-sensitive", "bg-normal", "bg-unclear");
  if (skinType !== "unclear") {
    document.body.classList.add(`bg-${skinType}`);
  }

  captureBtn.hidden = true;
  retryBtn.hidden = false;
  pdfBtn.hidden = false;
  errorPanel.hidden = true;
  reportPanel.hidden = false;

  // Restart the reveal sequence on every render
  reportPanel.classList.remove("reveal");
  void reportPanel.offsetWidth; // force a reflow so the animation restarts
  reportPanel.classList.add("reveal");

  document.getElementById("skinTypeHeading").textContent =
    skinType === "unclear" ? "No clear read" : `${skinType} skin`;
  document.getElementById("confidenceValue").textContent = report.confidence || "—";
  document.getElementById("summaryText").textContent = report.summary || "";

  const obsContainer = document.getElementById("observations");
  obsContainer.innerHTML = "";
  (report.observations || []).forEach((obs, i) => {
    const card = document.createElement("div");
    card.className = "observation";
    card.style.animationDelay = `${0.32 + i * 0.07}s`;
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
  (report.care_tips || []).forEach((tip, i) => {
    const li = document.createElement("li");
    li.textContent = tip;
    li.style.animationDelay = `${0.68 + i * 0.06}s`;
    tipsList.appendChild(li);
  });

  document.getElementById("caveatsText").textContent = report.caveats || "";

  reportPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showError(message) {
  document.body.classList.remove("is-scanning");
  reportPanel.hidden = true;
  errorPanel.hidden = false;
  errorText.textContent = message;
  captureBtn.hidden = true;
  retryBtn.hidden = true;
  pdfBtn.hidden = true;
}

// ------------------- Download report as PDF -------------------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function downloadReportAsPDF() {
  if (reportPanel.hidden || pdfBtn.disabled) return;

  if (!window.html2canvas || !window.jspdf) {
    alert("PDF export didn't load — check your connection and try again.");
    return;
  }

  const label = pdfBtn.querySelector("span");
  const originalLabel = label.textContent;
  pdfBtn.disabled = true;
  label.textContent = "Preparing PDF…";

  try {
    reportPanel.classList.add("exporting");
    const reportCanvas = await html2canvas(reportPanel, {
      backgroundColor: "#F7ECDD",
      scale: 2,
      useCORS: true,
    });
    reportPanel.classList.remove("exporting");

    const padding = 64;
    let photoImg = null;
    if (lastCapturedPhoto) {
      photoImg = await loadImage(lastCapturedPhoto);
    }

    const width = reportCanvas.width;
    const photoWidth = width - padding;
    const photoHeight = photoImg ? Math.round((photoImg.height / photoImg.width) * photoWidth) : 0;
    const photoBlockHeight = photoImg ? photoHeight + padding : 0;

    const composite = document.createElement("canvas");
    composite.width = width;
    composite.height = photoBlockHeight + reportCanvas.height;
    const ctx = composite.getContext("2d");

    ctx.fillStyle = "#F7ECDD";
    ctx.fillRect(0, 0, composite.width, composite.height);

    if (photoImg) {
      const x = padding / 2;
      const y = padding / 2;
      ctx.save();
      roundRectPath(ctx, x, y, photoWidth, photoHeight, 24);
      ctx.clip();
      ctx.drawImage(photoImg, x, y, photoWidth, photoHeight);
      ctx.restore();
    }

    ctx.drawImage(reportCanvas, 0, photoBlockHeight);

    const imageData = composite.toDataURL("image/png");

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      unit: "px",
      format: [composite.width, composite.height],
    });
    pdf.addImage(imageData, "PNG", 0, 0, composite.width, composite.height);

    const skinType = (document.getElementById("skinTypeHeading").textContent || "skin-report")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    pdf.save(`lumen-${skinType || "skin-report"}-${Date.now()}.pdf`);
  } catch (err) {
    console.error("PDF export failed:", err);
    alert("Couldn't generate the PDF. Please try again.");
  } finally {
    reportPanel.classList.remove("exporting");
    pdfBtn.disabled = false;
    label.textContent = originalLabel;
  }
}

// ------------------- Booth display mode -------------------
const IS_DISPLAY = new URLSearchParams(location.search).has("display");

function enterDisplayMode() {
  stopCamera();
  video.hidden = true;
  frozenFrame.hidden = true;
  scanLine.hidden = true;
  captureBtn.hidden = true;
  retryBtn.hidden = true;
  pdfBtn.hidden = true;
  hint.hidden = true;
  reportPanel.hidden = true;
  errorPanel.hidden = true;
  document.body.classList.add("display-mode");
  showIdle("Connecting to scanner…");
  connectDisplaySocket();
}

function showIdle(message) {
  document.body.removeAttribute("data-skin-type");
  document.body.classList.remove("bg-oily", "bg-dry", "bg-combination", "bg-sensitive", "bg-normal", "bg-unclear", "is-scanning");
  reportPanel.hidden = true;
  frozenFrame.hidden = true;
  scanLine.hidden = true;
  viewfinderStatus.hidden = false;
  viewfinderStatus.textContent = message;
}

function connectDisplaySocket() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/display`);

  ws.addEventListener("open", () => {
    if (reportPanel.hidden) {
      showIdle("Ready — waiting for the next scan…");
    }
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "hello") {
      if (reportPanel.hidden) {
        showIdle("Ready — waiting for the next scan…");
      }
    } else if (msg.type === "report") {
      showDisplayReport(msg.report, msg.image);
    }
  });

  ws.addEventListener("close", () => {
    if (reportPanel.hidden) {
      showIdle("Reconnecting…");
    }
    setTimeout(connectDisplaySocket, 2000);
  });
  ws.addEventListener("error", () => ws.close());
}

let idleTimer = null;
function showDisplayReport(report, image) {
  clearTimeout(idleTimer);
  viewfinderStatus.hidden = true;
  reportPanel.hidden = true;
  window.scrollTo({ top: 0 });
  document.body.removeAttribute("data-skin-type");
  document.body.classList.remove("bg-oily", "bg-dry", "bg-combination", "bg-sensitive", "bg-normal", "bg-unclear");

  if (image) {
    lastCapturedPhoto = image;
    frozenFrame.src = image;
    frozenFrame.hidden = false;
    video.hidden = true;
    if (viewfinder) {
      viewfinder.classList.add("flash");
      setTimeout(() => viewfinder.classList.remove("flash"), 450);
    }
  }
  document.body.classList.add("is-scanning");
  scanLine.hidden = false;

  setTimeout(() => {
    const morphShimmer = document.getElementById("uiMorphShimmer");
    if (morphShimmer) {
      morphShimmer.classList.add("active");
      setTimeout(() => {
        document.body.classList.remove("is-scanning");
        scanLine.hidden = true;
        renderReport(report);
        captureBtn.hidden = true;
        retryBtn.hidden = true;
        pdfBtn.hidden = false;
      }, 200);
      setTimeout(() => {
        morphShimmer.classList.remove("active");
      }, 800);
    } else {
      document.body.classList.remove("is-scanning");
      scanLine.hidden = true;
      renderReport(report);
      captureBtn.hidden = true;
      retryBtn.hidden = true;
      pdfBtn.hidden = false;
    }
  }, 1600);

  // Permanent report display: only resets when a new photo is sent via the phone
}

// ------------------- Events / boot -------------------
if (IS_DISPLAY) {
  enterDisplayMode();
} else {
  captureBtn.addEventListener("click", captureAndAnalyze);
  retryBtn.addEventListener("click", startCamera);
  errorRetryBtn.addEventListener("click", startCamera);
  pdfBtn.addEventListener("click", downloadReportAsPDF);
  startCamera();
}
