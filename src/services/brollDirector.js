// B-Roll Director — decide QUANDO um trecho merece B-roll e QUAL query
// buscar. Não busca mídia — só emite recomendações. Provedores externos
// (Pexels/Pixabay/upload/AI-gen) ficam em brollProvider (arquitetura
// modular pra swap).
//
// Determinístico, zero LLM. Consome narrative.timeline + visualPlan
// (fase 3.1) que já marca "broll_suggest" em roles proof/apropriados.
//
// Regras:
//   - Só sugere B-roll em roles: proof (default), problem (opcional),
//     development quando existe substantivo concreto na frase.
//   - Espaço mínimo entre B-rolls: 3s (evita poluição).
//   - Nunca sugere em CTA, hook (foco no rosto).
//   - Weakness marcada → skip.

/**
 * @typedef {Object} BrollSuggestion
 * @property {number} start
 * @property {number} end
 * @property {string} query          - texto pra busca em provider
 * @property {string} reason
 * @property {number} confidence     - 0-1
 * @property {string} narrativeRole
 * @property {string[]} keywords     - substantivos concretos extraídos
 */

// Roles onde B-roll faz sentido
const BROLL_FRIENDLY_ROLES = new Set(["proof", "problem", "development", "context"]);
// Roles onde NUNCA sugere (foco no rosto)
const NO_BROLL_ROLES = new Set(["hook", "cta", "turn"]);

// Substantivos concretos que rendem B-roll relevante
const CONCRETE_NOUN_HINTS = [
  "escritório", "escritorio", "equipe", "computador", "celular", "casa",
  "carro", "cidade", "praia", "montanha", "café", "cafe", "cozinha",
  "loja", "produto", "câmera", "camera", "notebook", "trabalho",
  "reunião", "reuniao", "família", "familia", "criança", "crianca",
  "livro", "curso", "sala", "escola", "empresa", "cliente", "mercado",
  "dinheiro", "vendas", "resultado", "gráfico", "grafico", "tela",
];

/**
 * Extrai keywords de uma sentence pra query de B-roll.
 * Simples — pega substantivos concretos + palavras longas.
 */
function extractKeywords(text) {
  if (!text) return [];
  const words = text.toLowerCase()
    .replace(/[.,!?;:"'()]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const found = [];
  for (const w of words) {
    if (CONCRETE_NOUN_HINTS.includes(w)) found.push(w);
    else if (w.length >= 6 && !w.match(/^(porque|quando|então|entao|também|tambem|apenas|realmente|geralmente|totalmente|absolutamente)$/)) {
      found.push(w);
    }
  }
  return [...new Set(found)].slice(0, 4);
}

/**
 * @param {object} args
 * @param {{ timeline: Array }} args.narrative
 * @param {Array} args.segments
 * @param {object} args.profile
 * @returns {{ suggestions: BrollSuggestion[], summary: object }}
 */
export function buildBrollPlan({ narrative, segments = [], profile = {} } = {}) {
  const suggestions = [];
  const timeline = narrative?.timeline || [];
  const activeSegs = segments.filter((s) => !s.deleted && s.action !== "review" && s.action !== "trim");
  const inActive = (t) => activeSegs.some((s) => t >= s.start - 0.05 && t < s.end + 0.05);

  const MIN_GAP = 3.0;
  let lastEnd = -Infinity;

  for (const item of timeline) {
    if (NO_BROLL_ROLES.has(item.role)) continue;
    if (!BROLL_FRIENDLY_ROLES.has(item.role)) continue;
    if (item.weakness) continue;
    if (!inActive(item.start)) continue;
    // Espaço mínimo entre b-rolls
    if (item.start - lastEnd < MIN_GAP) continue;

    const keywords = extractKeywords(item.text);
    if (!keywords.length) continue;

    // Score = importance + confidence + role weight
    const impScore = { critical: 1.0, high: 0.85, medium: 0.55, low: 0.25 }[item.importance] || 0.55;
    const confScore = (item.confidence ?? 70) / 100;
    const roleScore = item.role === "proof" ? 1.0 : (item.role === "problem" ? 0.75 : 0.55);
    const relevance = Math.min(1, impScore * confScore * roleScore * 1.2);

    if (relevance < 0.55) continue;

    const dur = Math.min(4.5, Math.max(2.0, item.end - item.start));

    suggestions.push({
      start: item.start,
      end: item.start + dur,
      query: keywords.join(" "),
      keywords,
      reason: `Apoio visual em ${item.role} (${item.importance})`,
      confidence: Math.round(relevance * 100) / 100,
      narrativeRole: item.role,
    });
    lastEnd = item.start + dur;
  }

  return {
    suggestions,
    summary: {
      totalCandidates: timeline.filter((t) => BROLL_FRIENDLY_ROLES.has(t.role)).length,
      emitted: suggestions.length,
      mode: profile?.id || "equilibrada",
    },
  };
}
