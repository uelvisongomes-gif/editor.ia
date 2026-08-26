// LLM que identifica APENAS defeitos de fala pontuais e curtos. O prompt
// foi endurecido depois de teste real: o modelo tendia a marcar blocos
// gigantes como "false_start" ou "abandoned_phrase" quando na verdade eram
// falas reais reiniciadas. Agora a regra é explícita: erros de fala não
// duram mais que ~3-4 segundos; se for mais longo, provavelmente NÃO é erro.

import { callLLM, extractJSON } from "./llmClient.js";

const PROMPT_TEMPLATE = (indexedWords) => `Você é um editor de vídeo experiente em português brasileiro. Abaixo está a transcrição de uma fala, com cada palavra numerada pelo índice (começando em 0), separada por espaços.

Identifique defeitos de fala que devem ser cortados. Categorias:

- "stutter": gagueira ou repetição imediata acidental ("eu eu acho", "vamos vamos fazer").
- "false_start": começo falso corrigido logo depois ("na terça- na quarta-feira").
- "abandoned_phrase": frase incompleta que a pessoa abandona e reinicia logo em seguida.
  Exemplo: "Hoje eu vou mostrar... não, pera... Hoje eu vou ensinar..."
  Marque APENAS "Hoje eu vou mostrar... não, pera..." como abandoned_phrase.
  A versão correta ("Hoje eu vou ensinar...") DEVE PERMANECER.
- "self_correction": pessoa afirma algo e imediatamente se corrige.
  Exemplo: "é vermelho, não, é azul" — marque "é vermelho, não," como self_correction.
- "filler": cadeia de muletas seguidas ("é... tipo... né, sabe").

REGRA DE DURAÇÃO (importante):
Cada corte deve ter NO MÁXIMO 15 palavras. Se um trecho "parece" um erro mas tem mais que isso, provavelmente é conteúdo real reiniciado — NÃO marque. O usuário pode cortar manualmente se quiser.

NÃO marque:
- Uma única muleta isolada ("né", "tipo", "sabe") — ok em fala natural.
- Ênfases naturais ou repetições retóricas ("muito, muito importante").
- Pausas para respirar (outro módulo cuida).
- Correções de conteúdo que a pessoa QUER manter.

Responda APENAS com um array JSON válido, sem markdown, no formato exato:
[{"startWord":0,"endWord":2,"reason":"stutter","confidence":0.9,"replacementNote":"tentativa correta em ..."}]

- reason ∈ {"stutter","filler","false_start","abandoned_phrase","self_correction"}
- confidence: >= 0.85 quando evidente, 0.65-0.84 quando claro mas com alguma ambiguidade, < 0.65 quando tiver dúvida real (nesses casos, prefira NÃO marcar).
- replacementNote é opcional: quando é uma tentativa errada seguida da versão correta, refira brevemente a versão preservada.

Se não houver nenhum defeito claro, responda [].

Transcrição indexada:
"""${indexedWords}"""`;

/**
 * @param {Array<{word:string,start:number,end:number}>} words
 * @param {{signal?:AbortSignal, onUsage?:(entry:any)=>void}} [opts]
 */
export async function detectSpeechErrors(words, { signal, onUsage } = {}) {
  if (!words?.length) return [];
  const indexed = words.map((w, i) => `${i}:${w.word}`).join(" ");
  const raw = await callLLM({
    prompt: PROMPT_TEMPLATE(indexed),
    maxTokens: 1500,
    signal,
    onUsage,
    operation: "speech_errors",
  });
  console.log("[speechErrorDetection] LLM raw response:", raw);
  const parsed = extractJSON(raw);
  if (!Array.isArray(parsed)) {
    console.warn("[speechErrorDetection] Failed to parse. Returning empty. Raw was:", raw);
    return [];
  }
  console.log("[speechErrorDetection] LLM parsed items:", parsed.length, parsed);

  const results = [];
  for (const m of parsed) {
    const sw = Number(m.startWord);
    const ew = Number(m.endWord);
    if (!Number.isFinite(sw) || !Number.isFinite(ew)) continue;
    // Extra guard on the client side: if the LLM still returns a huge range,
    // clip it — a stutter/false_start bigger than 20 words is almost certainly
    // a misclassification. We drop the whole entry rather than trimming to
    // avoid keeping half of what the model thought was one defect.
    if (ew - sw > 20) continue;
    const startWord = words[Math.max(0, sw)];
    const endWord = words[Math.min(words.length - 1, ew)];
    if (!startWord || !endWord || endWord.end <= startWord.start) continue;
    const item = {
      start: startWord.start,
      end: endWord.end,
      confidence: Number.isFinite(m.confidence) ? Math.max(0, Math.min(1, Number(m.confidence))) : 0.7,
      reason: typeof m.reason === "string" ? m.reason : "filler",
      source: "speechError",
      text: words.slice(sw, ew + 1).map((w) => w.word).join(" "),
    };
    if (typeof m.replacementNote === "string" && m.replacementNote.trim()) {
      item.replacementNote = m.replacementNote.trim();
    }
    results.push(item);
  }
  return results;
}
