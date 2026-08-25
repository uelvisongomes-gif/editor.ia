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

// Rough sentence pre-segmentation from word timestamps: split on end-of-sentence
// punctuation OR on a long silent gap. We ship these to the LLM as the base
// units so it can classify each without also having to invent boundaries.
function preSegmentSentences(words) {
  const sentences = [];
  let cur = [];
  let start = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur.length === 0) start = w.start;
    cur.push(w);
    const next = words[i + 1];
    const gap = next ? next.start - w.end : Infinity;
    const endsSentence = /[.!?…]$/.test(w.word);
    if (endsSentence || gap >= 0.9 || !next || cur.length >= 40) {
      sentences.push({
        index: sentences.length,
        start,
        end: w.end,
        text: cur.map((c) => c.word).join(" ").trim(),
      });
      cur = [];
    }
  }
  return sentences;
}

const PROMPT = (sentencesJson, topicHint) => `Você é um editor de vídeo especialista em conteúdo falado em português brasileiro.

Recebe abaixo uma lista de sentenças numeradas extraídas da fala de UM vídeo. Sua tarefa é:

1. Identificar o ASSUNTO PRINCIPAL do vídeo (uma frase).
2. Para cada sentença, retornar:
   - "index": índice recebido.
   - "role": papel narrativo dentro do vídeo. Um de:
       "hook"        (abertura que prende atenção)
       "context"     (situa o assunto)
       "development" (explicação/desenvolvimento)
       "point"       (ponto importante/insight/exemplo)
       "conclusion"  (encerramento do raciocínio)
       "cta"         (chamada para ação, "curte", "segue", "compra", "link")
       "aside"       (comentário paralelo, digressão curta)
       "off_topic"   (fora do assunto principal do vídeo)
   - "importance": "high" | "medium" | "low".
   - "dependsOnPrev": true se a sentença só faz sentido junto da imediatamente anterior (pronome sem antecedente, "isso", "essa parte", conclusão que depende do exemplo anterior). Caso contrário false.
   - "keepAdvice": "keep" | "trim" | "consider_remove" | "review". Nunca marque "consider_remove" se dependsOnPrev=true numa sentença que seria mantida.
3. Agrupar em "repeatedGroups" conjuntos de sentenças que exprimem A MESMA IDEIA de formas diferentes (o apresentador repete, reformula, tenta de novo). Para cada grupo, escolha "bestIndex" — a versão mais clara e objetiva (mantenha essa; as outras são candidatas a remoção).
4. Listar em "offTopicIndexes" sentenças claramente fora do assunto principal (conversas paralelas, interrupções, pensamentos abandonados, digressões longas).

REGRAS DE OURO:
- Não marque para remover uma sentença curta se ela dá contexto essencial para o que vem depois.
- Prefira sempre a versão mais clara e objetiva em repetições.
- Uma pausa dramática ou uma respiração não é conteúdo removível — você não decide sobre silêncios aqui.
- Se estiver em dúvida sobre remover, use "review" em keepAdvice.

${topicHint ? `Contexto: o vídeo aparenta ser sobre "${topicHint}". Use isso como âncora ao decidir off-topic.` : ""}

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

async function analyzeChunk(sentences, topicHint) {
  const payload = sentences.map((s) => ({ index: s.index, text: s.text }));
  const raw = await callLLM({
    prompt: PROMPT(JSON.stringify(payload), topicHint),
    maxTokens: 3000,
  });
  const parsed = extractJSON(raw);
  if (!parsed || typeof parsed !== "object") {
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
export async function analyzeSemantics(words) {
  const sentences = preSegmentSentences(words);
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
    const chunk = chunks[ci];
    const result = await analyzeChunk(chunk, topic);
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
