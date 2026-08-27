// buildEDL agora orquestra três camadas separadas:
//
//   1) candidateAggregator.collectCandidates(...) — colhe TUDO que os
//      detectores acharam, sem julgar. Dedupa por overlap temporal.
//      Este array é o problemCandidates — o painel "Problemas encontrados"
//      renderiza ele direto e mostra até o que não virou corte.
//
//   2) decisionEngine.decideAll(...) — para cada candidato, decide se
//      vira remove/trim/review/detected_only e por quê. Rastreia
//      blockedReasons (context guard, low confidence, duration cap,
//      protected role) pra que qualquer "não cortou" seja explicável.
//
//   3) A EDL propriamente dita é montada a partir das decisões:
//      cobertura estrita de [0, duration] com keep entre os cortes.
//
// A saída é um objeto {edl, problemCandidates} — quem chama pode usar
// só a EDL (timeline), só os candidates (painel de diagnóstico), ou os dois.

import { collectCandidates } from "./candidateAggregator.js";
import { decideAll, applySafetyValidators } from "./decisionEngine.js";

let _idCounter = 1;
const nextId = () => "edl-" + _idCounter++;

const EPSILON = 0.02;

/**
 * @returns {{edl: Array, problemCandidates: Array}}
 */
export function buildEDL({ duration, words, semantic, silences, speechErrors, profile }) {
  // 1) Colhe candidatos crus (sem julgar).
  const rawCandidates = collectCandidates({ words, semantic, silences, speechErrors, profile });

  // 2) Prepara contexto para o decision engine.
  const semanticSentences = semantic?.sentences || [];
  const protectedRanges = [];
  for (const s of semanticSentences) {
    if (profile.preserveRoles?.includes(s.role)) protectedRanges.push([s.start, s.end]);
  }

  // 3) Decide o destino de cada candidato — este é o problemCandidates.
  //    words é passado pro boundaryRefinement dentro do decisionEngine.
  const problemCandidates = decideAll(rawCandidates, {
    profile,
    semanticSentences,
    protectedRanges,
    words,
  });

  // 4) Monta a EDL de fato — só os que viraram remove/trim/review entram.
  //    detected_only e dropped ficam SÓ no problemCandidates.
  const cutsForEdl = problemCandidates.filter(
    (c) => c.finalAction === "remove" || c.finalAction === "trim" || c.finalAction === "review"
  ).sort((a, b) => a.start - b.start);

  const sortedNarrative = [...semanticSentences].sort((a, b) => a.start - b.start);
  const roleAt = (t) => {
    const s = sortedNarrative.find((s) => t >= s.start - EPSILON && t < s.end + EPSILON);
    return s ? s.role : null;
  };
  const textInRange = (start, end) => {
    if (!words?.length) return "";
    return words.filter((w) => w.start >= start - EPSILON && w.end <= end + EPSILON)
      .map((w) => w.word).join(" ").trim();
  };

  const items = [];
  let cursor = 0;
  // Usa CUTBORDS (cutStart/cutEnd), não as bordas do candidato — quando
  // o boundary refinement encolheu o corte, aqui é onde a decisão vira
  // realidade na timeline.
  const sortedCuts = [...cutsForEdl].sort((a, b) => (a.cutStart ?? a.start) - (b.cutStart ?? b.start));
  for (const cand of sortedCuts) {
    const cs = cand.cutStart ?? cand.start;
    const ce = cand.cutEnd ?? cand.end;
    if (ce <= cursor + EPSILON) continue;
    const start = Math.max(cursor, cs);
    if (start > cursor + EPSILON) {
      items.push({
        id: nextId(),
        start: cursor,
        end: start,
        action: "keep",
        reason: "content",
        confidence: 1,
        narrativeRole: roleAt((cursor + start) / 2),
        text: textInRange(cursor, start),
        source: "keep",
      });
    }
    items.push({
      id: nextId(),
      start,
      end: ce,
      action: cand.finalAction,
      reason: cand.primaryType,
      confidence: cand.confidence ?? 0.7,
      narrativeRole: roleAt((start + ce) / 2),
      text: cand.text || textInRange(start, ce),
      source: cand.detectors?.[0]?.detector || "unknown",
      contextSafe: cand.contextSafe !== false,
      candidateId: cand.id,
      // Preservar a região analisada original — a UI mostra em "REGIÃO ANALISADA"
      analyzedStart: cand.start,
      analyzedEnd: cand.end,
      ...(cand.boundaryNote ? { boundaryNote: cand.boundaryNote } : {}),
      ...(cand.contextGuardReason ? { contextGuardReason: cand.contextGuardReason } : {}),
      ...(cand.safety ? { safety: cand.safety } : {}),
      ...(cand.replacementNote ? { replacementNote: cand.replacementNote } : {}),
    });
    cursor = ce;
  }
  if (cursor < duration - EPSILON) {
    items.push({
      id: nextId(),
      start: cursor,
      end: duration,
      action: "keep",
      reason: "content",
      confidence: 1,
      narrativeRole: roleAt((cursor + duration) / 2),
      text: textInRange(cursor, duration),
      source: "keep",
    });
  }

  const compact = collapseTinyKeeps(items);
  const consolidated = consolidateEDL(compact);
  const edl = applySafetyValidators(consolidated, { duration });

  return { edl, problemCandidates };
}

/**
 * Segunda passagem: junta cortes REMOVE adjacentes que têm um "keep"
 * pequeno (< 0.4s) entre eles OU um review pequeno. Objetivo: evitar
 * timeline picotada tipo REMOVE-KEEP-REMOVE-KEEP-REMOVE quando o "keep"
 * do meio é uma respirada sem conteúdo.
 *
 * Regra:
 *   REMOVE (>= 0.15s) + KEEP (< 0.4s, sem texto ou texto de 1 palavra)
 *     + REMOVE (>= 0.15s)  →  vira UM REMOVE de start a end.
 *
 * NÃO junta se o keep do meio tem texto real (2+ palavras) — isso seria
 * remover conteúdo bom pra "arrumar" o ritmo.
 */
function consolidateEDL(items) {
  if (items.length < 3) return items;
  const result = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    const next = items[i + 1];
    const nextNext = items[i + 2];
    if (
      next && nextNext &&
      (cur.action === "remove" || cur.action === "trim") &&
      next.action === "keep" &&
      (nextNext.action === "remove" || nextNext.action === "trim") &&
      (next.end - next.start) < 0.4 &&
      wordCount(next.text) <= 1
    ) {
      // Merge os 3 num único remove — bordas do primeiro e do último
      result.push({
        ...cur,
        end: nextNext.end,
        reason: cur.reason || nextNext.reason,
        text: [cur.text, next.text, nextNext.text].filter(Boolean).join(" "),
      });
      i += 3;
      continue;
    }
    result.push(cur);
    i += 1;
  }
  return result;
}

function wordCount(s) {
  if (!s) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function collapseTinyKeeps(items) {
  const result = [];
  for (const item of items) {
    const prev = result[result.length - 1];
    const isTiny = item.action === "keep" && item.end - item.start < 0.15 && !item.text;
    if (isTiny && prev && (prev.action === "remove" || prev.action === "trim")) {
      prev.end = item.end;
      continue;
    }
    result.push(item);
  }
  // Caso especial: primeiro item é keep silencioso (sem texto) com dur < 1s,
  // seguido por remove. Isso é padding inicial (chiado/silêncio antes da
  // fala) — funde no remove seguinte pra o vídeo começar limpo.
  if (result.length >= 2) {
    const first = result[0];
    const second = result[1];
    const firstIsSilentPad = first.action === "keep" && !first.text && (first.end - first.start) < 1.0;
    if (firstIsSilentPad && (second.action === "remove" || second.action === "trim")) {
      second.start = first.start;
      result.shift();
    }
  }
  return result;
}

// applySafetyValidators foi movido para decisionEngine.js — safety é
// decisão (turn remove→review), não construção de EDL.

// Labels pt-BR usadas na UI. Nomes internos nunca vão pro usuário.
export const REASON_LABELS = {
  long_pause: "Pausa longa",
  filler: "Muleta / hesitação",
  stutter: "Gagueira / repetição",
  false_start: "Frase reiniciada",
  abandoned_phrase: "Frase abandonada",
  self_correction: "Autocorreção",
  repeated_idea: "Ideia repetida",
  off_topic: "Fora do assunto",
  low_value: "Pouco relevante",
  low_clarity: "Fala pouco clara — considere remover",
  trim_low_importance: "Encurtar",
  content: "Conteúdo mantido",
  manual: "Ajuste manual",
};

export const SAFETY_LABELS = {
  abrupt_open: "Poderia deixar o começo abrupto",
  abrupt_close: "Poderia deixar o final abrupto",
  long_removal_streak: "Muitos cortes seguidos",
  cut_too_long: "Corte longo demais — revise antes de aplicar",
};

export const CONTEXT_GUARD_LABELS = {
  next_segment_depends_on_removed_context: "Próxima fala depende deste trecho",
  next_segment_has_unresolved_reference: "Próxima fala começa com referência (ex: \"isso\", \"então\")",
  previous_segment_expects_continuation: "Fala anterior fica incompleta sem este trecho",
  role_protected: "Trecho protegido (hook/CTA)",
  repetition_versions_look_complementary: "Repetição aparente pode ser complemento, não redundância",
  part_of_rhetorical_anaphora: "Parte de estrutura repetida propositalmente (anáfora)",
  internal_enumeration: "Enumeração de itens diferentes — cada um é informação nova",
};

export function labelContextGuard(code) {
  return CONTEXT_GUARD_LABELS[code] || code;
}

export function labelReason(code) {
  return REASON_LABELS[code] || code;
}

export function labelSafety(code) {
  return SAFETY_LABELS[code] || null;
}
