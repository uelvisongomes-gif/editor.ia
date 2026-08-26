// LLM que identifica APENAS defeitos de fala pontuais e curtos. O prompt
// foi endurecido depois de teste real: o modelo tendia a marcar blocos
// gigantes como "false_start" ou "abandoned_phrase" quando na verdade eram
// falas reais reiniciadas. Agora a regra é explícita: erros de fala não
// duram mais que ~3-4 segundos; se for mais longo, provavelmente NÃO é erro.

import { callLLM, extractJSON } from "./llmClient.js";

const PROMPT_TEMPLATE = (indexedWords) => `Você é um editor de vídeo experiente em português brasileiro. Abaixo está a transcrição de uma fala, com cada palavra numerada pelo índice (começando em 0), separada por espaços.

Identifique APENAS defeitos de fala pontuais que devem ser cortados. Categorias:

- "stutter": gagueira ou repetição imediata acidental ("eu eu acho", "vamos vamos fazer").
- "false_start": começo falso corrigido logo depois ("na terça- na quarta-feira").
- "abandoned_phrase": frase incompleta que a pessoa abandona e reinicia logo em seguida.
  Exemplo: "Hoje eu vou mostrar... não, pera... Hoje eu vou ensinar..."
  Aqui o trecho "Hoje eu vou mostrar... não, pera..." vai como abandoned_phrase.
  A versão correta ("Hoje eu vou ensinar...") DEVE PERMANECER.
- "self_correction": pessoa afirma algo e imediatamente se corrige.
  Exemplo: "é vermelho, não, é azul" — o "é vermelho, não," é self_correction.
- "filler": cadeia CURTA de muletas ("é... tipo... né, sabe").

REGRAS CRÍTICAS:
1. DEFEITO DE FALA É CURTO. Cada corte deve ter no máximo ~15 palavras (~3-4 segundos). Se um trecho parece um "erro" mas tem mais que isso, é conteúdo real — NÃO marque.
2. Só marque quando houver EVIDÊNCIA CLARA de reinício, gagueira ou correção. Não invente erros para "melhorar" o vídeo.
3. Quando houver uma versão errada seguida de versão correta, marque só a errada. Na dúvida, prefira a versão MAIS COMPLETA para permanecer.
4. NA DÚVIDA, NÃO MARQUE. É melhor manter uma pausa desnecessária do que remover uma frase real.

NÃO marque:
- Uma única muleta isolada ("né", "tipo", "sabe").
- Ênfases naturais ou repetições retóricas propositais ("muito, muito importante").
- Pausas para respirar.
- Correções de conteúdo que a pessoa QUER manter.
- Blocos longos com mais de 15 palavras — mesmo que "pareça" reiniciado.
- Recomeços narrativos legítimos (a pessoa fala uma coisa, faz outra observação, e volta ao tema — isso é oratória, não erro).

Responda APENAS com um array JSON válido, sem markdown, no formato exato:
[{"startWord":0,"endWord":2,"reason":"stutter","confidence":0.9,"replacementNote":"tentativa correta em ..."}]

- reason ∈ {"stutter","filler","false_start","abandoned_phrase","self_correction"}
- confidence: use >= 0.90 só quando for absolutamente evidente; 0.75-0.89 quando for claro mas com pouca ambiguidade; abaixo de 0.75 quando tiver qualquer dúvida (nesses casos, prefira NÃO marcar).
- replacementNote é opcional: quando o corte é uma tentativa errada seguida da versão correta, escreva uma referência curta à versão que deve permanecer.

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
  const parsed = extractJSON(raw);
  if (!Array.isArray(parsed)) return [];

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
