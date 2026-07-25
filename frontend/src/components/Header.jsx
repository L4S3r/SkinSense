import React from "react";
import brandLogo from "../assets/meloniq-logo-trimmed.png";

export default function Header() {
  return (
    <header className="site-header">
      <div className="eyebrow">AI · Skin Analysis</div>
      <div className="meloniq-brand">
        <a href="https://meloniq-eta.vercel.app/" target="_blank" rel="noopener noreferrer" className="meloniq-brand-link">
          <img src={brandLogo} alt="Meloniq Logo" className="meloniq-brand-logo" />
        </a>
      </div>
      <p className="tagline">Point your camera at your face. Meloniq reads the surface — oil, texture, tone — and hands back a plain-language skin report.</p>
    </header>
  );
}
