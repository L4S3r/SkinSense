import React from "react";
import brandLogo from "../assets/meloniq-logo-trimmed.png";
import SoapRecommendationCard from "./SoapRecommendationCard";
import { getApiEndpoint } from "../config/api";

export default function PdfExportTemplate({ report, lastCapturedPhoto, pdfTemplateRef }) {
  if (!report) return null;

  return (
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

        {report.recommendedSoaps && report.recommendedSoaps.length > 0 && (
          <div style={{ marginTop: "16px", marginBottom: "16px" }}>
            <div className="pdf-section-heading">Recommended Meloniq Soaps</div>
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
  );
}
