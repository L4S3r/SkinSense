import OpenAI from "openai";
import {
  apiKey,
  FALLBACK_MODEL,
  MAX_CONCURRENT_CALLS,
  QUEUE_TIMEOUT_MS,
  MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS,
  GEMINI_REQUEST_TIMEOUT_MS,
  GEMINI_DAILY_LIMIT_HINT,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_COOLDOWN_MS,
} from "../config/index.js";

// Initialize OpenAI SDK pointed at Google Gemini OpenAI-compatible endpoint
export const openai = new OpenAI({
  apiKey: apiKey || "missing-key",
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

// In-Process Request Queue (Semaphore)
export class GeminiRequestQueue {
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

export const geminiQueue = new GeminiRequestQueue(MAX_CONCURRENT_CALLS, QUEUE_TIMEOUT_MS);

// Daily call counter per model
const _dailyCallCounts = {};

function _getPacificDateStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export function incrementDailyCallCount(model) {
  const today = _getPacificDateStr();
  if (!_dailyCallCounts[model] || _dailyCallCounts[model].date !== today) {
    _dailyCallCounts[model] = { date: today, count: 0 };
  }
  _dailyCallCounts[model].count += 1;
  return _dailyCallCounts[model].count;
}

export function getDailyCallCount(model) {
  const today = _getPacificDateStr();
  if (!_dailyCallCounts[model] || _dailyCallCounts[model].date !== today) return 0;
  return _dailyCallCounts[model].count;
}

export function detectQuotaType(err, model) {
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

  if (
    combined.includes("requests per day") ||
    combined.includes("per day") ||
    combined.includes("rpd") ||
    combined.includes("daily quota") ||
    combined.includes("day limit")
  ) {
    return "RPD";
  }

  if (
    combined.includes("tokens per minute") ||
    combined.includes("per minute tokens") ||
    combined.includes("tpm") ||
    combined.includes("token limit")
  ) {
    return "TPM";
  }

  if (
    combined.includes("requests per minute") ||
    combined.includes("per minute") ||
    combined.includes("rpm")
  ) {
    return "RPM";
  }

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

  if (is429) {
    if (hasEmptyBody) {
      console.warn(
        `[Gemini API] ⚠️ 429 received with empty error body on model "${model || "unknown"}". ` +
        `Quota type: unknown (empty error body) — treating as RPM (transient).`
      );
    }
    return "RPM";
  }

  return null;
}

export function getRetryAfterMs(err) {
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

// Circuit Breaker State
const _circuitBreakerState = {};

function _getBreakerState(model) {
  if (!_circuitBreakerState[model]) {
    _circuitBreakerState[model] = { consecutiveQuotaFailures: 0, lastFailureTs: 0 };
  }
  return _circuitBreakerState[model];
}

export function recordQuotaFailure(model) {
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

export function recordSuccess(model) {
  const s = _getBreakerState(model);
  if (s.consecutiveQuotaFailures > 0) {
    console.log(`[Circuit Breaker] ✅ "${model}" succeeded — resetting breaker (was ${s.consecutiveQuotaFailures} failures).`);
    s.consecutiveQuotaFailures = 0;
  }
}

export function isBreakerOpen(model) {
  const s = _getBreakerState(model);
  if (s.consecutiveQuotaFailures < CIRCUIT_BREAKER_THRESHOLD) return false;
  const ageMs = Date.now() - s.lastFailureTs;
  if (ageMs > CIRCUIT_BREAKER_COOLDOWN_MS) {
    console.log(
      `[Circuit Breaker] 🔄 "${model}" cooldown expired after ${Math.round(ageMs / 1000)}s. Resetting to allow probe attempt.`
    );
    s.consecutiveQuotaFailures = 0;
    return false;
  }
  return true;
}

export async function callOpenAIWithRetry(params, retries = MAX_RETRIES, initialDelay = INITIAL_RETRY_DELAY_MS, onAttempt = null) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (onAttempt) onAttempt();

    const dailyCount = incrementDailyCallCount(params.model);
    console.log(
      `[Gemini API] 📊 Daily call count for "${params.model}": ${dailyCount}` +
      (GEMINI_DAILY_LIMIT_HINT !== null ? ` / ${GEMINI_DAILY_LIMIT_HINT} hint` : "")
    );

    let timeoutHandle = null;
    const abortController = new AbortController();

    try {
      const startTime = Date.now();

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
            timeoutErr.status = 503;
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
      }

      const quotaType = detectQuotaType(err, params.model);
      if (quotaType) {
        err.quotaType = quotaType;
      }

      if (quotaType === "RPD" || quotaType === "RPM" || quotaType === "TPM") {
        recordQuotaFailure(params.model);
      }

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

export async function executeAnalysisWithFallback(requestParams, onAttempt = null) {
  const primaryModel = requestParams.model;

  if (isBreakerOpen(primaryModel)) {
    if (FALLBACK_MODEL && FALLBACK_MODEL !== primaryModel) {
      console.warn(
        `[Circuit Breaker] 🔴 "${primaryModel}" is tripped (${CIRCUIT_BREAKER_THRESHOLD} consecutive quota failures ` +
        `within ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s). Skipping primary — going straight to fallback "${FALLBACK_MODEL}".`
      );
      const fallbackParams = { ...requestParams, model: FALLBACK_MODEL };
      const fallbackResponse = await callOpenAIWithRetry(fallbackParams, MAX_RETRIES, INITIAL_RETRY_DELAY_MS, onAttempt);
      console.log(`[Gemini API] 🎉 Fallback model "${FALLBACK_MODEL}" succeeded (via circuit-breaker skip).`);
      return fallbackResponse;
    }
    console.warn(
      `[Circuit Breaker] ⚠️ "${primaryModel}" is tripped but no FALLBACK_MODEL is configured. Attempting primary anyway.`
    );
  }

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
        if (primaryErr.quotaType === "RPD") throw primaryErr;
        throw fallbackErr;
      }
    }

    throw primaryErr;
  }
}
