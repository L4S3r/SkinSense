import React from "react";

export default function SoapRecommendationCard({ recommendation, getApiEndpoint }) {
  if (!recommendation || !recommendation.soap) return null;

  const { soap, reasoning } = recommendation;
  const imageSrc = getApiEndpoint
    ? getApiEndpoint(`/soaps/${soap.imageAsset}`)
    : `/soaps/${soap.imageAsset}`;

  return (
    <div className="soap-card">
      <div className="soap-card-image-wrapper">
        <img
          src={imageSrc}
          alt={soap.nameEn}
          className="soap-card-image"
          onError={(e) => {
            e.target.onerror = null;
            e.target.style.display = "none";
          }}
        />
        {soap.isPhotosensitizing && (
          <span className="soap-badge warning" title="Use PM or pair with SPF">
            ☀️ PM / SPF Caution
          </span>
        )}
      </div>

      <div className="soap-card-content">
        <div className="soap-card-header">
          <h4 className="soap-title-en">{soap.nameEn}</h4>
          <span className="soap-title-ar" dir="rtl">{soap.nameAr}</span>
        </div>

        <p className="soap-reasoning">{reasoning}</p>

        {soap.keyActives && soap.keyActives.length > 0 && (
          <div className="soap-actives">
            <span className="soap-section-label">Key Actives:</span>
            <div className="soap-tags">
              {soap.keyActives.map((active, idx) => (
                <span key={idx} className="soap-tag">
                  {active}
                </span>
              ))}
            </div>
          </div>
        )}

        {soap.cautions && soap.cautions.length > 0 && (
          <div className="soap-cautions">
            {soap.cautions.map((caution, idx) => (
              <p key={idx} className="soap-caution-text">
                ⚠️ {caution}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
