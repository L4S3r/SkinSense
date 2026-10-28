import assert from "node:assert/strict";
import test from "node:test";

import { isReportValid, normalizeReport } from "./reportFormatter.js";

const baseReport = {
  confidence: "high",
  summary: "The visible skin characteristics appear balanced overall.",
  concerns: [],
  observations: [{ label: "Texture", detail: "Texture appears smooth." }],
  care_tips: ["Use a gentle cleanser."],
  caveats: "This is a cosmetic assessment only.",
};

test("normalizes a supported skin type before validation", () => {
  const report = normalizeReport({ ...baseReport, skin_type: " OILY " });

  assert.equal(report.skin_type, "oily");
  assert.equal(isReportValid(report), true);
});

test("rejects unsupported skin types", () => {
  const report = normalizeReport({ ...baseReport, skin_type: "oily skin" });

  assert.equal(isReportValid(report), false);
});
