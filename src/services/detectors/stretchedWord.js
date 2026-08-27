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

// Regra ampla: QUALQUER palavra curta (≤ 5 chars) esticada > 1.7s é
// suspeita. Cobre conectores ("da", "de"), pronomes ("isso", "essa"),
// numerais curtos ("duas", "três"), etc. Confia no heurístico
// "palavra curta demora ~200-400ms" — 1.7s é 5x isso.
const MIN_STRETCH_DUR = 1.7;
const MAX_SHORT_LEN = 5;
const MARGIN = 0.15;

export function detectStretchedWord({ words } = {}) {
  if (!words?.length) return [];
  const out = [];
  for (const w of words) {
    const raw = normalize(w.word);
    if (raw.length > MAX_SHORT_LEN) continue;
    if (raw.length === 0) continue;
    const dur = w.end - w.start;
    if (dur < MIN_STRETCH_DUR) continue;
    const start = w.start + MARGIN;
    const end = w.end - MARGIN;
    if (end - start < 0.5) continue;
    out.push({
      start,
      end,
      confidence: 0.65, // fica em REVIEW, nunca REMOVE
      reason: "low_clarity",
      source: "speechError",
      detectedBy: "heuristic",
      text: `(palavra "${w.word}" com duração incomum — ${dur.toFixed(1)}s. Escute pra ver se tem correção/repetição escondida)`,
    });
  }
  return out;
}
