/**
 * @typedef {"oily" | "dry" | "combination" | "normal" | "sensitive" | "unclear"} SkinType
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

import { readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";

const taxonomyPath = fileURLToPath(
  new URL("../../shared/skin-taxonomy.json", import.meta.url)
);

const taxonomy = JSON.parse(
  readFileSync(taxonomyPath, "utf8")
);

export const SKIN_TYPES = taxonomy.skinTypes;
export const SKIN_CONCERNS = taxonomy.skinConcerns;
export const UNCLEAR_SKIN_TYPE = taxonomy.unclearType;
