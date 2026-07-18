import React, { useState, useEffect, useRef } from "react";

export default function App() {
  const [isDisplay] = useState(() => {
    return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("display");
  });
  const [stream, setStream] = useState(null);
  const [viewfinderStatus, setViewfinderStatus] = useState("Requesting camera access…");
  const [viewfinderStatusVisible, setViewfinderStatusVisible] = useState(true);
  const [cameraAllowed, setCameraAllowed] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [morphActive, setMorphActive] = useState(false);
  const [wsStatusText, setWsStatusText] = useState("Connecting to scanner…");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const reportRef = useRef(null);

  // Sync state with body classes and attributes to trigger styling transitions
  useEffect(() => {
    const skinType = report?.skin_type || "unclear";
    document.body.dataset.skinType = report ? skinType : "unclear";

    // Clean up class names
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

  // Handle WebSocket display channel events in display mode
  useEffect(() => {
    if (!isDisplay) return;

    let ws = null;
    let reconnectTimeout = null;

    const connectDisplaySocket = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const host = window.location.host;
      ws = new WebSocket(`${proto}://${host}/ws/display`);

      ws.addEventListener("open", () => {
        setWsStatusText("Ready — waiting for the next scan…");
        setViewfinderStatusVisible(true);
      });

      ws.addEventListener("message", (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (err) {
          return;
        }

        if (msg.type === "hello") {
          setWsStatusText("Ready — waiting for the next scan…");
          setViewfinderStatusVisible(true);
        } else if (msg.type === "report") {
          handleDisplayReport(msg.report, msg.image);
        }
      });

      ws.addEventListener("close", () => {
        setWsStatusText("Reconnecting…");
        setViewfinderStatusVisible(true);
        reconnectTimeout = setTimeout(connectDisplaySocket, 2000);
      });

      ws.addEventListener("error", () => {
        ws.close();
      });
    };

    const handleDisplayReport = (newReport, newImage) => {
      window.scrollTo({ top: 0 });
      setReport(null);
      setCapturedImage(newImage);
      setIsScanning(true);
      setViewfinderStatusVisible(false);

      // Scanning simulation before rendering report
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

  // Wire video element source to current media stream
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
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    // Mirror image for a natural looking preview
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setCapturedImage(dataUrl);

    stopCamera();
    setIsScanning(true);
    setError(null);

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
    }
  };

  const handleRetry = () => {
    startCamera();
  };

  return (
    <>
      <div className={`ui-morph-shimmer ${morphActive ? "active" : ""}`} id="uiMorphShimmer" aria-hidden="true"></div>
      <div className="grid-overlay" aria-hidden="true"></div>
      <div id="skinBackdrop" aria-hidden="true">
        <svg className="dry-cracks-svg" width="100%" height="100%">
          <defs>
            <pattern id="realCracksPattern" width="300" height="300" patternUnits="userSpaceOnUse">
              <path className="crack-path-1" d="
                M 0 0 L 30 15 L 55 45 L 80 40 L 110 70 L 115 110 L 85 140 L 90 190 L 60 210 L 65 260 L 35 285 L 0 300
                M 30 15 L 75 10 L 125 35 L 165 30 L 210 55 L 245 45 L 285 75 L 300 70
                M 55 45 L 60 95 L 90 120 L 135 115 L 160 155 L 155 205 L 180 230 L 175 280 L 215 300
                M 110 70 L 155 75 L 195 105 L 190 155 M 195 105 L 240 100 L 285 130
                M 115 110 L 125 160 L 95 185 L 120 230 L 105 275 L 135 300
                M 160 155 L 215 165 L 235 210 L 215 250 L 245 285 L 240 300
                M 190 155 L 185 205 L 235 210
                M 245 45 L 250 95 L 295 110 M 250 95 L 235 145 M 285 130 L 280 180 L 300 190
                M 280 180 L 255 215 L 285 250 L 270 295 L 300 300
                M 90 190 L 120 230
                M 155 205 L 120 230
                M 215 250 L 175 280
                M 60 210 L 25 200 L 0 220
                M 25 200 L 15 150 L 0 140
                M 15 150 L 60 95
                M 65 260 L 75 300
                M 35 285 L 0 280
              " fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
              <path className="crack-path-2" d="
                M 75 10 L 80 0
                M 165 30 L 170 0
                M 285 75 L 290 50
                M 155 75 L 150 50
                M 95 185 L 75 170 M 95 185 L 110 200
                M 215 165 L 210 140 M 215 165 L 225 180
                M 255 215 L 270 205 M 255 215 L 250 230
                M 25 200 L 35 220
              " fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.6" strokeLinejoin="round" strokeLinecap="round" />
            </pattern>
            <filter id="dryCracks" x="0%" y="0%" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" result="noise" />
              <feColorMatrix type="matrix" values="
                0 0 0 0 0.35
                0 0 0 0 0.30
                0 0 0 0 0.25
                14 0 0 0 -12" result="crackLines" />
              <feComposite operator="over" in="crackLines" in2="SourceGraphic" />
            </filter>
          </defs>
          <rect width="100%" height="100%" fill="url(#realCracksPattern)" />
        </svg>
      </div>

      <header className="site-header">
        <div className="eyebrow">AI · Skin Analysis</div>
        <h1 className="logo">Meloniq</h1>
        <p className="tagline">Point your camera at your face. Meloniq reads the surface — oil, texture, tone — and hands back a plain-language skin report.</p>
      </header>

      <main className="stage">
        {/* ================= SCAN PANEL ================= */}
        {!error && (
          <section className="scan-panel" id="scanPanel">
            <div className="viewfinder" id="viewfinder">
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
          <section className="report-panel" id="reportPanel" ref={reportRef}>
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
                  style={{ animationDelay: `${0.35 + index * 0.08}s` }}
                >
                  <span className="label">{obs.label || ""}</span>
                  <span className="detail">{obs.detail || ""}</span>
                </div>
              ))}
            </div>

            <div className="care-tips">
              <h3>Care notes</h3>
              <ul id="careTipsList">
                {(report.care_tips || []).map((tip, index) => (
                  <li 
                    key={index}
                    style={{ animationDelay: `${0.5 + index * 0.08}s` }}
                  >
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            {report.caveats && (
              <p className="caveats" id="caveatsText">
                {report.caveats}
              </p>
            )}
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
    </>
  );
}
