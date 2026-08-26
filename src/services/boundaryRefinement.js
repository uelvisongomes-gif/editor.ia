// MINIMUM NECESSARY CUT.
//
// Detectores semânticos (repeated_idea, off_topic) recebem sentenças
// inteiras como candidatas. Isso é grosso: uma frase de 9s pode conter
// só 1,5s de erro real. Este módulo tenta, ANTES da EDL, encolher o
// intervalo pro subtrecho realmente problemático usando word timestamps.
//
// Estratégia (deterministica, sem LLM):
//   1. Pega as palavras do candidato.
//   2. Procura padrões que sinalizem o INÍCIO real do problema
//      (marcadores de reinício, muleta seguida de pausa, "porque X porque").
//   3. Se encontrar → refina start/end pra janela mínima.
//   4. Se NÃO encontrar → NÃO corta o segmento inteiro; degrada para
//      review com bandeira boundary_uncertain — o usuário decide manual.
//
// A saída marca cutStart/cutEnd separados de candidateStart/candidateEnd
// para a UI mostrar "REGIÃO ANALISADA" vs "CORTE SUGERIDO".

const RESTART_MARKERS_2W = [
  ["não", "pera"], ["não", "espera"], ["não", "é"],
  ["pera", "aí"], ["vou", "refazer"], ["esquece", "isso"],
  ["deixa", "eu"], ["quer", "dizer"], ["na", "verdade"],
];
const RESTART_MARKERS_1W = ["peraí", "recomeça", "espera", "corta", "errei", "melhor"];
const FILLER_1W = new Set(["é", "eh", "ah", "hum", "hmm", "uh", "tipo", "né", "então", "aí"]);

function normalize(w) {
  return (w || "").toLowerCase().replace(/[.,!?;:"'()]/g, "").trim();
}

/**
 * Tenta refinar o intervalo de um candidato semântico para o subtrecho
 * problemático real.
 * @returns {{ ok: boolean, cutStart?: number, cutEnd?: number, reason?: string, note?: string }}
 */
export function refineBoundary({ candidate, words }) {
  // Só faz sentido pra intervalos maiores que ~2s e pra tipos semânticos.
  const dur = candidate.end - candidate.start;
  if (dur < 2.0) return { ok: true, cutStart: candidate.start, cutEnd: candidate.end, reason: "small_enough" };
  if (!words?.length) return { ok: false, note: "no_word_timestamps" };
  if (candidate.primaryType === "long_pause" || candidate.primaryType === "stutter" || candidate.primaryType === "filler") {
    // Cortes técnicos vêm com bordas já finas — não mexer.
    return { ok: true, cutStart: candidate.start, cutEnd: candidate.end, reason: "technical_intact" };
  }

  const inRange = words.filter((w) => w.start >= candidate.start - 0.05 && w.end <= candidate.end + 0.05);
  if (inRange.length < 3) return { ok: false, note: "too_few_words" };
  const norm = inRange.map((w) => normalize(w.word));

  // Padrão 1: marcador de reinício (2 palavras) dentro do candidato.
  // Corta DO início até o fim do marcador — restante é a versão correta.
  for (let i = 0; i < inRange.length - 1; i++) {
    for (const [a, b] of RESTART_MARKERS_2W) {
      if (norm[i] === a && norm[i + 1] === b) {
        return {
          ok: true,
          cutStart: candidate.start,
          cutEnd: inRange[i + 1].end,
          reason: "restart_marker_2w",
          note: `Marcador "${a} ${b}" encontrado`,
        };
      }
    }
  }
  // Padrão 2: marcador de 1 palavra
  for (let i = 0; i < inRange.length; i++) {
    if (RESTART_MARKERS_1W.includes(norm[i])) {
      return {
        ok: true,
        cutStart: candidate.start,
        cutEnd: inRange[i].end,
        reason: "restart_marker_1w",
        note: `Marcador "${norm[i]}" encontrado`,
      };
    }
  }

  // Padrão 3: repetição imediata de palavra ("porque porque", "eu eu").
  for (let i = 0; i < inRange.length - 1; i++) {
    if (norm[i] && norm[i] === norm[i + 1] && norm[i].length <= 8) {
      return {
        ok: true,
        cutStart: inRange[i].start,
        cutEnd: inRange[i].end,   // remove só a primeira ocorrência
        reason: "immediate_repetition",
        note: `"${norm[i]}" repetido`,
      };
    }
  }

  // Padrão 4: cadeia de fillers (3+ muletas em 3s) — encolhe pra elas.
  for (let i = 0; i < inRange.length; i++) {
    if (!FILLER_1W.has(norm[i])) continue;
    let count = 1;
    let lastFillerIdx = i;
    for (let j = i + 1; j < inRange.length && inRange[j].start - inRange[i].start < 3; j++) {
      if (FILLER_1W.has(norm[j])) { count += 1; lastFillerIdx = j; }
    }
    if (count >= 3) {
      return {
        ok: true,
        cutStart: inRange[i].start,
        cutEnd: inRange[lastFillerIdx].end,
        reason: "filler_chain",
        note: `${count} muletas em sequência`,
      };
    }
  }

  // Padrão 5: repetição de bigrama ("a coisa a coisa", "muito muito importante" só
  // vale quando o bigrama vem imediatamente seguido).
  for (let i = 0; i < inRange.length - 3; i++) {
    if (norm[i] === norm[i + 2] && norm[i + 1] === norm[i + 3]) {
      return {
        ok: true,
        cutStart: inRange[i].start,
        cutEnd: inRange[i + 1].end,
        reason: "bigram_repetition",
        note: `"${norm[i]} ${norm[i + 1]}" repetido`,
      };
    }
  }

  // Sem padrão claro dentro do candidato — não corta o bloco inteiro.
  return { ok: false, note: "no_pattern_found" };
}
