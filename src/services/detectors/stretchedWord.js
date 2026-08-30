// StretchedWord — palavra funcional MUITO esticada (>2s) na transcrição.
// Palavras como "da", "de", "que", "o" tocam ~200ms em fala fluente.
// Quando Whisper devolve 2s+ pra uma delas, ele escondeu algo:
//   - autocorreção do apresentador
//   - repetição de palavras
//   - silêncio no meio da frase
//
// NUNCA marca como REMOVE — sempre REVIEW (confidence 0.65). Usuário
// escuta o trecho e decide se é lixo ou fala real.

import { normalize } from "./_shared.js";

// Regras de dur/comprimento:
//   - Palavras curtas (≤5 chars): >1.5s é suspeito
//     ("da","de","é","que","o" tocam ~200-400ms normal — 1.5s é 4x isso).
//   - Palavras médias/longas (>5 chars): >1.7s é suspeito
//     (pega "mediador" 1.74s, "sacrificar" 2.06s — casos reais de
//      emphasize "ÉEE" que Whisper baked into a palavra vizinha).
const MIN_STRETCH_SHORT = 1.5;
const MIN_STRETCH_LONG = 1.7;
const SHORT_LEN_CUTOFF = 5;
const MARGIN = 0.15;

export function detectStretchedWord({ words } = {}) {
  if (!words?.length) return [];
  const out = [];
  for (const w of words) {
    const raw = normalize(w.word);
    if (raw.length === 0) continue;
    const dur = w.end - w.start;
    const threshold = raw.length <= SHORT_LEN_CUTOFF ? MIN_STRETCH_SHORT : MIN_STRETCH_LONG;
    if (dur < threshold) continue;
    const start = w.start + MARGIN;
    const end = w.end - MARGIN;
    if (end - start < 0.5) continue;
    // Confiança escala com quanto passou do threshold. Palavras muito
    // esticadas (>2.5s) são quase certeza de repetição/correção escondida.
    //   1.5-2.0s → 0.68 (REVIEW)
    //   2.0-2.5s → 0.75 (REVIEW)
    //   2.5-3.0s → 0.85 (AUTO-CUT)
    //   3.0-4.0s → 0.90-0.94 (AUTO-CUT alta confiança)
    let confidence;
    if (dur < 2.0) confidence = 0.68;
    else if (dur < 2.5) confidence = 0.75;
    else if (dur < 3.0) confidence = 0.85;
    else confidence = Math.min(0.94, 0.90 + (dur - 3.0) * 0.04);
    out.push({
      start,
      end,
      confidence,
      reason: "low_clarity",
      source: "speechError",
      detectedBy: "heuristic",
      text: `(palavra "${w.word}" com duração incomum — ${dur.toFixed(1)}s. Provavelmente repetição/correção escondida)`,
    });
  }
  return out;
}
