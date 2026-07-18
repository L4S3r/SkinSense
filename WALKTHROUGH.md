# Lumen — AI Skin Scan · Complete Walkthrough

A guided tour of this repository: what it is, how the pieces fit together, and
how a photo becomes a skin report — in both self-serve web mode and two-device
booth mode.

---

## 1. What this project is

**Lumen** captures a face photo, sends it to a **Google Gemini** vision model,
and renders a plain-language skin-type report — skin type, confidence, a short
summary, 4–6 observations (hydration, pores, texture, tone, T-zone shine,
redness), and general care tips.

It runs two ways:

- **Self-serve web** — the browser opens the webcam, you capture a frame, and
  the report renders on the same device.
- **Booth mode** — a **Flutter phone app** is the capture station and a
  separate **big screen** (the web app in `?display` mode) shows each report
  live, pushed from the backend over a WebSocket.

It is intentionally minimal: one Express server, one API endpoint plus a
WebSocket channel, three static frontend files, and one Flutter screen. No
database, no user accounts, no image storage — the photo is sent to Gemini for
a single request and is not persisted.

> **Not a medical device.** The app gives general cosmetic skin-type insight
> only and explicitly does not diagnose skin conditions.

---

## 2. Where it came from — `FaceChain.py`

`FaceChain.py` is the **origin/ancestor** of this project, not part of the
running app. It's a Google Colab notebook that does:

- **Webcam capture** in Colab via injected JavaScript (`getUserMedia` →
  canvas → base64 JPEG).
- **Face recognition** using DeepFace (Facenet embeddings).
- A **toy proof-of-work blockchain** (`SimpleBlockchain`) to "enroll" and
  "recognize" faces, storing embeddings in blocks.

Lumen kept only the **webcam-capture pattern** and rebuilt it as a standalone
Node/Express + Gemini app. There is **no blockchain and no face-identity
recognition** in the app — it's a single-shot cosmetic skin analysis.

---

## 3. Project structure

```
Face-skin/
├── server.js               # Express server + Gemini call + WebSocket channel (serves dist/)
├── package.json            # deps: express, openai (Gemini-compat), ws, react, react-dom, vite, etc.
├── vite.config.js          # Vite config with React plugin and proxy settings
├── index.html              # Vite HTML entrypoint template
├── .env.example            # committed template — copy to .env
├── .env                    # your real GEMINI_API_KEY (gitignored)
├── .gitignore
├── booth-connect.ps1       # adb reverse helper for the browser fallback
├── FaceChain.py            # original Colab notebook (ancestor, not run by app)
├── README.md               # setup + booth docs
├── WALKTHROUGH.md          # this file
├── src/                    # React frontend source files
│   ├── main.jsx            # React app mount script
│   ├── App.jsx             # Camera capture, report rendering, display mode UI
│   └── App.css             # Skincare brand style definitions & animations
├── public_vanilla/         # Backup of old vanilla JS/CSS assets
└── mobile/                 # Flutter capture app (booth phone station)
    ├── lib/main.dart       # front-camera capture → POST to backend
    └── android/…/AndroidManifest.xml  # camera + internet + cleartext perms
```

---

## 4. The backend — `server.js`

An ES-module Express app (`"type": "module"` in `package.json`).

### API key loading (lines ~15–24)
The key is read from `GEMINI_API_KEY` in `.env` (loaded by `dotenv/config` at
the top of the file). `.env` is gitignored, so a real key never lands in
version control — only `.env.example` is tracked. If the key is missing the
server still boots but warns, and `/api/analyze` returns a clear 500.

### The Gemini client (lines ~26–35)
Gemini exposes an **OpenAI-compatible endpoint**, so the code reuses the
`openai` SDK and just points `baseURL` at
`https://generativelanguage.googleapis.com/v1beta/openai/`. The model defaults
to `gemini-3.5-flash` (override with `SKIN_ANALYSIS_MODEL`).

### App setup (lines ~37–40)
- `express.json({ limit: "15mb" })` — base64 photos are large, so the body
  limit is raised.
- `express.static("dist")` — serves the pre-compiled React frontend (production bundle).

### The booth display channel (lines ~42–75)
This is what makes two-device booth mode work. The phone POSTs a photo, but the
booth **screen is a different device** with no way to hear the result — so the
backend pushes each report to it over a WebSocket:

- Express is wrapped in an explicit `http.createServer(app)` so a
  `WebSocketServer` can attach to the same port on path `/ws/display`.
- Every connected screen is tracked in a `displays` Set; on connect it gets a
  `{ type: "hello" }` greeting so it can show a "connected, waiting" state.
- `broadcastToDisplays(payload)` sends to every open socket and prunes dead
  ones.

### The system prompt (`SYSTEM_PROMPT`, lines ~42–76)
The heart of the behavior. It constrains the model to:
- **Only** visible skin-surface traits (oiliness, dryness, texture, pores,
  tone, T-zone shine, redness).
- **Never** comment on age, race, ethnicity, gender, attractiveness, or
  identity, and never try to identify the person.
- **Never** diagnose — cosmetic description only.
- Return **strict JSON** in an exact shape (`skin_type`, `confidence`,
  `summary`, `observations[]`, `care_tips[]`, `caveats`).
- If no face is clearly visible → `skin_type: "unclear"` instead of guessing.

### The endpoint — `POST /api/analyze` (lines ~78–134)
1. Validates that `req.body.image` is a `data:image/...` string.
2. Confirms the API key is present.
3. Calls `openai.chat.completions.create(...)` with the system prompt and the
   image as an `image_url` content part.
4. Strips any stray ```` ```json ```` fences from the output, then
   `JSON.parse`s it. Parse failure → **502** with a friendly message (so no UI
   ever hangs on malformed model output).
5. **Broadcasts** `{ type: "report", report, image }` to any booth screens.
6. Returns `{ report }` to the caller (the phone or the web page).

### Listen (lines ~136–end)
`server.listen(PORT, "0.0.0.0", …)` — binding to `0.0.0.0` (not just
`localhost`) is what lets the Flutter phone reach the server over the LAN. The
startup log prints both the booth-screen URL and the phone POST target.

### Config (env vars, via `.env`)
| Env var | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | _(none)_ | Google Gemini API key. Required. |
| `SKIN_ANALYSIS_MODEL` | `gemini-3.5-flash` | Vision model used for analysis |
| `PORT` | `3000` | Server port |

---

## 5. The web frontend — React Source (`src/`)

### `index.html` (in root)
Vite's HTML entrypoint template containing:
- Preconnect settings and external fonts loader (`Playfair Display`, `DM Sans`).
- The root `<div id="root">` element where React mounts the application.

### `src/main.jsx`
The React application mount script. It imports React, ReactDOM, `App.jsx`, and `App.css`, then attaches the main `<App />` component to the DOM.

### `src/App.jsx` — two modes in a single component
Manages frontend reactive states (`isDisplay`, `stream`, `isScanning`, `report`, `error`, etc.).

**Self-serve mode** (default):
1. **Camera Initialization**: Runs `startCamera()` on mount via `useEffect` hook to fetch `navigator.mediaDevices.getUserMedia` video stream and feed it to the mirrored `<video>` preview.
2. **Frame Capture & Send**: `captureAndAnalyze()` draws the current video frame into a hidden `<canvas>`, extracts a JPEG data URL, stops the camera track, shows the scanning animation overlay, and fires a POST request to `/api/analyze`.
3. **Report Render**: On a successful response, triggers a `morphActive` shimmer transition and mounts the report panel details, updating body color themes based on the skin type (`bg-oily`, `bg-dry`, etc.). React state bindings safely prevent HTML injection.

**Booth display mode** (`?display` in the URL):
1. **WS Client**: Detects query params and initializes WebSocket connection to `/ws/display`. Automatically restarts the connection upon closures or server blips.
2. **Display Render**: Listens to `{ type: "report" }` broadcasts. When a report is received, it loads the base64 captured photo into the viewfinder, plays a 1.6-second scanning line sweep animation, triggers morph shimmer effects, and renders the skin type report details.

### `src/App.css`
A design-token-driven skincare brand styling stylesheet defining:
- Dynamic CSS color variables (`--bg`, `--coral`, etc.) overridden when body attributes match skin-type scan results (`data-skin-type="oily"`, `"dry"`...).
- Biometric grids, sweep animations, morph shimmers, and SVG path drawing keyframes for the clay-cracks effect.
- Media queries to handle viewport responsiveness and user-controlled accessibility tags (`prefers-reduced-motion`).

---

## 6. The Flutter capture app — `mobile/`

A single-screen Android app that is the booth's handheld capture station.

- **`lib/main.dart`** — initializes the **front camera**
  (`availableCameras()` → `CameraController`), shows a mirrored preview with a
  face guide, and a big **Capture & send** button. On tap it takes a picture,
  encodes it as `data:image/jpeg;base64,…`, and `POST`s it to
  `http://<host>/api/analyze`. It ignores the report body — a 200 means
  success, so it shows "Sent! Check the screen →" and auto-resets. States:
  idle → sending → sent / error.
- **Configurable host** — the laptop's `host:port` is editable via the settings
  button in the app bar and persisted with `shared_preferences`, so you set the
  booth laptop's IP once.
- **`AndroidManifest.xml`** — declares `CAMERA` + `INTERNET` permissions and
  `usesCleartextTraffic="true"` (Android blocks plain HTTP by default, and the
  booth LAN is HTTP).

Dependencies (`pubspec.yaml`): `camera`, `http`, `shared_preferences`.

---

## 7. End-to-end data flow (booth mode)

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
                         broadcastToDisplays(report) ──────────────────▶ { type:"report", … }
              ◀───────── { report }                                      show photo + scan
 "Sent!" → reset                                                         renderReport(report)
```

In **self-serve web mode** the same `/api/analyze` call is made by the browser
page itself, and it renders the returned `{ report }` directly — the broadcast
still fires but is simply a no-op if no screen is connected.

---

## 8. Running it

### Self-serve web (local dev)
```bash
npm install
cp .env.example .env        # then set GEMINI_API_KEY in .env
npm start                   # → http://localhost:3000
```
Open the URL, allow camera access, click **Capture & analyze**. Requires Node
18+, a Gemini key, a webcam, and a secure origin (`localhost` for dev; HTTPS if
deployed).

### Booth mode (phone + screen)
See the **Booth setup** section in `README.md` for the full step-by-step. In
short: `npm start` on the laptop, open `http://localhost:3000/?display` on the
screen, `flutter run` the app onto the phone, point it at the laptop's LAN IP,
and capture. The `adb reverse` + `booth-connect.ps1` path is the fallback if
venue Wi-Fi is unreliable.

---

## 9. Things to know / gotchas

- **No auth or rate limiting** on `/api/analyze` or the WebSocket. Fine for
  local dev and a closed booth LAN, but anyone who can reach the endpoint spends
  your Gemini quota or can push to the screen. Add auth + rate limiting and
  HTTPS before any public deployment.
- **No image storage.** By design, nothing is written to disk or logged.
- **Cleartext HTTP on the phone** is enabled via `usesCleartextTraffic` for the
  LAN booth setup — expected, since the venue backend is plain HTTP.
- **Windows Firewall** will prompt to allow Node on private networks the first
  time the phone connects; allow it or the phone can't reach port 3000.

---

## 10. Natural next steps

- Add auth + rate limiting before any public deployment.
- A front/rear camera toggle in the Flutter app.
- QR "room" pairing if you ever run multiple booths/screens at once (the
  current design is single-booth broadcast: any phone pushes to any screen).
- A "retake" quality check (blur/lighting) before sending, to cut down on
  `unclear` results.
- Optional history: a lightweight store (SQLite or a JSON file) keyed by
  session so someone could track their skin over time (left out of the MVP).
