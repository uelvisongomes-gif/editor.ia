// Pattern Interrupt — emite recomendações pra "quebrar" o padrão visual
// quando há RISCO de queda de retenção. Detecta:
//   - Trecho longo sem mudança visual (>15s sem cut/zoom/broll)
//   - Sequência de sentenças de MESMO role (viewer perde interesse)
//   - Modo viral pede densidade — se abaixo, injeta pattern break
//
// NÃO cria efeito por cronômetro. Só quando um SINAL narrativo/visual
// justifica.

/**
 * @typedef {Object} PatternInterruptSuggestion
 * @property {number} atSec
 * @property {number} durSec
 * @property {"quick_zoom"|"text_flash"|"cut_reframe"|"broll_flash"} kind
 * @property {string} reason
 * @property {number} priority
 */

/**
 * @param {object} args
 * @param {{ timeline: Array }} args.narrative
 * @param {{ events: Array }} args.visualTimeline
 * @param {object} args.profile
 * @returns {{ interrupts: PatternInterruptSuggestion[], summary: object }}
 */
export function buildPatternInterrupts({ narrative, visualTimeline, profile = {} } = {}) {
  const timeline = narrative?.timeline || [];
  const events = visualTimeline?.events || [];
  const interrupts = [];
  const mode = profile?.id || "equilibrada";

  // Quantos segundos SEM efeito visual são tolerados por modo
  const MAX_DEAD_INTERVAL = {
    leve: 20, equilibrada: 15, agressiva: 8,
    profissional: 18, podcast: 30, tiktokshop: 6, tutorial: 12,
  };
  const deadThreshold = MAX_DEAD_INTERVAL[mode] ?? 15;

  // 1) Detectar gaps sem NENHUM efeito visual (cut/zoom/broll)
  const anchors = events
    .filter((e) => e.kind === "cut" || e.kind === "zoom_in" || e.kind === "broll")
    .map((e) => e.start)
    .sort((a, b) => a - b);

  for (let i = 0; i < anchors.length - 1; i++) {
    const gap = anchors[i + 1] - anchors[i];
    if (gap <= deadThreshold) continue;
    const mid = anchors[i] + gap / 2;
    // Só sugere se cai em role de importância >= medium
    const role = timeline.find((s) => mid >= s.start && mid < s.end);
    if (!role || role.importance === "low" || role.weakness) continue;
    interrupts.push({
      atSec: mid,
      durSec: 1.2,
      kind: "quick_zoom",
      reason: `${gap.toFixed(1)}s sem estímulo visual em role ${role.role}`,
      priority: role.importance === "critical" ? 0.95 : 0.75,
    });
  }

  // 2) Sequência de sentenças MESMO role longa (viewer perde tração)
  let currentRole = null;
  let runStart = null;
  let runLen = 0;
  for (const s of timeline) {
    if (s.role === currentRole) { runLen += 1; }
    else {
      // fecha run anterior
      if (runLen >= 4 && (currentRole === "development" || currentRole === "context")) {
        const mid = runStart + (s.start - runStart) / 2;
        interrupts.push({
          atSec: mid,
          durSec: 1.5,
          kind: "text_flash",
          reason: `${runLen} sentenças seguidas de ${currentRole} — quebra visual`,
          priority: 0.70,
        });
      }
      currentRole = s.role;
      runStart = s.start;
      runLen = 1;
    }
  }

  interrupts.sort((a, b) => b.priority - a.priority);
  return {
    interrupts,
    summary: { total: interrupts.length, deadThreshold, mode },
  };
}
