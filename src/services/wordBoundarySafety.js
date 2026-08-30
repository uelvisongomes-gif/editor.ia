// Word Boundary Safety — garante que NENHUM corte cai no meio de uma
// palavra. Runs on ALL cuts (silêncio, filler, stutter, semântico, etc)
// APÓS a EDL ser construída, ANTES da compilação da timeline.
//
// Contrato: dado um cut {start, end} + words[], ajusta start/end pra
// bater com bordas de palavras vizinhas. Nunca INCLUI palavras válidas
// no corte (só ajusta pras bordas mais próximas SEGURAS).
//
// Convenção "seguro":
//   - start do corte deve estar ≥ w.end de alguma palavra (fim de palavra)
//     OU antes da primeira palavra
//   - end do corte deve estar ≤ w.start de alguma palavra (início de palavra)
//     OU depois da última palavra
//
// Se start cai dentro de uma palavra [w.start, w.end], empurramos:
//   - Se está mais perto de w.end → snap pra w.end (preserva palavra
//     mantendo-a fora do corte)
//   - Se está mais perto de w.start → snap pra w.start (encurta o corte
//     um pouco pra proteger a palavra)
//
// Ajuste é sempre CONSERVADOR: prefere reduzir o corte a expandi-lo.

const DEFAULT_MARGIN = 0.05; // 50ms de tolerância "fora da palavra"

/**
 * Verifica se o timestamp t cai DENTRO de alguma palavra.
 * Retorna a palavra que o contém, ou null.
 */
function wordContaining(t, words, margin = DEFAULT_MARGIN) {
  for (const w of words) {
    if (t > w.start + margin && t < w.end - margin) return w;
  }
  return null;
}

/**
 * Ajusta um único ponto (start ou end de corte) pra fora de qualquer
 * palavra que ele esteja violando.
 *
 * @param {"start"|"end"} kind - se é bordo esquerdo ou direito do corte
 * @returns {{ t: number, adjusted: boolean, snappedTo?: string, word?: string }}
 */
function snapPoint(t, words, kind, margin = DEFAULT_MARGIN) {
  const w = wordContaining(t, words, margin);
  if (!w) return { t, adjusted: false };

  if (kind === "start") {
    // Bordo esquerdo do corte violou palavra `w`. Pra proteger `w`,
    // empurra o start pra w.end (palavra fica FORA do corte, à esquerda).
    return { t: w.end, adjusted: true, snappedTo: "word_end", word: w.word };
  } else {
    // Bordo direito violou. Empurra pra w.start (palavra fica FORA à direita).
    return { t: w.start, adjusted: true, snappedTo: "word_start", word: w.word };
  }
}

/**
 * Aplica safety em UM cut {start, end}.
 * @returns {{ start, end, safety: {startAdjusted, endAdjusted, originalStart, originalEnd, notes: [] } }}
 */
export function snapCutToWordBoundaries(cut, words, opts = {}) {
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const notes = [];
  const originalStart = cut.start;
  const originalEnd = cut.end;

  const s = snapPoint(cut.start, words, "start", margin);
  const e = snapPoint(cut.end, words, "end", margin);

  if (s.adjusted) notes.push(`start snapped ${originalStart.toFixed(3)}→${s.t.toFixed(3)} (palavra "${s.word}" protegida)`);
  if (e.adjusted) notes.push(`end snapped ${originalEnd.toFixed(3)}→${e.t.toFixed(3)} (palavra "${e.word}" protegida)`);

  let start = s.t;
  let end = e.t;

  // Se snap causou start > end, corte se anula (palavra ocupava ele todo).
  if (start >= end) {
    notes.push("corte anulado — inteiramente dentro de palavras válidas");
    return {
      ...cut,
      start: originalStart,
      end: originalStart, // duração 0
      safety: {
        startAdjusted: s.adjusted, endAdjusted: e.adjusted,
        originalStart, originalEnd,
        cancelled: true,
        notes,
      },
    };
  }

  return {
    ...cut,
    start, end,
    safety: {
      startAdjusted: s.adjusted, endAdjusted: e.adjusted,
      originalStart, originalEnd,
      cancelled: false,
      notes,
    },
  };
}

/**
 * Aplica safety em array de cuts. Filtra cortes anulados (duração 0).
 *
 * @param {Array<{start, end, ...}>} cuts
 * @param {Array<{start, end, word}>} words
 * @param {object} [opts]
 * @returns {{ cuts: Array, adjustments: number, cancelled: number }}
 */
export function snapAllCutsToWordBoundaries(cuts, words, opts = {}) {
  if (!cuts?.length || !words?.length) {
    return { cuts: cuts || [], adjustments: 0, cancelled: 0 };
  }
  let adjustments = 0;
  let cancelled = 0;
  const result = [];
  for (const cut of cuts) {
    const snapped = snapCutToWordBoundaries(cut, words, opts);
    if (snapped.safety.cancelled) { cancelled += 1; continue; }
    if (snapped.safety.startAdjusted || snapped.safety.endAdjusted) adjustments += 1;
    result.push(snapped);
  }
  return { cuts: result, adjustments, cancelled };
}

/**
 * Audita cortes já existentes: retorna lista de violations (cortes que
 * caem no meio de palavra) sem alterar nada. Usado pelo QC.
 */
export function auditWordBoundaryViolations(cuts, words, opts = {}) {
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const violations = [];
  for (const cut of cuts || []) {
    const startWord = wordContaining(cut.start, words, margin);
    const endWord = wordContaining(cut.end, words, margin);
    if (startWord) {
      violations.push({
        cut,
        kind: "start_mid_word",
        word: startWord.word,
        t: cut.start,
      });
    }
    if (endWord) {
      violations.push({
        cut,
        kind: "end_mid_word",
        word: endWord.word,
        t: cut.end,
      });
    }
  }
  return violations;
}
