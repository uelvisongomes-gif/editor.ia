// Cut Edge Cleanup — corrige repetições que sobram nas bordas de cortes.
//
// Padrão detectado: quando um corte remove um trecho e a palavra
// IMEDIATAMENTE antes do corte é igual à palavra IMEDIATAMENTE depois,
// o listener escuta a mesma palavra 2x seguidas no seam do jump cut.
//
// Ex do usuário:
//   "...porque FALTA [ideia stretched cortada] FALTA jeito..."
//     ↑ falta antes                            ↑ falta depois
// Resultado auditivo: "porque falta falta jeito" — som duplicado.
//
// Fix: estender o corte pra trás pra engolir a "falta" pré-corte.
// Deixa só uma ocorrência da palavra.
//
// Aplica-se APENAS a REMOVE (não REVIEW nem KEEP). Roda depois do
// wordBoundarySafety pra ter certeza que as bordas já estão em word
// boundaries seguras.

function normalize(w) {
  return (w || "").toLowerCase().replace(/[.,!?;:"'()]/g, "").trim();
}

/**
 * Retorna a última palavra que termina em ou antes de t (com margem).
 */
function wordEndingBefore(t, words, margin = 0.05) {
  let candidate = null;
  for (const w of words) {
    if (w.end <= t + margin) {
      if (!candidate || w.end > candidate.end) candidate = w;
    }
  }
  return candidate;
}

/**
 * Retorna a primeira palavra que começa em ou depois de t (com margem).
 */
function wordStartingAfter(t, words, margin = 0.05) {
  for (const w of words) {
    if (w.start >= t - margin) return w;
  }
  return null;
}

/**
 * Estende um corte pra trás se a palavra antes é igual à palavra depois
 * (repetição no seam). Retorna o cut ajustado.
 */
export function extendCutIfBoundaryRepetition(cut, words) {
  if (!words?.length) return cut;
  const before = wordEndingBefore(cut.start, words);
  const after = wordStartingAfter(cut.end, words);
  if (!before || !after) return cut;
  const nBefore = normalize(before.word);
  const nAfter = normalize(after.word);
  if (!nBefore || nBefore !== nAfter) return cut;
  // Repetição! Estende pra trás pra swallowar a palavra "before".
  return {
    ...cut,
    start: before.start,
    edgeCleanup: {
      extendedFrom: cut.start,
      swallowedWord: before.word,
      reason: "boundary_word_repetition",
    },
  };
}

/**
 * Aplica em array de cuts. Só REMOVE são afetados.
 */
export function cleanupCutEdges(edl, words) {
  if (!edl?.length || !words?.length) return { edl, extensions: 0 };
  let extensions = 0;
  const result = edl.map((e) => {
    if (e.action !== "remove" && e.action !== "trim") return e;
    const adjusted = extendCutIfBoundaryRepetition(e, words);
    if (adjusted.edgeCleanup) extensions += 1;
    return adjusted;
  });
  return { edl: result, extensions };
}
