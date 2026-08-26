// Fuses semantic-sentence segmentation, narrative role classification,
// off-topic detection, and repeated-idea grouping into ONE LLM call.
// That keeps latency and cost low (a full 5–10min video = 1 call here plus
// the small speech-error call).
//
// For long transcripts we chunk by sentence-count windows (~90 sentences ≈
// 3–4 minutes of speech) and stitch results together. Narrative roles from
// later chunks are re-aligned so the earliest content is the "hook" and the
// latest is the "cta/conclusion".

import { callLLM, extractJSON } from "./llmClient.js";

const CHUNK_SENTENCES = 90;

// Rough sentence pre-segmentation from word timestamps.
// Fase 2.3: quebras mais agressivas — em teste real o Whisper devolve
// pouca pontuação em vídeos curtos e falas emendadas, gerando "sentenças"
// de 10-15 segundos que impedem o LLM de identificar micro-erros. Agora
// quebramos em:
//   - pontuação forte (.!?…)
//   - gap silencioso >= 0.5s (era 0.9s)
//   - vírgula OU "e" isolado quando o cur já tem >= 8 palavras
//   - hard limit de 15 palavras (era 40)
function preSegmentSentences(words) {
  const sentences = [];
  let cur = [];
  let start = null;
  const push = (endWord) => {
    sentences.push({
      index: sentences.length,
      start,
      end: endWord.end,
      text: cur.map((c) => c.word).join(" ").trim(),
    });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur.length === 0) start = w.start;
    cur.push(w);
    const next = words[i + 1];
    const gap = next ? next.start - w.end : Infinity;
    const raw = (w.word || "").trim();
    const endsSentence = /[.!?…]$/.test(raw);
    const softBreak = /,$/.test(raw) && cur.length >= 8;
    const hardLimit = cur.length >= 15;
    if (endsSentence || gap >= 0.5 || softBreak || hardLimit || !next) {
      push(w);
    }
  }
  return sentences;
}

const PROMPT = (sentencesJson, topicHint) => `Você é um editor de vídeo experiente em português brasileiro. Sua meta é enxugar o vídeo SEM comprometer a narrativa. Marque o que for genuinamente removível; quando estiver em dúvida real, deixe como "review" para o usuário decidir.

Recebe abaixo uma lista de sentenças numeradas extraídas da fala de UM vídeo. Retorne:

1. "topic": ASSUNTO PRINCIPAL do vídeo (uma frase curta).
2. "sentences": para cada sentença, retornar:
   - "index": índice recebido.
   - "role": papel narrativo — um de:
       "hook"        (abertura que prende atenção)
       "context"     (situa o assunto)
       "development" (explicação/desenvolvimento)
       "point"       (insight/exemplo/ponto principal)
       "conclusion"  (encerramento do raciocínio)
       "cta"         (chamada para ação)
       "aside"       (comentário paralelo breve)
       "off_topic"   (fora do assunto — use com cuidado)
   - "importance": "high" | "medium" | "low".
   - "dependsOnPrev": true se a sentença só faz sentido junto da imediatamente anterior (pronome sem antecedente, "isso", "essa parte", conclusão que precisa do exemplo anterior).
   - "keepAdvice": "keep" | "trim" | "consider_remove" | "review".

3. "repeatedGroups": conjuntos de sentenças que exprimem A MESMA IDEIA de formas parecidas e PODEM SUBSTITUIR UMA À OUTRA. Para cada grupo, escolha "bestIndex" (a versão mais clara). As demais são candidatas a remoção. NÃO agrupe complementos (ex: "vender por vídeo" + "vender por live" — são coisas diferentes, não repetição).

4. "offTopicIndexes": sentenças que NÃO tocam o assunto principal. Uma história curta que ilustra o ponto NÃO é off-topic. Uma digressão evidente (interrompeu para falar de outra coisa) É.

REGRAS:
- Prefira "consider_remove" apenas quando tiver certeza de que a sentença é dispensável e a remoção não vai quebrar o que vem depois.
- Se a próxima sentença começa com "isso/ele/então/por isso/essa parte", a atual NÃO deve ser consider_remove.
- Se a sentença atual termina em conector aberto (porque, pois, mas, como), NÃO marque consider_remove.
- Pausas e silêncios são decididos por outro módulo — ignore.
- Reforço narrativo ("isso é muito importante") não é repetição se estiver enfatizando; só marque como repeated_idea quando UMA versão substitui a outra sem perda.

ATENÇÃO: ANÁFORAS RETÓRICAS E ENUMERAÇÕES NÃO SÃO REDUNDÂNCIA.
- Várias sentenças consecutivas com mesma estrutura para dar ênfase
  ("falta ideia", "falta jeito", "falta técnica") — anáfora, todas KEEP.
- Uma única sentença com enumeração interna ("falta técnica, falta método",
  "primeiro X, segundo Y, terceiro Z", "temos A, B e C") — enumeração,
  KEEP. Cada item é uma INFORMAÇÃO DIFERENTE, não repetição.
- Complementos ("vender por vídeo" + "vender por live") — coisas diferentes,
  KEEP ambas.
Nunca agrupe em repeatedGroups nem marque consider_remove nesses casos.

Só use repeated_idea quando UMA versão pode SUBSTITUIR a outra sem
perder informação (mesma coisa dita de dois jeitos). Se A e B adicionam
informações diferentes → KEEP ambas.

${topicHint ? `Contexto: o vídeo aparenta ser sobre "${topicHint}". Off_topic só quando claramente desconectado disso.` : ""}

Responda APENAS com um JSON válido, sem markdown, no formato exato:
{
  "topic": "assunto principal em uma frase",
  "sentences": [
    { "index": 0, "role": "hook", "importance": "high", "dependsOnPrev": false, "keepAdvice": "keep" }
  ],
  "repeatedGroups": [
    { "indexes": [3,5,9], "bestIndex": 5, "idea": "resumo curto da ideia" }
  ],
  "offTopicIndexes": [12, 17]
}

Sentenças:
${sentencesJson}`;

async function analyzeChunk(sentences, topicHint, { signal, onUsage } = {}) {
  const payload = sentences.map((s) => ({ index: s.index, text: s.text }));
  const raw = await callLLM({
    prompt: PROMPT(JSON.stringify(payload), topicHint),
    maxTokens: 3000,
    signal,
    onUsage,
    operation: "semantic_analysis",
  });
  console.log("[semanticAnalysis] LLM raw response (first 500 chars):", raw?.slice(0, 500));
  const parsed = extractJSON(raw);
  if (!parsed || typeof parsed !== "object") {
    console.warn("[semanticAnalysis] Failed to parse JSON. Raw was:", raw);
    return { topic: topicHint || "", sentences: [], repeatedGroups: [], offTopicIndexes: [] };
  }
  return {
    topic: typeof parsed.topic === "string" ? parsed.topic : (topicHint || ""),
    sentences: Array.isArray(parsed.sentences) ? parsed.sentences : [],
    repeatedGroups: Array.isArray(parsed.repeatedGroups) ? parsed.repeatedGroups : [],
    offTopicIndexes: Array.isArray(parsed.offTopicIndexes) ? parsed.offTopicIndexes : [],
  };
}

/**
 * @param {Array<{word:string,start:number,end:number}>} words
 * @returns {Promise<{
 *   topic:string,
 *   sentences: Array<{index:number,start:number,end:number,text:string,role:string,importance:string,dependsOnPrev:boolean,keepAdvice:string}>,
 *   repeatedGroups: Array<{indexes:number[],bestIndex:number,idea:string}>,
 *   offTopicIndexes: number[]
 * }>}
 */
export async function analyzeSemantics(words, { signal, onUsage } = {}) {
  const sentences = preSegmentSentences(words);
  console.log("[semanticAnalysis] pre-segmented into", sentences.length, "sentences:");
  sentences.forEach((s) => console.log(`  #${s.index} [${s.start.toFixed(2)}→${s.end.toFixed(2)}] "${s.text}"`));
  if (!sentences.length) {
    return { topic: "", sentences: [], repeatedGroups: [], offTopicIndexes: [] };
  }

  // Chunk to fit LLM context comfortably for long videos.
  const chunks = [];
  for (let i = 0; i < sentences.length; i += CHUNK_SENTENCES) {
    chunks.push(sentences.slice(i, i + CHUNK_SENTENCES));
  }

  let topic = "";
  const merged = new Map(); // index -> classification
  const repeatedGroups = [];
  const offTopicIndexes = new Set();

  for (let ci = 0; ci < chunks.length; ci++) {
    if (signal?.aborted) throw new DOMException("Cancelado pelo usuário", "AbortError");
    const chunk = chunks[ci];
    const result = await analyzeChunk(chunk, topic, { signal, onUsage });
    if (!topic && result.topic) topic = result.topic;
    for (const s of result.sentences) {
      if (!Number.isFinite(s.index)) continue;
      merged.set(s.index, {
        role: typeof s.role === "string" ? s.role : "development",
        importance: typeof s.importance === "string" ? s.importance : "medium",
        dependsOnPrev: !!s.dependsOnPrev,
        keepAdvice: typeof s.keepAdvice === "string" ? s.keepAdvice : "keep",
      });
    }
    for (const g of result.repeatedGroups) {
      if (Array.isArray(g?.indexes) && g.indexes.length >= 2) {
        repeatedGroups.push({
          indexes: g.indexes.filter((i) => Number.isFinite(i)),
          bestIndex: Number.isFinite(g.bestIndex) ? g.bestIndex : g.indexes[0],
          idea: typeof g.idea === "string" ? g.idea : "",
        });
      }
    }
    for (const i of result.offTopicIndexes) {
      if (Number.isFinite(i)) offTopicIndexes.add(i);
    }
  }

  const enriched = sentences.map((s) => {
    const cls = merged.get(s.index) || { role: "development", importance: "medium", dependsOnPrev: false, keepAdvice: "keep" };
    return { ...s, ...cls };
  });

  // Post-hoc: force first spoken sentence toward "hook" and last toward
  // "cta" or "conclusion" if the LLM was unsure across chunks.
  if (enriched.length) {
    if (enriched[0].role === "development") enriched[0].role = "hook";
    const last = enriched[enriched.length - 1];
    if (last.role === "development") last.role = "conclusion";
  }

  return {
    topic,
    sentences: enriched,
    repeatedGroups,
    offTopicIndexes: [...offTopicIndexes],
  };
}
