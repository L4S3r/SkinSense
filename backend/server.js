// =====================================================
// Meloniq Skin Analyzer — Standalone Backend
// Serves the API, WebSocket display channel, and static assets
// =====================================================

import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env file from backend directory or parent directory
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "../.env") });

// ------------------- API key loading -------------------
const apiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim();
if (!apiKey) {
  console.warn(
    "\n⚠️  No Gemini API key found.\n" +
      "   Copy .env.example to .env and set GEMINI_API_KEY to your key\n" +
      "   (from https://aistudio.google.com/apikey), then restart.\n"
  );
}

// Gemini exposes an OpenAI-compatible endpoint, so we reuse the OpenAI
// SDK and point it at Google's base URL.
const openai = new OpenAI({
  apiKey: apiKey || "missing-key",
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

// Vision-capable model used for the analysis.
const MODEL = process.env.SKIN_ANALYSIS_MODEL || "gemini-3.5-flash";

// ------------------- App setup -------------------
const app = express();
app.use(express.json({ limit: "15mb" })); // photos as base64 need headroom

// Enable CORS for frontend & ngrok cross-origin access
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, ngrok-skip-browser-warning, User-Agent"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Root status endpoint for headless backend
app.get("/", (req, res) => {
  res.json({
    service: "Meloniq AI Backend API",
    status: "running",
    endpoints: {
      health: "GET /api/health",
      analyze: "POST /api/analyze",
      websocket: "WS /ws/display",
    },
  });
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    model: MODEL,
    hasApiKey: Boolean(apiKey),
  });
});

// ------------------- Booth display channel -------------------
// The Flutter phone captures a photo and POSTs it here; the booth SCREEN is a
// different device, so we push each finished report to it over a WebSocket.
// Any browser tab opened with `?display` connects to /ws/display and listens.
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/display" });
const displays = new Set();

wss.on("connection", (socket) => {
  displays.add(socket);
  socket.on("close", () => displays.delete(socket));
  socket.on("error", () => displays.delete(socket));
  // Greet the display so it can show a "connected, waiting…" state.
  try {
    socket.send(JSON.stringify({ type: "hello" }));
  } catch {
    // ignore — a socket that fails here will be cleaned up on next broadcast
  }
});

// Send a payload to every connected booth screen, dropping dead sockets.
function broadcastToDisplays(payload) {
  const data = JSON.stringify(payload);
  for (const socket of displays) {
    if (socket.readyState === socket.OPEN) {
      try {
        socket.send(data);
      } catch {
        displays.delete(socket);
      }
    } else {
      displays.delete(socket);
    }
  }
}

const SYSTEM_PROMPT = `You are a cosmetic skincare assistant. You analyze a single face
photo that a person took of themselves and produce a short, friendly,
informational skin-type report for personal/cosmetic use.

Focus only on visible skin-surface characteristics: oiliness, dryness,
texture, visible pore size, tone evenness, shine (especially T-zone),
and any visible redness or irritation. Never comment on age, race,
ethnicity, gender, attractiveness, or identity, and never try to
recognize or identify who the person is.

This tool is not a medical device and must never claim to diagnose a
skin disease or condition — only describe general cosmetic
skin-type characteristics and offer general, non-prescriptive
skincare tips.

Respond with ONLY one JSON object (no markdown fences, no commentary
outside the JSON) in exactly this shape:

{
  "skin_type": "oily" | "dry" | "combination" | "normal" | "sensitive" | "unclear",
  "confidence": "low" | "medium" | "high",
  "summary": "2-3 plain-language sentences summarizing the overall impression",
  "observations": [
    { "label": "short label, e.g. Hydration", "detail": "one sentence" }
    // 4 to 6 items covering things like hydration, pore visibility,
    // texture, tone evenness, T-zone shine, redness/irritation
  ],
  "care_tips": [ "short tip", "short tip", "short tip", "short tip" ],
  "caveats": "1-2 sentences noting lighting/image limitations and that this is not a medical diagnosis"
}

If no face is clearly visible, set "skin_type" to "unclear", keep
"observations" minimal, and use "caveats" to explain that a face
wasn't clearly detected and suggest retaking the photo facing the
camera in even lighting.`;

// Helper to call OpenAI API wrapper with automated retries and exponential backoff
async function callOpenAIWithRetry(params, retries = 3, initialDelay = 1500) {
  let delay = initialDelay;
  for (let i = 0; i < retries; i++) {
    try {
      return await openai.chat.completions.create(params);
    } catch (err) {
      const isRateLimit = err.status === 429 || (err.message && err.message.includes("429"));
      if (isRateLimit && i < retries - 1) {
        console.warn(`[Gemini API] Rate limit (429) encountered. Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // exponential backoff
      } else {
        throw err;
      }
    }
  }
}

// Helper to safely parse or repair model JSON outputs
function safeParseJSON(rawInput) {
  let cleaned = rawInput
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch (innerErr) {
        // proceed to auto-repair
      }
    }

    if (firstBrace !== -1) {
      let candidate = cleaned.slice(firstBrace).replace(/,\s*$/, "");
      let inString = false;
      let escape = false;
      let stack = [];

      for (let i = 0; i < candidate.length; i++) {
        const char = candidate[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (char === "\\") {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (char === "{" || char === "[") {
            stack.push(char === "{" ? "}" : "]");
          } else if (char === "}" || char === "]") {
            if (stack.length && stack[stack.length - 1] === char) {
              stack.pop();
            }
          }
        }
      }

      if (inString) candidate += '"';
      while (stack.length > 0) {
        candidate += stack.pop();
      }

      try {
        return JSON.parse(candidate);
      } catch (repairErr) {
        // proceed to fallback
      }
    }

    throw new Error("Unable to parse model JSON");
  }
}

app.post("/api/analyze", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
      return res.status(400).json({ error: "No valid image was provided." });
    }

    if (!apiKey) {
      return res.status(500).json({
        error:
          "Server is missing a Gemini API key. Set GEMINI_API_KEY in .env and restart the server.",
      });
    }

    const response = await callOpenAIWithRetry({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this face photo and return the JSON skin report described in your instructions.",
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    });

    const raw = response.choices?.[0]?.message?.content || "";
    let report;

    try {
      report = safeParseJSON(raw);
    } catch (parseErr) {
      console.error("Failed to parse model output as JSON:\n", raw);
      // Fallback report if model output is severely malformed
      report = {
        skin_type: "unclear",
        confidence: "low",
        summary: "The scan could not be fully evaluated. Please retake your photo in bright, direct lighting facing the camera.",
        observations: [
          { label: "Photo Quality", detail: "Image lighting or orientation was unclear for cosmetic surface analysis." }
        ],
        care_tips: [
          "Ensure your face is well-lit without harsh shadows",
          "Remove sunglasses or obstructions before scanning",
          "Keep the camera steady at eye level"
        ],
        caveats: "A face was not clearly detected. Please retake the photo facing the camera in even lighting."
      };
    }

    // Push finished report to any booth screens, then return to caller.
    broadcastToDisplays({ type: "report", report, image });

    return res.json({ report });
  } catch (err) {
    console.error("Analyze error:", err);
    if (err.status === 429 || (err.message && err.message.includes("429"))) {
      return res.status(429).json({
        error: "The AI scanner is temporarily busy (Rate Limit Exceeded). Please wait a few seconds and scan again.",
      });
    }
    if (err.status === 404 || (err.message && err.message.includes("404"))) {
      return res.status(404).json({
        error: `The requested AI model "${MODEL}" was not found. Please update SKIN_ANALYSIS_MODEL in .env (e.g. gemini-3.5-flash).`,
      });
    }
    return res.status(500).json({
      error: "Something went wrong while analyzing the photo. Check the server logs for details.",
    });
  }
});

const PORT = process.env.PORT || 3000;
// Listen on 0.0.0.0 so external clients / phones can reach the server over LAN
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✨ Meloniq Standalone Backend API running on port ${PORT}`);
  console.log(`   Health Check : http://localhost:${PORT}/api/health`);
  console.log(`   API Endpoint : http://localhost:${PORT}/api/analyze`);
  console.log(`   WebSocket    : ws://localhost:${PORT}/ws/display\n`);
});
