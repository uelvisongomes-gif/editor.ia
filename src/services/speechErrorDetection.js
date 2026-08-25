// Uses the LLM to spot clear speech-level defects: stutters, filler chains,
// false starts, and abandoned/restarted phrases. Returns word-index ranges,
// which the caller converts to seconds via the word timestamps.

import { callLLM, extractJSON } from "./llmClient.js";

const PROMPT_TEMPLATE = (indexedWords) => `Você é um editor de vídeo experiente em português brasileiro. Abaixo está a transcrição de uma fala, com cada palavra numerada pelo índice dela (começando em 0), separada por espaços.

Identifique APENAS trechos que são claramente defeitos de fala que devem ser cortados:
- gagueira / repetição imediata ("eu eu acho", "vamos vamos fazer")
- começos falsos corrigidos logo depois ("na terça- na quarta-feira", "Hoje eu vou mostrar... não, pera... Hoje eu vou ensinar")
- correções auto-imediatas onde a pessoa se contradiz e reformula ("é vermelho, não, é azul")
- cadeias de hesitação com muletas ("é... tipo... né...")
- frases visivelmente incompletas e reiniciadas em seguida

NÃO marque:
- uma única muleta isolada ("né", "tipo")
- ênfases naturais
- pausas para respirar
- repetições retóricas propositais ("muito, muito importante")

Responda APENAS com um array JSON válido, sem markdown, no formato exato:
[{"startWord":0,"endWord":2,"reason":"stutter","confidence":0.9}]

reason ∈ {"stutter","filler","false_start","abandoned_phrase"}
confidence entre 0 e 1 — use 0.5 quando estiver em dúvida.

Se não houver nenhum defeito claro, responda [].

Transcrição indexada:
"""${indexedWords}"""`;

/**
 * @param {Array<{word:string,start:number,end:number}>} words
 * @returns {Promise<Array<{start:number,end:number,confidence:number,reason:string,source:'speechError',text:string}>>}
 */
export async function detectSpeechErrors(words) {
  if (!words?.length) return [];
  const indexed = words.map((w, i) => `${i}:${w.word}`).join(" ");
  const raw = await callLLM({ prompt: PROMPT_TEMPLATE(indexed), maxTokens: 1500 });
  const parsed = extractJSON(raw);
  if (!Array.isArray(parsed)) return [];

  const results = [];
  for (const m of parsed) {
    const sw = Number(m.startWord);
    const ew = Number(m.endWord);
    if (!Number.isFinite(sw) || !Number.isFinite(ew)) continue;
    const startWord = words[Math.max(0, sw)];
    const endWord = words[Math.min(words.length - 1, ew)];
    if (!startWord || !endWord || endWord.end <= startWord.start) continue;
    results.push({
      start: startWord.start,
      end: endWord.end,
      confidence: Number.isFinite(m.confidence) ? Math.max(0, Math.min(1, Number(m.confidence))) : 0.7,
      reason: typeof m.reason === "string" ? m.reason : "filler",
      source: "speechError",
      text: words.slice(sw, ew + 1).map((w) => w.word).join(" "),
    });
  }
  return results;
}
