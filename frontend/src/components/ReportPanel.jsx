import React from "react";
import SoapRecommendationCard from "./SoapRecommendationCard";
import { getApiEndpoint } from "../config/api";

export default function ReportPanel({
  report,
  revealActive,
  isExportingPdf,
  onDownloadPdf,
  reportRef,
}) {
  if (!report) return null;

  return (
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

      {report.recommendedSoaps && report.recommendedSoaps.length > 0 && (
        <div className="soap-recommendations">
          <h3>Recommended Meloniq Soaps</h3>
          <div className="soap-grid">
            {report.recommendedSoaps.map((rec, index) => (
              <SoapRecommendationCard
                key={rec.soap?.id || index}
                recommendation={rec}
                getApiEndpoint={getApiEndpoint}
              />
            ))}
          </div>
        </div>
      )}

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
        onClick={onDownloadPdf}
      >
        <svg className="pdf-btn-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 14.5v1A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{isExportingPdf ? "Preparing PDF…" : "Download as PDF"}</span>
      </button>
    </section>
  );
}
