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
   # Option A: Install both backend and frontend dependencies from root
   npm run install:all

   # Option B: Install individually
   cd backend && npm install
   cd ../frontend && npm install
   ```

2. **Configure Environment Variables**:
   - **Backend Configuration**:
     ```bash
     cp backend/.env.example backend/.env
     # Set GEMINI_API_KEY to your Google Gemini API key
     ```
   - **Frontend Configuration**:
     ```bash
     cp frontend/.env.example frontend/.env
     # Set VITE_API_BASE_URL to your backend / mini-server URL (default: http://localhost:3000)
     ```

3. **Running Backend & Frontend as Separate Entities**:

   - **Standalone Backend Server (Port 3000)**:
     Launch the headless Express API + WebSocket server independently on port 3000. It handles API requests (`POST /api/analyze`) and WebSocket connections (`WS /ws/display`) without serving web app UI assets.
     ```bash
     cd backend
     npm start
     # Or from root: npm run backend
     ```
     Test backend health: **http://localhost:3000/api/health**

   - **Frontend Application (Port 5173)**:
     Launch the Meloniq web UI using Vite React dev server on port 5173:
     ```bash
     cd frontend
     npm run dev
     # Or from root: npm run frontend
     ```
     Open **http://localhost:5173** in your browser.

   - **Connecting Frontend to a Remote Mini-Server**:
     To point the frontend to a backend hosted on a mini-server / LAN IP (e.g., `http://192.168.1.100:3000`), update `frontend/.env`:
     ```env
     VITE_API_BASE_URL=http://192.168.1.100:3000
     ```

## Configuration

### Backend (`backend/.env`)

| Env var | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | _(none)_ | Your Google Gemini API key (from https://aistudio.google.com/apikey). Required. |
| `SKIN_ANALYSIS_MODEL` | `gemini-3.5-flash` | Vision model used for skin analysis. Options below. |
| `PORT` | `3000` | Port the backend server listens on. |

#### Available Gemini Models (Pros & Cons):

- `gemini-3.5-flash` **(Default - Recommended)**:
  - **Pros**: Balanced vision accuracy, detailed skin observations, fast latency (1-2s), generous free tier quotas.
  - **Cons**: Slightly slower than `flash-lite`.
- `gemini-3.5-flash-lite`:
  - **Pros**: Ultra-fast sub-second latency (<1s response times), lowest token cost, ideal for high-traffic live booths.
  - **Cons**: Slightly less detailed observation notes on subtle redness/tone nuances.
- `gemini-3.5-pro`:
  - **Pros**: Highest precision vision reasoning, handles uneven lighting best, rich dermatological observation notes.
  - **Cons**: Higher latency (3-5s per scan), lower free-tier rate limits (15 requests/min).

### Frontend (`frontend/.env`)

| Env var | Default | What it does |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3000` | Direct backend API & WebSocket base URL. Point to your mini-server IP/domain when hosting backend remotely. |

Gemini is called through its **OpenAI-compatible endpoint**, so the backend code reuses the `openai` SDK pointed at Google's base URL — no separate Google SDK required.

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

### Booth gotchas & Network Troubleshooting

- **Linux Mini-Server Firewall (Ubuntu/Debian)**: Allow port 3000:
  ```bash
  sudo ufw allow 3000/tcp
  ```
- **Linux Mini-Server Firewall (Fedora/RHEL)**:
  ```bash
  sudo firewall-cmd --zone=public --add-port=3000/tcp --permanent && sudo firewall-cmd --reload
  ```
- **Windows Firewall (PowerShell as Administrator)**: Allow port 3000 on all network profiles:
  ```powershell
  New-NetFirewallRule -DisplayName "Meloniq Backend 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any
  ```
- **Ethernet vs Wi-Fi Subnets**: If the backend machine is on Ethernet and the mobile phone is on Wi-Fi, verify your router bridges both to the same IP subnet (e.g. `192.168.1.x`).
- **5-Second Diagnostics**: On the phone browser, navigate to `http://<backend-ip>:3000/api/health`. If it returns `{"status":"ok"}`, network connectivity is confirmed.
- **No auth** on `/api/analyze` or the WebSocket. Fine for a closed booth LAN, but don't expose this to the public internet as-is.

## Project structure

```
Face-skin/
├── backend/                # Standalone Express & WebSocket backend entity
│   ├── server.js           # Express + Gemini call + WebSocket display channel (serves dist/)
│   ├── package.json        # backend deps: express, openai, ws, dotenv
│   ├── .env.example        # template — copy to .env
│   └── .env                # your real key (gitignored)
├── frontend/               # Standalone React frontend entity
│   ├── src/                # React source files (App.jsx, App.css, main.jsx)
│   ├── index.html          # Vite HTML entrypoint template with Google Fonts
│   ├── vite.config.js      # Vite config with React plugin and proxy settings
│   └── package.json        # frontend deps: react, react-dom, jspdf, html2canvas, vite
├── package.json            # Root workspace package with npm run backend / frontend scripts
├── booth-connect.ps1       # adb-reverse helper for browser fallback
├── FaceChain.py            # original Colab notebook (ancestor, not run by app)
├── README.md               # setup + booth + PDF export docs
├── WALKTHROUGH.md          # full guided tour of the codebase
├── public_vanilla/         # Backup of legacy vanilla JS/CSS assets
└── mobile/                 # Flutter capture app (booth phone station)
    └── lib/main.dart       # front-camera capture → POST to backend
```

## Notes / possible next steps

- The model is prompted to return strict JSON; the server strips stray markdown fences and parses it, returning a 502 with a friendly message if parsing ever fails so the UI doesn't hang.
- If no face is clearly visible, the model is instructed to say so (`skin_type: "unclear"`) instead of guessing.
- Before any public deployment: add auth + rate limiting on `/api/analyze` and the WebSocket, and put it behind HTTPS.
