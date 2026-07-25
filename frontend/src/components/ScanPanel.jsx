import React from "react";

export default function ScanPanel({
  stream,
  capturedImage,
  flashActive,
  isScanning,
  viewfinderStatusVisible,
  isDisplay,
  wsStatusText,
  viewfinderStatus,
  report,
  cameraAllowed,
  onCapture,
  onRetry,
  videoRef,
  canvasRef,
}) {
  return (
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
              onClick={onCapture}
            >
              {!isScanning && <span className="btn-dot"></span>}
              {isScanning ? "Analyzing…" : "Capture & analyze"}
            </button>
          ) : (
            <button className="btn btn-ghost" id="retryBtn" onClick={onRetry}>
              Scan again
            </button>
          )}
        </div>
      )}

      {!isDisplay && !isScanning && !report && (
        <p className="hint" id="hint">Face the camera directly in even, natural light for the most accurate read.</p>
      )}
    </section>
  );
}
