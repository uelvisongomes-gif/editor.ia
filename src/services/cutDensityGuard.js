// Cut Density Guard — protege contra overcutting rebaixando os
// candidatos de menor confiança pra REVIEW quando a densidade de
// cortes excederia o razoável.
//
// NÃO é limitador rígido — não impõe `maxCuts`. É um comportamento
// adaptativo: se o pipeline pretende gerar 30 cortes/min num vídeo
// que naturalmente merece 10, os piores 20 viram REVIEW pro usuário
// julgar. Nada se perde — só não vira jump cut automático.
//
// Densidades por perfil (cortes por minuto):
//   leve      — 6  (edição sutil, só pega problemas óbvios)
//   equilibrada — 10 (padrão razoável pra vídeo social 1-5min)
//   agressiva — 16 (aceita mais fragmentação por dinamismo)

const DENSITY_PER_PROFILE = {
  leve: 6,
  equilibrada: 10,
  agressiva: 16,
};

const WINDOW_SEC = 60;

/**
 * Recebe candidates JÁ decididos (com finalAction). Retorna nova lista
 * onde os REMOVE de menor confidence viraram REVIEW se a densidade
 * ultrapassaria o esperado pra o perfil.
 *
 * @param {Array} decided - saída do decideAll
 * @param {object} profile - editingProfile.getProfile(...)
 * @param {number} duration - duração do vídeo em segundos
 * @returns {{ decided: Array, metrics: object }}
 */
export function applyCutDensityGuard(decided, profile, duration) {
  if (!decided?.length) return { decided: [], metrics: emptyMetrics() };
  const targetDensity = DENSITY_PER_PROFILE[profile?.id] ?? 10;
  const durMin = Math.max(WINDOW_SEC, duration) / 60;
  const targetCount = Math.ceil(targetDensity * durMin);

  const removeCands = decided
    .filter((c) => c.finalAction === "remove" || c.finalAction === "trim")
    .sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0)); // menor conf primeiro

  const excessCount = removeCands.length - targetCount;
  const downgradeIds = new Set();
  if (excessCount > 0) {
    // Rebaixa os `excessCount` de menor confidence, EXCETO surgical
    // (stutter/false_start/abandoned_phrase/low_clarity/filler quando alta conf).
    // Adicionado low_clarity + filler porque estas capturam palavras
    // esticadas e hesitações com alta confiança — não deveriam virar
    // REVIEW só porque o vídeo tem muitos candidatos.
    const SURGICAL = new Set(["stutter", "false_start", "abandoned_phrase", "self_correction", "low_clarity", "filler"]);
    let downgraded = 0;
    for (const c of removeCands) {
      if (downgraded >= excessCount) break;
      if (SURGICAL.has(c.primaryType)) continue;
      downgradeIds.add(c.id);
      downgraded += 1;
    }
  }

  const out = decided.map((c) => {
    if (downgradeIds.has(c.id)) {
      return {
        ...c,
        finalAction: "review",
        blockedReasons: [...(c.blockedReasons || []), `cut_density_guard (perfil ${profile?.id})`],
        safety: c.safety || "high_density",
      };
    }
    return c;
  });

  const finalRemoveCount = out.filter((c) => c.finalAction === "remove" || c.finalAction === "trim").length;
  return {
    decided: out,
    metrics: {
      targetDensity,
      targetCount,
      actualRemoveBeforeGuard: removeCands.length,
      actualRemoveAfterGuard: finalRemoveCount,
      downgradedToReview: downgradeIds.size,
      cutsPerMinuteBeforeGuard: (removeCands.length / durMin).toFixed(1),
      cutsPerMinuteAfterGuard: (finalRemoveCount / durMin).toFixed(1),
    },
  };
}

function emptyMetrics() {
  return {
    targetDensity: 0,
    targetCount: 0,
    actualRemoveBeforeGuard: 0,
    actualRemoveAfterGuard: 0,
    downgradedToReview: 0,
    cutsPerMinuteBeforeGuard: "0.0",
    cutsPerMinuteAfterGuard: "0.0",
  };
}
