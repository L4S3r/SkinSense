// =====================================================
// FaceChain Skin Analyzer — backend
// Serves the camera UI and calls the OpenAI API (vision)
// to produce a skin-type analysis report.
// =====================================================

import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ------------------- API key loading -------------------
// The key comes from the GEMINI_API_KEY variable in .env (loaded above).
const apiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim();
if (!apiKey) {
  console.warn(
    "\n⚠️  No Gemini API key found.\n" +
      "   Copy .env.example to .env and set GEMINI_API_KEY to your key\n" +
      "   (from https://aistudio.google.com/apikey), then restart.\n"
  );
}

// Gemini exposes an OpenAI-compatible endpoint, so we reuse the OpenAI
// SDK and just point it at Google's base URL.
const openai = new OpenAI({
  apiKey: apiKey || "missing-key",
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

// Vision-capable model used for the analysis. Override with the
// SKIN_ANALYSIS_MODEL env var if you want a different model/tier.
const MODEL = process.env.SKIN_ANALYSIS_MODEL || "gemini-2.5-flash";

// ------------------- App setup -------------------
const app = express();
app.use(express.json({ limit: "15mb" })); // photos as base64 need headroom
app.use(express.static(path.join(__dirname, "public")));

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
    // ignore — a socket that fails here will be cleaned up on the next broadcast
  }
});

// Send a payload to every connected booth screen, dropping any dead sockets.
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

    const response = await openai.chat.completions.create({
      model: MODEL,
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
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    let report;
    try {
      report = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Failed to parse model output as JSON:\n", raw);
      return res.status(502).json({
        error: "The AI response couldn't be read as a report. Please try again.",
      });
    }

    // Push the finished report (plus the captured photo) to any booth
    // screens, then return it to the phone that triggered the scan.
    broadcastToDisplays({ type: "report", report, image });

    return res.json({ report });
  } catch (err) {
    console.error("Analyze error:", err);
    return res.status(500).json({
      error: "Something went wrong while analyzing the photo. Check the server logs for details.",
    });
  }
});

const PORT = process.env.PORT || 3000;
// Listen on 0.0.0.0 so the Flutter phone can reach the server over the LAN
// (not just localhost). The booth screen opens `?display` on the same host.
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✨ Lumen Skin Analyzer running`);
  console.log(`   Booth screen : http://localhost:${PORT}/?display`);
  console.log(`   Phone posts  : http://<this-laptop-LAN-ip>:${PORT}/api/analyze\n`);
});
