// Contextual Protections — regras que impedem cortes/overlays em
// momentos visualmente importantes:
//   - Sobre expressão emocional (importance=critical + role=point/turn/cta)
//   - Durante demonstração de produto (productMoments)
//   - Durante gesto/apontamento (sem CV — infere de importance)
//   - Sobre prova visual (broll suggested)
//
// Não bloqueia diretamente — retorna protectedRanges[] que outras camadas
// (autoReframe, captions, brollDirector, transitionEngine) devem honrar.

/**
 * @typedef {Object} ProtectedRange
 * @property {number} start
 * @property {number} end
 * @property {"emotional"|"product"|"gesture"|"proof"|"critical_narrative"} kind
 * @property {string} reason
 * @property {string[]} forbidden  - lista de ações proibidas: ["cut","broll","caption_overlap","reframe","transition"]
 */

/**
 * @param {object} args
 * @param {{ timeline: Array, criticalSpans: Array }} args.narrative
 * @param {{ moments: Array }} args.productMoments
 * @param {{ suggestions: Array }} args.brollPlan
 * @returns {{ ranges: ProtectedRange[], summary: object }}
 */
export function buildProtectedRanges({ narrative, productMoments, brollPlan } = {}) {
  const ranges = [];

  // 1) Momentos críticos narrativos (Item 7 da spec Fase 2)
  for (const c of (narrative?.criticalSpans || [])) {
    ranges.push({
      start: c.start,
      end: c.end,
      kind: "critical_narrative",
      reason: `${c.role} crítico — nunca autocortar`,
      forbidden: ["cut", "broll", "caption_overlap", "transition"],
    });
  }

  // 2) Trechos com role point/turn/cta em importance high → emotional
  for (const s of (narrative?.timeline || [])) {
    if (s.importance !== "high" && s.importance !== "critical") continue;
    if (!["point", "turn", "cta"].includes(s.role)) continue;
    ranges.push({
      start: s.start,
      end: s.end,
      kind: "emotional",
      reason: `${s.role} em ${s.importance} — protege expressão`,
      forbidden: ["broll", "caption_overlap"],
    });
  }

  // 3) Momentos de produto (Item 6)
  for (const m of (productMoments?.moments || [])) {
    ranges.push({
      start: m.start,
      end: m.end,
      kind: "product",
      reason: `${m.kind} de produto — protege área central`,
      // Demonstração é mais restritiva
      forbidden: m.kind === "demonstration"
        ? ["cut", "broll", "caption_overlap", "reframe"]
        : ["broll", "caption_overlap"],
    });
  }

  // 4) Onde já há B-roll sugerido, protege o rosto (não coloca overlay em cima)
  for (const b of (brollPlan?.suggestions || [])) {
    ranges.push({
      start: b.start,
      end: b.end,
      kind: "proof",
      reason: "B-roll ocupando quadro",
      forbidden: ["caption_overlap", "text_overlay"],
    });
  }

  // Merge overlaps do mesmo kind
  ranges.sort((a, b) => a.start - b.start);

  return {
    ranges,
    summary: {
      total: ranges.length,
      byKind: ranges.reduce((acc, r) => { acc[r.kind] = (acc[r.kind] || 0) + 1; return acc; }, {}),
    },
  };
}

/**
 * Retorna true se a ação `action` no instante `t` está PROIBIDA por alguma
 * regra ativa. Usado pelos consumidores (autoReframe, captions, etc).
 */
export function isActionForbiddenAt(t, action, protectedRanges) {
  for (const r of (protectedRanges?.ranges || [])) {
    if (t < r.start || t > r.end) continue;
    if (r.forbidden.includes(action)) return { forbidden: true, reason: r.reason, kind: r.kind };
  }
  return { forbidden: false };
}
