// Cut Edge Cleanup — corrige repetições que sobram nas bordas de cortes.
//
// Padrão A (repetição no seam):
//   "...porque FALTA [ideia stretched cortada] FALTA jeito..."
//     ↑ falta antes                            ↑ falta depois
//   Auditivo: "porque falta falta jeito" — soa duplicado.
//   Fix: estende REMOVE pra trás pra swallowar a "falta" antes,
//   E encolhe o KEEP anterior pro novo start (evita overlap).
//
// Padrão B (frase abandonada antes do cut):
//   "...é PORQUE [...corte de hesitação...] Então..."
//   Se a palavra antes do corte tem "..." (Whisper marca com ellipsis
//   frases interrompidas) OU é uma conjunção incompleta, também
//   estende pra tras pra engolir ela.

const INCOMPLETE_MARKERS = /\.\.\.$/;

// Palavras que quando ficam pendentes antes de um cut viram frase
// abandonada auditiva (usuário ouve "mas o problema é porque..." sem
// continuação).
const ORPHAN_CONNECTORS = new Set([
  "porque", "porém", "que", "e", "mas", "então", "aí", "daí",
  "quando", "se", "porque...", "então...", "mas...",
]);

function normalize(w) {
  return (w || "").toLowerCase().replace(/[.,!?;:"'()]/g, "").trim();
}

function rawWord(w) {
  return (w || "").trim();
}

function wordEndingBefore(t, words, margin = 0.05) {
  let candidate = null;
  for (const w of words) {
    if (w.end <= t + margin) {
      if (!candidate || w.end > candidate.end) candidate = w;
    }
  }
  return candidate;
}

function wordStartingAfter(t, words, margin = 0.05) {
  for (const w of words) {
    if (w.start >= t - margin) return w;
  }
  return null;
}

/**
 * Decide se o corte deve ser estendido pra trás e retorna o novo start.
 * Retorna { newStart, reason, swallowedWord } ou null se não deve estender.
 */
function decideExtensionBackward(cut, words) {
  const before = wordEndingBefore(cut.start, words);
  const after = wordStartingAfter(cut.end, words);
  if (!before) return null;

  const rBefore = rawWord(before.word);
  const nBefore = normalize(before.word);
  const nAfter = after ? normalize(after.word) : "";

  // Padrão A: repetição no seam
  if (nAfter && nBefore === nAfter) {
    return { newStart: before.start, reason: "boundary_word_repetition", swallowedWord: before.word };
  }
  // Padrão B: palavra antes do cut é conector abandonado ("porque...", "mas")
  // OU tem ellipsis marcando frase interrompida
  if (ORPHAN_CONNECTORS.has(nBefore) || INCOMPLETE_MARKERS.test(rBefore)) {
    // Pega até a palavra ANTES desse conector (encolhe o KEEP mais).
    const prevWord = wordEndingBefore(before.start - 0.01, words);
    // Se prevWord também for conector abandonado, sobe mais uma
    let target = before;
    const chainLimit = 3;
    let p = prevWord; let count = 0;
    while (p && count < chainLimit && (ORPHAN_CONNECTORS.has(normalize(p.word)) || INCOMPLETE_MARKERS.test(rawWord(p.word)))) {
      target = p;
      p = wordEndingBefore(p.start - 0.01, words);
      count += 1;
    }
    // Se target ainda é a palavra imediatamente antes, mas ela é
    // abandonada, precisamos ir pelo menos 1 palavra atrás pra remover
    // o abandono. Se target === before, retorna null (nada a fazer).
    // Caso contrário estende pra trás.
    if (target !== before || ORPHAN_CONNECTORS.has(nBefore)) {
      return {
        newStart: target.start,
        reason: "abandoned_connector_before_cut",
        swallowedWord: `${rawWord(target.word)}...${rBefore}`,
      };
    }
  }
  return null;
}

/**
 * Aplica cleanup em array de EDL, ajustando REMOVE E o KEEP anterior
 * pra ficar sem sobreposição.
 */
export function cleanupCutEdges(edl, words) {
  if (!edl?.length || !words?.length) return { edl, extensions: 0 };
  const sorted = [...edl].sort((a, b) => a.start - b.start);
  let extensions = 0;

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur.action !== "remove" && cur.action !== "trim") continue;
    const decision = decideExtensionBackward(cur, words);
    if (!decision) continue;
    // Safety margin: recua 30ms antes do início da palavra swallowada.
    // Garante que nem 1 frame de áudio da palavra que deveria sumir
    // vaze pro KEEP (fonema inicial da palavra tende a começar 20-50ms
    // antes do "start" oficial que o Whisper reporta).
    const SAFETY_MARGIN = 0.03;
    const effectiveStart = Math.max(0, decision.newStart - SAFETY_MARGIN);
    // Estende o REMOVE pra trás
    const originalStart = cur.start;
    cur.start = effectiveStart;
    cur.edgeCleanup = {
      extendedFrom: originalStart,
      reason: decision.reason,
      swallowedWord: decision.swallowedWord,
      safetyMargin: SAFETY_MARGIN,
    };
    extensions += 1;
    // Ajusta o KEEP anterior pra terminar no novo start (evita overlap)
    for (let j = i - 1; j >= 0; j--) {
      const prev = sorted[j];
      if (prev.action === "keep" && prev.end > effectiveStart) {
        prev.end = effectiveStart;
        if (prev.end <= prev.start + 0.02) prev._voidKeep = true;
      } else if (prev.end <= effectiveStart) {
        break;
      }
    }
  }

  // Remove KEEPs anulados
  const filtered = sorted.filter((e) => !e._voidKeep);

  // Segunda passada: TIGHTEN — estende bordas do REMOVE pro máximo espaço
  // vazio disponível ao lado. Se a última palavra REAL antes do REMOVE
  // termina em 14.00 e o REMOVE começa em 14.10 (com 100ms de silêncio
  // entre eles), estende REMOVE.start pra 14.03 (30ms depois da palavra).
  // Do outro lado: se REMOVE.end é 27.15 e próxima palavra começa em 27.30,
  // estende REMOVE.end pra 27.27 (30ms antes da palavra).
  //
  // Isso engole hesitações inaudíveis ("haaaa" residual, sons de boca,
  // respiração) que o Whisper não transcreveu mas que ainda vazam no
  // seam do corte causando "chatice auditiva".
  const TIGHTEN_MARGIN = 0.03;
  let tightened = 0;
  for (const cut of filtered) {
    if (cut.action !== "remove" && cut.action !== "trim") continue;
    const prevWord = wordEndingBefore(cut.start, words);
    const nextWord = wordStartingAfter(cut.end, words);
    // Encolhe pra trás: se há silêncio entre prevWord.end e cut.start, come.
    if (prevWord && prevWord.end < cut.start - TIGHTEN_MARGIN) {
      const oldStart = cut.start;
      cut.start = prevWord.end + TIGHTEN_MARGIN;
      cut._tightenedStart = { from: oldStart, to: cut.start };
      tightened += 1;
    }
    // Estende pra frente: se há silêncio entre cut.end e nextWord.start, come.
    if (nextWord && nextWord.start > cut.end + TIGHTEN_MARGIN) {
      const oldEnd = cut.end;
      cut.end = nextWord.start - TIGHTEN_MARGIN;
      cut._tightenedEnd = { from: oldEnd, to: cut.end };
      tightened += 1;
    }
  }
  // Se REMOVE ficou colado num KEEP e KEEP começa antes, avança KEEP.start
  // pra igualar o novo REMOVE.end. Evita overlap invertido.
  const sortedByStart = [...filtered].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sortedByStart.length - 1; i++) {
    const cur = sortedByStart[i];
    const nxt = sortedByStart[i + 1];
    if ((cur.action === "remove" || cur.action === "trim") &&
        nxt.action === "keep" && nxt.start < cur.end) {
      nxt.start = cur.end;
      if (nxt.end <= nxt.start + 0.02) nxt._voidKeep = true;
    }
  }

  const finalOut = filtered.filter((e) => !e._voidKeep);
  return { edl: finalOut, extensions, tightened };
}
