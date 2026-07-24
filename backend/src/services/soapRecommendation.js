import { SOAP_CATALOG } from "../data/soapCatalog.js";

const CONCERN_MATCH_POINTS = 3;
const SKIN_TYPE_MATCH_POINTS = 1;
const PHOTOSENSITIVE_PENALTY = 2;

/**
 * Build human-readable reasoning for soap recommendation
 * @param {import('../types/soap.js').Soap} soap
 * @param {import('../types/soap.js').SkinConcern[]} matchedConcerns
 * @returns {string}
 */
function buildReasoning(soap, matchedConcerns) {
  if (!matchedConcerns || matchedConcerns.length === 0) {
    return "A gentle everyday match for your skin type.";
  }
  const concernLabels = matchedConcerns.join(", ").replace(/_/g, " ");
  const active = soap.keyActives[0] || "natural botanicals";
  return `Targets your ${concernLabels} with ${active}.`;
}

/**
 * Recommend soaps for a given skin profile
 * @param {import('../types/soap.js').SkinProfile} profile
 * @param {number} [topN=2]
 * @returns {import('../types/soap.js').SoapRecommendation[]}
 */
export function recommendSoaps(profile, topN = 2) {
  const safeProfile = {
    skinType: profile?.skinType || "normal",
    concerns: Array.isArray(profile?.concerns) ? profile.concerns : [],
    sunExposureRisk: Boolean(profile?.sunExposureRisk)
  };

  const scored = SOAP_CATALOG.map((soap) => {
    const matchedConcerns = soap.targetsConcerns.filter((c) =>
      safeProfile.concerns.includes(c)
    );
    let score = matchedConcerns.length * CONCERN_MATCH_POINTS;

    if (soap.bestForSkinTypes.includes(safeProfile.skinType)) {
      score += SKIN_TYPE_MATCH_POINTS;
    }

    if (safeProfile.sunExposureRisk && soap.isPhotosensitizing) {
      score -= PHOTOSENSITIVE_PENALTY;
    }

    return {
      soap,
      score,
      matchedConcerns,
      reasoning: buildReasoning(soap, matchedConcerns),
    };
  });

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // tie-break: fewer caution flags wins
      return a.soap.cautions.length - b.soap.cautions.length;
    })
    .slice(0, topN);
}

/**
 * Extract SkinProfile from Gemini vision report object
 * @param {Object} report
 * @returns {import('../types/soap.js').SkinProfile}
 */
export function extractSkinProfile(report) {
  if (!report || typeof report !== "object") {
    return { skinType: "normal", concerns: [], sunExposureRisk: false };
  }

  const rawSkinType = (report.skin_type || "normal").toLowerCase();
  const validSkinTypes = ["oily", "dry", "combination", "normal", "sensitive"];
  const skinType = validSkinTypes.includes(rawSkinType) ? rawSkinType : "normal";

  const validConcernsSet = new Set([
    "acne",
    "hyperpigmentation",
    "aging",
    "dehydration",
    "redness",
    "dullness",
    "sun_damage",
    "enlarged_pores",
    "post_hair_removal",
  ]);

  let concerns = [];

  // 1. If explicit structured concerns array is provided in report, filter valid items
  if (Array.isArray(report.concerns) && report.concerns.length > 0) {
    concerns = report.concerns.filter((c) => typeof c === "string" && validConcernsSet.has(c));
  }

  // 2. If no valid concerns were extracted from explicit array, fallback to scanning narrative details
  if (concerns.length === 0) {
    // Note: scan details only, excluding section labels like "Pore Visibility" to avoid false positive triggers
    const textParts = [
      report.summary || "",
      ...(Array.isArray(report.observations)
        ? report.observations.map((o) => (typeof o === "string" ? o : `${o.detail || ""}`))
        : []),
      ...(Array.isArray(report.care_tips)
        ? report.care_tips.map((t) => (typeof t === "string" ? t : JSON.stringify(t)))
        : []),
      report.caveats || "",
    ].join(" ").toLowerCase();

    const concernKeywords = {
      acne: ["acne", "breakout", "pimple", "congest", "blackhead", "blemish"],
      hyperpigmentation: ["hyperpigmentation", "pigment", "dark spot", "uneven tone", "discolor", "dark circle", "melasma", "sun spot"],
      aging: ["aging", "wrinkle", "fine line", "firm", "elasticity", "collagen", "sagging"],
      dehydration: ["dehydrat", "tight", "flak", "moisture loss", "dry patch", "parched"],
      redness: ["redness", "flush", "irritat", "blotchy", "inflammation", "erythema", "rosy"],
      dullness: ["dull", "radiance", "lackluster", "glow", "tired", "uneven texture"],
      sun_damage: ["sunburn", "photodamage", "sun damage", "uv damage", "photoaging"],
      enlarged_pores: ["enlarged pore", "prominent pore", "large pore", "visible pore", "clogged pore", "dilated pore", "congested pore", "expanded pore"],
      post_hair_removal: ["hair removal", "waxing", "shaving", "threading", "ingrown"],
    };

    for (const [concern, keywords] of Object.entries(concernKeywords)) {
      if (keywords.some((kw) => textParts.includes(kw))) {
        concerns.push(concern);
      }
    }
  }

  const textToScan = [
    report.summary || "",
    ...(Array.isArray(report.observations)
      ? report.observations.map((o) => (typeof o === "string" ? o : `${o.detail || ""}`))
      : []),
    report.caveats || "",
  ].join(" ").toLowerCase();

  const sunExposureRisk = ["sun exposure", "sunburn", "uv", "outdoor", "sun-exposed"].some(
    (kw) => textToScan.includes(kw)
  );

  return {
    skinType,
    concerns,
    sunExposureRisk,
  };
}
