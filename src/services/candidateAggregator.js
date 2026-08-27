// Camada intermediária ANTES da EDL. Coleta candidatos de todos os
// detectores (silence, heuristicSpeechError, LLM speechError, semantic
// analysis) e dedupa por sobreposição temporal, preservando as evidências
// de cada detector. O painel "Problemas encontrados" lê esta lista — não
// a EDL — para mostrar TUDO que foi encontrado, mesmo que não tenha virado
// corte automático.
//
// problemCandidate shape:
// {
//   id, start, end,
//   text,                     // trecho falado, quando aplicável
//   primaryType,              // silence|stutter|filler|false_start|abandoned_phrase|self_correction|repeated_idea|off_topic|low_value|trim_low_importance
//   confidence,               // MÁXIMO das evidências
//   detectors,                // Array<{detector, reason, confidence, ...}>
//   semanticRole,             // role da sentença que contém o candidato
//   repeatedGroupBestIndex?,  // pra Context Guard poder checar complementaridade
//   trimOnly?,                // true = candidato de trim, não remove
//   canOverrideProtection?,   // true = pode cortar cirurgicamente dentro de hook/cta
// }

let _candId = 1;
const nextId = () => "cand-" + _candId++;

const EPSILON = 0.02;
// Se dois candidatos se sobrepõem em > 50% do menor deles, viram um só.
const MERGE_OVERLAP_RATIO = 0.5;

const SURGICAL_ERROR_REASONS = new Set([
  "stutter", "false_start", "abandoned_phrase", "self_correction", "filler",
  "silence", "no_speech", "long_pause",
]);

// Enumeração ("falta X, falta Y, falta Z..."): detectada DIRETO das
// palavras — 3+ ocorrências da mesma palavra atuando como item-opener
// (aparecendo logo após vírgula/ponto OU no início) dentro de janela de
// 12s. Não depende de segmentação do LLM. Cobre também casos onde o
// item aparece no MEIO da frase ("porque falta ideia falta jeito
// falta técnica...").
function normWord(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[.,!?;:"'()]/g, "")
    .trim();
}

export function detectEnumerationSpans(sentences, words = []) {
  const spans = [];

  // Regra A: 3+ sentenças consecutivas começando com mesma palavra.
  if (sentences?.length) {
    const firstWord = (s) => normWord((s.text || "").split(/\s+/)[0] || "");
    const sorted = [...sentences].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    let i = 0;
    while (i < sorted.length) {
      const anchor = firstWord(sorted[i]);
      if (!anchor || anchor.length < 2) { i += 1; continue; }
      let j = i + 1;
      while (j < sorted.length && firstWord(sorted[j]) === anchor) j += 1;
      if (j - i >= 3) {
        spans.push({ start: sorted[i].start, end: sorted[j - 1].end, anchor, count: j - i });
        i = j;
      } else {
        i += 1;
      }
    }
  }

  // Regra B (mais robusta): 3+ ocorrências da MESMA palavra num intervalo
  // de 12s onde cada ocorrência (exceto a 1ª) vem logo depois de uma
  // vírgula/ponto (padrão inequívoco de enumeração retórica).
  if (words?.length) {
    for (let i = 0; i < words.length; i++) {
      const anchor = normWord(words[i].word);
      if (anchor.length < 3) continue; // ignora "e", "a", "o"
      const openerHits = [i];
      const WINDOW = 12;
      for (let j = i + 1; j < words.length && (words[j].start - words[i].start) <= WINDOW; j++) {
        if (normWord(words[j].word) !== anchor) continue;
        // Item-opener: palavra anterior termina em vírgula/ponto.
        const prev = words[j - 1];
        const prevRaw = prev ? (prev.word || "") : "";
        const isOpener = /[,.;:!?]$/.test(prevRaw);
        if (isOpener) openerHits.push(j);
      }
      // Filtra hits colados (stutter da mesma palavra, tipo "falta,
      // falta, falta" tudo em 0.3s NÃO é enumeração — é gagueira). Cada
      // hit precisa estar ao menos 0.5s do hit spaced anterior.
      const spaced = [];
      for (const idx of openerHits) {
        const last = spaced[spaced.length - 1];
        if (!last || words[idx].start - words[last].start >= 0.5) spaced.push(idx);
      }
      if (spaced.length >= 3) {
        // Requisito extra: enumeração RETÓRICA tem itens CURTOS entre
        // âncoras (tipo "falta ideia, falta jeito" — 1 palavra). Se as
        // âncoras estão longe umas das outras com muito conteúdo no
        // meio (tipo "revelação... [10 palavras] ... revelação..."),
        // NÃO é enumeração — é palavra reaparecendo no discurso.
        let maxWordsBetween = 0;
        for (let k = 1; k < spaced.length; k++) {
          const gap = spaced[k] - spaced[k - 1] - 1; // palavras entre
          if (gap > maxWordsBetween) maxWordsBetween = gap;
        }
        if (maxWordsBetween > 3) { i = spaced[spaced.length - 1]; continue; }
        const firstIdx = spaced[0];
        const lastIdx = spaced[spaced.length - 1];
        const totalSpan = words[lastIdx].start - words[firstIdx].start;
        if (totalSpan < 2.0) { i = lastIdx; continue; } // muito curto → não é enumeração
        let endIdx = lastIdx;
        while (endIdx < words.length - 1 && (words[endIdx].end - words[lastIdx].start) < 1.5) {
          if (/[.!?]$/.test(words[endIdx].word || "")) break;
          endIdx += 1;
        }
        spans.push({
          start: words[firstIdx].start,
          end: words[endIdx].end,
          anchor,
          count: spaced.length,
        });
        i = lastIdx;
      }
    }
  }

  // Merge de spans sobrepostos
  spans.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end + 0.5) {
      last.end = Math.max(last.end, s.end);
      last.count = Math.max(last.count, s.count);
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

const ENUMERATION_BLOCKED_TYPES = new Set([
  "repeated_idea", "low_value", "trim_low_importance", "off_topic",
]);

function candidateInSpan(cand, span) {
  const mid = (cand.start + cand.end) / 2;
  return mid >= span.start && mid <= span.end;
}

function isSoundWithoutWordCand(cand) {
  return (cand.text || "").includes("som sem palavra");
}

// Detecta enumeração dentro de um GRUPO de sentenças (não só entre
// sentenças distintas). Padrão "falta X falta Y | falta Z falta W" —
// mesmo dividido em 2 sentenças, se a palavra-âncora aparece 3+ vezes
// somando o texto de todas, é enumeração retórica, não redundância.
function groupIsEnumeration(sentencesInGroup) {
  if (!sentencesInGroup?.length) return false;
  const norm = (s) => (s || "").toLowerCase().replace(/[.,!?;:"'()]/g, "");
  const firstOf = (s) => norm((s.text || "").split(/\s+/)[0] || "");
  const anchor = firstOf(sentencesInGroup[0]);
  if (!anchor || anchor.length < 2) return false;
  // Todas as sentenças do grupo precisam começar com o mesmo anchor.
  if (!sentencesInGroup.every((s) => firstOf(s) === anchor)) return false;
  // Conta ocorrências do anchor em TODO o texto de todas as sentenças.
  let count = 0;
  for (const s of sentencesInGroup) {
    const toks = (s.text || "").toLowerCase().split(/\s+/).map(norm);
    count += toks.filter((w) => w === anchor).length;
  }
  return count >= 3;
}

/**
 * Colhe todos os candidatos das fontes disponíveis. Não decide nada — só
 * junta e dedupa.
 */
export function collectCandidates({ words, semantic, silences, speechErrors, profile }) {
  const candidates = [];
  const enumerationSpans = detectEnumerationSpans(semantic?.sentences || [], words || []);
  const inEnumeration = (cand) => enumerationSpans.some((sp) => candidateInSpan(cand, sp));

  // 1) Silêncios (sempre considerados).
  for (const s of silences || []) {
    candidates.push({
      start: s.start,
      end: s.end,
      text: "",
      primaryType: s.reason || "long_pause",
      confidence: s.confidence ?? 0.75,
      detectors: [{
        detector: "silence",
        reason: s.reason || "long_pause",
        confidence: s.confidence ?? 0.75,
        evidence: `Trecho sem fala de ${(s.end - s.start).toFixed(1)}s`,
      }],
      canOverrideProtection: false,
    });
  }

  // 2) Speech errors (heurístico + LLM, ambos entram pelo mesmo bag).
  if (profile.removeSpeechErrors) {
    for (const e of speechErrors || []) {
      const cand = {
        start: e.start,
        end: e.end,
        text: e.text || "",
        primaryType: e.reason || "filler",
        confidence: e.confidence ?? 0.75,
        detectors: [{
          detector: e.detectedBy || "speechError",
          reason: e.reason || "filler",
          confidence: e.confidence ?? 0.75,
          evidence: e.text || "(sem texto)",
          replacementNote: e.replacementNote || null,
        }],
        replacementNote: e.replacementNote,
        canOverrideProtection: SURGICAL_ERROR_REASONS.has(e.reason || "filler"),
      };
      // "(som sem palavra)" dentro de enumeração retórica = pausa
      // intencional entre itens da lista. Não é hesitação.
      if (isSoundWithoutWordCand(cand) && inEnumeration(cand)) continue;
      candidates.push(cand);
    }
  }

  // 3) Repetições semânticas.
  if (profile.removeRepeats && semantic?.repeatedGroups?.length) {
    const byIndex = new Map((semantic.sentences || []).map((s) => [s.index, s]));
    for (const group of semantic.repeatedGroups) {
      const best = group.bestIndex;
      // Se o grupo INTEIRO forma enumeração retórica (mesma âncora
      // repetindo 3+ vezes no texto combinado), descarta o grupo inteiro
      // — o LLM se enganou classificando como repetição.
      const groupSentences = (group.indexes || []).map((i) => byIndex.get(i)).filter(Boolean);
      if (groupIsEnumeration(groupSentences)) continue;
      for (const idx of group.indexes) {
        if (idx === best) continue;
        const s = byIndex.get(idx);
        if (!s) continue;
        const cand = {
          start: s.start,
          end: s.end,
          text: s.text,
          primaryType: "repeated_idea",
          confidence: 0.75,
          detectors: [{
            detector: "semantic",
            reason: "repeated_idea",
            confidence: 0.75,
            evidence: `Ideia: "${group.idea || "sem descrição"}" — versão preferida: sentença #${best}`,
          }],
          canOverrideProtection: false,
          repeatedGroupBestIndex: best,
        };
        // Item de enumeração retórica ("falta X, falta Y, falta Z...")
        // NUNCA é redundância — cada item é uma informação distinta.
        if (inEnumeration(cand)) continue;
        candidates.push(cand);
      }
    }
  }

  // 4) Off-topic.
  if (profile.removeOffTopic && semantic?.offTopicIndexes?.length) {
    const byIndex = new Map((semantic.sentences || []).map((s) => [s.index, s]));
    for (const idx of semantic.offTopicIndexes) {
      const s = byIndex.get(idx);
      if (!s) continue;
      const cand = {
        start: s.start,
        end: s.end,
        text: s.text,
        primaryType: "off_topic",
        confidence: 0.7,
        detectors: [{
          detector: "narrative",
          reason: "off_topic",
          confidence: 0.7,
          evidence: `Sentença classificada como fora do assunto principal "${semantic.topic || ""}"`,
        }],
        canOverrideProtection: false,
      };
      if (inEnumeration(cand)) continue;
      candidates.push(cand);
    }
  }

  // 5) Advice do LLM por sentença.
  // REGRA (Fase 3): keepAdvice="consider_remove" SOZINHO NÃO gera candidato.
  // Baixa relevância isolada não é motivo pra cortar — a frase pode ser
  // conexão/preparação/estilo. Só será considerada se OUTRO detector
  // (silence, speechError, repetição, off_topic) concordar no mesmo
  // intervalo — o merge por overlap cuida disso ao juntar as evidências.
  // Deixamos aqui apenas o caso trim explícito, que exige perfil agressivo.
  if (semantic?.sentences?.length) {
    for (const s of semantic.sentences) {
      if (s.keepAdvice === "trim" && profile.trimLowImportance) {
        const cand = {
          start: s.start,
          end: s.end,
          text: s.text,
          primaryType: "trim_low_importance",
          confidence: 0.55,
          detectors: [{
            detector: "semantic",
            reason: "trim_low_importance",
            confidence: 0.55,
            evidence: `LLM sugeriu trim; importance=${s.importance || "?"}`,
          }],
          trimOnly: true,
          canOverrideProtection: false,
        };
        if (inEnumeration(cand)) continue;
        candidates.push(cand);
      }
    }
  }

  // Enumeração retórica é INTOCÁVEL. Regra:
  //   - Candidato cujo MID cai dentro da span de enumeração:
  //       - se for pausa/silêncio/repeated_idea/off_topic/low_value → DROP
  //       - se for surgical (stutter/false_start/abandoned_phrase) → mantém
  //         (pode legitimamente cortar dentro de um item, ex.: gagueira do
  //         próprio "falta falta falta")
  //   - Candidato cruzando borda: encolhe pra ficar do lado de fora.
  const REASONS_BLOCKED_IN_ENUM = new Set([
    "silence", "no_speech", "long_pause",
    "repeated_idea", "off_topic", "trim_low_importance", "low_value",
  ]);
  const isBlockedByReasonOrText = (c) => {
    if (REASONS_BLOCKED_IN_ENUM.has(c.primaryType)) return true;
    const txt = (c.text || "").toLowerCase();
    if (txt.includes("pausa entre palavras")) return true;
    if (txt.includes("som sem palavra")) return true;
    if (txt.includes("pre-roll sem fala")) return true;
    // Detectores subjacentes também contam — merge pode ter escondido.
    if (c.detectors?.some((d) => REASONS_BLOCKED_IN_ENUM.has(d.reason))) return true;
    return false;
  };
  // Considera surgical qualquer candidate cujo primaryType OU qualquer
  // detector subjacente seja stutter/false_start/abandoned_phrase — o
  // merge pode ter escolhido "filler" como primary só porque a
  // confidence do LLM era 0.90 vs 0.88 da heurística stutter.
  const isSurgicalCandidate = (c) => {
    if (SURGICAL_TYPES.has(c.primaryType)) return true;
    if (c.detectors?.some((d) => SURGICAL_TYPES.has(d.reason))) return true;
    return false;
  };
  const clamped = [];
  for (const c of candidates) {
    let s = c.start, e = c.end;
    const mid = (s + e) / 2;
    let killed = false;
    for (const sp of enumerationSpans) {
      const midInside = mid >= sp.start && mid <= sp.end;
      if (midInside && !isSurgicalCandidate(c) && isBlockedByReasonOrText(c)) {
        killed = true; break;
      }
      // Encolhe se cruza borda (mesmo pra surgical)
      if (s < sp.start && e > sp.start && e <= sp.end) {
        e = sp.start;
      } else if (s >= sp.start && s < sp.end && e > sp.end) {
        s = sp.end;
      }
    }
    if (killed) continue;
    if (e - s < 0.1) continue;
    clamped.push({ ...c, start: s, end: e });
  }
  // Depois do dedup por overlap tradicional, faz semantic aggregation:
  // agrupa candidatos consecutivos que estão a < 0.5s um do outro num
  // único candidato multi-evidência. Isso evita que 12 detectores
  // heurísticos, ao pegarem o mesmo defeito por ângulos diferentes,
  // produzam 4-5 cortes onde deveria haver 1.
  const deduped = dedupCandidates(clamped);
  return semanticAggregation(deduped);
}

/**
 * Segunda passagem: junta candidatos MUITO próximos temporalmente
 * (< 0.5s de gap) num único grupo. Preserva TODAS as evidências.
 * Diferente de dedupCandidates (que exige overlap ≥ 50%), este junta
 * candidatos adjacentes que representam o MESMO defeito de fala visto
 * por múltiplos detectores.
 *
 * Exemplo:
 *   3.10-3.35 filler       ← detector A
 *   3.35-3.60 silence      ← detector B (0.0s gap)
 *   3.55-3.92 restart      ← detector C (0.05s gap com o filler)
 *   → único grupo 3.10-3.92 com 3 evidências.
 */
export function semanticAggregation(candidates, opts = {}) {
  const MERGE_GAP = opts.mergeGap ?? 0.5;
  if (!candidates?.length) return [];
  const sorted = [...candidates].sort((a, b) => a.start - b.start);
  const groups = [];
  for (const cur of sorted) {
    const last = groups[groups.length - 1];
    // Não mescla se algum é surgical E o tipo é diferente — surgical
    // (stutter, false_start) marca borda de palavra e não pode ser
    // engordado por adjacente de outra natureza.
    const gap = last ? cur.start - last.end : Infinity;
    const bothOrNoneSurgical = (SURGICAL_TYPES.has(last?.primaryType) === SURGICAL_TYPES.has(cur.primaryType));
    if (last && gap <= MERGE_GAP && bothOrNoneSurgical) {
      last.start = Math.min(last.start, cur.start);
      last.end = Math.max(last.end, cur.end);
      last.detectors.push(...cur.detectors);
      // Primary type e confidence: o maior confidence vence.
      if ((cur.confidence ?? 0) > (last.confidence ?? 0)) {
        last.confidence = cur.confidence;
        last.primaryType = cur.primaryType;
      }
      if (cur.text && (!last.text || cur.text.length > last.text.length)) {
        last.text = cur.text;
      }
      last.canOverrideProtection = last.canOverrideProtection || cur.canOverrideProtection;
      if (cur.replacementNote && !last.replacementNote) last.replacementNote = cur.replacementNote;
      if (cur.trimOnly && !last.trimOnly) last.trimOnly = true;
    } else {
      groups.push({ ...cur, detectors: [...cur.detectors] });
    }
  }
  return groups;
}

/**
 * Junta candidatos que se sobrepõem no tempo em > MERGE_OVERLAP_RATIO do
 * menor deles. O resultado carrega TODAS as evidências e escolhe a
 * confiança máxima. primaryType do de maior confiança prevalece; se
 * empatar, mantém o primeiro.
 */
// Cortes surgicais (stutter, false_start, abandoned_phrase) marcam bordas
// exatas de palavra e NÃO podem ser esticados por silêncios adjacentes.
// Ex.: bigram stutter em [3.84, 4.18] + gap silence em [3.5, 5.0] deve
// virar [3.84, 4.18], não [3.5, 5.0].
const SURGICAL_TYPES = new Set(["stutter", "false_start", "abandoned_phrase", "self_correction"]);

export function dedupCandidates(candidates) {
  if (!candidates.length) return [];
  const sorted = [...candidates].sort((a, b) => a.start - b.start);
  const result = [];
  for (const cur of sorted) {
    const merged = result.find((p) => {
      const overlap = Math.max(0, Math.min(p.end, cur.end) - Math.max(p.start, cur.start));
      const minDur = Math.min(p.end - p.start, cur.end - cur.start);
      return minDur > 0 && overlap / minDur >= MERGE_OVERLAP_RATIO;
    });
    if (merged) {
      const mergedIsSurgical = SURGICAL_TYPES.has(merged.primaryType);
      const curIsSurgical = SURGICAL_TYPES.has(cur.primaryType);
      // Se algum dos dois é surgical, preserva as bordas do surgical.
      // (Caso ambos sejam surgical, une normal.)
      if (mergedIsSurgical && !curIsSurgical) {
        // Mantém bordas do merged.
      } else if (curIsSurgical && !mergedIsSurgical) {
        merged.start = cur.start;
        merged.end = cur.end;
      } else {
        merged.start = Math.min(merged.start, cur.start);
        merged.end = Math.max(merged.end, cur.end);
      }
      merged.detectors.push(...cur.detectors);
      if ((cur.confidence ?? 0) > (merged.confidence ?? 0)) {
        merged.confidence = cur.confidence;
        merged.primaryType = cur.primaryType;
      }
      if (cur.text && (!merged.text || cur.text.length > merged.text.length)) {
        merged.text = cur.text;
      }
      merged.canOverrideProtection = merged.canOverrideProtection || cur.canOverrideProtection;
      if (cur.replacementNote && !merged.replacementNote) merged.replacementNote = cur.replacementNote;
      if (cur.repeatedGroupBestIndex != null && merged.repeatedGroupBestIndex == null) {
        merged.repeatedGroupBestIndex = cur.repeatedGroupBestIndex;
      }
      if (cur.trimOnly && !merged.trimOnly) merged.trimOnly = true;
    } else {
      result.push({ id: nextId(), ...cur });
    }
  }
  return result;
}
