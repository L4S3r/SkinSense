# Meloniq — AI Skin Analysis · Complete Walkthrough

A guided tour of this repository: what it is, how the pieces fit together, and how a photo becomes a skin report — in both self-serve web mode and two-device booth mode, including publication-ready A4 PDF export.

---

## 1. What this project is

**Meloniq** captures a face photo, sends it to a **Google Gemini** vision model (via OpenAI-compatible API), and renders a plain-language skin-type report — skin type, confidence, a short summary, 4-metric observations grid (hydration, pores, texture, tone), and care notes.

It features the **Meloniq Botanical Brand Identity**:
- **Muted Sage Light** (`#E2E7DA`) global backdrop.
- **Deep Olive** (`#434E3F`) primary text, headings, icons, and buttons.
- **Soft Off-White Cream** (`#F4F6F0`) card surfaces and scan viewfinder.
- High-contrast `Playfair Display` serif typography with customized **Meloniq Wordmark** ("Mel" + 3-arch concentric SVG "o" + "niq" + baseline underline).

It runs two ways:

- **Self-serve web** — the browser opens the webcam, you capture a frame, and the report renders on the same device.
- **Booth mode** — a **Flutter phone app** is the capture station and a separate **big screen** (the web app in `?display` mode) shows each report live, pushed from the backend over a WebSocket. Reports stay displayed permanently until a new scan arrives.

> **Not a medical device.** The app gives general cosmetic skin-type insight only and explicitly does not diagnose skin conditions.

---

## 2. Where it came from — `FaceChain.py`

`FaceChain.py` is the **origin/ancestor** of this project, not part of the running app. It's a Google Colab notebook that does webcam capture in Colab and face recognition using DeepFace.

Meloniq kept only the **webcam-capture pattern** and rebuilt it as a standalone Node/Express + React application.

---

## 3. Project structure

```
Face-skin/
├── backend/                # Modular Express API & WebSocket backend
│   ├── server.js           # Lightweight server entry point (~40 lines)
│   ├── ai_service/         # Internal Python FastAPI AI Vision Microservice (main.py, requirements.txt)
│   ├── src/
│   │   ├── config/
│   │   │   └── index.js              # Environment & configuration loading
│   │   ├── routes/
│   │   │   └── api.js                # Express API routes (/, /api/health, /api/analyze)
│   │   ├── services/
│   │   │   ├── geminiClient.js       # Gemini OpenAI-compat client, queue & circuit breaker
│   │   │   ├── reportFormatter.js    # System prompt, JSON parser, normalization & validation
│   │   │   ├── soapRecommendation.js # Organic soap recommendation & scoring algorithm
│   │   │   └── processSpawner.js     # Lifecycle manager for Python AI Microservice
│   │   ├── data/
│   │   │   └── soapCatalog.js        # Catalog of botanical soaps with key actives & targets
│   │   ├── websocket/
│   │   │   └── displayChannel.js     # WebSocket server (/ws/display) & booth display channel
│   │   └── types/
│   │       └── soap.js               # JSDoc type definitions
│   ├── package.json        # backend deps: express, openai, ws, dotenv
│   └── .env.example        # template — copy to .env
├── frontend/               # Modular React frontend (Vite)
│   ├── src/
│   │   ├── main.jsx        # React entrypoint
│   │   ├── App.jsx         # Decoupled App container assembling state & components
│   │   ├── App.css         # Skincare brand design tokens, styles, and animations
│   │   ├── config/
│   │   │   └── api.js      # API & WebSocket URL builder helpers
│   │   ├── utils/
│   │   │   └── pdfExporter.js # html2canvas + jsPDF A4 export utility
│   │   └── components/
│   │       ├── Header.jsx   # Brand logo & tagline header
│   │       ├── Footer.jsx   # Cosmetic disclaimer footer
│   │       ├── ScanPanel.jsx # Camera viewfinder & capture controls
│   │       ├── ReportPanel.jsx # Analyzed skin report card & care notes
│   │       ├── ErrorPanel.jsx  # Error state display card & retry button
│   │       ├── PdfExportTemplate.jsx # Printable off-screen A4 PDF document template
│   │       └── SoapRecommendationCard.jsx # Card rendering tailored botanical soaps
│   ├── index.html          # Vite HTML entrypoint template
│   ├── vite.config.js      # Vite config with React plugin and proxy settings
│   └── package.json        # frontend deps: react, react-dom, jspdf, html2canvas, vite
├── booth-connect.ps1       # ADB reverse helper for browser fallback
├── FaceChain.py            # Original Colab notebook (ancestor)
├── README.md               # Setup + booth + PDF export docs
├── WALKTHROUGH.md          # This file
├── public_vanilla/         # Backup of legacy vanilla JS/CSS assets
└── mobile/                 # Flutter capture app (booth phone station)
    ├── lib/
    │   ├── main.dart       # Front-camera capture → POST to backend
    │   ├── models/
    │   │   └── soap_recommendation.dart # Soap recommendation data model
    │   └── widgets/
    │       └── soap_recommendation_card.dart # Flutter widget for soap recommendations
    └── test/
        └── widget_test.dart # Flutter test suite
```

---

## 4. The backend — `server.js`

An ES-module Express app (`"type": "module"` in `package.json`).

### API key loading & Gemini Client
The key is read from `GEMINI_API_KEY` in `.env` (loaded by `dotenv/config`). Gemini is accessed via its OpenAI-compatible endpoint at `https://generativelanguage.googleapis.com/v1beta/openai/` using the `openai` SDK. The model defaults to `gemini-3.6-flash`, with `gemini-3.5-flash-lite` configured as fallback.

### The booth display channel
Express is wrapped in an explicit `http.createServer(app)` with a `WebSocketServer` attached at `/ws/display`. When the mobile app POSTs a photo, `broadcastToDisplays(payload)` sends `{ type: "report", report, image }` to all connected screens.

---

## 5. The web frontend — React Source (`src/`)

### `index.html`
Vite HTML entrypoint template containing preconnect settings and Google Fonts (`Playfair Display`, `DM Sans`, `JetBrains Mono`).

### `src/App.jsx`
Manages frontend reactive states (`isDisplay`, `stream`, `isScanning`, `report`, `error`, `pdfTemplateRef`, etc.).

- **Self-serve mode**: Manages webcam stream lifecycle, draws frames into canvas, fires `/api/analyze` POST request, and displays the animated report panel.
- **Booth display mode** (`?display`): Listens for WebSocket broadcasts on `/ws/display`. Renders received reports and retains them on screen permanently until a new scan is submitted.
- **Publication-Ready A4 PDF Export**:
  - Contains an off-screen print-rendering container (`.pdf-export-template-container`) positioned via `position: fixed; top: 0; left: -9999px; z-index: -9999;`.
  - Dimensions fixed to exact A4 standard (794px × 1123px / 210mm × 297mm).
  - Renders official Meloniq letterhead, compact portrait photo thumbnail, 4-metric grid, care notes, disclaimer, and page number.
  - Executed via `html2canvas` (2x retina scale) + `jsPDF({ format: "a4" })`, saving output as `meloniq-skin-report-YYYY-MM-DD.pdf`.

### `src/App.css`
Contains design tokens (`--bg: #E2E7DA`, `--olive: #434E3F`, `--bg-raised: #F4F6F0`), keyframe animations for scanning line sweeps, morph shimmers, and A4 print template layout styles.

---

## 6. End-to-end data flow (booth mode & PDF export)

```
Flutter phone            Server (server.js)                Gemini      Big screen (?display)
────────────            ──────────────────                ──────      ─────────────────────
                                                                        WS connect /ws/display
                                                                        ◀── { type: "hello" }
front camera preview
tap "Capture & send"
  takePicture → JPEG
  POST /api/analyze ────▶ validate data URL
  { image: dataURL }      check API key
                          chat.completions.create({    ──▶ vision model
                            system: SYSTEM_PROMPT,          analyzes image
                            image_url })                ◀── returns JSON text
                          strip ``` fences + JSON.parse
                          broadcastToDisplays(report) ──────────────────▶ { type: "report", … }
               ◀───────── { report }                                      show photo + scan
  "Sent!" → reset                                                         renders Meloniq report
                                                                          [Download as PDF] ──▶ Generates A4 PDF
```

---

## 7. Running it & Verification

- **Standalone Backend Server (Port 3000)**: `cd backend && npm start` (or `npm run backend` from root).
- **Frontend Dev Server (Port 5173)**: `cd frontend && npm run dev` (or `npm run frontend` from root).
- **Network & Firewall Setup**:
  - Linux Mini-Server (Ubuntu/Debian): `sudo ufw allow 3000/tcp`
  - Linux Mini-Server (Fedora/RHEL): `sudo firewall-cmd --zone=public --add-port=3000/tcp --permanent && sudo firewall-cmd --reload`
  - Windows Host: `New-NetFirewallRule -DisplayName "Meloniq Backend 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any`
- **Health Check**: Verify connectivity from mobile browser at `http://<backend-ip>:3000/api/health`.
- **Download as PDF**: Accessible in both normal web sessions and booth display mode.
