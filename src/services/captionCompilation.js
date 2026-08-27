// Caption Compilation — deriva legendas dos word timestamps E as
// alinha com a EDL (evita legenda dessincronizada depois de cortes).
//
// Duas responsabilidades separadas:
//   1. buildCaptionsFromWords: agrupa palavras em cues (unidade de exibição)
//   2. remapCaptionsToCompiledTime: converte cues do tempo ORIGINAL pro
//      tempo COMPILADO (o que resta depois de aplicar todos os REMOVE)
//
// Regra crítica: legenda cujo intervalo cai dentro de um segmento
// REMOVIDO some (não vira cue no output). Legenda que atravessa borda
// de corte é encolhida ou dividida.

const DEFAULT_MAX_WORDS = 8;
const DEFAULT_PAUSE_GAP = 0.6;

/**
 * Agrupa palavras em cues respeitando: número máximo por cue, gap entre
 * palavras (nova cue quando gap > pauseGap) e fim de frase (.!?).
 * Cada cue carrega `words[]` com timings individuais pra estilos
 * word-highlight/karaokê.
 */
export function buildCaptionsFromWords(words, maxWords = DEFAULT_MAX_WORDS, pauseGap = DEFAULT_PAUSE_GAP) {
  if (!words?.length) return [];
  const cues = [];
  let current = [];
  let cueStart = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (current.length === 0) cueStart = w.start;
    current.push(w);
    const next = words[i + 1];
    const gapToNext = next ? next.start - w.end : Infinity;
    const endsSentence = /[.!?]$/.test((w.word || "").trim());
    if (current.length >= maxWords || gapToNext >= pauseGap || endsSentence || !next) {
      cues.push({
        id: "cap-" + cues.length,
        start: cueStart,
        end: w.end,
        text: current.map((c) => c.word).join(" ").trim(),
        words: current.map((c) => ({
          word: (c.word || "").replace(/[.,!?;:]$/, ""),
          start: c.start,
          end: c.end,
        })),
      });
      current = [];
    }
  }
  return cues;
}

/**
 * Constrói uma tabela de conversão original→compilado a partir dos
 * segmentos KEEP (deleted=false). Cada intervalo de tempo original tem
 * um offset acumulado que representa quanto tempo foi removido antes
 * dele.
 *
 * @param {Array<{start:number,end:number,deleted:boolean}>} segments
 * @returns {Array<{origStart:number,origEnd:number,offset:number}>}
 */
function buildOriginalToCompiledMap(segments) {
  if (!segments?.length) return [];
  const map = [];
  let removed = 0;
  for (const seg of segments) {
    if (seg.deleted) {
      removed += seg.end - seg.start;
      continue;
    }
    map.push({
      origStart: seg.start,
      origEnd: seg.end,
      offset: removed,
    });
  }
  return map;
}

/**
 * Converte um instante original em compilado. Se o instante cai dentro
 * de um segmento REMOVIDO, retorna null (o instante não existe no
 * compilado).
 */
export function origToCompiled(map, tOrig) {
  for (const m of map) {
    if (tOrig >= m.origStart && tOrig <= m.origEnd) {
      return tOrig - m.offset;
    }
  }
  return null;
}

/**
 * Remapa cues do tempo ORIGINAL pro tempo COMPILADO respeitando a EDL.
 * Uma cue pode:
 *   - Sumir completamente (cai inteira dentro de segmento REMOVIDO)
 *   - Encolher (borda cai em segmento removido)
 *   - Ser dividida (atravessa segmento removido no meio) → vira 2 cues
 *
 * @param {Array<{id,start,end,text,words}>} cues
 * @param {Array<{start,end,deleted}>} segments
 * @returns {Array<cue>} cues com tempos compilados
 */
export function remapCaptionsToCompiledTime(cues, segments) {
  if (!cues?.length) return [];
  if (!segments?.length) return cues.slice();
  const keepMap = buildOriginalToCompiledMap(segments);
  if (!keepMap.length) return [];

  const result = [];
  for (const cue of cues) {
    // Interseção da cue com cada segmento KEEP. Cada interseção vira
    // uma sub-cue com tempo compilado calculado.
    const parts = [];
    for (const m of keepMap) {
      const overlapStart = Math.max(cue.start, m.origStart);
      const overlapEnd = Math.min(cue.end, m.origEnd);
      if (overlapEnd - overlapStart <= 0.01) continue;
      const compStart = overlapStart - m.offset;
      const compEnd = overlapEnd - m.offset;
      // Filtra as palavras que caem dentro dessa interseção
      const wordsInPart = (cue.words || [])
        .filter((w) => w.end > overlapStart && w.start < overlapEnd)
        .map((w) => ({
          word: w.word,
          start: Math.max(overlapStart, w.start) - m.offset,
          end: Math.min(overlapEnd, w.end) - m.offset,
        }));
      parts.push({
        id: `${cue.id}${parts.length ? "-" + parts.length : ""}`,
        start: compStart,
        end: compEnd,
        text: wordsInPart.length ? wordsInPart.map((w) => w.word).join(" ") : cue.text,
        words: wordsInPart,
      });
    }
    result.push(...parts);
  }
  return result;
}

/**
 * Pipeline completo: words + segments → cues em tempo compilado.
 */
export function compileCaptions(words, segments, opts = {}) {
  const cues = buildCaptionsFromWords(words, opts.maxWords, opts.pauseGap);
  return remapCaptionsToCompiledTime(cues, segments);
}
