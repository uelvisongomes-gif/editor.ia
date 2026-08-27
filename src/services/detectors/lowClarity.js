// Low Clarity — palavras que provavelmente NÃO foram ditas claramente.
// Não corta automaticamente: sinaliza como SUGESTÃO pra revisão manual.
// Confidence deliberadamente entre reviewThreshold (0.60) e
// executeThreshold (0.80) — cai na banda REVIEW, não REMOVE.
//
// Heurísticas:
//   - Palavra com duração < 20ms (Whisper está chutando)
//   - Palavra com duração zero (start == end)
//   - Palavras seguidas com start/end colapsados no mesmo instante
//     (Whisper enfileirou várias no mesmo timestamp — normalmente
//     porque não conseguiu separar acusticamente)
//
// Agrupa palavras suspeitas consecutivas em uma única sugestão.

const TINY_DUR = 0.020;
const CLARITY_CONF = 0.65;   // fica na banda REVIEW, nunca REMOVE

export function detectLowClarity({ words } = {}) {
  if (!words?.length) return [];
  const out = [];
  let runStart = null;
  let runEnd = null;
  let runWords = [];

  const flushRun = () => {
    if (runStart == null || !runWords.length) return;
    // Ignora runs de 1 palavra curta isolada — pouco informativo pro
    // usuário; só sugere quando são 2+ suspeitas em sequência OU 1
    // palavra suspeita rodeada de pausas.
    if (runWords.length < 2) {
      runStart = null; runEnd = null; runWords = [];
      return;
    }
    out.push({
      start: runStart,
      end: runEnd,
      confidence: CLARITY_CONF,
      reason: "low_clarity",
      source: "speechError",
      detectedBy: "heuristic",
      text: `(fala pouco clara — ${runWords.map((w) => w.word).join(" ")})`,
    });
    runStart = null; runEnd = null; runWords = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const dur = w.end - w.start;
    const next = words[i + 1];
    const nextCollapsed = next && Math.abs(next.start - w.start) < 0.01 && Math.abs(next.end - w.end) < 0.01;
    const isSuspect = dur < TINY_DUR || nextCollapsed;

    if (isSuspect) {
      if (runStart == null) runStart = w.start;
      runEnd = w.end;
      runWords.push(w);
    } else if (runStart != null) {
      flushRun();
    }
  }
  flushRun();
  return out;
}
