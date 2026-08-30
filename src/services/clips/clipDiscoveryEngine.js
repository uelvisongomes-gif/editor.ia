// Clip Discovery Engine — Fase 7, Items 7.1-7.5.
// Analisa vídeo longo e encontra segmentos que podem virar clips
// independentes (Shorts/Reels/TikTok).
//
// Reutiliza:
//   - narrativeAnalysis.js (timeline com roles)
//   - narrative.criticalSpans
//   - narrative.timeline (hook/proof/turn/point/cta)
//
// NÃO faz download nem re-transcribe. Só decide quais janelas de tempo
// podem virar clip.

const MIN_CLIP_DUR = 12;
const MAX_CLIP_DUR = 90;
const DEFAULT_TARGET_DUR = 45;
const IDEAL_DUR_BUCKETS = [
  { max: 30, weight: 1.0 },
  { max: 60, weight: 0.95 },
  { max: 90, weight: 0.80 },
];

const MOMENT_TYPES = {
  INSIGHT:       { score: 0.85, hookRoles: ["point", "solution"] },
  STORY:         { score: 0.80, hookRoles: ["hook", "problem"] },
  TUTORIAL:      { score: 0.75, hookRoles: ["hook", "development"] },
  OPINION:       { score: 0.80, hookRoles: ["point"] },
  CONTROVERSY:   { score: 0.90, hookRoles: ["turn", "problem"] },
  SURPRISE:      { score: 0.90, hookRoles: ["turn"] },
  RESULT:        { score: 0.85, hookRoles: ["proof", "solution"] },
  BEFORE_AFTER:  { score: 0.85, hookRoles: ["turn"] },
  PRODUCT:       { score: 0.80, hookRoles: ["cta", "point"] },
  DEMONSTRATION: { score: 0.80, hookRoles: ["proof", "development"] },
  FAQ:           { score: 0.70, hookRoles: ["problem"] },
  TIP:           { score: 0.75, hookRoles: ["point", "solution"] },
  WARNING:       { score: 0.80, hookRoles: ["problem", "point"] },
  MISTAKE:       { score: 0.80, hookRoles: ["problem"] },
  MYTH:          { score: 0.85, hookRoles: ["turn", "point"] },
  CTA:           { score: 0.70, hookRoles: ["cta"] },
};

/**
 * @typedef {Object} ClipCandidate
 * @property {string} id
 * @property {number} start
 * @property {number} end
 * @property {number} duration
 * @property {string} topic
 * @property {string} hook
 * @property {string} payoff
 * @property {number} context_score
 * @property {number} standalone_score
 * @property {number} retention_score
 * @property {number} relevance_score
 * @property {number} score
 * @property {number} confidence
 * @property {string} momentType
 * @property {string[]} roles
 */

/**
 * @param {object} args
 * @param {object} args.narrative
 * @param {number} args.duration
 * @param {Array} args.words
 * @param {string} [args.mode="general"]  - "podcast" | "tutorial" | "tiktokshop" | "general"
 * @param {number} [args.maxCandidates=15]
 * @returns {{ candidates: ClipCandidate[], summary: object }}
 */
export function discoverClips({ narrative, duration = 0, words = [], mode = "general", maxCandidates = 15 } = {}) {
  const timeline = narrative?.timeline || [];
  if (!timeline.length || duration < MIN_CLIP_DUR * 2) {
    return { candidates: [], summary: { reason: "vídeo muito curto ou sem narrativa" } };
  }

  // Estratégia: cada trecho candidato começa num item de role "hook"/"point"/"turn"
  // e expande até formar 15-90s com payoff (proof/solution/cta/conclusion).
  const seeds = timeline.filter((t) =>
    ["hook", "point", "turn", "problem", "proof", "solution", "cta"].includes(t.role)
  );

  const rawCandidates = [];
  for (const seed of seeds) {
    const expanded = expandClipAround(seed, timeline, duration);
    if (!expanded) continue;
    if (expanded.end - expanded.start < MIN_CLIP_DUR) continue;
    if (expanded.end - expanded.start > MAX_CLIP_DUR) continue;

    const momentType = classifyMoment(seed, expanded.covers);
    const durScore = pickDurationScore(expanded.end - expanded.start);
    const standalone = computeStandaloneScore(expanded);
    const context = computeContextScore(expanded.covers, seed);
    const retention = computeRetentionScore(seed, expanded.covers);
    const relevance = (MOMENT_TYPES[momentType]?.score ?? 0.6) * durScore;

    const combined = Math.round(
      (standalone * 0.30 + context * 0.20 + retention * 0.25 + relevance * 0.25) * 100
    );

    rawCandidates.push({
      id: `clip-${expanded.start.toFixed(2)}-${expanded.end.toFixed(2)}`,
      start: expanded.start,
      end: expanded.end,
      duration: Math.round((expanded.end - expanded.start) * 10) / 10,
      topic: seed.text?.slice(0, 80) || "",
      hook: seed.text?.slice(0, 100) || "",
      payoff: expanded.payoffText,
      context_score: Math.round(context * 100),
      standalone_score: Math.round(standalone * 100),
      retention_score: Math.round(retention * 100),
      relevance_score: Math.round(relevance * 100),
      score: combined,
      confidence: Math.min(1, (seed.confidence || 70) / 100),
      momentType,
      roles: expanded.covers.map((c) => c.role),
    });
  }

  // Dedupe similares (item 7.10) — se dois clips overlapam > 60%, mantém melhor score
  const dedup = deduplicateBySimilarity(rawCandidates);
  const ranked = dedup.sort((a, b) => b.score - a.score).slice(0, maxCandidates);

  return {
    candidates: ranked,
    summary: {
      totalSeeds: seeds.length,
      rawCount: rawCandidates.length,
      afterDedupe: dedup.length,
      returned: ranked.length,
      averageScore: ranked.length ? Math.round(ranked.reduce((a, b) => a + b.score, 0) / ranked.length) : 0,
      mode,
    },
  };
}

function expandClipAround(seed, timeline, videoDuration) {
  const seedIdx = timeline.indexOf(seed);
  if (seedIdx < 0) return null;

  let start = seed.start;
  let end = seed.end;
  const covers = [seed];

  // Expande pra trás enquanto duração < target E ganha contexto
  for (let i = seedIdx - 1; i >= 0; i--) {
    const item = timeline[i];
    if (["off_topic", "aside"].includes(item.role)) break;
    const nextStart = item.start;
    if (seed.start - nextStart > 40) break; // limite de contexto anterior
    if (end - nextStart > MAX_CLIP_DUR) break;
    start = nextStart;
    covers.unshift(item);
    if (end - start >= DEFAULT_TARGET_DUR) break;
  }

  // Expande pra frente até achar payoff ou hit max duration
  let payoffText = "";
  for (let i = seedIdx + 1; i < timeline.length; i++) {
    const item = timeline[i];
    if (["off_topic"].includes(item.role)) break;
    if (item.end - start > MAX_CLIP_DUR) break;
    end = item.end;
    covers.push(item);
    if (["cta", "solution", "conclusion", "proof"].includes(item.role) && !payoffText) {
      payoffText = item.text?.slice(0, 100) || "";
    }
    if (payoffText && end - start >= DEFAULT_TARGET_DUR) break;
  }

  // Se não achou payoff explícito, o próprio último item vira payoff
  if (!payoffText && covers.length > 1) payoffText = covers[covers.length - 1].text?.slice(0, 100) || "";

  end = Math.min(end, videoDuration);
  return { start, end, covers, payoffText };
}

function classifyMoment(seed, covers) {
  const roles = covers.map((c) => c.role);
  if (roles.includes("proof") && roles.includes("turn")) return "BEFORE_AFTER";
  if (roles.includes("turn")) return "SURPRISE";
  if (roles.includes("proof") && roles.includes("cta")) return "RESULT";
  if (roles.includes("problem") && roles.includes("solution")) return "STORY";
  if (roles.filter((r) => r === "development").length >= 2) return "TUTORIAL";
  if (seed.role === "cta") return "CTA";
  if (seed.role === "point" && (seed.weakness == null || !seed.weakness)) return "INSIGHT";
  if (roles.includes("problem")) return "MISTAKE";
  if (roles.includes("proof")) return "DEMONSTRATION";
  return "OPINION";
}

function pickDurationScore(dur) {
  for (const b of IDEAL_DUR_BUCKETS) if (dur <= b.max) return b.weight;
  return 0.6;
}

function computeStandaloneScore(clip) {
  // Standalone alto se: começa com hook/turn/point, termina com payoff/proof/cta
  const first = clip.covers[0]?.role;
  const last = clip.covers[clip.covers.length - 1]?.role;
  let score = 0.5;
  if (["hook", "turn", "point", "problem"].includes(first)) score += 0.20;
  if (["proof", "solution", "cta", "conclusion", "point"].includes(last)) score += 0.20;
  // Não deve começar com "development" ou "context" isolado (falta setup)
  if (["development", "context", "aside"].includes(first)) score -= 0.15;
  return Math.max(0, Math.min(1, score + 0.1));
}

function computeContextScore(covers, seed) {
  // Se seed é hook/turn, precisa muito contexto antes; se é proof/solution,
  // já tem contexto nos anteriores.
  const beforeSeedCount = covers.findIndex((c) => c === seed);
  if (["hook", "turn"].includes(seed.role)) {
    return beforeSeedCount === 0 ? 0.9 : 0.7;
  }
  return beforeSeedCount >= 1 ? 0.85 : 0.55;
}

function computeRetentionScore(seed, covers) {
  // Aproximação: importance da seed + presença de critical spans
  const impBase = { critical: 1.0, high: 0.8, medium: 0.55, low: 0.3 }[seed.importance] || 0.55;
  const critInside = covers.filter((c) => c.importance === "critical").length;
  return Math.min(1, impBase + critInside * 0.08);
}

function deduplicateBySimilarity(candidates) {
  const kept = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    const overlap = kept.some((k) => {
      const ov = Math.max(0, Math.min(k.end, c.end) - Math.max(k.start, c.start));
      const smaller = Math.min(k.duration, c.duration);
      return ov / smaller > 0.6;
    });
    if (!overlap) kept.push(c);
  }
  return kept;
}
