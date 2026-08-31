// Style Schema — contrato JSON declarativo de um estilo de edição.
// Item 4 da spec. Todos os presets seguem este formato.
//
// Um Style é APENAS configuração. A execução é feita pelo AnimationRegistry
// + EffectDecisionLayer. Isto permite criar N estilos sem tocar em código.

/**
 * @typedef {Object} StyleConfig
 * @property {string} id                    - ex "viral_fast_01"
 * @property {string} version               - semver "1.0.0"
 * @property {string} name                  - human readable
 * @property {string} category              - "natural" | "dynamic" | "viral" | "storytelling" | "podcast" | "tutorial" | "tiktokshop" | "ugc" | "business" | "high_energy" | "custom"
 * @property {string} [extends]             - id de base preset (Item 17)
 * @property {StylePacing} pacing
 * @property {StyleBudget} budget
 * @property {Record<string, TriggerBinding[]>} triggers  - trigger→animation
 * @property {StyleBrandKit} [brandKit]
 * @property {string} [description]
 * @property {string[]} [tags]
 */

/**
 * @typedef {Object} StylePacing
 * @property {number} intensity            - 0-1, densidade geral
 * @property {"slow"|"medium"|"fast"|"very_fast"} cutPace
 * @property {number} [minPlaneSec]        - duração mínima de "plano"
 */

/**
 * @typedef {Object} StyleBudget
 * @property {"low"|"medium"|"medium_high"|"high"} density  - Item 12
 * @property {StyleCooldowns} cooldowns
 * @property {number} [maxEventsPerMin]    - override do density limit
 */

/**
 * @typedef {Object} StyleCooldowns
 * @property {number} zoom       - segundos mínimos entre zooms
 * @property {number} text       - entre overlays de texto
 * @property {number} broll      - entre B-rolls
 * @property {number} transition
 * @property {number} sfx
 */

/**
 * @typedef {Object} TriggerBinding
 * @property {string} animation          - id do AnimationRegistry (ex "punch_in", "big_number")
 * @property {number} [priority]         - 0-1, usado quando > 1 binding pro mesmo trigger
 * @property {object} [params]           - overrides pros params default da animation
 * @property {string[]} [requires]       - condições extras (ex ["hasNumber", "notInCta"])
 * @property {number} [chance]           - 0-1, se < 1 sofre roll com seed
 */

/**
 * @typedef {Object} StyleBrandKit
 * @property {string} [primary]
 * @property {string} [secondary]
 * @property {string} [accent]
 * @property {string} [fontHeading]
 * @property {string} [fontBody]
 * @property {string} [logoUrl]
 * @property {string} [watermarkUrl]
 */

export const DEFAULT_COOLDOWNS = { zoom: 3, text: 2, broll: 4, transition: 0.5, sfx: 1.5 };
export const DEFAULT_BRAND = { primary: "#FF6A2B", secondary: "#FF3EA5", accent: "#FFB020", fontHeading: "Archivo Black", fontBody: "Inter Tight" };

export const DENSITY_LIMITS = {
  low:         { perMin: 6,  perTenSec: 2 },
  medium:      { perMin: 12, perTenSec: 3 },
  medium_high: { perMin: 18, perTenSec: 4 },
  high:        { perMin: 28, perTenSec: 6 },
};

/**
 * Normaliza um style aplicando defaults + extends recursivo.
 * @param {StyleConfig} style
 * @param {Function} resolveExtends  - (id) => StyleConfig
 * @returns {StyleConfig}
 */
export function normalizeStyle(style, resolveExtends = () => null) {
  if (!style) throw new Error("normalizeStyle: style required");
  let merged = { ...style };
  if (style.extends) {
    const base = resolveExtends(style.extends);
    if (base) {
      const baseNorm = normalizeStyle(base, resolveExtends);
      merged = deepMerge(baseNorm, style);
    }
  }
  merged.pacing = { intensity: 0.5, cutPace: "medium", ...merged.pacing };
  merged.budget = {
    density: "medium",
    ...merged.budget,
    cooldowns: { ...DEFAULT_COOLDOWNS, ...(merged.budget?.cooldowns || {}) },
  };
  merged.brandKit = { ...DEFAULT_BRAND, ...(merged.brandKit || {}) };
  merged.triggers = merged.triggers || {};
  merged.version = merged.version || "1.0.0";
  return merged;
}

function deepMerge(base, over) {
  if (over === null || typeof over !== "object" || Array.isArray(over)) return over ?? base;
  if (typeof base !== "object" || Array.isArray(base)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = deepMerge(base?.[k], v);
  }
  return out;
}

export function validateStyle(style) {
  const errs = [];
  if (!style?.id) errs.push("id required");
  if (!style?.name) errs.push("name required");
  if (!style?.category) errs.push("category required");
  if (!DENSITY_LIMITS[style?.budget?.density]) errs.push(`unknown density: ${style?.budget?.density}`);
  return { ok: errs.length === 0, errors: errs };
}
