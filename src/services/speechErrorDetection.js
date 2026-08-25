// Uses the LLM to spot clear speech-level defects and — critically — to
// prefer the corrected version whenever the speaker re-does a phrase.
// Returns word-index ranges; the caller converts them to seconds using the
// same word timestamps we sent to the model, so ranges align exactly with
// the video timeline.

import { callLLM, extractJSON } from "./llmClient.js";

const PROMPT_TEMPLATE = (indexedWords) => `Você é um editor de vídeo experiente em português brasileiro. Abaixo está a transcrição de uma fala, com cada palavra numerada pelo índice dela (começando em 0), separada por espaços.

Identifique APENAS trechos que são claramente defeitos de fala que devem ser cortados. Categorias:

- "stutter": gagueira ou repetição imediata acidental ("eu eu acho", "vamos vamos fazer").
- "false_start": começo falso corrigido logo depois ("na terça- na quarta-feira").
- "abandoned_phrase": frase incompleta que a pessoa abandona e reinicia.
  Exemplo: "Hoje eu vou mostrar... não, pera... Hoje eu vou ensinar como vender no TikTok Shop."
  Aqui o trecho "Hoje eu vou mostrar... não, pera..." deve ser marcado como abandoned_phrase.
  A versão correta ("Hoje eu vou ensinar como vender no TikTok Shop") DEVE PERMANECER.
- "self_correction": a pessoa afirma algo e imediatamente se corrige.
  Exemplo: "é vermelho, não, é azul" — marque o "é vermelho, não," como self_correction.
- "filler": cadeias longas de muletas ("é... tipo... né, sabe").

REGRA CRÍTICA:
Quando existir uma versão errada seguida por uma versão correta da MESMA frase, sempre marque a versão errada (não a correta). Se estiver em dúvida sobre qual é a "correta", prefira a MAIS COMPLETA e a que traz a mensagem final da pessoa.

NÃO marque:
- Uma única muleta isolada ("né", "tipo", "sabe").
- Ênfases naturais ou repetições retóricas propositais ("muito, muito importante").
- Pausas para respirar (silêncios não fazem parte desta análise).
- Correções de conteúdo intencional que a pessoa quer manter no vídeo.

Responda APENAS com um array JSON válido, sem markdown, no formato exato:
[{"startWord":0,"endWord":2,"reason":"stutter","confidence":0.9,"replacementNote":"tentativa correta em ..."}]

- reason ∈ {"stutter","filler","false_start","abandoned_phrase","self_correction"}
- confidence entre 0 e 1. Use >= 0.85 quando for absolutamente evidente; 0.70-0.85 quando for claro mas com pouca ambiguidade; 0.5 se estiver em dúvida (nesses casos, prefira NÃO marcar).
- replacementNote é opcional: quando o corte é uma tentativa errada seguida da versão correta, escreva uma referência curta à versão que deve permanecer.

Se não houver nenhum defeito claro, responda [].

Transcrição indexada:
"""${indexedWords}"""`;

/**
 * @param {Array<{word:string,start:number,end:number}>} words
 * @returns {Promise<Array<{start:number,end:number,confidence:number,reason:string,source:'speechError',text:string,replacementNote?:string}>>}
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
