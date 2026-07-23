import { recommendSoaps } from "./soapRecommendation.js";

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

console.log("\n🎉 All 4 soap recommendation unit tests passed successfully!");
