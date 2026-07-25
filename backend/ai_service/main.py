import os
import re
import json
import logging
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import httpx

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai_service")

app = FastAPI(title="Meloniq AI Vision Service", version="1.0.0")

# Load environment variables
from pathlib import Path
env_paths = [
    Path(__file__).parent / ".env",
    Path(__file__).parent.parent / ".env",
]

for p in env_paths:
    if p.exists():
        from dotenv import load_dotenv
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
Respond ONLY with a valid, raw JSON object. Do not include markdown code fences (e.g., ```json), prefix commentary, or postfix explanations. 

Follow this exact structure:

{
  "skin_type": "oily" | "dry" | "combination" | "normal" | "sensitive" | "unclear",
  "confidence": "low" | "medium" | "high",
  "summary": "2-3 plain-language sentences summarizing the overall visual impression.",
  "concerns": ["zero or more of: acne, hyperpigmentation, aging, dehydration, redness, dullness, sun_damage, enlarged_pores, post_hair_removal — include ONLY those visually evident from the photo"],
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

If "skin_type" is "unclear", keep "observations" to a single general entry and use "caveats" to explain why analysis was not possible and request a clear, well-lit photo facing the camera"""


class AnalyzeRequest(BaseModel):
    image: str = Field(..., description="Base64 data URL of face photo (e.g. data:image/jpeg;base64,...)")


class ObservationItem(BaseModel):
    label: str
    detail: str


class SkinReport(BaseModel):
    skin_type: str
    confidence: str
    summary: str
    concerns: List[str] = []
    observations: List[ObservationItem]
    care_tips: List[str]
    caveats: str


class AnalyzeResponse(BaseModel):
    report: SkinReport


def parse_and_validate_json(raw_text: str) -> dict:
    cleaned = raw_text.strip()
    cleaned = re.sub(r"^```json\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"^```\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"```$", "", cleaned, flags=re.I).strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        first_brace = cleaned.find("{")
        last_brace = cleaned.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            snippet = cleaned[first_brace:last_brace + 1]
            return json.loads(snippet)
        raise ValueError("Model output could not be parsed as valid JSON")


async def call_gemini_api(model_name: str, base64_image: str) -> dict:
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not set on the AI microservice.")

    headers = {
        "Authorization": f"Bearer {GEMINI_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Analyze this face photo for skin type and visual cosmetic characteristics."},
                    {"type": "image_url", "image_url": {"url": base64_image}},
                ],
            },
        ],
        "temperature": 0.2,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(OPENAI_COMPAT_URL, headers=headers, json=payload)
        if response.status_code != 200:
            logger.error(f"Gemini API returned error HTTP {response.status_code}: {response.text}")
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Gemini API error: {response.text}",
            )

        data = response.json()
        try:
            content = data["choices"][0]["message"]["content"]
            return parse_and_validate_json(content)
        except (KeyError, IndexError, ValueError) as e:
            logger.error(f"Failed to parse report from model response: {e}")
            raise HTTPException(
                status_code=502,
                detail=f"Model output format invalid: {str(e)}",
            )


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "Meloniq Python AI Microservice",
        "primary_model": PRIMARY_MODEL,
        "fallback_model": FALLBACK_MODEL,
        "has_api_key": bool(GEMINI_API_KEY),
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    logger.info(f"Received analysis request for model {PRIMARY_MODEL}")
    try:
        parsed_report = await call_gemini_api(PRIMARY_MODEL, request.image)
        return {"report": parsed_report}
    except HTTPException as e:
        if e.status_code == 429 and FALLBACK_MODEL and FALLBACK_MODEL != PRIMARY_MODEL:
            logger.warning(f"Primary model {PRIMARY_MODEL} rate limited. Attempting fallback {FALLBACK_MODEL}...")
            try:
                parsed_report = await call_gemini_api(FALLBACK_MODEL, request.image)
                return {"report": parsed_report}
            except Exception as fallback_err:
                logger.error(f"Fallback model also failed: {fallback_err}")
                raise e
        raise e
