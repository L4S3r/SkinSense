# context for coding agents

Read this first. It captures the non-obvious facts about this repo so you don't
have to rediscover them. For a full narrative tour see `WALKTHROUGH.md`; for
setup/booth instructions see `README.md`.

## What this is

**Lumen** — a face-photo skin-type analyzer. A camera captures a frame, the
backend sends it to a **Google Gemini** vision model, and a structured
skin-type report comes back (skin type, confidence, observations, care tips).

It runs two ways:
- **Self-serve web** — browser opens the webcam, captures, renders the report
  on the same device.
- **Booth mode** — a **Flutter phone app** (`mobile/`) is the capture station;
  the web app opened with `?display` is a big screen that shows each report
  live, pushed from the backend over a WebSocket.

**Not a medical device** — cosmetic skin-type insight only, never diagnostic.
The system prompt hard-forbids commenting on age/race/gender/identity. Keep it
that way.

## Gotchas that will bite you (read these)

- **Gemini via the OpenAI SDK.** `server.js` uses the `openai` npm package but
  points `baseURL` at `https://generativelanguage.googleapis.com/v1beta/openai/`.
  It is NOT calling OpenAI. The key is `GEMINI_API_KEY`, the model defaults to
  `gemini-2.5-flash`. Don't "fix" this back to OpenAI.
- **Stale docs history.** Earlier commits referenced OpenAI, an
  `OPENAI_API_KEY` file, and a fake model `gpt-5.6-terra`. That's all migrated
  away. If you see those names, they're stale — current truth is Gemini + `.env`.
  (An unused real `OPENAI_API_KEY` file may still sit on disk, gitignored. It's
  dead; don't wire anything to it, don't print its contents.)
- **Server binds `0.0.0.0`, not localhost.** This is intentional — the phone
  reaches the backend over the LAN. Don't change it to `localhost` or booth
  mode breaks.
- **`usesCleartextTraffic="true"`** in the Android manifest is intentional (the
  booth LAN is plain HTTP). Not a security bug to "fix" for this use case.
- **No auth / no rate limiting** on `/api/analyze` or the WebSocket. Acceptable
  for a closed booth LAN only. Flag it, add auth+HTTPS, before any public deploy.
- **No image storage by design.** Don't add logging/persistence of photos
  without explicit ask.

## Layout

```
server.js                 # Express + Gemini + WebSocket (/ws/display). ES modules.
src/                      # React frontend
  main.jsx                # React app entrypoint
  App.jsx                 # Core app component (web webcam + display mode via WS)
  App.css                 # Custom Skincare brand design tokens, styles, and animations
index.html                # Root HTML template for Vite
vite.config.js            # Vite configurations with server proxies
public_vanilla/           # Backup folder containing vanilla JS/CSS assets
dist/                     # Vite production build output (served by server.js, gitignored)
mobile/                   # Flutter capture app (Android)
  lib/main.dart           # single screen: front/rear camera → POST /api/analyze
.env.example              # copy to .env, set GEMINI_API_KEY
FaceChain.py              # ANCESTOR Colab notebook only — not run by the app. Don't wire it in.
booth-connect.ps1         # adb reverse helper for the browser-fallback booth path
```

## Backend contract

- `POST /api/analyze` — body `{ image: "data:image/...;base64,..." }`.
  - 400 if image missing/not a data URL; 500 if no API key; 502 if model output
    won't parse as JSON.
  - On success returns `{ report }` AND broadcasts
    `{ type: "report", report, image }` to every `?display` screen.
- `WS /ws/display` — on connect sends `{ type: "hello" }`, then `report`
  messages. The React app display mode auto-reconnects.
- Report JSON shape: `skin_type, confidence, summary, observations[], care_tips[], caveats`.
  No clear face → `skin_type: "unclear"` (don't make the model guess).

## Config (all via `.env`)

| var | default | note |
|---|---|---|
| `GEMINI_API_KEY` | — | required |
| `SKIN_ANALYSIS_MODEL` | `gemini-3.5-flash` | also: `-flash-lite`, `-pro` |
| `PORT` | `3000` | |

## Commands

```bash
# backend / web
npm install
npm run dev                   # Starts Vite dev server (port 5173, proxies to Express on 3000)
npm run build                 # Builds React bundle into dist/
npm start                     # Starts Express server on http://localhost:3000 (serves dist/)

# flutter app  (dev machine: Node 24 present, Flutter 3.x)
cd mobile
flutter pub get
flutter analyze               # MUST be clean before you call Flutter work done
flutter run                   # onto a connected Android device
flutter build apk --debug     # ~9 min first build; the camera KGP warning is benign
```

There is no automated JS test suite. Flutter has one smoke test
(`mobile/test/widget_test.dart`). The real backend check is a live POST +
WebSocket broadcast round-trip against a valid key.

## Conventions / expectations

- Frontend inserts model output using React state bindings, safeguarding against raw HTML injection.
- Flutter: front camera default (selfie face-scan), front preview mirrored,
  rear preview un-mirrored. `flutter analyze` clean is the bar.
- Don't commit or push unless explicitly asked. Secrets live in `.env` /
  the gitignored key file — never stage them, never echo their values.
- Match existing style: `server.js` is ES modules; the web app is React using Vite; keep the dark coral/teal "biometric scan"
  theme consistent across web and Flutter.
