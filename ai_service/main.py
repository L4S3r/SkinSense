import os
import json
import time
import logging
import requests
from typing import List, Optional
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ai_service")

# Load environment variables from backend/.env or root .env
env_paths = [
    Path(__file__).parent.parent / "backend" / ".env",
    Path(__file__).parent.parent / ".env",
    Path(__file__).parent / ".env"
]
for p in env_paths:
    if p.exists():
        load_dotenv(p)
        logger.info(f"Loaded env file from: {p}")
        break

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
PRIMARY_MODEL = os.getenv("SKIN_ANALYSIS_MODEL", "gemini-3.6-flash")
FALLBACK_MODEL = os.getenv("FALLBACK_MODEL", "gemini-3.5-flash-lite")
OPENAI_COMPAT_URL = "https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions"

SYSTEM_PROMPT = """You are an expert cosmetic skincare analyst. Your task is to analyze a single user-provided face photo and generate a concise, friendly, and purely cosmetic skin-type report.

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
1. STRICT NON-MEDICAL RULE: You are NOT a medical device. Never diagnose skin diseases, acne vulgaris, rosacea, eczema, or clinical conditions. Refer only to cosmetic characteristics (e.g., "visible redness" instead of "rosacea", "visible congestion" instead of "severe acne").
2. PRIVACY & SAFETY: Never comment on age, race, ethnicity, gender, identity, or physical attractiveness. Do not attempt identity recognition.

### OUTPUT FORMAT
Respond ONLY with a valid, raw JSON object. Do not include markdown code fences, prefix commentary, or postfix explanations."""

SKIN_REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "skin_type": {
            "type": "string",
            "enum": ["oily", "dry", "combination", "normal", "sensitive", "unclear"],
        },
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "summary": {"type": "string"},
        "concerns": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": [
                    "acne",
                    "hyperpigmentation",
                    "aging",
                    "dehydration",
                    "redness",
                    "dullness",
                    "sun_damage",
                    "enlarged_pores",
                    "post_hair_removal",
                ],
            },
        },
        "observations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "detail": {"type": "string"},
                },
                "required": ["label", "detail"],
                "additionalProperties": False,
            },
        },
        "care_tips": {"type": "array", "items": {"type": "string"}},
        "caveats": {"type": "string"},
    },
    "required": [
        "skin_type",
        "confidence",
        "summary",
        "concerns",
        "observations",
        "care_tips",
        "caveats",
    ],
    "additionalProperties": False,
}

# --- Pydantic Data Models ---
class ObservationItem(BaseModel):
    label: str
    detail: str

class SkinReport(BaseModel):
    skin_type: str
    confidence: str
    summary: str
    concerns: List[str] = Field(default_factory=list)
    observations: List[ObservationItem]
    care_tips: List[str]
    caveats: str

class AnalyzeRequest(BaseModel):
    image: str

class AnalyzeResponse(BaseModel):
    report: SkinReport

# --- FastAPI App Initialization ---
app = FastAPI(title="Meloniq AI Vision Service", version="1.0.0")

def parse_and_validate_json(raw_text: str) -> Optional[dict]:
    """Clean markdown backticks if any and parse JSON."""
    clean = raw_text.strip()
    if clean.startswith("```"):
        lines = clean.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        clean = "\n".join(lines).strip()
    try:
        return json.loads(clean)
    except Exception as e:
        logger.error(f"Failed to parse JSON raw content: {e}")
        return None

def call_gemini_api(image_base64: str, model_name: str) -> dict:
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is missing on AI microservice.")

    headers = {
        "Authorization": f"Bearer {GEMINI_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model_name,
        "temperature": 0.2,
        "max_tokens": 2048,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "skin_report",
                "strict": True,
                "schema": SKIN_REPORT_SCHEMA,
            },
        },
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Analyze this face photo and return the complete JSON skin report described in your instructions.",
                    },
                    {"type": "image_url", "image_url": {"url": image_base64}},
                ],
            },
        ],
    }

    resp = requests.post(OPENAI_COMPAT_URL, headers=headers, json=payload, timeout=25)
    if resp.status_code != 200:
        logger.warning(f"Gemini call to {model_name} failed with HTTP {resp.status_code}: {resp.text}")
        raise Exception(f"Gemini API Error {resp.status_code}: {resp.text}")

    data = resp.json()
    choices = data.get("choices", [])
    if not choices:
        raise Exception("Empty choices array returned by Gemini API")

    raw_content = choices[0].get("message", {}).get("content", "")
    parsed = parse_and_validate_json(raw_content)
    if not parsed:
        raise Exception("Failed to parse response JSON from Gemini API")

    return parsed

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "meloniq-ai-vision-service",
        "primary_model": PRIMARY_MODEL,
        "fallback_model": FALLBACK_MODEL,
    }

@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_skin(req: AnalyzeRequest):
    if not req.image or not req.image.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Invalid or missing base64 image data.")

    # Primary attempt
    report_data = None
    try:
        logger.info(f"Analyzing photo using primary model: {PRIMARY_MODEL}")
        report_data = call_gemini_api(req.image, PRIMARY_MODEL)
    except Exception as err:
        logger.warning(f"Primary model ({PRIMARY_MODEL}) call failed: {err}")
        if PRIMARY_MODEL != FALLBACK_MODEL:
            try:
                logger.info(f"Attempting fallback model: {FALLBACK_MODEL}")
                report_data = call_gemini_api(req.image, FALLBACK_MODEL)
            except Exception as fb_err:
                logger.error(f"Fallback model ({FALLBACK_MODEL}) also failed: {fb_err}")
                raise HTTPException(status_code=502, detail="AI Vision analysis service encountered API quota or model errors.")
        else:
            raise HTTPException(status_code=502, detail=str(err))

    try:
        report_obj = SkinReport(**report_data)
        return AnalyzeResponse(report=report_obj)
    except Exception as val_err:
        logger.error(f"Pydantic schema validation error: {val_err}")
        raise HTTPException(status_code=500, detail="Generated report failed schema validation.")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_SERVICE_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
