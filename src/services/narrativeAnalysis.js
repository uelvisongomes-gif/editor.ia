// Narrative Analysis — mapa narrativo completo do vídeo, agrupado por
// função. Determinístico, zero LLM extra (deriva do semanticAnalysis).
//
// Adiciona:
// - buckets pra novos roles (problem, proof, turn, solution)
// - map narrativo em ORDEM cronológica com timestamps (pra timeline UI)
// - resumo de forças/fraquezas (weakSpots)
// - lista de trechos essenciais (critical) que nunca devem ser cortados

const ALL_ROLES = [
  "hook", "context", "problem", "development", "proof",
  "turn", "solution", "point", "conclusion", "cta", "aside", "off_topic",
];

const BUCKET_KEY = {
  hook: "hook",
  context: "context",
  problem: "problem",
  development: "development",
  proof: "proof",
  turn: "turn",
  solution: "solution",
  point: "points",
  conclusion: "conclusion",
  cta: "cta",
  aside: "aside",
  off_topic: "offTopic",
};

/**
 * @param {ReturnType<import('./semanticAnalysis.js').analyzeSemantics> extends Promise<infer T> ? T : never} semantic
 * @returns {{
 *   topic: string,
 *   buckets: Object,
 *   durations: Object,
 *   timeline: Array<{ start:number, end:number, role:string, importance:string, confidence:number, weakness:string|null, text:string, index:number }>,
 *   weakSpots: Array,     // sentences com weakness != null
 *   criticalSpans: Array, // sentences importance === 'critical'
 * }}
 */
export function buildNarrativeMap(semantic) {
  const buckets = {
    hook: [], context: [], problem: [], development: [], proof: [],
    turn: [], solution: [], points: [], conclusion: [], cta: [], aside: [], offTopic: [],
  };
  const timeline = [];
  const weakSpots = [];
  const criticalSpans = [];

  for (const s of (semantic?.sentences || [])) {
    const bucketKey = BUCKET_KEY[s.role] || "development";
    buckets[bucketKey].push(s);
    timeline.push({
      start: s.start,
      end: s.end,
      role: s.role || "development",
      importance: s.importance || "medium",
      confidence: s.roleConfidence ?? 70,
      weakness: s.weakness || null,
      text: s.text,
      index: s.index,
    });
    if (s.weakness) weakSpots.push({
      index: s.index, start: s.start, end: s.end, role: s.role,
      weakness: s.weakness, text: s.text,
    });
    if (s.importance === "critical") criticalSpans.push({
      index: s.index, start: s.start, end: s.end, role: s.role, text: s.text,
    });
  }
  timeline.sort((a, b) => a.start - b.start);

  return {
    topic: semantic?.topic || "",
    buckets,
    durations: Object.fromEntries(
      Object.entries(buckets).map(([k, arr]) => [k, arr.reduce((a, s) => a + (s.end - s.start), 0)])
    ),
    timeline,
    weakSpots,
    criticalSpans,
  };
}

export { ALL_ROLES };
