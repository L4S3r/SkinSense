import { recommendSoaps } from "./soapRecommendation.js";

console.log("=================================================");
console.log("  MELONIQ SOAP RECOMMENDATION INTEGRATION VERIFICATION");
console.log("=================================================\n");

// Profile 1: Oily + Acne
const profile1 = {
  skinType: "oily",
  concerns: ["acne", "enlarged_pores"],
  sunExposureRisk: false
};
const recs1 = recommendSoaps(profile1, 2);
console.log("📋 Profile 1 (Oily + Acne):");
recs1.forEach((r, i) => {
  console.log(`  #${i + 1}: ${r.soap.nameEn} (${r.soap.nameAr}) [Score: ${r.score}]`);
  console.log(`      Reasoning: "${r.reasoning}"`);
});

// Profile 2: Sensitive + Redness + Sun Exposure Risk
const profile2 = {
  skinType: "sensitive",
  concerns: ["redness"],
  sunExposureRisk: true
};
const recs2 = recommendSoaps(profile2, 3);
console.log("\n📋 Profile 2 (Sensitive + Redness + SunExposureRisk=true):");
recs2.forEach((r, i) => {
  console.log(`  #${i + 1}: ${r.soap.nameEn} (${r.soap.nameAr}) [Score: ${r.score}]`);
  console.log(`      Reasoning: "${r.reasoning}"`);
});

// Profile 3: Dry + Aging
const profile3 = {
  skinType: "dry",
  concerns: ["aging", "dehydration"],
  sunExposureRisk: false
};
const recs3 = recommendSoaps(profile3, 2);
console.log("\n📋 Profile 3 (Dry + Aging):");
recs3.forEach((r, i) => {
  console.log(`  #${i + 1}: ${r.soap.nameEn} (${r.soap.nameAr}) [Score: ${r.score}]`);
  console.log(`      Reasoning: "${r.reasoning}"`);
});

console.log("\n✅ Manual Verification Completed Successfully!");
