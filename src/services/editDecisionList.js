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
import { decideAll } from "./decisionEngine.js";

let _idCounter = 1;
const nextId = () => "edl-" + _idCounter++;

const EPSILON = 0.02;
const MAX_CONSECUTIVE_REMOVE_DUR = 12;
const MIN_OPENING_KEEP_DUR = 0.4;
const MIN_CLOSING_KEEP_DUR = 0.4;

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
  const problemCandidates = decideAll(rawCandidates, {
    profile,
    semanticSentences,
    protectedRanges,
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
  for (const cand of cutsForEdl) {
    // Cortes se sobrepondo — pula os que ficaram para trás do cursor.
    if (cand.end <= cursor + EPSILON) continue;
    const start = Math.max(cursor, cand.start);
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
      end: cand.end,
      action: cand.finalAction,
      reason: cand.primaryType,
      confidence: cand.confidence ?? 0.7,
      narrativeRole: roleAt((start + cand.end) / 2),
      text: cand.text || textInRange(start, cand.end),
      source: cand.detectors?.[0]?.detector || "unknown",
      contextSafe: cand.contextSafe !== false,
      candidateId: cand.id,
      ...(cand.contextGuardReason ? { contextGuardReason: cand.contextGuardReason } : {}),
      ...(cand.safety ? { safety: cand.safety } : {}),
      ...(cand.replacementNote ? { replacementNote: cand.replacementNote } : {}),
    });
    cursor = cand.end;
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
  const edl = applySafetyValidators(compact, { duration });

  return { edl, problemCandidates };
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
  return result;
}

function applySafetyValidators(items, { duration }) {
  if (!items.length) return items;

  if (items[0].action !== "keep") {
    items[0] = { ...items[0], action: "review", safety: "abrupt_open" };
  } else if (items[0].end - items[0].start < MIN_OPENING_KEEP_DUR && items[1]?.action !== "keep") {
    items[1] = { ...items[1], action: "review", safety: "abrupt_open" };
  }

  const last = items[items.length - 1];
  if (last.action !== "keep") {
    items[items.length - 1] = { ...last, action: "review", safety: "abrupt_close" };
  } else if (last.end - last.start < MIN_CLOSING_KEEP_DUR && items.length >= 2 && items[items.length - 2].action !== "keep") {
    const idx = items.length - 2;
    items[idx] = { ...items[idx], action: "review", safety: "abrupt_close" };
  }

  let streakDur = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.action === "remove" || it.action === "trim") {
      streakDur += it.end - it.start;
      if (streakDur > MAX_CONSECUTIVE_REMOVE_DUR) {
        items[i] = { ...it, action: "review", safety: "long_removal_streak" };
        streakDur = 0;
      }
    } else {
      streakDur = 0;
    }
  }

  return items;
}

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
