// Pre-roll: chiado/ruído + fillers no início do vídeo.
// Absorve as PRIMEIRAS palavras se forem fillers/hesitações — assim o
// vídeo começa direto no conteúdo, não em "É... Bom,...".

import { FILLER_WORDS, STANDALONE_HESITATIONS, ELONG_FILLERS, normalize } from "./_shared.js";

const PRE_ROLL_MARGIN = 0.15;
const MIN_PRE_ROLL = 0.5;
const MAX_ABSORB_WINDOW = 4.0; // não absorve fillers depois de 4s do início

function isOpenerFiller(word) {
  const raw = normalize(word.word);
  if (FILLER_WORDS.has(raw)) return true;
  if (STANDALONE_HESITATIONS.has(raw)) return true;
  if (ELONG_FILLERS.has(raw)) return true;
  // Elongado: palavra 1-3 chars com duração > 0.4s
  if (raw.length <= 3 && (word.end - word.start) > 0.4) return true;
  // Repetição de letras ("éee", "aah")
  if (/([aeiouâéíóúãhm])\1{2,}/i.test(word.word || "")) return true;
  return false;
}

export function detectPreRoll({ words } = {}) {
  if (!words?.length) return [];
  const first = words[0];

  // Absorve fillers iniciais mesmo que o vídeo tenha pouco pre-roll.
  // Ex: primeira palavra é "É..." em 0.2s — não tem pre-roll de ruído
  // mas o "É..." é filler e deve entrar.
  let cutEnd = first.start - PRE_ROLL_MARGIN;
  let absorbedIdx = -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.start > MAX_ABSORB_WINDOW) break;
    if (!isOpenerFiller(w)) break;
    absorbedIdx = i;
    cutEnd = w.end;
  }

  const hasPreRollGap = first.start >= MIN_PRE_ROLL + PRE_ROLL_MARGIN;
  const absorbed = absorbedIdx >= 0;

  if (!hasPreRollGap && !absorbed) return [];

  // Se absorveu fillers, o cut vai de 0 até um pouco depois da última
  // palavra filler (com pequena margem pra respirar).
  if (absorbed) {
    // Margem pequena antes da próxima palavra de conteúdo
    const nextContent = words[absorbedIdx + 1];
    if (nextContent) {
      cutEnd = Math.min(cutEnd + 0.10, nextContent.start - 0.10);
    }
    return [{
      start: 0,
      end: cutEnd,
      confidence: 0.92,
      reason: "no_speech",
      source: "speechError",
      detectedBy: "heuristic",
      text: `(início sem conteúdo — pre-roll + ${absorbedIdx + 1} fillers)`,
    }];
  }

  // Só pre-roll puro (nenhum filler absorvido)
  return [{
    start: 0,
    end: first.start - PRE_ROLL_MARGIN,
    confidence: 0.92,
    reason: "no_speech",
    source: "speechError",
    detectedBy: "heuristic",
    text: "(pre-roll sem fala — ruído/ambiente)",
  }];
}
