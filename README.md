# Meloniq — AI Skin Analysis

A modern full-stack web application: it captures a face photo, sends it to a **Google Gemini** vision model (via OpenAI-compatible API), and renders a plain-language skin-type report (skin type, hydration/texture observations, care tips, and publication-ready A4 PDF download). Inspired by the webcam-capture pattern in `FaceChain.py`, but built as a standalone Node/Express + React application with the **Meloniq** botanical brand design system.

It runs two ways:

- **Self-serve web** — open it in a browser, allow the camera, capture, and read/download the report on the same device.
- **Booth mode** — a **Flutter phone app** (`mobile/`) is the handheld capture station and a **big screen** (`?display`) shows each report live. See [Booth setup](#booth-setup-phone-capture--big-screen) below.

## What it does

1. A camera viewfinder is shown (browser `getUserMedia` in React, or the Flutter app's native front camera).
2. On **Capture**, the frame is captured and sent to your backend (`POST /api/analyze`) as a base64 data URL.
3. The backend calls Gemini with the image and requests a structured skin report.
4. The report renders with the Meloniq botanical aesthetic: skin type, confidence, summary, 4-metric observations grid (hydration, texture, pores, tone), and care notes.
5. **A4 PDF Export**: Users can download a publication-ready, retina-sharp A4 PDF document (`meloniq-skin-report-YYYY-MM-DD.pdf`) with official Meloniq letterhead, compact photo thumbnail, metric grid, and page numbering.
6. In booth mode, reports are pushed live to the display screen over WebSockets and remain visible until a new scan is submitted from the phone.

The photo is only ever sent to Gemini for that single request — this app does not store, log, or persist images anywhere.

**This is not a medical device.** It gives general, cosmetic skin-type insight only, and explicitly does not diagnose skin conditions. Point people with real skin concerns to a dermatologist.

## Design System & Branding (Meloniq)

- **Palette**:
  - **Muted Sage Light** (`#E2E7DA`): Primary background.
  - **Deep Olive** (`#434E3F`): Headings, text, icons, buttons, and decorative underlines.
  - **Soft Off-White Cream** (`#F4F6F0`): Report card containers and scan frame.
- **Typography & Wordmark**:
  - `Playfair Display` serif for titles and wordmarks.
  - Customized **Meloniq Wordmark**: "Mel" + stylized "o" with 3 nested concentric arches SVG + "niq" + geometric baseline alignment line.

## Requirements

- Node.js 18+
- A **Google Gemini API key** (from https://aistudio.google.com/apikey)
- For the web camera: a browser that supports `getUserMedia` and a **secure origin** — `localhost` for dev, or HTTPS if deployed.
- For booth mode: Flutter 3.x + an Android phone (see [Booth setup](#booth-setup-phone-capture--big-screen)).

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure API Key**:
   ```bash
   cp .env.example .env
   # Open .env and set GEMINI_API_KEY to your Gemini API key
   ```

3. **Run the App**:

   - **Development Mode (Hot-Reloading)**:
     Start both the Express backend and the Vite dev server.
     ```bash
     # In terminal 1: starts backend Express server on port 3000
     npm start

     # In terminal 2: starts Vite dev server on port 5173
     npm run dev
     ```
     Open **http://localhost:5173** in your browser, allow camera access, and click **Capture & analyze**.

   - **Production Mode (Pre-compiled)**:
     Compile the React application first, then start the Express server.
     ```bash
     # Compile the React app (outputs to dist/)
     npm run build

     # Start the Express server (serves compiled files from dist/ on port 3000)
     npm start
     ```
     Open **http://localhost:3000** in your browser.

## Configuration

All config is via `.env` (see `.env.example`):

| Env var | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | _(none)_ | Your Google Gemini API key. Required. |
| `SKIN_ANALYSIS_MODEL` | `gemini-3.5-flash` | Vision model used for analysis. Alternatives: `gemini-2.5-flash-lite`, `gemini-2.5-pro`. |
| `PORT` | `3000` | Port the server listens on. |

Gemini is called through its **OpenAI-compatible endpoint**, so the code reuses the `openai` SDK pointed at Google's base URL — no separate Google SDK needed.

## Publication-Ready A4 PDF Export

The application includes a dedicated, off-screen A4 print rendering engine:
- **Dimensions**: Exact A4 standard (210mm × 297mm / 794px × 1123px) with ~18–20mm margins.
- **Letterhead**: Official Meloniq letterhead, confidential cosmetic report tag, generation date, and document ID.
- **Thumbnail Layout**: Compact, framed portrait photo alongside skin type diagnosis and summary.
- **File Naming**: Formatted as `meloniq-skin-report-YYYY-MM-DD.pdf`.
- **Availability**: Accessible via the **"Download as PDF"** button in both normal web sessions and booth display mode.

## Booth setup (phone capture + big screen)

For a conference booth, split capture and display across two devices: an Android phone (Flutter app) is the handheld capture station, and a laptop screen is the display everyone watches. The phone talks to the laptop's backend over the venue LAN; the backend pushes each finished report to the screen over a WebSocket.

```
Flutter phone ──POST /api/analyze (photo)──▶ backend ──▶ Gemini
     │ shows "Sent!" on success                 │
     │                                           │ broadcast report + photo
big screen (web ?display) ◀── WebSocket push ────┘
```

Reports remain displayed permanently on the screen until a new photo is sent from the phone.

### One-time

1. Build the app dependencies once: `cd mobile && flutter pub get`.
2. Make sure the phone and laptop are on the **same Wi-Fi**.

### Booth day

1. **Laptop — start the backend:**
   ```bash
   npm start
   ```
2. **Laptop — open the big screen** in a browser, maximized:
   ```
   http://localhost:3000/?display
   ```
   It shows "waiting for the next scan…" and auto-reconnects if the server restarts.
3. **Find the laptop's LAN IP** (`ipconfig` on Windows → IPv4 Address, e.g. `192.168.1.5`).
4. **Phone — run the Flutter app** onto the device:
   ```bash
   cd mobile
   flutter run
   ```
   In the app, tap the address shown in the top bar and set it to `<laptop-ip>:3000`. It's saved for next time.
5. Aim the phone at the person, tap **Capture & send**. The report appears on the big screen a moment later. The phone just says "Sent!" and resets for the next person.

### If Wi-Fi is flaky — the `adb reverse` fallback

You can skip the phone app entirely and open the web app in the **phone's browser** over a USB/wireless-debugging tunnel. `adb reverse` forwards the phone's `localhost:3000` to the laptop, which satisfies the secure-origin rule so the phone's browser camera works.

```bash
# Phone: enable wireless debugging, then on the laptop:
adb pair <phone-ip>:<pair-port>       # enter the pairing code
adb connect <phone-ip>:<debug-port>
./booth-connect.ps1                    # sets up the reverse forward
```

Then open **http://localhost:3000** (not the LAN IP) in the phone's browser. `booth-connect.ps1` auto-detects the device and prints the next step; run it with `-Serve` to also start the server. Re-run it if the connection drops.

### Booth gotchas

- **Windows Firewall**: the first time the phone connects, Windows prompts to allow Node.js on private networks — allow it, or the phone can't reach port 3000.
- **No auth** on `/api/analyze` or the WebSocket. Fine for a closed booth LAN, but anyone on the same Wi-Fi who knows the address could POST an image or connect a display. Don't expose this to the public internet as-is.
- The wireless-debugging **port changes** each session; re-check with `adb devices -l` if `booth-connect.ps1` can't find the device.

## Project structure

```
Face-skin/
├── server.js               # Express + Gemini call + WebSocket display channel (serves dist/)
├── package.json            # deps: express, openai, ws, react, react-dom, jspdf, html2canvas, vite
├── vite.config.js          # Vite config with React plugin and proxy settings
├── index.html              # Vite HTML entrypoint template with Google Fonts (Playfair Display, DM Sans)
├── .env.example            # committed template — copy to .env
├── .env                    # your real key (gitignored)
├── booth-connect.ps1       # adb-reverse helper for browser fallback
├── FaceChain.py            # original Colab notebook (ancestor, not run by app)
├── README.md               # setup + booth + PDF export docs
├── WALKTHROUGH.md          # full guided tour of the codebase
├── src/                    # React frontend source files
│   ├── main.jsx            # React app mount script
│   ├── App.jsx             # Camera capture, report rendering, display mode, A4 PDF export template
│   └── App.css             # Meloniq botanical brand design system tokens & animations
├── public_vanilla/         # Backup of legacy vanilla JS/CSS assets
└── mobile/                 # Flutter capture app (booth phone station)
    └── lib/main.dart       # front-camera capture → POST to backend
```

## Notes / possible next steps

- The model is prompted to return strict JSON; the server strips stray markdown fences and parses it, returning a 502 with a friendly message if parsing ever fails so the UI doesn't hang.
- If no face is clearly visible, the model is instructed to say so (`skin_type: "unclear"`) instead of guessing.
- Before any public deployment: add auth + rate limiting on `/api/analyze` and the WebSocket, and put it behind HTTPS.
