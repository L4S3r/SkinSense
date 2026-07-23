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

// ------------------- Configuration & Models -------------------
// Primary vision-capable model used for skin analysis.
const MODEL = process.env.SKIN_ANALYSIS_MODEL || "gemini-3.5-flash";

// Optional fallback model if primary model is quota-exhausted (opt-in via env var)
const FALLBACK_MODEL = process.env.FALLBACK_MODEL && process.env.FALLBACK_MODEL.trim();

// Maximum concurrent Gemini API requests (default 1 to prevent free-tier RPM budget collisions)
const MAX_CONCURRENT_CALLS = parseInt(process.env.MAX_CONCURRENT_GEMINI_CALLS || "1", 10);

// Maximum queue wait time in ms before timing out queued requests (default 30 seconds)
const QUEUE_TIMEOUT_MS = parseInt(process.env.GEMINI_QUEUE_TIMEOUT_MS || "30000", 10);

// Retry settings
const MAX_RETRIES = parseInt(process.env.GEMINI_MAX_RETRIES || "3", 10);
const INITIAL_RETRY_DELAY_MS = parseInt(process.env.GEMINI_INITIAL_RETRY_DELAY_MS || "1500", 10);

// Per-call timeout for individual Gemini API calls (ms). Prevents hung calls from
// holding the concurrency queue slot indefinitely. Treated as a transient error.
const GEMINI_REQUEST_TIMEOUT_MS = parseInt(process.env.GEMINI_REQUEST_TIMEOUT_MS || "20000", 10);

// Maximum total raw Gemini HTTP attempts (primary retries + fallback retries, counted
// per individual HTTP call, not per executeAnalysisWithFallback round) per single
// /api/analyze request.  Default 8: allows up to ~3 primary + ~3 fallback + 2 spare
// for truncation/invalid-report retries, with schema enforcement making the latter rare.
const GEMINI_MAX_CALLS_PER_REQUEST = parseInt(process.env.GEMINI_MAX_CALLS_PER_REQUEST || "8", 10);

// Optional hint: if daily calls to a model reach this many and a 429 arrives, treat
// it as an RPD (daily quota) exhaustion even if the error body is empty.
// Leave unset (default) to disable this heuristic.
const GEMINI_DAILY_LIMIT_HINT = process.env.GEMINI_DAILY_LIMIT_HINT
  ? parseInt(process.env.GEMINI_DAILY_LIMIT_HINT, 10)
  : null;

// Circuit breaker: if a model accumulates N consecutive quota failures within
// CIRCUIT_BREAKER_COOLDOWN_MS milliseconds, skip it on the next request and go
// straight to the fallback model, avoiding wasted retry delay against a hot quota.
const CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || "2", 10);
const CIRCUIT_BREAKER_COOLDOWN_MS = parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS || "60000", 10);

// ------------------- In-Process Request Queue (Semaphore) -------------------
class GeminiRequestQueue {
  constructor(maxConcurrent = 1, timeoutMs = 30000) {
    this.maxConcurrent = maxConcurrent;
    this.timeoutMs = timeoutMs;
    this.activeCount = 0;
    this.queue = [];
  }

  async run(fn) {
    const queueStartTime = Date.now();
    if (this.activeCount >= this.maxConcurrent) {
      const queueDepth = this.queue.length + 1;
      console.log(
        `[Request Queue] ⏳ Max concurrency reached (${this.activeCount}/${this.maxConcurrent} active). Queueing request (Queue depth: ${queueDepth})...`
      );

      await new Promise((resolve, reject) => {
        let timer = null;
        const queueItem = {
          resolve: () => {
            if (timer) clearTimeout(timer);
            resolve();
          },
          reject: (err) => {
            if (timer) clearTimeout(timer);
            reject(err);
          },
        };

        if (this.timeoutMs > 0) {
          timer = setTimeout(() => {
            const idx = this.queue.indexOf(queueItem);
            if (idx !== -1) {
              this.queue.splice(idx, 1);
            }
            const timeoutErr = new Error("Request timed out waiting in queue for AI processing slot.");
            timeoutErr.status = 503;
            timeoutErr.isQueueTimeout = true;
            console.warn(`[Request Queue] ⚠️ Request timed out after ${this.timeoutMs}ms waiting in queue.`);
            reject(timeoutErr);
          }, this.timeoutMs);
        }

        this.queue.push(queueItem);
      });

      const waitMs = Date.now() - queueStartTime;
      console.log(
        `[Request Queue] ▶️ Request dequeued after ${waitMs}ms wait. Active slots: ${this.activeCount + 1}/${this.maxConcurrent}.`
      );
    } else {
      console.log(
        `[Request Queue] ▶️ Queue slot available (${this.activeCount + 1}/${this.maxConcurrent} active). Executing...`
      );
    }

    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next.resolve();
      }
    }
  }
}

const geminiQueue = new GeminiRequestQueue(MAX_CONCURRENT_CALLS, QUEUE_TIMEOUT_MS);

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
    fallbackModel: FALLBACK_MODEL || null,
    maxConcurrent: MAX_CONCURRENT_CALLS,
    hasApiKey: Boolean(apiKey),
  });
});

// ------------------- Booth display channel -------------------
// The Flutter phone captures a photo and POSTs it here; the booth SCREEN is a
// different device, so we push each finished report to it over a WebSocket.
// Any browser tab opened with `?display` connects to /ws/display and listens.
const server = http.createServer(app);

// Gracefully handle client connection socket errors to prevent the server from crashing.
server.on("connection", (socket) => {
  socket.on("error", (err) => {
    if (
      err.code === "ECONNRESET" ||
      err.code === "ECONNABORTED" ||
      err.code === "EPIPE"
    ) {
      return; // Ignore common connection drops/aborts
    }
    console.error("Connection socket error:", err);
  });
});

server.on("clientError", (err, socket) => {
  if (
    err.code === "ECONNRESET" ||
    err.code === "ECONNABORTED" ||
    err.code === "EPIPE"
  ) {
    socket.destroy();
    return;
  }
  console.warn("Client connection error:", err.message);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

// Process-level handlers for unhandled socket exceptions/rejections
process.on("uncaughtException", (err) => {
  if (
    err.code === "ECONNRESET" ||
    err.code === "ECONNABORTED" ||
    err.code === "EPIPE"
  ) {
    console.warn(`[Node Process] Handled socket error gracefully: ${err.message}`);
    return;
  }
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

const wss = new WebSocketServer({ server, path: "/ws/display" });

wss.on("error", (err) => {
  console.error("WebSocket server error:", err);
});

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

const SYSTEM_PROMPT = `You are an expert cosmetic skincare analyst.Your task is to analyze a single user-provided face photo and generate a concise, friendly, and purely cosmetic skin - type report.

### ANALYSIS PROTOCOL
Carefully examine the visible facial regions (forehead, nose, chin / T-zone, and cheeks / U-zone) using the following visual markers:
- Shine Spread & Sebum: Estimate surface reflection area. Note if shine extends beyond the nose/forehead into the cheeks (oily) versus remaining strictly isolated to the narrow T-zone with matte cheeks (combination).
- Dewy vs. Oily: Distinguish natural light bounce on cheekbones (dewy) from diffuse surface sheen across the cheeks or central face (oily).
- Pores & Texture: Check pore prominence across the nose, forehead, and cheeks.
- Dryness & Flaking: Check if cheeks are visibly dry, tight, or matte.
- Irritation / Redness: Identify localized flushing or diffuse redness.

### CLASSIFICATION RULES
- Oily: Moderate-to-noticeable shine or sheen across the T-zone extending into the inner/mid cheeks, or general surface reflection across multiple facial zones without visibly dry or matte outer cheeks. Prefer "oily" over "combination" or "normal" if oil/shine is present beyond the immediate nose bridge and cheeks show noticeable sheen.
- Combination: Requires a clear, distinct zone contrast—persistent shine strictly limited to the narrow T-zone (nose/forehead) while the cheeks/U-zone are visibly matte, dry, or tight.
- Dry: Matte or dull appearance across the entire face, minimal visible shine anywhere, potential fine flaking or dry texture.
- Normal: Low-to-moderate, soft balanced light bounce with smooth texture and no noticeable excess oiliness in the T-zone or cheeks.
- Sensitive: Dominant diffuse redness, blotchiness, or visible surface irritation regardless of oil levels.
- Unclear: Obscured face, severe motion blur, low resolution, extreme shadows/overexposure, or no human face visible.

### BOUNDARIES & SAFETY
1. STRICT NON - MEDICAL RULE: You are NOT a medical device.Never diagnose skin diseases, acne vulgaris, rosacea, eczema, or clinical conditions.Refer only to cosmetic characteristics(e.g., "visible redness" instead of "rosacea", "visible congestion" instead of "severe acne").
2. PRIVACY & SAFETY: Never comment on age, race, ethnicity, gender, identity, or physical attractiveness.Do not attempt identity recognition.

### OUTPUT FORMAT
Respond ONLY with a valid, raw JSON object.Do not include markdown code fences(e.g., \`\`\`json), prefix commentary, or postfix explanations. 

Follow this exact structure:

{
  "skin_type": "oily" | "dry" | "combination" | "normal" | "sensitive" | "unclear",
  "confidence": "low" | "medium" | "high",
  "summary": "2-3 plain-language sentences summarizing the overall visual impression.",
  "observations": [
    { "label": "Hydration & Moisture", "detail": "One specific sentence describing moisture balance." },
    { "label": "Pore Visibility", "detail": "One specific sentence describing pore prominence and location." },
    { "label": "Skin Texture", "detail": "One specific sentence describing overall surface texture." },
    { "label": "Tone & Redness", "detail": "One specific sentence describing visual evenness or redness." }
  ],
  "care_tips": [
    "Short non-prescriptive cosmetic tip 1",
    "Short non-prescriptive cosmetic tip 2",
    "Short non-prescriptive cosmetic tip 3",
    "Short non-prescriptive cosmetic tip 4"
  ],
  "caveats": "1-2 sentences noting photo lighting/angle limitations and stating this is purely cosmetic, not a medical diagnosis."
}

If "skin_type" is "unclear", keep "observations" to a single general entry and use "caveats" to explain why analysis was not possible and request a clear, well-lit photo facing the camera`;

// ------------------- In-process daily call counter per model -------------------
// Counts every attempted Gemini call. Resets at midnight Pacific Time (America/Los_Angeles)
// because that is when Gemini's RPD quota window rolls over.
// No persistence: a server restart resets the counter, which is acceptable for a booth.
const _dailyCallCounts = {}; // { [modelName]: { date: "YYYY-MM-DD", count: N } }

function _getPacificDateStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function incrementDailyCallCount(model) {
  const today = _getPacificDateStr();
  if (!_dailyCallCounts[model] || _dailyCallCounts[model].date !== today) {
    _dailyCallCounts[model] = { date: today, count: 0 };
  }
  _dailyCallCounts[model].count += 1;
  return _dailyCallCounts[model].count;
}

function getDailyCallCount(model) {
  const today = _getPacificDateStr();
  if (!_dailyCallCounts[model] || _dailyCallCounts[model].date !== today) return 0;
  return _dailyCallCounts[model].count;
}

// Inspect error messages/bodies to detect Gemini quota type (RPD vs RPM vs TPM).
// Incorporates the daily call counter as a secondary RPD signal because Gemini's
// OpenAI-compat endpoint often returns 429s with an empty error body.
function detectQuotaType(err, model) {
  if (!err) return null;
  const parts = [
    err.message,
    err.status,
    err.code,
    err.error?.message,
    err.error?.status,
    err.error?.code,
    typeof err.error === "string" ? err.error : "",
    JSON.stringify(err.error || {}),
    JSON.stringify(err.body || {}),
  ];
  const combined = parts.filter(Boolean).join(" ").toLowerCase();
  const hasEmptyBody =
    !err.error && !err.body && combined === (err.message || "").toLowerCase();

  // --- Text-based detection (primary) ---

  // Requests Per Day (RPD) - Hard daily limit
  if (
    combined.includes("requests per day") ||
    combined.includes("per day") ||
    combined.includes("rpd") ||
    combined.includes("daily quota") ||
    combined.includes("day limit")
  ) {
    return "RPD";
  }

  // Tokens Per Minute (TPM)
  if (
    combined.includes("tokens per minute") ||
    combined.includes("per minute tokens") ||
    combined.includes("tpm") ||
    combined.includes("token limit")
  ) {
    return "TPM";
  }

  // Requests Per Minute (RPM)
  if (
    combined.includes("requests per minute") ||
    combined.includes("per minute") ||
    combined.includes("rpm")
  ) {
    return "RPM";
  }

  // --- Daily-counter heuristic (secondary, only when a 429 is present) ---
  // If the error body is empty AND daily call count is at/above the hint threshold,
  // treat this as likely RPD rather than silently assuming RPM.
  const is429 =
    err.status === 429 ||
    combined.includes("429") ||
    combined.includes("rate limit") ||
    combined.includes("resource_exhausted") ||
    combined.includes("too many requests");

  if (is429 && model && GEMINI_DAILY_LIMIT_HINT !== null) {
    const todayCount = getDailyCallCount(model);
    if (todayCount >= GEMINI_DAILY_LIMIT_HINT) {
      console.warn(
        `[Gemini API] 📊 Daily counter heuristic: ${todayCount} calls made to "${model}" today (threshold: ${GEMINI_DAILY_LIMIT_HINT}). ` +
        `Treating this 429 as likely RPD (daily quota exhaustion).`
      );
      return "RPD";
    }
  }

  // Generic 429 — could be RPM or something else. If the body is empty, log
  // explicitly that we are guessing rather than silently defaulting.
  if (is429) {
    if (hasEmptyBody) {
      console.warn(
        `[Gemini API] ⚠️ 429 received with empty error body on model "${model || "unknown"}". ` +
        `Quota type: unknown (empty error body) — treating as RPM (transient). ` +
        `Set GEMINI_DAILY_LIMIT_HINT to improve RPD detection.`
      );
    }
    return "RPM";
  }

  return null;
}

// Extract Retry-After header in milliseconds if present
function getRetryAfterMs(err) {
  if (!err || !err.headers) return 0;
  let rawHeader = null;
  if (typeof err.headers.get === "function") {
    rawHeader = err.headers.get("retry-after") || err.headers.get("retry-after-ms");
  } else if (typeof err.headers === "object") {
    rawHeader =
      err.headers["retry-after"] ||
      err.headers["retry-after-ms"] ||
      err.headers["Retry-After"] ||
      err.headers["RETRY-AFTER"];
  }
  if (!rawHeader) return 0;

  const parsed = parseFloat(rawHeader);
  if (isNaN(parsed) || parsed <= 0) return 0;

  if (err.headers["retry-after-ms"] || parsed > 1000) {
    return Math.round(parsed);
  }
  return Math.round(parsed * 1000);
}

// ------------------- Circuit Breaker -------------------
// Tracks consecutive quota failures per model. State is in-memory only; a server
// restart resets all breakers, which is acceptable for a single-process booth deployment.
const _circuitBreakerState = {};
// { [model]: { consecutiveQuotaFailures: N, lastFailureTs: timestamp } }

function _getBreakerState(model) {
  if (!_circuitBreakerState[model]) {
    _circuitBreakerState[model] = { consecutiveQuotaFailures: 0, lastFailureTs: 0 };
  }
  return _circuitBreakerState[model];
}

// Record a quota failure for a model and return the new consecutive count.
function recordQuotaFailure(model) {
  const s = _getBreakerState(model);
  s.consecutiveQuotaFailures += 1;
  s.lastFailureTs = Date.now();
  console.warn(
    `[Circuit Breaker] ⚡ Quota failure recorded for "${model}". ` +
    `Consecutive: ${s.consecutiveQuotaFailures}/${CIRCUIT_BREAKER_THRESHOLD}. ` +
    `Breaker ${s.consecutiveQuotaFailures >= CIRCUIT_BREAKER_THRESHOLD ? "TRIPPED" : "armed"}.`
  );
  return s.consecutiveQuotaFailures;
}

// Reset the breaker on any successful call.
function recordSuccess(model) {
  const s = _getBreakerState(model);
  if (s.consecutiveQuotaFailures > 0) {
    console.log(`[Circuit Breaker] ✅ "${model}" succeeded — resetting breaker (was ${s.consecutiveQuotaFailures} failures).`);
    s.consecutiveQuotaFailures = 0;
  }
}

// Returns true if the circuit breaker is open (model should be skipped).
function isBreakerOpen(model) {
  const s = _getBreakerState(model);
  if (s.consecutiveQuotaFailures < CIRCUIT_BREAKER_THRESHOLD) return false;
  const ageMs = Date.now() - s.lastFailureTs;
  if (ageMs > CIRCUIT_BREAKER_COOLDOWN_MS) {
    // Cooldown expired — half-open: allow one probe attempt by resetting the count.
    console.log(
      `[Circuit Breaker] 🔄 "${model}" cooldown expired after ${Math.round(ageMs / 1000)}s. ` +
      `Resetting to allow probe attempt.`
    );
    s.consecutiveQuotaFailures = 0;
    return false;
  }
  return true;
}

// Helper to call OpenAI API wrapper with automated retries, jitter, and Retry-After support.
// Each raw HTTP attempt charges one slot against the per-request budget via the onAttempt
// callback injected by budgetedExecute.  This ensures the budget reflects actual API calls,
// not high-level executeAnalysisWithFallback invocations.
async function callOpenAIWithRetry(params, retries = MAX_RETRIES, initialDelay = INITIAL_RETRY_DELAY_MS, onAttempt = null) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Charge the per-request call budget before every raw HTTP attempt (Fix #3).
    // onAttempt throws if the budget is exhausted, aborting the retry loop early.
    if (onAttempt) onAttempt();

    // Increment the daily call counter before every attempt so it reflects real usage
    // even when retries are exhausted or the call is never completed.
    const dailyCount = incrementDailyCallCount(params.model);
    console.log(
      `[Gemini API] 📊 Daily call count for "${params.model}": ${dailyCount}` +
      (GEMINI_DAILY_LIMIT_HINT !== null ? ` / ${GEMINI_DAILY_LIMIT_HINT} hint` : "")
    );

    let timeoutHandle = null;
    const abortController = new AbortController();

    try {
      const startTime = Date.now();

      // Race the API call against a timeout so hung connections don't block the queue.
      const apiCallPromise = openai.chat.completions.create(
        params,
        { signal: abortController.signal }
      );

      let response;
      if (GEMINI_REQUEST_TIMEOUT_MS > 0) {
        const timeoutPromise = new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            abortController.abort();
            const timeoutErr = new Error(
              `Gemini API call timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms (model: ${params.model})`
            );
            timeoutErr.isCallTimeout = true;
            timeoutErr.status = 503; // treat as transient overload
            reject(timeoutErr);
          }, GEMINI_REQUEST_TIMEOUT_MS);
        });
        response = await Promise.race([apiCallPromise, timeoutPromise]);
      } else {
        response = await apiCallPromise;
      }

      if (timeoutHandle) clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;
      console.log(`[Gemini API] ✅ Success using model "${params.model}" (${duration}ms).`);
      recordSuccess(params.model);
      return response;
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);

      if (err.isCallTimeout) {
        console.warn(
          `[Gemini API] ⏱️ Call timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms on model "${params.model}" (Attempt ${attempt}/${retries}). Treating as transient.`
        );
        // Fall through: isTransient will be true (status 503), eligible for retry.
      }

      const quotaType = detectQuotaType(err, params.model);
      if (quotaType) {
        err.quotaType = quotaType;
      }

      // Record quota failures for the circuit breaker before deciding to retry or bail.
      if (quotaType === "RPD" || quotaType === "RPM" || quotaType === "TPM") {
        recordQuotaFailure(params.model);
      }

      // If RPD (Requests Per Day) quota is hit, fail fast immediately — retrying same model won't help today!
      if (quotaType === "RPD") {
        console.error(
          `[Gemini API] ❌ Hard Quota Exhausted: RPD (Requests Per Day) limit hit on model "${params.model}". Skipping retries for this model.`
        );
        throw err;
      }

      const isTransient =
        err.isCallTimeout ||
        quotaType === "RPM" ||
        quotaType === "TPM" ||
        err.status === 429 ||
        err.status === 502 ||
        err.status === 503 ||
        err.status === 504 ||
        (err.message && /429|502|503|504/.test(err.message));

      if (isTransient && attempt < retries) {
        const retryAfterMs = getRetryAfterMs(err);
        let delayMs;
        let delaySource;

        if (retryAfterMs > 0) {
          const jitter = Math.floor(Math.random() * 400) + 100;
          delayMs = retryAfterMs + jitter;
          delaySource = `Retry-After header (${Math.round(retryAfterMs / 1000)}s + ${jitter}ms jitter)`;
        } else {
          // Equal jitter backoff:
          // base = initialDelay * 2^(attempt - 1)
          // delay = (base / 2) + random(0, base / 2)
          const baseDelay = initialDelay * Math.pow(2, attempt - 1);
          delayMs = Math.floor(baseDelay / 2 + Math.random() * (baseDelay / 2));
          delaySource = `Exponential backoff with jitter`;
        }

        const reason = quotaType ? `Quota [${quotaType}]` : `Status [${err.status || "transient"}]`;
        console.warn(
          `[Gemini API] ⚠️ ${reason} on model "${params.model}". Retrying in ${delayMs}ms via ${delaySource} (Attempt ${attempt}/${retries})...`
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        const finalReason = quotaType ? `Quota [${quotaType}]` : `Status [${err.status || "error"}]`;
        console.error(
          `[Gemini API] ❌ Request failed on model "${params.model}" after attempt ${attempt}/${retries}: ${finalReason} - ${err.message}`
        );
        throw err;
      }
    }
  }
}

// Executes analysis request with primary model, falling back to secondary model if
// quota-exhausted or circuit-broken.  Accepts an optional onAttempt callback that is
// forwarded into callOpenAIWithRetry to charge the per-request budget per raw HTTP call.
async function executeAnalysisWithFallback(requestParams, onAttempt = null) {
  const primaryModel = requestParams.model;

  // --- Circuit Breaker: skip primary if it is currently tripped ---
  if (isBreakerOpen(primaryModel)) {
    if (FALLBACK_MODEL && FALLBACK_MODEL !== primaryModel) {
      console.warn(
        `[Circuit Breaker] 🔴 "${primaryModel}" is tripped (${CIRCUIT_BREAKER_THRESHOLD} consecutive quota failures ` +
        `within ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s). Skipping primary — going straight to fallback "${FALLBACK_MODEL}".`
      );
      const fallbackParams = { ...requestParams, model: FALLBACK_MODEL };
      // Let any error propagate — the budget and error-tracking machinery above handles it.
      const fallbackResponse = await callOpenAIWithRetry(fallbackParams, MAX_RETRIES, INITIAL_RETRY_DELAY_MS, onAttempt);
      console.log(`[Gemini API] 🎉 Fallback model "${FALLBACK_MODEL}" succeeded (via circuit-breaker skip).`);
      return fallbackResponse;
    }
    // No fallback configured — log the skip but proceed anyway so the request has a chance.
    console.warn(
      `[Circuit Breaker] ⚠️ "${primaryModel}" is tripped but no FALLBACK_MODEL is configured. ` +
      `Attempting primary anyway.`
    );
  }

  // --- Normal path: try primary, then fall back on quota/overload errors ---
  try {
    return await callOpenAIWithRetry(requestParams, MAX_RETRIES, INITIAL_RETRY_DELAY_MS, onAttempt);
  } catch (primaryErr) {
    const isQuotaOrOverload =
      primaryErr.quotaType === "RPD" ||
      primaryErr.quotaType === "RPM" ||
      primaryErr.quotaType === "TPM" ||
      primaryErr.status === 429 ||
      primaryErr.status === 503 ||
      primaryErr.status === 502 ||
      primaryErr.status === 504;

    if (FALLBACK_MODEL && FALLBACK_MODEL !== primaryModel && isQuotaOrOverload) {
      console.warn(
        `[Gemini API] 🔄 Primary model "${primaryModel}" quota/capacity exhausted ` +
        `(${primaryErr.quotaType || primaryErr.status || "error"}). Attempting fallback "${FALLBACK_MODEL}"...`
      );
      try {
        const fallbackParams = { ...requestParams, model: FALLBACK_MODEL };
        const fallbackResponse = await callOpenAIWithRetry(fallbackParams, MAX_RETRIES, INITIAL_RETRY_DELAY_MS, onAttempt);
        console.log(`[Gemini API] 🎉 Fallback model "${FALLBACK_MODEL}" succeeded!`);
        return fallbackResponse;
      } catch (fallbackErr) {
        console.error(
          `[Gemini API] ❌ Fallback model "${FALLBACK_MODEL}" also failed: ` +
          `${fallbackErr.quotaType || fallbackErr.status || fallbackErr.message}`
        );
        // Prefer surfacing RPD on primary over a fallback error — RPD is more actionable.
        if (primaryErr.quotaType === "RPD") throw primaryErr;
        throw fallbackErr;
      }
    }

    throw primaryErr;
  }
}

// Helper to safely parse or repair model JSON outputs
function safeParseJSON(rawInput) {
  if (!rawInput || typeof rawInput !== "string") {
    throw new Error("Empty or non-string input");
  }

  let cleaned = rawInput
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  // 1. Direct parse attempt
  try {
    return JSON.parse(cleaned);
  } catch (_) { }

  // 2. Extract JSON object substring between first '{' and matching '}'
  // Handle extra trailing closing braces (e.g. `{\n...\n}\n}`) or extra trailing text
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace !== -1) {
    const braceIndices = [];
    for (let i = cleaned.length - 1; i >= firstBrace; i--) {
      if (cleaned[i] === "}") {
        braceIndices.push(i);
      }
    }

    for (const endIdx of braceIndices) {
      const candidate = cleaned.slice(firstBrace, endIdx + 1);
      try {
        return JSON.parse(candidate);
      } catch (_) { }

      // Try with trailing comma cleanup
      const sanitized = candidate.replace(/,\s*([\}\]])/g, "$1");
      try {
        return JSON.parse(sanitized);
      } catch (_) { }
    }
  }

  // 3. Fallback: Auto-repair unclosed strings & brackets for truncated outputs
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
    } catch (_) { }
  }

  throw new Error("Unable to parse model JSON");
}

// Normalise common field-name aliases that Gemini sometimes produces instead of the
// canonical schema fields.  Runs *before* isReportValid so a recoverable mismatch
// doesn't waste a full retry round-trip.
// Mutates the object in place and returns it for convenience.
function normalizeReport(report) {
  if (!report || typeof report !== "object") return report;

  // ── care_tips aliases ────────────────────────────────────────────────────────
  if (!Array.isArray(report.care_tips)) {
    const alt = report.tips ?? report.skincare_tips ?? report.recommendations ??
      report.advice ?? report.skin_tips ?? report.skinTips ??
      report.careTips ?? report.care_recommendations;
    if (Array.isArray(alt)) {
      report.care_tips = alt;
    }
  }

  // ── summary aliases ──────────────────────────────────────────────────────────
  if (!report.summary || typeof report.summary !== "string") {
    const alt = report.description ?? report.overview ?? report.analysis ??
      report.result ?? report.skin_summary;
    if (typeof alt === "string" && alt.trim().length >= 15) {
      report.summary = alt;
    }
  }

  // ── observations: plain-string array → {label, detail} object array ─────────
  if (Array.isArray(report.observations) && report.observations.length > 0) {
    const firstItem = report.observations[0];
    if (typeof firstItem === "string") {
      report.observations = report.observations.map((str, i) => ({
        label: `Observation ${i + 1}`,
        detail: str,
      }));
    }
  }

  // ── observations aliases ─────────────────────────────────────────────────────
  if (!Array.isArray(report.observations) || report.observations.length === 0) {
    const alt = report.findings ?? report.skin_observations ?? report.details ??
      report.skinObservations ?? report.characteristics;
    if (Array.isArray(alt) && alt.length > 0) {
      report.observations = alt.map((item, i) => {
        if (typeof item === "string") return { label: `Observation ${i + 1}`, detail: item };
        if (item && typeof item === "object") return item;
        return { label: `Observation ${i + 1}`, detail: String(item) };
      });
    }
  }

  return report;
}

function isReportValid(report) {
  if (!report || typeof report !== "object") return false;
  if (!report.skin_type || typeof report.skin_type !== "string") return false;
  if (!report.summary || typeof report.summary !== "string" || report.summary.trim().length < 15) return false;
  if (!Array.isArray(report.care_tips) || report.care_tips.length === 0) return false;
  if (!Array.isArray(report.observations) || report.observations.length === 0) return false;
  return true;
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

    // Fix #1: Use json_schema strict mode so the model is forced to emit exactly the
    // fields isReportValid requires — eliminating the "tips"/"summary" alias problem.
    //
    // Compatibility note (verified 2026-07): Gemini's OpenAI-compat endpoint
    // (generativelanguage.googleapis.com/v1beta/openai/) accepts response_format with
    // type="json_schema" for gemini-3.5-flash and gemini-3.1-flash-lite in real-time
    // (non-batch) mode.  If either model rejects the schema with a 400, the error will
    // be caught by callOpenAIWithRetry and rethrown as a non-transient error (no retry),
    // and /api/analyze will respond with HTTP 500 + a server-log entry indicating the
    // cause.  In that case, revert response_format to { type: "json_object" } for that
    // model and rely on normalizeReport() + isReportValid() as the validation layer.
    const SKIN_REPORT_SCHEMA = {
      type: "object",
      properties: {
        skin_type: {
          type: "string",
          enum: ["oily", "dry", "combination", "normal", "sensitive", "unclear"],
        },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        summary: { type: "string" },
        observations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              detail: { type: "string" },
            },
            required: ["label", "detail"],
            additionalProperties: false,
          },
        },
        care_tips: { type: "array", items: { type: "string" } },
        caveats: { type: "string" },
      },
      required: ["skin_type", "confidence", "summary", "observations", "care_tips", "caveats"],
      additionalProperties: false,
    };

    const requestParams = {
      model: MODEL,
      temperature: 0.2,
      max_tokens: 2048,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "skin_report",
          strict: true,
          schema: SKIN_REPORT_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this face photo and return the complete JSON skin report described in your instructions.",
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    };

    // Execute within the in-process request queue to limit concurrency and protect RPM budget.
    //
    // Fix #2: every executeAnalysisWithFallback call site shares a single per-request budget
    // (GEMINI_MAX_CALLS_PER_REQUEST) via `budgetedExecute`. Once the budget is exhausted the
    // most specific error seen so far is thrown rather than a generic INCOMPLETE_REPORT.
    const { report } = await geminiQueue.run(async () => {
      // Tracks the total number of Gemini calls (across all retry paths) for this request.
      let requestCallsUsed = 0;
      // Tracks the most specific error seen during this request so we can surface it
      // instead of a generic INCOMPLETE_REPORT if things go wrong (Fix #3).
      let mostSpecificErr = null;

      function isQuotaOrOverloadErr(e) {
        return (
          e &&
          (e.quotaType === "RPD" ||
            e.quotaType === "RPM" ||
            e.quotaType === "TPM" ||
            e.status === 429 ||
            e.status === 502 ||
            e.status === 503 ||
            e.status === 504 ||
            e.isCallTimeout)
        );
      }

      // Wrapped executeAnalysisWithFallback that enforces the per-request call budget.
      // Fix #3: budget is charged once per raw HTTP attempt inside callOpenAIWithRetry
      // via the onAttempt callback, not once per high-level budgetedExecute call.  This
      // means each retry within callOpenAIWithRetry consumes its own budget slot, so a
      // 3-retry primary round costs 3 slots, not 1.
      function onAttempt() {
        if (requestCallsUsed >= GEMINI_MAX_CALLS_PER_REQUEST) {
          const budgetErr = new Error("BUDGET_EXHAUSTED");
          budgetErr.isBudgetExhausted = true;
          console.warn(
            `[Gemini API] 🛑 Per-request call budget exhausted (${requestCallsUsed}/${GEMINI_MAX_CALLS_PER_REQUEST} raw HTTP attempts). ` +
            `Aborting further Gemini calls for this request.`
          );
          throw budgetErr;
        }
        requestCallsUsed += 1;
        console.log(
          `[Gemini API] 📋 Request call budget: ${requestCallsUsed}/${GEMINI_MAX_CALLS_PER_REQUEST} raw HTTP attempts used.`
        );
      }

      async function budgetedExecute(params) {
        // onAttempt is passed into callOpenAIWithRetry (and forwarded by
        // executeAnalysisWithFallback) so budget is charged per raw HTTP call.
        try {
          const result = await executeAnalysisWithFallback(params, onAttempt);
          return result;
        } catch (e) {
          // Record the most specific error seen across all attempts.
          if (isQuotaOrOverloadErr(e) && !isQuotaOrOverloadErr(mostSpecificErr)) {
            mostSpecificErr = e;
          } else if (!mostSpecificErr) {
            mostSpecificErr = e;
          }
          throw e;
        }
      }

      let response = await budgetedExecute(requestParams);
      let choice = response.choices?.[0];
      let finishReason = choice?.finish_reason;
      let raw = choice?.message?.content || "";
      let parsedReport = null;

      if (finishReason === "length" || finishReason === "max_tokens") {
        console.warn(
          `[Gemini API] Output truncated by max_tokens (finish_reason: ${finishReason}). Retrying with max_tokens: 2048...`
        );
        try {
          response = await budgetedExecute({
            ...requestParams,
            max_tokens: 2048,
            temperature: 0.1,
          });
          choice = response.choices?.[0];
          finishReason = choice?.finish_reason;
          raw = choice?.message?.content || "";
        } catch (truncRetryErr) {
          if (truncRetryErr.isBudgetExhausted) throw truncRetryErr;
          // Non-budget error on truncation retry: log and fall through to parse what we have.
          console.warn("[Gemini API] Truncation retry failed:", truncRetryErr.message);
        }
      }

      try {
        parsedReport = normalizeReport(safeParseJSON(raw));
      } catch (parseErr) {
        console.error("[Gemini API] JSON parse error on raw output:\n", raw);
      }

      if (!isReportValid(parsedReport)) {
        console.warn("[Gemini API] Report was invalid or incomplete. Retrying vision request...");
        try {
          response = await budgetedExecute({
            ...requestParams,
            max_tokens: 2048,
            temperature: 0.1,
          });
          raw = response.choices?.[0]?.message?.content || "";
          parsedReport = normalizeReport(safeParseJSON(raw));
        } catch (retryErr) {
          // Fix #3: don't swallow quota/overload errors — record and re-classify.
          if (retryErr.isBudgetExhausted) throw retryErr;
          if (isQuotaOrOverloadErr(retryErr)) {
            mostSpecificErr = retryErr;
          }
          console.warn(
            "[Gemini API] Invalid-report retry failed:",
            retryErr.quotaType || retryErr.status || retryErr.message
          );
        }
      }

      if (!isReportValid(parsedReport)) {
        console.error("[Gemini API] Unable to produce complete report. Raw content:\n", raw);
        // Fix #3: if a quota/overload error occurred during any attempt, throw it so
        // the outer handler sends the accurate error message rather than INCOMPLETE_REPORT.
        if (mostSpecificErr && isQuotaOrOverloadErr(mostSpecificErr)) {
          throw mostSpecificErr;
        }
        throw new Error("INCOMPLETE_REPORT");
      }

      return { report: parsedReport };
    });

    // Push finished valid report to any booth screens, then return to caller.
    broadcastToDisplays({ type: "report", report, image });

    return res.json({ report });
  } catch (err) {
    if (err.message === "INCOMPLETE_REPORT") {
      return res.status(502).json({
        error: "The AI skin report was incomplete or truncated. Please retake your photo and scan again.",
      });
    }

    console.error("[API Analyze Error]", err.message);

    if (err.isQueueTimeout) {
      return res.status(503).json({
        error:
          "The AI scanner is currently busy handling other requests. Please wait a few seconds and try scanning again.",
      });
    }

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

    if (err.status === 404 || (err.message && err.message.includes("404"))) {
      return res.status(404).json({
        error: `The requested AI model "${MODEL}" was not found. Please check SKIN_ANALYSIS_MODEL in .env.`,
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
  console.log(`   Health Check   : http://localhost:${PORT}/api/health`);
  console.log(`   API Endpoint   : http://localhost:${PORT}/api/analyze`);
  console.log(`   WebSocket      : ws://localhost:${PORT}/ws/display`);
  console.log(`   Primary Model  : ${MODEL}`);
  console.log(`   Fallback Model : ${FALLBACK_MODEL || "None (Set FALLBACK_MODEL in .env to enable)"}`);
  console.log(`   Max Concurrency: ${MAX_CONCURRENT_CALLS} (Queue timeout: ${QUEUE_TIMEOUT_MS}ms)\n`);
});
