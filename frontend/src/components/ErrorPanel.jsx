import React from "react";

export default function ErrorPanel({ error, onRetry }) {
  if (!error) return null;

  return (
    <section className="error-panel" id="errorPanel">
      <p id="errorText">{error}</p>
      <button className="btn btn-ghost" id="errorRetryBtn" onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}
