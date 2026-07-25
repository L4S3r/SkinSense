import { Router } from "express";
import {
  MODEL,
  FALLBACK_MODEL,
  MAX_CONCURRENT_CALLS,
  apiKey,
  AI_SERVICE_URL,
} from "../config/index.js";
import { normalizeReport, isReportValid } from "../services/reportFormatter.js";
import { recommendSoaps, extractSkinProfile } from "../services/soapRecommendation.js";
import { broadcastToDisplays } from "../websocket/displayChannel.js";

const router = Router();

// Root status endpoint for backend API
router.get("/", (req, res) => {
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
router.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    model: MODEL,
    fallbackModel: FALLBACK_MODEL || null,
    maxConcurrent: MAX_CONCURRENT_CALLS,
    hasApiKey: Boolean(apiKey),
  });
});

// Analysis endpoint
router.post("/api/analyze", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
      return res.status(400).json({ error: "No valid image was provided." });
    }

    let aiResponse;
    try {
      aiResponse = await fetch(AI_SERVICE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
    } catch (netErr) {
      console.error("[API Gateway] Unable to reach Python AI Microservice:", netErr.message);
      return res.status(503).json({
        error: "AI Vision Service is currently unreachable. Please ensure the Python AI microservice is running on port 8000.",
      });
    }

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error(`[API Gateway] Python AI Microservice returned HTTP ${aiResponse.status}:`, errText);
      return res.status(aiResponse.status).json({
        error: "AI processing failed on microservice: " + errText,
      });
    }

    const data = await aiResponse.json();
    let parsedReport = normalizeReport(data.report);

    if (!isReportValid(parsedReport)) {
      return res.status(502).json({
        error: "The AI skin report was incomplete or invalid.",
      });
    }

    // Attach Meloniq Soap Recommendations based on extracted SkinProfile
    const skinProfile = extractSkinProfile(parsedReport);
    const recommendedSoaps = recommendSoaps(skinProfile, 2);
    parsedReport.recommendedSoaps = recommendedSoaps;

    // Push finished valid report to any booth screens, then return to caller.
    broadcastToDisplays({ type: "report", report: parsedReport, image });

    return res.json({ report: parsedReport });
  } catch (err) {
    console.error("[API Analyze Error]", err.message);

    if (err.quotaType === "RPD") {
      return res.status(429).json({
        error:
          "Daily AI scanning quota reached for the booth. Please try again tomorrow or contact the administrator.",
      });
    }

    if (
      err.quotaType === "RPM" ||
      err.quotaType === "TPM" ||
      err.status === 429 ||
      (err.message && err.message.includes("429"))
    ) {
      return res.status(429).json({
        error:
          "The AI scanner per-minute rate limit was exceeded. Please wait a moment and scan again.",
      });
    }

    if (
      err.status === 503 ||
      err.status === 502 ||
      err.status === 504 ||
      (err.message && /502|503|504/.test(err.message))
    ) {
      return res.status(503).json({
        error:
          "The AI scanner service is temporarily busy (model overloaded). Please wait a few seconds and scan again.",
      });
    }

    return res.status(500).json({
      error: "An unexpected error occurred during skin analysis. " + err.message,
    });
  }
});

export default router;
