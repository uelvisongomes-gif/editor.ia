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

// Palavras que sozinhas, no INÍCIO do vídeo ou depois de silêncio longo,
// costumam ser trava/hesitação e não conteúdo. "Bom", "Então", "Olha",
// "Assim", "Aí", "Ah", "Bem" — em fala real são reset words.
const STANDALONE_HESITATIONS = new Set([
  "bom", "então", "olha", "assim", "aí", "ah", "bem", "eh", "e", "é",
  "veja", "vejam", "gente", "pessoal",
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
 * @param {{waveform?: Array<{start:number,end:number,level:number}>}} [opts]
 * @returns {Array<{start:number,end:number,confidence:number,reason:string,source:'speechError',text:string}>}
 */
export function detectSpeechErrorsHeuristic(words, { waveform } = {}) {
  if (!words?.length) return [];
  const norm = words.map((w) => normalize(w.word));
  const results = [];

  // 0.PRE) NO_SPEECH INICIAL: se a primeira palavra transcrita começa
  //     depois de N segundos (default 0.8s) e não há nenhuma palavra antes,
  //     o intervalo 0→(primeira palavra - margem) é background/pre-roll
  //     sem fala útil. Diferente de "hesitação inicial" — aqui não é fala,
  //     é ruído/respiração/ambiente. Sempre presente independente de
  //     waveform (não depende de amplitude zero).
  {
    const PRE_ROLL_MARGIN = 0.15;   // deixa 150ms antes da 1ª palavra
    const MIN_PRE_ROLL = 0.5;       // < 0.5s não vale cortar
    if (words.length > 0 && words[0].start >= MIN_PRE_ROLL + PRE_ROLL_MARGIN) {
      results.push({
        start: 0,
        end: words[0].start - PRE_ROLL_MARGIN,
        confidence: 0.92,
        reason: "no_speech",
        source: "speechError",
        detectedBy: "heuristic",
        text: "(pre-roll sem fala — ruído/ambiente)",
      });
    }
  }

  // 0.GAP) GAP ENTRE PALAVRAS COMO SILÊNCIO: quando existe intervalo >= 0.7s
  //      entre o end de uma palavra e o start da próxima, esse gap é
  //      espaço morto — mesmo que haja respiração ou som de boca, não é
  //      conteúdo falado. Cortar deixa a fala mais fluida.
  {
    const MIN_GAP = 0.7;
    const EDGE_MARGIN = 0.1;
    for (let i = 0; i < words.length - 1; i++) {
      const w = words[i];
      const nx = words[i + 1];
      const gap = nx.start - w.end;
      if (gap < MIN_GAP) continue;
      const cutStart = w.end + EDGE_MARGIN;
      const cutEnd = nx.start - EDGE_MARGIN;
      if (cutEnd - cutStart < 0.3) continue;
      results.push({
        start: cutStart,
        end: cutEnd,
        confidence: 0.85,
        reason: "silence",
        source: "speechError",
        detectedBy: "heuristic",
        text: `(pausa entre palavras — ${gap.toFixed(1)}s)`,
      });
    }
  }

  // 0) SOM SEM PALAVRA (waveform + words) — pega "Éeeee...", "aaah",
  //    "hmmmm" que o Whisper suavizou ou pulou. Estratégia:
  //    procuramos janelas do waveform com energia >= threshold que NÃO
  //    têm palavra transcrita dentro (ou têm só palavra muito curta).
  //    Isso vale tanto no INÍCIO do vídeo quanto no MEIO — entre duas
  //    palavras com gap grande mas com áudio ativo.
  if (waveform?.length) {
    const SOUND_LEVEL = 0.03;         // acima disso = tem áudio (não silêncio)
    const MIN_HESIT_DUR = 0.40;       // menos que isso não é hesitação relevante
    // Cria "janelas suspeitas": trechos onde waveform tem som mas não
    // há palavra transcrita cobrindo majoritariamente.
    const wordCovers = (t) => words.some((w) => t >= w.start - 0.05 && t < w.end + 0.05);
    let winStart = null;
    let winCovered = 0; // tempo dentro da janela que já é coberto por palavra
    let winTotal = 0;
    for (let bi = 0; bi < waveform.length; bi++) {
      const b = waveform[bi];
      const hasSound = b.level >= SOUND_LEVEL;
      const covered = wordCovers((b.start + b.end) / 2);
      if (hasSound && !covered) {
        if (winStart == null) winStart = b.start;
        winTotal += (b.end - b.start);
      } else {
        // Fim de janela; considera se qualifica.
        if (winStart != null && winTotal >= MIN_HESIT_DUR) {
          const winEnd = b.start;
          // Confidence maior se for no início do vídeo.
          const conf = winStart < 2 ? 0.9 : 0.78;
          results.push({
            start: winStart,
            end: winEnd,
            confidence: conf,
            reason: "filler",
            source: "speechError",
            detectedBy: "heuristic",
            text: winStart < 2 ? "(hesitação inicial)" : "(som sem palavra)",
          });
        }
        winStart = null;
        winTotal = 0;
      }
    }
    // Fecha janela em aberto (caso o vídeo termine com som pré-palavra)
    if (winStart != null && winTotal >= MIN_HESIT_DUR) {
      results.push({
        start: winStart,
        end: waveform[waveform.length - 1].end,
        confidence: 0.78,
        reason: "filler",
        source: "speechError",
        detectedBy: "heuristic",
        text: "(som sem palavra)",
      });
    }
  }

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
      detectedBy: "heuristic",
            text: words.slice(i, j - 1).map((w) => w.word).join(" "),
          });
        }
        i = j - 1;
      } else {
        i += 1;
      }
    }
  }

  // 1.5) BIGRAM/TRIGRAM repetido — "na maioria na maioria", "eu vou eu vou",
  //      "isso porque isso porque". Pega padrões de 2-3 palavras que se
  //      repetem imediatamente (típico de reinício acidental do apresentador).
  //      Remove a PRIMEIRA ocorrência, deixa a segunda + o resto.
  for (let ngram = 3; ngram >= 2; ngram--) {
    let i = 0;
    while (i <= words.length - ngram * 2) {
      // Checa se palavras [i..i+ngram-1] == palavras [i+ngram..i+ngram*2-1]
      let match = true;
      for (let k = 0; k < ngram; k++) {
        if (!norm[i + k] || norm[i + k] !== norm[i + ngram + k]) { match = false; break; }
      }
      if (match) {
        // Gap entre as duas cópias precisa ser curto (<= 0.5s) — se for
        // longo é reforço retórico ("primeiro X. depois X.")
        const gap = words[i + ngram].start - words[i + ngram - 1].end;
        if (gap <= 0.5) {
          const start = words[i].start;
          const end = words[i + ngram - 1].end;
          if (end > start + 0.05) {
            results.push({
              start, end,
              confidence: 0.88,
              reason: "stutter",
              source: "speechError",
              detectedBy: "heuristic",
              text: words.slice(i, i + ngram).map((w) => w.word).join(" "),
            });
            i += ngram * 2 - 1; // pula a repetição também
            continue;
          }
        }
      }
      i += 1;
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
      detectedBy: "heuristic",
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
      detectedBy: "heuristic",
          text: words.slice(sentStart, i + marker.length).map((w) => w.word).join(" "),
        });
      }
      break; // não checa outros marcadores na mesma posição
    }
  }

  // 3.4) Hesitação PROLONGADA no início da fala: quando o Whisper devolve
  //      uma vogal/muleta curta ("é", "ah", "eh", "um") com DURAÇÃO
  //      anormalmente longa (> 0.45s pra uma palavra de 1-3 letras), é o
  //      típico "Éeeee..." antes da pessoa começar a falar de verdade.
  //      Detecta nos primeiros 5s do vídeo. Também detecta letras
  //      repetidas na transcrição raw ("éee", "ahhh").
  {
    const ELONG_FILLERS = new Set(["é", "eh", "ah", "eee", "ééé", "hum", "hmm", "uhm", "uh", "aaa", "ééé"]);
    const hasElongatedLetters = (raw) => {
      const s = (raw || "").toLowerCase();
      return /([aeiouâéíóúãhm])\1{2,}/i.test(s);
    };
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.start > 5) break; // só no início do vídeo
      const raw = (w.word || "").toLowerCase().replace(/[.,!?;:"'()]/g, "").trim();
      const dur = w.end - w.start;
      const isFiller = ELONG_FILLERS.has(raw) || FILLER_WORDS.has(raw) || raw.length <= 3;
      const isLong = dur >= 0.45;
      const hasElongated = hasElongatedLetters(w.word);
      if ((isFiller && isLong) || hasElongated) {
        const next = words[i + 1];
        const gapAfter = next ? next.start - w.end : Infinity;
        // Só marca se tiver silêncio depois (pausa antes de começar) OU
        // for elongado explícito. Palavra fluida numa frase não conta.
        if (hasElongated || gapAfter >= 0.3) {
          results.push({
            start: w.start,
            end: w.end,
            confidence: hasElongated ? 0.92 : 0.85,
            reason: "filler",
            source: "speechError",
            detectedBy: "heuristic",
            text: w.word,
          });
        }
      }
    }
  }

  // 3.5) Hesitação isolada: palavra "reset" ("Bom", "Então", "Olha") que
  //      aparece SOZINHA cercada por silêncios longos (>= 0.8s antes e/ou
  //      >= 0.8s depois). Padrão típico de trava inicial ou pausa
  //      entre pensamentos. Corta a palavra + o silêncio adjacente que
  //      grudou nela — o silence detector separado pega a parte silenciosa.
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const normW = norm[i];
    if (!STANDALONE_HESITATIONS.has(normW)) continue;
    const prev = words[i - 1];
    const next = words[i + 1];
    const gapBefore = prev ? w.start - prev.end : (w.start >= 0.5 ? Infinity : 0);
    const gapAfter = next ? next.start - w.end : Infinity;
    // Isolamento: precisa estar sozinho de pelo menos um lado por 0.8s+
    // Se tiver silêncio dos DOIS lados, mais confiança.
    const isolatedBefore = gapBefore >= 0.8;
    const isolatedAfter = gapAfter >= 0.8;
    if (!(isolatedBefore || isolatedAfter)) continue;
    // Não marca se a próxima palavra vier logo depois formando frase
    // ("Bom pessoal, vamos lá") — só quando é hesitação real.
    if (gapAfter < 0.4) continue;
    const confidence = isolatedBefore && isolatedAfter ? 0.85 : 0.75;
    results.push({
      start: w.start,
      end: w.end,
      confidence,
      reason: "filler",
      source: "speechError",
      detectedBy: "heuristic",
      text: w.word,
    });
  }

  // 3.6) DEAD ZONE DENTRO DE PALAVRA (Whisper esticou timing pra dentro
  //      de pausa/repetição). Rege pra QUALQUER palavra (funcional ou de
  //      conteúdo) com duração > 1.5s. Usa waveform como evidência dura:
  //      se houver ≥ 500ms de silêncio contínuo DENTRO do timing da
  //      palavra, esse silêncio é o corte candidato. Isso pega:
  //        - palavra funcional ("das") esticada porque escondeu "na maioria"
  //        - palavra de conteúdo ("ideia") esticada porque escondeu pausa
  //        - qualquer outro artefato de timing do Whisper
  //      Sem waveform, não faz nada (evita falsos positivos por chute).
  if (waveform?.length) {
    const SILENCE_LEVEL = 0.025;
    const MIN_HIDDEN_SILENCE = 0.5;
    const MIN_WORD_DUR = 1.5;
    for (const w of words) {
      const dur = w.end - w.start;
      if (dur < MIN_WORD_DUR) continue;
      // Varre bins da waveform dentro do intervalo da palavra e acha o
      // maior run contínuo de silêncio.
      let runStart = null;
      let best = { start: 0, end: 0, dur: 0 };
      for (const b of waveform) {
        if (b.end <= w.start) continue;
        if (b.start >= w.end) break;
        const bStart = Math.max(b.start, w.start);
        const bEnd = Math.min(b.end, w.end);
        if (b.level < SILENCE_LEVEL) {
          if (runStart == null) runStart = bStart;
        } else {
          if (runStart != null) {
            const runEnd = bStart;
            const runDur = runEnd - runStart;
            if (runDur > best.dur) best = { start: runStart, end: runEnd, dur: runDur };
            runStart = null;
          }
        }
      }
      if (runStart != null) {
        const runEnd = w.end;
        const runDur = runEnd - runStart;
        if (runDur > best.dur) best = { start: runStart, end: runEnd, dur: runDur };
      }
      if (best.dur >= MIN_HIDDEN_SILENCE) {
        results.push({
          start: best.start,
          end: best.end,
          confidence: 0.88,
          reason: "silence",
          source: "speechError",
          detectedBy: "heuristic",
          text: `(silêncio de ${best.dur.toFixed(1)}s escondido dentro da palavra "${w.word}")`,
        });
      }
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
    // Pular palavras de abertura tipo "bom", "então", "olha" quando forem
    // apenas hesitação/reset — a comparação de reinício deve ser sobre a
    // parte REAL da fala, não sobre o filler inicial.
    const isSkippableHead = (w) => STANDALONE_HESITATIONS.has(w);
    const headOf = (startIdx, endIdx) => {
      let idx = startIdx;
      while (idx <= endIdx && isSkippableHead(norm[idx])) idx += 1;
      return idx;
    };
    for (let s = 0; s < sentences.length - 1; s++) {
      const a = sentences[s];
      const b = sentences[s + 1];
      const aLen = a.endIdx - a.startIdx + 1;
      const bLen = b.endIdx - b.startIdx + 1;
      if (aLen > 15 || bLen > 15) continue;
      const gap = words[b.startIdx].start - words[a.endIdx].end;
      if (gap > 3.0) continue;
      const aHead = headOf(a.startIdx, a.endIdx);
      const bHead = headOf(b.startIdx, b.endIdx);
      if (aHead > a.endIdx - 1 || bHead > b.endIdx - 1) continue;
      // Compara as 2 primeiras palavras depois de pular hesitations iniciais.
      const sameHead2 = norm[aHead] === norm[bHead] &&
                        norm[aHead + 1] === norm[bHead + 1];
      if (!sameHead2) continue;
      const sameHead3 = (aHead + 2 <= a.endIdx) && (bHead + 2 <= b.endIdx) &&
                        norm[aHead + 2] === norm[bHead + 2];
      const isFirst = s === 0;
      const conf = sameHead3 ? 0.88 : isFirst ? 0.82 : 0.75;
      results.push({
        start: words[a.startIdx].start,
        end: words[a.endIdx].end,
        confidence: conf,
        reason: "false_start",
        source: "speechError",
        detectedBy: "heuristic",
        text: words.slice(a.startIdx, a.endIdx + 1).map((w) => w.word).join(" "),
      });
      s += 1;
    }
  }

  return results;
}
