// =====================================================
// FaceChain Skin Analyzer — backend
// Serves the camera UI and calls the OpenAI API (vision)
// to produce a skin-type analysis report.
// =====================================================

import express from "express";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ------------------- API key loading -------------------
// Priority: OPENAI_API_KEY file in the project root, then the
// OPENAI_API_KEY environment variable. This matches the "key lives
// in a file called OPENAI_API_KEY" setup requested for this project.
function loadApiKey() {
  const keyPath = path.join(__dirname, "OPENAI_API_KEY");
  try {
    const fromFile = fs.readFileSync(keyPath, "utf-8").trim();
    if (fromFile && !fromFile.startsWith("sk-REPLACE")) {
      return fromFile;
    }
  } catch (err) {
    // File doesn't exist yet — that's fine, fall back to env var below.
  }
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
    return process.env.OPENAI_API_KEY.trim();
  }
  return null;
}

const apiKey = loadApiKey();
if (!apiKey) {
  console.warn(
    "\n⚠️  No OpenAI API key found.\n" +
      "   Put your key in the 'OPENAI_API_KEY' file at the project root\n" +
      "   (replace the placeholder text), or set an OPENAI_API_KEY\n" +
      "   environment variable, then restart the server.\n"
  );
}

const openai = new OpenAI({ apiKey: apiKey || "missing-key" });

// Vision-capable model used for the analysis. Override with the
// SKIN_ANALYSIS_MODEL env var if you want a different model/tier.
const MODEL = process.env.SKIN_ANALYSIS_MODEL || "gpt-5.6-terra";

// ------------------- App setup -------------------
const app = express();
app.use(express.json({ limit: "15mb" })); // photos as base64 need headroom
app.use(express.static(path.join(__dirname, "public")));

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
          "Server is missing an OpenAI API key. Add it to the OPENAI_API_KEY file and restart the server.",
      });
    }

    const response = await openai.responses.create({
      model: MODEL,
      instructions: SYSTEM_PROMPT,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Analyze this face photo and return the JSON skin report described in your instructions.",
            },
            { type: "input_image", image_url: image },
          ],
        },
      ],
    });

    const raw = response.output_text || "";
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

    return res.json({ report });
  } catch (err) {
    console.error("Analyze error:", err);
    return res.status(500).json({
      error: "Something went wrong while analyzing the photo. Check the server logs for details.",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✨ FaceChain Skin Analyzer running → http://localhost:${PORT}\n`);
});
