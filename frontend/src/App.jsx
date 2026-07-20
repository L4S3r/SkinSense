import React, { useState, useEffect, useRef } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import "./App.css";
import brandLogo from "./assets/meloniq-logo-trimmed.png";

// Helper function to build API endpoint for any IP address or domain URL
function getApiEndpoint(path = "") {
  let base = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (!base) return path;

  if (!/^https?:\/\//i.test(base)) {
    const isSecure = base.includes("ngrok") || base.includes("loca.lt") || base.endsWith(".trycloudflare.com");
    base = (isSecure ? "https://" : "http://") + base;
  }
  
  base = base.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

// Helper function to build WebSocket URL for booth display mode
function getWebSocketUrl(path = "/ws/display") {
  let base = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (base) {
    if (!/^https?:\/\//i.test(base)) {
      const isSecure = base.includes("ngrok") || base.includes("loca.lt") || base.endsWith(".trycloudflare.com");
      base = (isSecure ? "https://" : "http://") + base;
    }
    try {
      const url = new URL(base);
      const wsProto = url.protocol === "https:" ? "wss:" : "ws:";
      return `${wsProto}//${url.host}${path}`;
    } catch {
      // fallback
    }
  }

  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${path}`;
}

export default function App() {
  const [isDisplay] = useState(() => {
    return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("display");
  });
  const [stream, setStream] = useState(null);
  const [viewfinderStatus, setViewfinderStatus] = useState("Requesting camera access…");
  const [viewfinderStatusVisible, setViewfinderStatusVisible] = useState(true);
  const [cameraAllowed, setCameraAllowed] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [lastCapturedPhoto, setLastCapturedPhoto] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [morphActive, setMorphActive] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const [revealActive, setRevealActive] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [wsStatusText, setWsStatusText] = useState("Connecting to scanner…");
  const [backdropActive, setBackdropActive] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const reportRef = useRef(null);
  const pdfTemplateRef = useRef(null);

  // Export report as high-quality publication-ready A4 PDF document
  const downloadReportAsPDF = async () => {
    if (!report || isExportingPdf || !pdfTemplateRef.current) return;

    setIsExportingPdf(true);

    try {
      const exportElement = pdfTemplateRef.current;

      const reportCanvas = await html2canvas(exportElement, {
        backgroundColor: "#FAFBF8",
        scale: 2,
        useCORS: true,
        logging: false,
      });

      const imgData = reportCanvas.toDataURL("image/png");

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      // A4 dimensions are 210mm x 297mm
      pdf.addImage(imgData, "PNG", 0, 0, 210, 297);

      // Add interactive click targets in generated PDF
      pdf.link(12, 10, 55, 18, { url: "https://meloniq-eta.vercel.app/" });
      pdf.link(12, 275, 186, 12, { url: "https://meloniq-eta.vercel.app/" });

      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, "0");
      const day = String(today.getDate()).padStart(2, "0");
      const formattedDate = `${year}-${month}-${day}`;

      pdf.save(`meloniq-skin-report-${formattedDate}.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
      alert("Couldn't generate the PDF document. Please try again.");
    } finally {
      setIsExportingPdf(false);
    }
  };

  useEffect(() => {
    const skinType = report?.skin_type || "unclear";

    if (report) {
      document.body.dataset.skinType = skinType;
    } else {
      delete document.body.dataset.skinType;
    }

    document.body.classList.remove(
      "bg-oily",
      "bg-dry",
      "bg-combination",
      "bg-sensitive",
      "bg-normal",
      "bg-unclear",
      "is-scanning",
      "display-mode"
    );

    if (report && skinType !== "unclear") {
      document.body.classList.add(`bg-${skinType}`);
    }

    if (isScanning) {
      document.body.classList.add("is-scanning");
    }

    if (isDisplay) {
      document.body.classList.add("display-mode");
    }

    return () => {
      document.body.removeAttribute("data-skin-type");
      document.body.classList.remove(
        "bg-oily",
        "bg-dry",
        "bg-combination",
        "bg-sensitive",
        "bg-normal",
        "bg-unclear",
        "is-scanning",
        "display-mode"
      );
    };
  }, [report, isScanning, isDisplay]);

  // Trigger reveal animation when a report is loaded
  useEffect(() => {
    if (report) {
      setRevealActive(false);
      const timer = setTimeout(() => {
        setRevealActive(true);
      }, 20);
      return () => clearTimeout(timer);
    }
  }, [report]);

  // Set backdropActive on the next animation frame after a report renders
  useEffect(() => {
    if (report && !isScanning) {
      const frame = requestAnimationFrame(() => {
        setBackdropActive(true);
      });
      return () => cancelAnimationFrame(frame);
    } else {
      setBackdropActive(false);
    }
  }, [report, isScanning]);

  // Handle WebSocket display channel events in display mode
  useEffect(() => {
    if (!isDisplay) return;

    let ws = null;
    let reconnectTimeout = null;

    const connectDisplaySocket = () => {
      const wsUrl = getWebSocketUrl("/ws/display");
      ws = new WebSocket(wsUrl);

      ws.addEventListener("open", () => {
        setReport((prev) => {
          if (!prev) {
            setWsStatusText("Ready — waiting for the next scan…");
            setViewfinderStatusVisible(true);
          }
          return prev;
        });
      });

      ws.addEventListener("message", (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === "hello") {
          setReport((prev) => {
            if (!prev) {
              setWsStatusText("Ready — waiting for the next scan…");
              setViewfinderStatusVisible(true);
            }
            return prev;
          });
        } else if (msg.type === "report") {
          handleDisplayReport(msg.report, msg.image);
        }
      });

      ws.addEventListener("close", () => {
        setReport((prev) => {
          if (!prev) {
            setWsStatusText("Reconnecting…");
            setViewfinderStatusVisible(true);
          }
          return prev;
        });
        reconnectTimeout = setTimeout(connectDisplaySocket, 2000);
      });

      ws.addEventListener("error", () => {
        ws.close();
      });
    };

    const handleDisplayReport = (newReport, newImage) => {
      window.scrollTo({ top: 0 });
      setReport(null);
      if (newImage) {
        setCapturedImage(newImage);
        setLastCapturedPhoto(newImage);
        triggerShutterFlash();
      }
      setIsScanning(true);
      setViewfinderStatusVisible(false);

      setTimeout(() => {
        setMorphActive(true);
        setTimeout(() => {
          setIsScanning(false);
          setReport(newReport);
        }, 200);
        setTimeout(() => {
          setMorphActive(false);
        }, 800);
      }, 1600);
      // Permanent report display: only resets when a new photo is sent via the phone
    };

    connectDisplaySocket();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [isDisplay]);

  // Setup interactive camera lifecycle
  useEffect(() => {
    if (isDisplay) return;
    startCamera();
    return () => {
      stopCamera();
    };
  }, [isDisplay]);

  // Wire video element source to media stream
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Scroll to report details when report load completes
  useEffect(() => {
    if (report && reportRef.current) {
      reportRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [report]);

  const triggerShutterFlash = () => {
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 450);
  };

  const startCamera = async () => {
    setReport(null);
    setError(null);
    setCapturedImage(null);
    setViewfinderStatus("Requesting camera access…");
    setViewfinderStatusVisible(true);
    setCameraAllowed(false);

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 } },
        audio: false,
      });
      setStream(mediaStream);
      setViewfinderStatusVisible(false);
      setCameraAllowed(true);
    } catch (err) {
      console.error("Camera error:", err);
      setViewfinderStatus("Camera access denied — allow it in your browser to continue.");
      setViewfinderStatusVisible(true);
      setCameraAllowed(false);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  };

  const captureAndAnalyze = async () => {
    if (!stream || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    const w = video.videoWidth || 720;
    const h = video.videoHeight || 900;

    // Downscale capture to max 640px for ultra-fast network transmission & AI vision encoding
    const maxDim = 640;
    let targetW = w;
    let targetH = h;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        targetW = maxDim;
        targetH = Math.round((h * maxDim) / w);
      } else {
        targetH = maxDim;
        targetW = Math.round((w * maxDim) / h);
      }
    }

    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");

    // Mirror image for a natural self-facing preview
    ctx.translate(targetW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
    setCapturedImage(dataUrl);
    setLastCapturedPhoto(dataUrl);

    triggerShutterFlash();
    stopCamera();
    setIsScanning(true);
    setError(null);

    let success = false;
    try {
      const targetUrl = getApiEndpoint("/api/analyze");
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ image: dataUrl }),
      });

      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload.error || "The analysis failed. Please try again.");
      }

      success = true;
      setMorphActive(true);
      setTimeout(() => {
        setIsScanning(false);
        setReport(payload.report);
      }, 200);
      setTimeout(() => {
        setMorphActive(false);
      }, 800);
    } catch (err) {
      console.error("Analyze request failed:", err);
      setError(err.message || "Something went wrong. Please try again.");
      setIsScanning(false);
    } finally {
      if (!success) {
        setIsScanning(false);
      }
    }
  };

  const handleRetry = () => {
    setReport(null);
    setCapturedImage(null);
    setError(null);
    startCamera();
  };

  const skinType = report?.skin_type || "unclear";
  const mappedSkinType = (skinType === "oily" || skinType === "dry" || skinType === "combination") 
    ? skinType 
    : "normal";
  const backdropClass = `backdrop-${mappedSkinType}`;

  return (
    <>
      <div className={`ui-morph-shimmer ${morphActive ? "active" : ""}`} id="uiMorphShimmer" aria-hidden="true"></div>
      <div className="grid-overlay" aria-hidden="true"></div>

      <div 
        id="skinBackdrop" 
        aria-hidden="true"
      >
        <div className={`backdrop-image ${backdropClass} ${backdropActive ? "backdrop-active" : ""}`} aria-hidden="true"></div>
        <div className="backdrop-overlay" aria-hidden="true"></div>

      </div>

      <div className="bubble-field" aria-hidden="true">
        <span className="bubble b1"></span>
        <span className="bubble b2"></span>
        <span className="bubble b3"></span>
        <span className="bubble b4"></span>
        <span className="bubble b5"></span>
        <span className="bubble b6"></span>
        <span className="bubble b7"></span>
        <span className="bubble b8"></span>
        <span className="bubble b9"></span>
        <span className="bubble b10"></span>
        <span className="bubble b11"></span>
        <span className="bubble b12"></span>
        <span className="bubble b13"></span>
        <span className="soap-wrap sw1"><span className="soap-bar"></span></span>
        <span className="soap-wrap sw2"><span className="soap-bar"></span></span>
      </div>

      <header className="site-header">
        <div className="eyebrow">AI · Skin Analysis</div>
        <div className="meloniq-brand">
          <a href="https://meloniq-eta.vercel.app/" target="_blank" rel="noopener noreferrer" className="meloniq-brand-link">
            <img src={brandLogo} alt="Meloniq Logo" className="meloniq-brand-logo" />
          </a>
        </div>
        <p className="tagline">Point your camera at your face. Meloniq reads the surface — oil, texture, tone — and hands back a plain-language skin report.</p>
      </header>

      <main className="stage">
        {/* ================= SCAN PANEL ================= */}
        {!error && (
          <section className="scan-panel" id="scanPanel">
            <div className={`viewfinder ${flashActive ? "flash" : ""}`} id="viewfinder">
              {stream && !capturedImage && (
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                />
              )}
              <canvas ref={canvasRef} style={{ display: "none" }} />
              {capturedImage && (
                <img 
                  id="frozenFrame" 
                  className="frozen-frame" 
                  src={capturedImage} 
                  alt="Captured photo" 
                />
              )}

              <svg className="face-guide" viewBox="0 0 300 300" aria-hidden="true">
                <ellipse cx="150" cy="150" rx="88" ry="112" />
              </svg>

              {isScanning && <div className="scan-line" id="scanLine" />}

              <div className="corner tl"></div>
              <div className="corner tr"></div>
              <div className="corner bl"></div>
              <div className="corner br"></div>

              {viewfinderStatusVisible && (
                <p className="viewfinder-status" id="viewfinderStatus">
                  {isDisplay ? wsStatusText : viewfinderStatus}
                </p>
              )}
            </div>

            {!isDisplay && (
              <div className="controls">
                {!report ? (
                  <button 
                    className="btn btn-primary" 
                    id="captureBtn" 
                    disabled={!cameraAllowed || isScanning}
                    onClick={captureAndAnalyze}
                  >
                    {!isScanning && <span className="btn-dot"></span>}
                    {isScanning ? "Analyzing…" : "Capture & analyze"}
                  </button>
                ) : (
                  <button className="btn btn-ghost" id="retryBtn" onClick={handleRetry}>
                    Scan again
                  </button>
                )}
              </div>
            )}

            {!isDisplay && !isScanning && !report && (
              <p className="hint" id="hint">Face the camera directly in even, natural light for the most accurate read.</p>
            )}
          </section>
        )}

        {/* ================= REPORT PANEL ================= */}
        {report && !error && (
          <section className={`report-panel ${revealActive ? "reveal" : ""}`} id="reportPanel" ref={reportRef}>
            <div className="report-head">
              <div>
                <div className="eyebrow">Report</div>
                <h2 id="skinTypeHeading">
                  {report.skin_type === "unclear" ? "No clear read" : `${report.skin_type} skin`}
                </h2>
              </div>
              <div className="confidence" id="confidenceBadge">
                <span className="confidence-label">confidence</span>
                <span className="confidence-value" id="confidenceValue">
                  {report.confidence || "—"}
                </span>
              </div>
            </div>

            <p className="summary" id="summaryText">
              {report.summary || ""}
            </p>

            <div className="observations" id="observations">
              {(report.observations || []).map((obs, index) => (
                <div 
                  key={index}
                  className="observation" 
                  style={{ animationDelay: `${0.32 + index * 0.07}s` }}
                >
                  <span className="label">{obs.label || obs.name || obs.title || "Observation"}</span>
                  <span className="detail">{obs.detail || obs.description || obs.text || (typeof obs === "string" ? obs : "")}</span>
                </div>
              ))}
            </div>

            <div className="care-tips">
              <h3>Care notes</h3>
              <ul id="careTipsList">
                {(report.care_tips || []).map((tip, index) => (
                  <li 
                    key={index}
                    style={{ animationDelay: `${0.68 + index * 0.06}s` }}
                  >
                    {typeof tip === "string" ? tip : (tip.tip || tip.text || tip.detail || JSON.stringify(tip))}
                  </li>
                ))}
              </ul>
            </div>

            {report.caveats && (
              <p className="caveats" id="caveatsText">
                {report.caveats}
              </p>
            )}

            <button 
              className="pdf-btn" 
              id="pdfBtn" 
              type="button"
              disabled={isExportingPdf}
              onClick={downloadReportAsPDF}
            >
              <svg className="pdf-btn-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 14.5v1A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{isExportingPdf ? "Preparing PDF…" : "Download as PDF"}</span>
            </button>
          </section>
        )}

        {/* ================= ERROR PANEL ================= */}
        {error && (
          <section className="error-panel" id="errorPanel">
            <p id="errorText">{error}</p>
            <button className="btn btn-ghost" id="errorRetryBtn" onClick={handleRetry}>
              Try again
            </button>
          </section>
        )}
      </main>

      <footer className="site-footer">
        <p>Analysis is generated by an AI model for general cosmetic insight only. It is not a medical diagnosis — see a dermatologist for skin concerns. Photos are sent to the OpenAI API for this single analysis and are not stored by this app.</p>
      </footer>

      {/* ================= DEDICATED A4 PRINT/EXPORT TEMPLATE ================= */}
      {report && (
        <div className="pdf-export-template-container" aria-hidden="true">
          <div ref={pdfTemplateRef} className="pdf-export-template">
            <div>
              {/* 1. Letterhead Header */}
              <div className="pdf-header">
                <div className="pdf-brand">
                  <a href="https://meloniq-eta.vercel.app/" target="_blank" rel="noopener noreferrer" className="pdf-brand-link">
                    <img src={brandLogo} alt="Meloniq Logo" className="pdf-brand-logo" crossOrigin="anonymous" />
                  </a>
                  <div className="pdf-subhead">AI Skin Analysis Report</div>
                </div>
                <div className="pdf-meta">
                  <div className="pdf-meta-title">CONFIDENTIAL COSMETIC REPORT</div>
                  <div>Date: {new Date().toISOString().split("T")[0]}</div>
                  <div>Doc ID: MLQ-78291</div>
                </div>
              </div>

              {/* 2. Overview Section with Compact Photo Thumbnail */}
              <div className="pdf-overview">
                {lastCapturedPhoto && (
                  <div className="pdf-photo-wrapper">
                    <img className="pdf-photo" src={lastCapturedPhoto} alt="Captured portrait" />
                  </div>
                )}
                <div className="pdf-summary-block">
                  <div className="pdf-eyebrow">Cosmetic Skin Type Evaluation</div>
                  <h2 className="pdf-skin-heading">
                    {report.skin_type === "unclear" ? "No Clear Read" : `${report.skin_type} skin`}
                  </h2>
                  <div className="pdf-badge">Confidence: {report.confidence || "Medium"}</div>
                  <p className="pdf-summary-text">{report.summary || ""}</p>
                </div>
              </div>

              {/* 3. 4-Metric Observations Grid */}
              <div className="pdf-section-heading">Detailed Skin Metric Observations</div>
              <div className="pdf-grid">
                {(report.observations || []).map((obs, i) => (
                  <div key={i} className="pdf-card">
                    <div className="pdf-card-label">{obs.label || obs.name || obs.title || "Observation"}</div>
                    <div className="pdf-card-detail">{obs.detail || obs.description || obs.text || (typeof obs === "string" ? obs : "")}</div>
                  </div>
                ))}
              </div>

              {/* 4. Care Notes / Recommendations */}
              <div className="pdf-section-heading">Care Notes & Daily Regimen</div>
              <ul className="pdf-tips-list">
                {(report.care_tips || []).map((tip, i) => (
                  <li key={i} className="pdf-tip-item">
                    {typeof tip === "string" ? tip : (tip.tip || tip.text || tip.detail || JSON.stringify(tip))}
                  </li>
                ))}
              </ul>
            </div>

            {/* 5. Caveats & Footer */}
            <div>
              {report.caveats && (
                <div className="pdf-caveats">
                  {report.caveats}
                </div>
              )}
              <div className="pdf-footer">
                <span>
                  Meloniq • <a href="https://meloniq-eta.vercel.app/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>https://meloniq-eta.vercel.app</a> • Handmade botanical care inspired by calm rituals.
                </span>
                <span>Page 1 of 1</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
