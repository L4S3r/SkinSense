import { SKIN_TYPES, UNCLEAR_SKIN_TYPE } from "../types/soap.js";

const VALID_SKIN_TYPES = new Set([
  ...SKIN_TYPES,
  UNCLEAR_SKIN_TYPE,
]);

export function safeParseJSON(rawInput) {
  if (!rawInput || typeof rawInput !== "string") {
    throw new Error("Empty or non-string input");
  }

  let cleaned = rawInput
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) { }

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

      const sanitized = candidate.replace(/,\s*([\}\]])/g, "$1");
      try {
        return JSON.parse(sanitized);
      } catch (_) { }
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
    } catch (_) { }
  }

  throw new Error("Unable to parse model JSON");
}

export function normalizeReport(report) {
  if (!report || typeof report !== "object") return report;

  if (typeof report.skin_type === "string") {
    report.skin_type = report.skin_type.trim().toLowerCase();
  }

  if (!Array.isArray(report.care_tips)) {
    const alt = report.tips ?? report.skincare_tips ?? report.recommendations ??
      report.advice ?? report.skin_tips ?? report.skinTips ??
      report.careTips ?? report.care_recommendations;
    if (Array.isArray(alt)) {
      report.care_tips = alt;
    }
  }

  if (!report.summary || typeof report.summary !== "string") {
    const alt = report.description ?? report.overview ?? report.analysis ??
      report.result ?? report.skin_summary;
    if (typeof alt === "string" && alt.trim().length >= 15) {
      report.summary = alt;
    }
  }

  if (Array.isArray(report.observations) && report.observations.length > 0) {
    const firstItem = report.observations[0];
    if (typeof firstItem === "string") {
      report.observations = report.observations.map((str, i) => ({
        label: `Observation ${i + 1}`,
        detail: str,
      }));
    }
  }

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

export function isReportValid(report) {
  if (!report || typeof report !== "object") return false;
  if (typeof report.skin_type !== "string" || !VALID_SKIN_TYPES.has(report.skin_type)) return false;
  if (!report.summary || typeof report.summary !== "string" || report.summary.trim().length < 15) return false;
  if (!Array.isArray(report.care_tips) || report.care_tips.length === 0) return false;
  if (!Array.isArray(report.observations) || report.observations.length === 0) return false;
  return true;
}
