/**
 * @typedef {"oily" | "dry" | "combination" | "normal" | "sensitive"} SkinType
 * @typedef {"acne" | "hyperpigmentation" | "aging" | "dehydration" | "redness" | "dullness" | "sun_damage" | "enlarged_pores" | "post_hair_removal"} SkinConcern
 *
 * @typedef {Object} SkinProfile
 * @property {SkinType} skinType
 * @property {SkinConcern[]} concerns
 * @property {boolean} sunExposureRisk
 *
 * @typedef {Object} Soap
 * @property {string} id
 * @property {string} nameEn
 * @property {string} nameAr
 * @property {string} imageAsset
 * @property {string[]} keyActives
 * @property {SkinType[]} bestForSkinTypes
 * @property {SkinConcern[]} targetsConcerns
 * @property {string[]} cautions
 * @property {boolean} isPhotosensitizing
 *
 * @typedef {Object} SoapRecommendation
 * @property {Soap} soap
 * @property {number} score
 * @property {SkinConcern[]} matchedConcerns
 * @property {string} reasoning
 */

export const SKIN_TYPES = ["oily", "dry", "combination", "normal", "sensitive"];
export const SKIN_CONCERNS = [
  "acne",
  "hyperpigmentation",
  "aging",
  "dehydration",
  "redness",
  "dullness",
  "sun_damage",
  "enlarged_pores",
  "post_hair_removal",
];
