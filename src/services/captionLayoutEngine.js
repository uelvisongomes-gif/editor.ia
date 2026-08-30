// Caption Layout Engine — decide COMPOSIÇÃO das legendas (agrupamento,
// quebras, ênfase). Templates decidem ESTÉTICA.
//
// Determinístico. Zero LLM extra. Usa word timestamps + listas de markers
// do emphasisModel.

import { IMPACT_MARKERS, EMPHASIS_MARKERS } from "./emphasisModel.js";

// -----------------------------------------------------------------------
// Config — ranges pensados pra leitura rápida (Reels/TikTok/Shorts).
// -----------------------------------------------------------------------
const DEFAULTS = {
  minWords: 2,
  targetWords: 4,        // sweet spot pra caber em 1 linha
  maxWords: 7,           // hard cap — nunca gera 3+ linhas na render
  minDurationSec: 0.8,   // abaixo disso a cue "pisca"
  maxDurationSec: 3.8,   // acima disso a legenda fica "velha" na tela
  naturalBreakGapSec: 0.45, // exige pausa mais clara pra fechar cue
};

// Palavras de ALTO valor que sempre viram emphasis se aparecerem numa cue
// (Item 12 · Keyword highlight expandido).
const CTA_WORDS = new Set([
  "siga", "segue", "salva", "salve", "comenta", "comente", "compartilha",
  "compartilhe", "clica", "clique", "compra", "compre", "envia", "envie",
  "cadastra", "cadastre", "cadastre-se", "assina", "assine", "baixa", "baixe",
  "acessa", "acesse", "conheca", "conheça", "aproveita", "aproveite",
  "corre", "garanta", "aprenda", "descubra",
]);
const BENEFIT_WORDS = new Set([
  "grátis", "gratis", "gratuito", "hoje", "agora", "primeiro", "único",
  "unico", "exclusivo", "melhor", "novo", "novidade", "desconto", "oferta",
  "resultado", "solução", "solucao", "resposta", "chave",
]);
const CONTRAST_WORDS = new Set([
  "antes", "depois", "mas", "porém", "porem", "entretanto", "no entanto",
  "diferente", "contrário", "contrario", "oposto", "invés", "inves",
]);

/**
 * Detecta se uma palavra é "keyword" de destaque (números/valores/CTA/etc).
 * Prioridade sobre a heurística "última palavra de conteúdo".
 * @returns {number|null} boost 0-1 (null = não é keyword)
 */
export function keywordBoost(word) {
  if (!word) return null;
  const raw = String(word).trim();
  const clean = raw.toLowerCase().replace(/[.,!?;:()"']/g, "");
  // Número (incl. porcentagens, valores, ordinal)
  if (/^\d+([.,]\d+)?%?$/.test(clean)) return 0.95;
  if (/^R\$/.test(raw) || /^\$/.test(raw) || /^€/.test(raw)) return 0.95;
  if (/\d/.test(clean) && clean.length <= 8) return 0.80; // "5x", "24h"
  // CTA
  if (CTA_WORDS.has(clean)) return 0.90;
  // Benefício
  if (BENEFIT_WORDS.has(clean)) return 0.75;
  // Contraste
  if (CONTRAST_WORDS.has(clean)) return 0.65;
  // Palavra CAPS LOCK (usuário enfatizou)
  if (raw.length >= 3 && raw === raw.toUpperCase() && /[A-Z]/.test(raw)) return 0.80;
  return null;
}

// Palavras "fracas" — nunca terminar cue nelas (fica orfão visual).
const CONNECTORS = new Set([
  "e", "o", "a", "os", "as", "de", "da", "do", "das", "dos",
  "que", "um", "uma", "uns", "umas", "para", "pra", "por",
  "com", "em", "na", "no", "nas", "nos", "se", "é", "ou",
  "ao", "aos", "à", "às", "pelo", "pela", "pelos", "pelas",
  "mas", "então", "aí",
]);

const cleanWord = (w) => (w || "").toLowerCase().replace(/[.,!?;:"()\[\]]/g, "").trim();
const endsSentence = (w) => /[.!?…]$/.test((w || "").trim());

// -----------------------------------------------------------------------
// Agrupamento principal — retorna cues { start, end, words[], emphasisWordIdx }
// -----------------------------------------------------------------------
export function buildCaptionsSmartly(words, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  if (!words?.length) return [];

  const cues = [];
  let current = [];
  let cueStart = null;

  const flush = () => {
    if (!current.length) return;

    const start = cueStart;
    const end = current[current.length - 1].end;
    const emphasisIdx = pickEmphasisWordIndex(current);
    cues.push({
      id: "cap-" + cues.length,
      start,
      end,
      text: current.map((c) => c.word).join(" ").trim(),
      words: current.map((c) => ({
        word: (c.word || "").replace(/[.,!?;:]$/, ""),
        start: c.start,
        end: c.end,
      })),
      emphasisWordIdx: emphasisIdx,
    });
    current = [];
    cueStart = null;
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!current.length) cueStart = w.start;
    current.push(w);

    const next = words[i + 1];
    const gapToNext = next ? next.start - w.end : Infinity;
    const dur = w.end - cueStart;
    const cleanCurrent = cleanWord(w.word);
    const currentIsConnector = CONNECTORS.has(cleanCurrent);

    // Razões pra fechar cue AGORA:
    // 1) Fim de sentença
    // 2) Atingiu maxWords
    // 3) Alcançou targetWords E há pausa natural
    // 4) Alcançou targetWords E duraria demais pra próxima
    // 5) Última palavra do transcript
    // 6) Duração já ultrapassou maxDurationSec
    const hitMax = current.length >= cfg.maxWords;
    const hitTarget = current.length >= cfg.targetWords;
    const naturalBreak = gapToNext >= cfg.naturalBreakGapSec;
    const overDuration = dur >= cfg.maxDurationSec;

    const shouldClose =
      !next ||
      endsSentence(w.word) ||
      hitMax ||
      overDuration ||
      (hitTarget && naturalBreak && !currentIsConnector);

    if (shouldClose) flush();
  }

  // 1) Balance: se a última cue ficou órfã (< 3 palavras), puxa palavras
  //    da cue anterior pra distribuir melhor. Evita "simples" sozinho.
  balanceOrphanTails(cues, 3);

  // 2) Shift connectors finais pra próxima cue (evita cue terminar em
  //    "e"/"o"/"que"/etc). Preserva todas as palavras.
  shiftTrailingConnectors(cues);

  // 3) Merge cues muito curtas (< minDurationSec) pra evitar piscar.
  return mergeShortCues(cues, cfg.minDurationSec);
}

function balanceOrphanTails(cues, minWordsPerCue) {
  if (cues.length < 2) return;
  // Faz múltiplas passadas — cada passada move 1 palavra por cue órfã.
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let i = 1; i < cues.length; i++) {
      const cur = cues[i];
      const prev = cues[i - 1];
      if (cur.words.length >= minWordsPerCue) continue;
      if (prev.words.length <= minWordsPerCue) continue;
      const w = prev.words.pop();
      cur.words.unshift(w);
      prev.text = prev.words.map((x) => x.word).join(" ");
      prev.end = prev.words[prev.words.length - 1].end;
      prev.emphasisWordIdx = pickEmphasisWordIndex(prev.words);
      cur.text = cur.words.map((x) => x.word).join(" ");
      cur.start = cur.words[0].start;
      cur.emphasisWordIdx = pickEmphasisWordIndex(cur.words);
      changed = true;
    }
    if (!changed) break;
  }
}

function shiftTrailingConnectors(cues) {
  for (let i = 0; i < cues.length - 1; i++) {
    const cur = cues[i];
    while (cur.words.length > 1 && CONNECTORS.has(cleanWord(cur.words[cur.words.length - 1].word))) {
      const shifted = cur.words.pop();
      cues[i + 1].words.unshift(shifted);
      cues[i + 1].start = shifted.start;
      cur.end = cur.words[cur.words.length - 1].end;
    }
    cur.text = cur.words.map((w) => w.word).join(" ");
    cur.emphasisWordIdx = pickEmphasisWordIndex(cur.words);
    cues[i + 1].text = cues[i + 1].words.map((w) => w.word).join(" ");
    cues[i + 1].emphasisWordIdx = pickEmphasisWordIndex(cues[i + 1].words);
  }
}

function mergeShortCues(cues, minDurSec) {
  if (cues.length < 2) return cues;
  const out = [cues[0]];
  for (let i = 1; i < cues.length; i++) {
    const prev = out[out.length - 1];
    const cur = cues[i];
    const prevDur = prev.end - prev.start;
    const curDur = cur.end - cur.start;
    // Só faz merge se o resultado ainda cabe no MAX (6 palavras).
    if ((prevDur < minDurSec || curDur < minDurSec) && (prev.words.length + cur.words.length) <= DEFAULTS.maxWords) {
      const mergedWords = [...prev.words, ...cur.words];
      const mergedEmphasis = pickEmphasisWordIndex(mergedWords);
      out[out.length - 1] = {
        ...prev,
        end: cur.end,
        text: mergedWords.map((w) => w.word).join(" "),
        words: mergedWords,
        emphasisWordIdx: mergedEmphasis,
      };
    } else {
      out.push(cur);
    }
  }
  return out;
}

// -----------------------------------------------------------------------
// Ênfase — 3 níveis de fallback:
//   1) Palavra de IMPACT_MARKERS
//   2) Palavra de EMPHASIS_MARKERS
//   3) Última palavra "de conteúdo" (não conector, >= 4 chars)
//   4) -1 = sem destaque
// -----------------------------------------------------------------------
export function pickEmphasisWordIndex(cueWords) {
  if (!cueWords?.length) return -1;
  const cleaned = cueWords.map((w) => cleanWord(w.word));

  // Prioridade 1: keyword boost (números, CTA, benefício, contraste, CAPS)
  // Retorna o de maior boost.
  let bestIdx = -1;
  let bestBoost = 0;
  for (let i = 0; i < cueWords.length; i++) {
    const boost = keywordBoost(cueWords[i].word);
    if (boost && boost > bestBoost) { bestBoost = boost; bestIdx = i; }
  }
  if (bestIdx >= 0) return bestIdx;

  // Prioridade 2: IMPACT markers
  for (let i = 0; i < cleaned.length; i++) {
    if (IMPACT_MARKERS.some((m) => cleaned[i] === m)) return i;
  }
  // Prioridade 3: EMPHASIS markers
  for (let i = 0; i < cleaned.length; i++) {
    if (EMPHASIS_MARKERS.some((m) => cleaned[i] === m)) return i;
  }
  // Fallback: última palavra de conteúdo
  for (let i = cleaned.length - 1; i >= 0; i--) {
    if (!CONNECTORS.has(cleaned[i]) && cleaned[i].length >= 4) return i;
  }
  return -1;
}

// -----------------------------------------------------------------------
// Safe area por posição — retorna fração vertical (0-1) do canvas.
// Padrão TikTok/Reels tem UI:
//   - fundo: descrição/nome/botões nos últimos ~18%
//   - topo: música/perfil nos primeiros ~10%
// -----------------------------------------------------------------------
export const CAPTION_Y_SAFE = {
  bottom:          0.82,  // era 0.93 — fora da zona da UI
  "middle-bottom": 0.70,  // era 0.78 — mais alto, boa pra talking-head
  top:             0.18,  // era 0.12
  center:          0.50,
};

// Largura de segurança (fração da largura útil do canvas).
// Prioridade HORIZONTAL: legenda cresce em largura antes de quebrar linha.
export const CAPTION_MAX_WIDTH_FRACTION = 0.88;

// Fade curto pra suavizar entrada/saída (não competir com a fala).
export const CAPTION_FADE_SEC = 0.12;

/**
 * Opacidade de fade da cue em função do timestamp t.
 */
export function captionFadeOpacity(t, cue, fadeSec = CAPTION_FADE_SEC) {
  if (t < cue.start || t > cue.end) return 0;
  const inLeft = (t - cue.start) / fadeSec;
  const inRight = (cue.end - t) / fadeSec;
  return Math.max(0, Math.min(1, inLeft, inRight, 1));
}
