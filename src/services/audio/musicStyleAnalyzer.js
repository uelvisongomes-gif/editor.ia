// Music Style Analyzer — deriva direção musical (style/mood/energy)
// a partir de narrativa + tema + modo. Item 15 da spec.
//
// Não é IA generativa — é matching heurístico entre padrões narrativos
// e um catálogo de estilos musicais.

/**
 * @typedef {Object} MusicStyle
 * @property {string} style          - "modern electronic", "cinematic", etc
 * @property {string} mood           - "motivational", "calm", "energetic"...
 * @property {"low"|"medium"|"high"} energy
 * @property {boolean} vocals        - permite música com voz cantada?
 * @property {string[]} keywords     - pra busca no provider
 * @property {string} rationale
 */

const STYLE_CATALOG = {
  motivational_electronic:  { style: "modern electronic",  mood: "motivational",  energy: "high",   vocals: false, keywords: ["motivational electronic", "uplifting"] },
  corporate_calm:           { style: "corporate ambient",  mood: "calm",          energy: "low",    vocals: false, keywords: ["corporate", "background", "calm"] },
  lifestyle_indie:          { style: "indie folk",         mood: "warm",          energy: "medium", vocals: false, keywords: ["indie", "acoustic", "warm"] },
  cinematic:                { style: "cinematic",          mood: "epic",          energy: "high",   vocals: false, keywords: ["cinematic", "epic", "orchestral"] },
  minimalist:               { style: "minimalist piano",   mood: "reflective",    energy: "low",    vocals: false, keywords: ["minimal piano", "reflective"] },
  viral_energetic:          { style: "trap/hip-hop",       mood: "energetic",     energy: "high",   vocals: false, keywords: ["viral", "hip hop", "energetic"] },
  educational_soft:         { style: "lo-fi",              mood: "focused",       energy: "low",    vocals: false, keywords: ["lofi", "study", "focus"] },
  commercial_upbeat:        { style: "commercial pop",     mood: "upbeat",        energy: "medium", vocals: false, keywords: ["upbeat", "commercial", "pop"] },
  tech_electronic:          { style: "tech electronic",    mood: "future",        energy: "medium", vocals: false, keywords: ["tech", "synth", "future"] },
  emotional:                { style: "emotional piano",    mood: "emotional",     energy: "medium", vocals: false, keywords: ["emotional", "piano", "strings"] },
  suspense:                 { style: "suspense",           mood: "tense",         energy: "medium", vocals: false, keywords: ["suspense", "tension"] },
  elegant:                  { style: "elegant jazz",       mood: "sophisticated", energy: "low",    vocals: false, keywords: ["elegant", "jazz", "smooth"] },
};

// Palavras-chave do tema → estilo
const THEME_MATCH = {
  motivacional:    "motivational_electronic",
  motivacão:       "motivational_electronic",
  sucesso:         "motivational_electronic",
  empreender:      "commercial_upbeat",
  vender:          "commercial_upbeat",
  vendas:          "commercial_upbeat",
  dinheiro:        "commercial_upbeat",
  tecnologia:      "tech_electronic",
  ia:              "tech_electronic",
  aplicativo:      "tech_electronic",
  software:        "tech_electronic",
  corporativo:     "corporate_calm",
  empresa:         "corporate_calm",
  liderança:       "corporate_calm",
  educação:        "educational_soft",
  ensinar:         "educational_soft",
  aprender:        "educational_soft",
  curso:           "educational_soft",
  familia:         "lifestyle_indie",
  vida:            "lifestyle_indie",
  viagem:          "lifestyle_indie",
  emoção:          "emotional",
  história:        "emotional",
  medo:            "suspense",
  mistério:        "suspense",
  luxo:            "elegant",
  premium:         "elegant",
};

/**
 * @param {object} args
 * @param {string} args.topic
 * @param {object} args.narrative
 * @param {object} args.profile
 * @param {number} args.duration
 * @returns {MusicStyle}
 */
export function analyzeMusicStyle({ topic = "", narrative, profile, duration } = {}) {
  const t = (topic || "").toLowerCase();
  // Tenta match por tema
  for (const [kw, styleKey] of Object.entries(THEME_MATCH)) {
    if (t.includes(kw)) {
      const s = STYLE_CATALOG[styleKey];
      return { ...s, rationale: `tema "${kw}" → ${styleKey}` };
    }
  }
  // Match por modo de edição
  const modeMap = {
    viral:       "viral_energetic",
    tiktokshop:  "commercial_upbeat",
    dinamico:    "motivational_electronic",
    natural:     "lifestyle_indie",
    equilibrada: "corporate_calm",
    profissional: "corporate_calm",
    podcast:     "minimalist",
    tutorial:    "educational_soft",
  };
  const modeKey = modeMap[profile?.id] || "corporate_calm";
  const s = STYLE_CATALOG[modeKey];
  return { ...s, rationale: `modo ${profile?.id || "default"} → ${modeKey}` };
}
