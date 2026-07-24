import { recommendSoaps, extractSkinProfile } from "./soapRecommendation.js";

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Test failed: ${message}`);
    process.exit(1);
  }
}

console.log("🧪 Running soap recommendation engine unit tests...\n");

// Test 1: Oily + acne concern -> Tea Tree & Sidr should rank #1
{
  const profile = { skinType: "oily", concerns: ["acne"], sunExposureRisk: false };
  const recs = recommendSoaps(profile, 2);
  assert(recs.length === 2, "Test 1: Should return 2 recommendations");
  assert(recs[0].soap.id === "tea-tree-sidr", `Test 1: Expected tea-tree-sidr at #1, got ${recs[0].soap.id}`);
  console.log("✅ Test 1 Passed: Oily + acne concern correctly ranks Tea Tree & Sidr #1");
}

// Test 2: Sensitive + redness + sunExposureRisk: true -> Tropical Fruit & Oat outranks Aloe Vera & Cucumber
{
  const profile = { skinType: "sensitive", concerns: ["redness"], sunExposureRisk: true };
  const recs = recommendSoaps(profile, 5);
  const tropicalIdx = recs.findIndex((r) => r.soap.id === "tropical-fruit-oat");
  const aloeIdx = recs.findIndex((r) => r.soap.id === "aloe-vera-cucumber");

  assert(tropicalIdx !== -1, "Test 2: Tropical Fruit & Oat should be in recommendations");
  assert(aloeIdx !== -1, "Test 2: Aloe Vera & Cucumber should be in recommendations");
  assert(
    tropicalIdx < aloeIdx,
    `Test 2: Tropical Fruit & Oat (idx ${tropicalIdx}) should outrank Aloe Vera & Cucumber (idx ${aloeIdx}) when sunExposureRisk is true`
  );
  console.log("✅ Test 2 Passed: Photosensitivity penalty correctly down-ranks Aloe Vera & Cucumber when sunExposureRisk: true");
}

// Test 3: Empty concerns[] -> still returns topN soaps (falls back to skin-type-only scoring)
{
  const profile = { skinType: "dry", concerns: [], sunExposureRisk: false };
  const recs = recommendSoaps(profile, 2);
  assert(recs.length === 2, "Test 3: Should return 2 recommendations even with empty concerns");
  assert(recs[0].soap.bestForSkinTypes.includes("dry"), "Test 3: #1 soap should be suitable for dry skin");
  console.log("✅ Test 3 Passed: Empty concerns[] falls back to skin-type-only scoring without error");
}

// Test 4: Unknown/unlisted concern string -> should not crash, contributes zero matches
{
  const profile = { skinType: "normal", concerns: ["unknown_alien_condition", "magic_glow"], sunExposureRisk: false };
  const recs = recommendSoaps(profile, 2);
  assert(recs.length === 2, "Test 4: Should handle unknown concern without crashing");
  console.log("✅ Test 4 Passed: Unknown concern string handled gracefully without crash");
}

// Test 5: Extract skin profile from 4 distinct report narratives and verify unique concerns & soap recommendations
{
  const reportDryAging = {
    skin_type: "dry",
    summary: "Skin appears tight with fine lines around the eyes.",
    observations: [
      { label: "Hydration & Moisture", detail: "Severe flaking and dry patches noted." },
      { label: "Pore Visibility", detail: "Pores are refined and minimal." },
      { label: "Skin Texture", detail: "Surface shows fine wrinkles." },
      { label: "Tone & Redness", detail: "Even tone overall." },
    ],
    care_tips: ["Use rich cream"],
    caveats: "Cosmetic evaluation only",
  };

  const reportOilyAcne = {
    skin_type: "oily",
    summary: "Excessive sebum and active breakouts across T-zone.",
    observations: [
      { label: "Hydration & Moisture", detail: "High oil sheen." },
      { label: "Pore Visibility", detail: "Noticeably enlarged pores and congestion." },
      { label: "Skin Texture", detail: "Acne blemishes visible." },
      { label: "Tone & Redness", detail: "Mild inflammation." },
    ],
    care_tips: ["Use clarifying cleanser"],
    caveats: "Cosmetic evaluation only",
  };

  const reportCombinationPigment = {
    skin_type: "combination",
    summary: "Uneven complexion with dark spots on cheeks.",
    observations: [
      { label: "Hydration & Moisture", detail: "Balanced moisture." },
      { label: "Pore Visibility", detail: "Normal pores." },
      { label: "Skin Texture", detail: "Dull skin texture." },
      { label: "Tone & Redness", detail: "Noticeable hyperpigmentation and dark spots." },
    ],
    care_tips: ["Apply Vitamin C"],
    caveats: "Cosmetic evaluation only",
  };

  const reportSensitiveRedness = {
    skin_type: "sensitive",
    summary: "Visible flushing and irritation post hair removal.",
    observations: [
      { label: "Hydration & Moisture", detail: "Dehydrated surface." },
      { label: "Pore Visibility", detail: "Standard pore size." },
      { label: "Skin Texture", detail: "Smooth." },
      { label: "Tone & Redness", detail: "Diffuse redness and flushing after waxing." },
    ],
    care_tips: ["Use soothing lotion"],
    caveats: "Cosmetic evaluation only",
  };

  const profileDry = extractSkinProfile(reportDryAging);
  const profileOily = extractSkinProfile(reportOilyAcne);
  const profileComb = extractSkinProfile(reportCombinationPigment);
  const profileSens = extractSkinProfile(reportSensitiveRedness);

  assert(!profileDry.concerns.includes("enlarged_pores"), "Test 5: Dry report should not falsely detect enlarged_pores from section label");
  assert(profileDry.concerns.includes("dehydration") || profileDry.concerns.includes("aging"), "Test 5: Dry report should detect dehydration or aging");
  assert(profileOily.concerns.includes("acne"), "Test 5: Oily report should detect acne");
  assert(profileComb.concerns.includes("hyperpigmentation"), "Test 5: Combination report should detect hyperpigmentation");
  assert(profileSens.concerns.includes("redness"), "Test 5: Sensitive report should detect redness");

  const recsDry = recommendSoaps(profileDry, 2);
  const recsOily = recommendSoaps(profileOily, 2);
  const recsComb = recommendSoaps(profileComb, 2);
  const recsSens = recommendSoaps(profileSens, 2);

  const drySoaps = recsDry.map((r) => r.soap.id).join(",");
  const oilySoaps = recsOily.map((r) => r.soap.id).join(",");
  const combSoaps = recsComb.map((r) => r.soap.id).join(",");
  const sensSoaps = recsSens.map((r) => r.soap.id).join(",");

  assert(drySoaps !== oilySoaps, "Test 5: Dry recommendations should differ from Oily recommendations");
  assert(oilySoaps !== combSoaps, "Test 5: Oily recommendations should differ from Combination recommendations");
  assert(combSoaps !== sensSoaps, "Test 5: Combination recommendations should differ from Sensitive recommendations");

  console.log("✅ Test 5 Passed: 4 distinct narratives produced unique concern profiles and soap recommendations:");
  console.log(`   - Dry/Aging -> [${profileDry.concerns.join(", ")}] -> Soaps: ${drySoaps}`);
  console.log(`   - Oily/Acne -> [${profileOily.concerns.join(", ")}] -> Soaps: ${oilySoaps}`);
  console.log(`   - Combination/Pigment -> [${profileComb.concerns.join(", ")}] -> Soaps: ${combSoaps}`);
  console.log(`   - Sensitive/Redness -> [${profileSens.concerns.join(", ")}] -> Soaps: ${sensSoaps}`);
}

console.log("\n🎉 All 5 soap recommendation unit tests passed successfully!");
