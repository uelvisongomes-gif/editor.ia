// Speech Activity — camada VAD (Voice Activity Detection) determinística.
// Não confunde silêncio com ausência de fala. Um intervalo pode ter
// ENERGIA de áudio (respiração, chiado, ruído ambiente, som de boca) e
// mesmo assim NÃO ter fala útil.
//
// Classifica cada timeslot (~100ms) em uma de 3 categorias:
//   SPEECH       — palavra transcrita cobre o timeslot
//   NO_SPEECH    — sem palavra E sem energia significativa
//   UNCERTAIN    — sem palavra MAS com energia (candidato a filler/hesitação
//                  ou ruído; quem decide se é filler é outro detector)
//
// Combina três fontes:
//   1. Word timestamps (do transcriber)
//   2. Gaps entre palavras
//   3. Waveform (níveis de amplitude por bin)
//
// Não depende SÓ do waveform (amplitude zero) — inclui a evidência dos
// word timestamps.

export const SpeechState = Object.freeze({
  SPEECH: "SPEECH",
  NO_SPEECH: "NO_SPEECH",
  UNCERTAIN: "UNCERTAIN",
});

const DEFAULTS = {
  slotSec: 0.1,           // resolução de 100ms
  wordEdgeMarginSec: 0.05,// tolerância pra "palavra cobre o slot"
  silenceLevel: 0.025,    // abaixo disso o waveform é considerado silêncio
  mergeMinDurSec: 0.15,   // segmentos menores que isso são absorvidos no vizinho
};

/**
 * Constrói uma linha de atividade de fala para o vídeo inteiro.
 *
 * @param {object} args
 * @param {Array<{word:string,start:number,end:number}>} args.words
 * @param {Array<{start:number,end:number,level:number}>} [args.waveform]
 * @param {number} args.duration - duração total do vídeo (segundos)
 * @param {object} [args.config] - override de defaults
 * @returns {{
 *   slots: Array<{start:number,end:number,state:string}>,
 *   segments: Array<{start:number,end:number,state:string}>,
 * }}
 */
export function buildSpeechActivity({ words, waveform, duration, config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  if (!Number.isFinite(duration) || duration <= 0) {
    return { slots: [], segments: [] };
  }

  const totalSlots = Math.ceil(duration / cfg.slotSec);
  const slots = new Array(totalSlots);

  // Pré-calcula cobertura por word — pra cada slot, se qualquer palavra
  // cai dentro (com margem) → SPEECH.
  const wordCovers = (t) => {
    if (!words?.length) return false;
    for (const w of words) {
      if (t >= w.start - cfg.wordEdgeMarginSec && t < w.end + cfg.wordEdgeMarginSec) {
        return true;
      }
    }
    return false;
  };

  // Pré-calcula nível de energia no timeslot (média dos bins que caem
  // dentro). Sem waveform, todos os slots sem-palavra viram NO_SPEECH
  // (fallback conservador — melhor não sinalizar UNCERTAIN se não temos
  // evidência de energia).
  const energyAt = (start, end) => {
    if (!waveform?.length) return null;
    let sum = 0, count = 0;
    for (const b of waveform) {
      if (b.end <= start) continue;
      if (b.start >= end) break;
      const overlap = Math.min(b.end, end) - Math.max(b.start, start);
      if (overlap > 0) {
        sum += b.level;
        count += 1;
      }
    }
    return count ? sum / count : 0;
  };

  for (let i = 0; i < totalSlots; i++) {
    const s = i * cfg.slotSec;
    const e = Math.min((i + 1) * cfg.slotSec, duration);
    const mid = (s + e) / 2;
    if (wordCovers(mid)) {
      slots[i] = { start: s, end: e, state: SpeechState.SPEECH };
      continue;
    }
    const energy = energyAt(s, e);
    if (energy == null || energy < cfg.silenceLevel) {
      slots[i] = { start: s, end: e, state: SpeechState.NO_SPEECH };
    } else {
      slots[i] = { start: s, end: e, state: SpeechState.UNCERTAIN };
    }
  }

  return { slots, segments: compactSlots(slots, cfg) };
}

/**
 * Reduz uma sequência de slots em runs contínuos por estado. Runs muito
 * curtos (< mergeMinDurSec) são absorvidos pelo vizinho de maior duração
 * — evita microestados no meio de fala fluida por causa de ruído de bin.
 */
function compactSlots(slots, cfg) {
  if (!slots.length) return [];
  const merged = [];
  for (const slot of slots) {
    const last = merged[merged.length - 1];
    if (last && last.state === slot.state) {
      last.end = slot.end;
    } else {
      merged.push({ ...slot });
    }
  }
  // Absorve runs curtos no vizinho de estado mais "confiável".
  // Ordem de confiança: SPEECH > NO_SPEECH > UNCERTAIN.
  const CONFIDENCE = { SPEECH: 3, NO_SPEECH: 2, UNCERTAIN: 1 };
  const cleaned = [];
  for (let i = 0; i < merged.length; i++) {
    const seg = merged[i];
    const dur = seg.end - seg.start;
    if (dur < cfg.mergeMinDurSec && (i > 0 || i < merged.length - 1)) {
      const prev = cleaned[cleaned.length - 1];
      const next = merged[i + 1];
      const prevScore = prev ? CONFIDENCE[prev.state] : -1;
      const nextScore = next ? CONFIDENCE[next.state] : -1;
      if (prevScore >= nextScore && prev) {
        prev.end = seg.end;
        continue;
      }
      if (next) {
        next.start = seg.start;
        continue;
      }
    }
    cleaned.push({ ...seg });
  }
  return cleaned;
}

/**
 * Retorna o estado de fala em um instante t. Se não achar, assume
 * UNCERTAIN.
 */
export function stateAt(activity, t) {
  if (!activity?.segments?.length) return SpeechState.UNCERTAIN;
  for (const seg of activity.segments) {
    if (t >= seg.start && t < seg.end) return seg.state;
  }
  return SpeechState.UNCERTAIN;
}

/**
 * Retorna todos os intervalos contínuos de um estado dado (SPEECH,
 * NO_SPEECH ou UNCERTAIN). Útil pra:
 *   - Encontrar dead air candidato a cut
 *   - Identificar regiões UNCERTAIN pra filler detection
 *   - Detectar pre-roll (NO_SPEECH antes da primeira SPEECH)
 */
export function regionsOf(activity, state) {
  if (!activity?.segments?.length) return [];
  return activity.segments.filter((s) => s.state === state);
}

/**
 * Encontra o primeiro instante SPEECH — útil pra pre-roll trimming.
 */
export function firstSpeechStart(activity) {
  if (!activity?.segments?.length) return 0;
  const first = activity.segments.find((s) => s.state === SpeechState.SPEECH);
  return first ? first.start : 0;
}
