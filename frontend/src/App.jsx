import React, { useState, useEffect, useRef } from "react";
import "./App.css";
import Header from "./components/Header";
import Footer from "./components/Footer";
import ScanPanel from "./components/ScanPanel";
import ReportPanel from "./components/ReportPanel";
import ErrorPanel from "./components/ErrorPanel";
import PdfExportTemplate from "./components/PdfExportTemplate";
import { getApiEndpoint, getWebSocketUrl } from "./config/api";
import { downloadReportAsPDF } from "./utils/pdfExporter";

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

  const handleDownloadPdf = () => {
    downloadReportAsPDF(report, pdfTemplateRef, setIsExportingPdf);
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

  useEffect(() => {
    if (report) {
      setRevealActive(false);
      const timer = setTimeout(() => {
        setRevealActive(true);
      }, 20);
      return () => clearTimeout(timer);
    }
  }, [report]);

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
    };

    connectDisplaySocket();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [isDisplay]);

  useEffect(() => {
    if (isDisplay) return;
    startCamera();
    return () => {
      stopCamera();
    };
  }, [isDisplay]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

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

      <div id="skinBackdrop" aria-hidden="true">
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

      <Header />

      <main className="stage">
        {!error && (
          <ScanPanel
            stream={stream}
            capturedImage={capturedImage}
            flashActive={flashActive}
            isScanning={isScanning}
            viewfinderStatusVisible={viewfinderStatusVisible}
            isDisplay={isDisplay}
            wsStatusText={wsStatusText}
            viewfinderStatus={viewfinderStatus}
            report={report}
            cameraAllowed={cameraAllowed}
            onCapture={captureAndAnalyze}
            onRetry={handleRetry}
            videoRef={videoRef}
            canvasRef={canvasRef}
          />
        )}

        {report && !error && (
          <ReportPanel
            report={report}
            revealActive={revealActive}
            isExportingPdf={isExportingPdf}
            onDownloadPdf={handleDownloadPdf}
            reportRef={reportRef}
          />
        )}

        <ErrorPanel error={error} onRetry={handleRetry} />
      </main>

      <Footer />

      <PdfExportTemplate
        report={report}
        lastCapturedPhoto={lastCapturedPhoto}
        pdfTemplateRef={pdfTemplateRef}
      />
    </>
  );
}
