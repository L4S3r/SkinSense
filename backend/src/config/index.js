import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env file from backend directory
dotenv.config({ path: path.join(__dirname, "../../.env") });

export const apiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim();
if (!apiKey) {
  console.warn(
    "\n⚠️  No Gemini API key found.\n" +
    "   Copy .env.example to .env and set GEMINI_API_KEY to your key\n" +
    "   (from https://aistudio.google.com/apikey), then restart.\n"
  );
}

export const MODEL = process.env.SKIN_ANALYSIS_MODEL || "gemini-3.6-flash";
export const FALLBACK_MODEL = process.env.FALLBACK_MODEL && process.env.FALLBACK_MODEL.trim();

export const MAX_CONCURRENT_CALLS = parseInt(process.env.MAX_CONCURRENT_GEMINI_CALLS || "1", 10);
export const QUEUE_TIMEOUT_MS = parseInt(process.env.GEMINI_QUEUE_TIMEOUT_MS || "30000", 10);

export const MAX_RETRIES = parseInt(process.env.GEMINI_MAX_RETRIES || "3", 10);
export const INITIAL_RETRY_DELAY_MS = parseInt(process.env.GEMINI_INITIAL_RETRY_DELAY_MS || "1500", 10);

export const GEMINI_REQUEST_TIMEOUT_MS = parseInt(process.env.GEMINI_REQUEST_TIMEOUT_MS || "20000", 10);
export const GEMINI_MAX_CALLS_PER_REQUEST = parseInt(process.env.GEMINI_MAX_CALLS_PER_REQUEST || "8", 10);

export const GEMINI_DAILY_LIMIT_HINT = process.env.GEMINI_DAILY_LIMIT_HINT
  ? parseInt(process.env.GEMINI_DAILY_LIMIT_HINT, 10)
  : null;

export const CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || "2", 10);
export const CIRCUIT_BREAKER_COOLDOWN_MS = parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS || "60000", 10);

export const PORT = process.env.PORT || 3000;
export const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8000/analyze";
