// Emphasis Model — pontua cada sentence do vídeo em [0,1] indicando o
// quanto ela merece énfase VISUAL (zoom, caption emphasis, insert).
//
// Determinístico. Zero LLM. Usa só campos que semanticAnalysis já produziu
// (role, importance, text) + listas de markers editoriais.
//
// Campo canônico: sentence.emphasisScore (float 0-1)
//                 sentence.emphasisTier  (low | mid | high)
//                 sentence.emphasisReasons ([string])
//
// Consumido por: smartZoom, visualAttentionEngine, futuro captionEmphasis.
// NÃO é usado pra decidir cortes (isso é speech-cleanup, separado).

export const ROLE_WEIGHT = {
  point: 1.00,
  turn: 0.98,          // virada narrativa é fortíssima
  cta: 0.95,
  solution: 0.85,
  hook: 0.80,          // subiu — gancho merece atenção visual
  problem: 0.70,       // dor/desafio precisa de peso
  proof: 0.65,         // evidência/exemplo/dado
  conclusion: 0.60,
  development: 0.35,
  context: 0.20,
  aside: 0.00,
  off_topic: 0.00,
};

export const IMPORTANCE_WEIGHT = {
  critical: 1.10,     // ultrapassa 1.0 — clamp em score final
  high: 1.00,
  medium: 0.55,
  low: 0.15,
};

// Palavras que reforçam "momento de impacto" — bump forte.
export const IMPACT_MARKERS = [
  "olha", "veja", "atenção", "cuidado", "nunca", "sempre",
  "revelação", "segredo", "descobri", "aconteceu", "resultado",
  "antes", "depois", "mas", "porém", "surpresa", "impressionante",
  "único", "só existe", "impossível", "imperdível",
];

// Palavras que indicam énfase — bump moderado.
export const EMPHASIS_MARKERS = [
  "importante", "essencial", "principal", "fundamental", "crítico",
  "muito", "problema", "solução", "resposta",
];

const normalize = (s) => (s || "").toLowerCase();

/**
 * Calcula emphasisScore pra uma sentence.
 * @returns {{score:number, tier:"low"|"mid"|"high", reasons:string[]}}
 */
export function computeEmphasis(sentence) {
  const text = normalize(sentence.text);
  const reasons = [];

  const role = ROLE_WEIGHT[sentence.role] ?? 0.30;
  const imp = IMPORTANCE_WEIGHT[sentence.importance] ?? 0.50;
  let score = role * 0.55 + imp * 0.45;
  if (role >= 0.75) reasons.push(`role_${sentence.role}`);
  if (imp >= 0.75) reasons.push(`importance_${sentence.importance}`);

  const impactHits = IMPACT_MARKERS.filter((m) => text.includes(m));
  if (impactHits.length) {
    const bump = Math.min(0.25, impactHits.length * 0.10);
    score += bump;
    reasons.push(...impactHits.slice(0, 3).map((m) => `impact_${m}`));
  }
  const emphHits = EMPHASIS_MARKERS.filter((m) => text.includes(m));
  if (emphHits.length) {
    const bump = Math.min(0.20, emphHits.length * 0.07);
    score += bump;
    reasons.push(...emphHits.slice(0, 3).map((m) => `emphasis_${m}`));
  }

  const wc = text.split(/\s+/).filter(Boolean).length;
  if (wc < 4) { score -= 0.30; reasons.push("short_sentence"); }
  if (wc > 35) { score -= 0.15; reasons.push("long_sentence"); }

  score = Math.max(0, Math.min(1, score));
  const tier = score >= 0.75 ? "high" : score >= 0.50 ? "mid" : "low";
  return { score, tier, reasons };
}

/**
 * Enriquece sentences com emphasisScore/emphasisTier/emphasisReasons.
 * Mutação-livre: retorna array novo.
 */
export function enrichWithEmphasis(sentences) {
  return sentences.map((s) => {
    const { score, tier, reasons } = computeEmphasis(s);
    return { ...s, emphasisScore: score, emphasisTier: tier, emphasisReasons: reasons };
  });
}
