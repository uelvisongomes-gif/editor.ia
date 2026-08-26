// Detector determinístico de erros de fala. Roda em PARALELO com o LLM
// como rede de segurança: garante que padrões óbvios (gagueira imediata,
// "não pera", muletas em cadeia) sejam pegos mesmo quando o LLM devolve
// [] — o que aconteceu em teste real quando o prompt ficou conservador
// demais ou quando a transcrição já normalizou parte do erro.
//
// Não substitui o LLM (que entende contexto e autocorreções mais sutis):
// entrega candidatos DUPLICADOS que o merger da EDL vai dedupar por
// overlap. Prefere errar pra mais.

// Muletas que quando aparecem 3+ vezes seguidas sinalizam hesitação.
const FILLER_WORDS = new Set([
  "é", "eh", "ah", "hum", "hmm", "uh", "uhm", "tipo", "tá",
  "né", "sei", "então", "aí",
]);

// Frases curtas de auto-interrupção. Se aparecerem, o trecho DO INÍCIO da
// sentença até essa marca é uma tentativa abandonada.
const RESTART_MARKERS = [
  ["não", "pera"],
  ["não", "espera"],
  ["não", "peraí"],
  ["pera", "aí"],
  ["peraí"],
  ["não", "é"],           // "não é isso, é aquilo"
  ["deixa", "eu", "ver"],
  ["deixa", "eu", "pensar"],
  ["deixa", "eu", "refazer"],
  ["esquece", "isso"],
  ["esquece", "o", "que"],
  ["vou", "refazer"],
  ["vamos", "de", "novo"],
  ["vou", "começar", "de", "novo"],
  ["vou", "recomeçar"],
  ["recomeça"],
  ["ai", "meu", "deus"],  // frequentemente sinal de trava/erro
  ["puta", "que", "pariu"],
  ["caraca"],
];

function normalize(w) {
  return (w || "").toLowerCase().replace(/[.,!?;:"'()]/g, "").trim();
}

/**
 * @param {Array<{word:string,start:number,end:number}>} words
 * @returns {Array<{start:number,end:number,confidence:number,reason:string,source:'speechError',text:string}>}
 */
export function detectSpeechErrorsHeuristic(words) {
  if (!words?.length) return [];
  const norm = words.map((w) => normalize(w.word));
  const results = [];

  // 1) Repetição imediata de PALAVRA idêntica ("eu eu", "vou vou", "e e").
  //    Aceita repetições exatas — vale a partir de 2 iguais em sequência.
  {
    let i = 0;
    while (i < words.length - 1) {
      let j = i + 1;
      while (j < words.length && norm[j] === norm[i] && norm[i]) j++;
      const repeats = j - i;
      // Só marca a partir da segunda ocorrência quando é uma palavra
      // curta (< 6 chars) e curta em duração (< 0.6s cada).
      if (repeats >= 2 && norm[i].length > 0 && norm[i].length <= 6) {
        // Removemos as REPETIÇÕES, deixando a última.
        const start = words[i].start;
        const end = words[j - 2].end; // até a penúltima; a última fica.
        if (end > start + 0.02) {
          results.push({
            start, end,
            confidence: 0.88,
            reason: "stutter",
            source: "speechError",
            text: words.slice(i, j - 1).map((w) => w.word).join(" "),
          });
        }
        i = j - 1;
      } else {
        i += 1;
      }
    }
  }

  // 2) Cadeia de 3+ muletas dentro de uma janela curta (5s).
  //    Rastreia o índice do ÚLTIMO filler dentro da janela — o corte
  //    termina nele, não em uma palavra de conteúdo próxima.
  {
    let i = 0;
    while (i < words.length) {
      if (FILLER_WORDS.has(norm[i])) {
        let count = 1;
        let lastFillerIdx = i;
        let j = i + 1;
        while (j < words.length && words[j].start - words[i].start < 5.0) {
          if (FILLER_WORDS.has(norm[j])) {
            count += 1;
            lastFillerIdx = j;
          }
          j += 1;
        }
        if (count >= 3) {
          const start = words[i].start;
          const end = words[lastFillerIdx].end;
          results.push({
            start, end,
            confidence: 0.7,
            reason: "filler",
            source: "speechError",
            text: words.slice(i, lastFillerIdx + 1).map((w) => w.word).join(" "),
          });
          i = lastFillerIdx + 1;
          continue;
        }
      }
      i += 1;
    }
  }

  // 3) Marcadores de reinício ("não pera", "peraí"). Removemos DO início
  //    da sentença corrente até o final do marcador — a próxima sentença
  //    é a versão correta que fica.
  for (let i = 0; i <= words.length - 1; i++) {
    for (const marker of RESTART_MARKERS) {
      if (i + marker.length > words.length) continue;
      let match = true;
      for (let k = 0; k < marker.length; k++) {
        if (norm[i + k] !== marker[k]) { match = false; break; }
      }
      if (!match) continue;

      // Volta procurando o começo da sentença atual: um "." ou vírgula
      // pesada, ou o início dos words.
      let sentStart = 0;
      for (let k = i - 1; k >= Math.max(0, i - 40); k--) {
        const raw = words[k]?.word || "";
        if (/[.!?]$/.test(raw)) { sentStart = k + 1; break; }
      }
      const startTime = words[sentStart].start;
      const endTime = words[i + marker.length - 1].end;
      const wordCount = (i + marker.length) - sentStart;
      // Cap: mesma regra dos 20 palavras — se for enorme, provavelmente
      // não é reinício, é conteúdo real com um "pera" no meio.
      if (wordCount <= 20 && endTime > startTime + 0.05) {
        results.push({
          start: startTime, end: endTime,
          confidence: 0.85,
          reason: "abandoned_phrase",
          source: "speechError",
          text: words.slice(sentStart, i + marker.length).map((w) => w.word).join(" "),
        });
      }
      break; // não checa outros marcadores na mesma posição
    }
  }

  // 4) Reinício de frase sem marcador: duas sentenças consecutivas que
  //    começam com as mesmas 2-3 palavras (ex: "Hoje eu vou mostrar. Hoje
  //    eu vou ensinar."). Marca a primeira como abandoned_phrase.
  {
    // Split em "sentenças" grosseiras por ponto final, ? ou !.
    const sentences = [];
    let cur = [];
    let curStart = 0;
    for (let i = 0; i < words.length; i++) {
      if (cur.length === 0) curStart = i;
      cur.push(i);
      const raw = words[i].word || "";
      if (/[.!?]$/.test(raw) || i === words.length - 1) {
        sentences.push({ startIdx: curStart, endIdx: i });
        cur = [];
      }
    }
    for (let s = 0; s < sentences.length - 1; s++) {
      const a = sentences[s];
      const b = sentences[s + 1];
      const aLen = a.endIdx - a.startIdx + 1;
      const bLen = b.endIdx - b.startIdx + 1;
      // Só considera se ambas curtas (<=15 palavras) e o gap entre elas < 2s.
      if (aLen > 15 || bLen > 15) continue;
      const gap = words[b.startIdx].start - words[a.endIdx].end;
      if (gap > 2.0) continue;
      // Compara as N primeiras palavras (N = min(3, aLen, bLen)).
      const n = Math.min(3, aLen, bLen);
      if (n < 2) continue;
      let same = true;
      for (let k = 0; k < n; k++) {
        if (norm[a.startIdx + k] !== norm[b.startIdx + k]) { same = false; break; }
      }
      if (!same) continue;
      // Marca a primeira sentença inteira como reinício.
      results.push({
        start: words[a.startIdx].start,
        end: words[a.endIdx].end,
        confidence: 0.85,
        reason: "false_start",
        source: "speechError",
        text: words.slice(a.startIdx, a.endIdx + 1).map((w) => w.word).join(" "),
      });
      s += 1; // pula a segunda pra não re-analisar
    }
  }

  return results;
}
