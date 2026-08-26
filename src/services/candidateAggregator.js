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
]);

/**
 * Colhe todos os candidatos das fontes disponíveis. Não decide nada — só
 * junta e dedupa.
 */
export function collectCandidates({ words, semantic, silences, speechErrors, profile }) {
  const candidates = [];

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
      candidates.push({
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
      });
    }
  }

  // 3) Repetições semânticas.
  if (profile.removeRepeats && semantic?.repeatedGroups?.length) {
    const byIndex = new Map((semantic.sentences || []).map((s) => [s.index, s]));
    for (const group of semantic.repeatedGroups) {
      const best = group.bestIndex;
      for (const idx of group.indexes) {
        if (idx === best) continue;
        const s = byIndex.get(idx);
        if (!s) continue;
        candidates.push({
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
        });
      }
    }
  }

  // 4) Off-topic.
  if (profile.removeOffTopic && semantic?.offTopicIndexes?.length) {
    const byIndex = new Map((semantic.sentences || []).map((s) => [s.index, s]));
    for (const idx of semantic.offTopicIndexes) {
      const s = byIndex.get(idx);
      if (!s) continue;
      candidates.push({
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
      });
    }
  }

  // 5) Advice do LLM por sentença.
  if (semantic?.sentences?.length) {
    for (const s of semantic.sentences) {
      if (s.keepAdvice === "consider_remove") {
        candidates.push({
          start: s.start,
          end: s.end,
          text: s.text,
          primaryType: "low_value",
          confidence: 0.6,
          detectors: [{
            detector: "semantic",
            reason: "low_value",
            confidence: 0.6,
            evidence: `LLM sugeriu consider_remove; importance=${s.importance || "?"}`,
          }],
          canOverrideProtection: false,
        });
      } else if (s.keepAdvice === "trim" && profile.trimLowImportance) {
        candidates.push({
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
        });
      }
    }
  }

  return dedupCandidates(candidates);
}

/**
 * Junta candidatos que se sobrepõem no tempo em > MERGE_OVERLAP_RATIO do
 * menor deles. O resultado carrega TODAS as evidências e escolhe a
 * confiança máxima. primaryType do de maior confiança prevalece; se
 * empatar, mantém o primeiro.
 */
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
      merged.start = Math.min(merged.start, cur.start);
      merged.end = Math.max(merged.end, cur.end);
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
