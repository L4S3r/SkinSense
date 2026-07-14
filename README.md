# Lumen — AI Skin Scan

A small full-stack web app: it opens your webcam in the browser, captures a
photo, and sends it to an OpenAI vision model to generate a plain-language
skin-type report (skin type, hydration/texture observations, and general
care tips). Inspired by the webcam-capture pattern in `FaceChain.py`, but
built as a standalone Node/Express + OpenAI app rather than a Colab notebook
— no blockchain or face-identity enrollment here, just a single-shot skin
analysis.

## What it does

1. The browser asks for camera access and shows a live viewfinder.
2. You click **Capture & analyze**; the frame is captured client-side.
3. The photo is sent to your own backend (`/api/analyze`), which calls the
   OpenAI API with the image and asks for a structured skin report.
4. The report renders in the UI: skin type, confidence, a short summary,
   4–6 observations (hydration, texture, pores, tone, shine, redness), and
   general care tips.

The photo is only ever sent to OpenAI for that one request — this app does
not store, log, or persist images anywhere.

**This is not a medical device.** It gives general, cosmetic skin-type
insight only, and explicitly does not diagnose skin conditions. Point people
with real skin concerns to a dermatologist.

## Requirements

- Node.js 18+
- An OpenAI API account with a key that has access to a vision-capable model
- A webcam, and a browser that supports `getUserMedia` (any modern browser)
- **HTTPS or `localhost`** — browsers only allow camera access on secure
  origins, so this works great on `localhost` for local dev; if you deploy
  it, put it behind HTTPS.

## Setup

```bash
cd skin-analyzer
npm install

# Add your key
cp OPENAI_API_KEY.example OPENAI_API_KEY
# then open OPENAI_API_KEY and replace the placeholder with your real key
# (starts with "sk-")

npm start
```

Open **http://localhost:3000**, allow camera access, and click **Capture &
analyze**.

By default the server looks for the key in a file literally named
`OPENAI_API_KEY` in the project root (this is the file `.gitignore` keeps
out of version control, so you never accidentally commit a real key — only
`OPENAI_API_KEY.example` is tracked). If that file is missing, it falls back
to an `OPENAI_API_KEY` environment variable instead, so it also works
cleanly if you deploy somewhere that injects secrets as env vars.

## Configuration

| Env var | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `SKIN_ANALYSIS_MODEL` | `gpt-5.6-terra` | Vision model used for analysis. Any current vision-capable OpenAI model works — swap in whichever tier fits your cost/quality needs. |

## Project structure

```
skin-analyzer/
├── server.js              # Express server + OpenAI call
├── package.json
├── OPENAI_API_KEY.example # committed placeholder — copy to OPENAI_API_KEY
├── OPENAI_API_KEY         # your real key (gitignored)
└── public/
    ├── index.html         # camera viewfinder + report UI
    ├── style.css
    └── app.js              # camera capture + fetch('/api/analyze')
```

## Notes / possible next steps

- The model is prompted to return strict JSON; the server strips stray
  markdown fences and parses it, returning a 502 with a friendly message if
  parsing ever fails so the UI doesn't hang.
- If no face is clearly visible, the model is instructed to say so
  (`skin_type: "unclear"`) instead of guessing.
- Want history? You could add a lightweight store (SQLite, or even a JSON
  file) keyed by session to let someone track their skin over time — that's
  a natural next feature but intentionally left out for the MVP.
