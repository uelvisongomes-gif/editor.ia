// Composition Engine — decide QUAL composição usar em cada momento.
//
// Consome: narrative timeline + triggers + mídia disponível + preset behavior
// Produz: lista de "composition segments" que cobrem toda a duração do vídeo.
//
// Regras:
//   - default: full_speaker (todo trecho não coberto)
//   - se trigger NUMBER + preset permite big_number → big_number_composed
//   - se trigger PROOF/PRODUCT/PROBLEM + mídia disponível + preset permite → top_media_bottom_speaker OU full_broll OU pip
//   - se trigger EMOTION/critical → quote quando texto curto disponível
//   - cooldown entre composições: mínimo 1.5s de full_speaker entre trocas
//   - nunca fica > 4s em composição não-speaker sem voltar

import { getComposition, compositionSupportsMedia, listCompositions } from "./compositionRegistry.js";
import { roll, jitter } from "./seedRandom.js";

/**
 * @typedef {Object} CompositionSegment
 * @property {string} compositionId
 * @property {number} start
 * @property {number} end
 * @property {object} slotContent   - map anchor → conteúdo (mediaUrl, text, number, etc)
 * @property {string} reason
 * @property {number} confidence
 * @property {object[]} events      - eventos que originaram esta composição
 */

const MIN_SPEAKER_GAP = 1.2;
const MAX_NON_SPEAKER_DURATION = 5.0;

/**
 * @param {object} args
 * @param {object} args.narrative
 * @param {import("./triggerEngine.js").Trigger[]} args.triggers
 * @param {Array} args.brollSuggestions    - com media[] anexado
 * @param {object} args.compositionBehavior - do preset { full_speaker: 0.5, top_media_bottom_speaker: 0.3, ... }
 * @param {number} args.duration
 * @param {Function} args.rng
 * @returns {{ segments: CompositionSegment[], summary: object }}
 */
export function scheduleCompositions({
  narrative, triggers = [], brollSuggestions = [], compositionBehavior = {},
  duration = 60, rng = Math.random,
} = {}) {
  const segments = [];
  const impls = listCompositions({ implementedOnly: true });

  const hasBroll = (t, tEnd) => brollSuggestions.find((b) => b.start <= t && b.end >= tEnd);
  const brollNear = (t) => brollSuggestions.find((b) => Math.abs(b.start - t) < 2 && b.media?.length);

  // Sort triggers by t
  const sorted = [...triggers].sort((a, b) => a.t - b.t);

  for (const trig of sorted) {
    const behavior = compositionBehavior || {};
    const candidates = [];

    // Big number composition
    if (trig.type === "NUMBER" || trig.type === "PRICE") {
      const chance = behavior.big_number_composed ?? 0.6;
      if (roll(rng, chance)) {
        candidates.push({
          compositionId: "big_number_composed",
          slotContent: { number: trig.value || trig.text, speaker: true },
          reason: `${trig.type} → big_number`,
          duration: Math.min(3, jitter(rng, 1.8, 2.5)),
          priority: 0.9,
          confidence: trig.confidence,
        });
      }
    }

    // Media-driven compositions
    if (["PROOF", "PROBLEM", "SOLUTION", "PRODUCT_DEMONSTRATION", "BEFORE_AFTER"].includes(trig.type)) {
      const broll = brollNear(trig.t);
      const mediaUrl = broll?.media?.[0]?.url;
      if (mediaUrl) {
        // Escolhe entre 3 layouts baseado em behavior
        const topBottom = behavior.top_media_bottom_speaker ?? 0.4;
        const pip = behavior.picture_in_picture ?? 0.25;
        const full = behavior.full_broll ?? 0.2;
        const totals = topBottom + pip + full;
        if (totals > 0) {
          const r = rng() * totals;
          let composition;
          if (r < topBottom) composition = "top_media_bottom_speaker";
          else if (r < topBottom + pip) composition = "picture_in_picture";
          else composition = "full_broll";
          candidates.push({
            compositionId: composition,
            slotContent: { media: mediaUrl, speaker: true, attribution: broll.media[0].attribution },
            reason: `${trig.type} + media → ${composition}`,
            duration: Math.min(4, jitter(rng, 2.5, 3.5)),
            priority: 0.85,
            confidence: trig.confidence * 0.9,
          });
        }
      }
    }

    // Quote — emotional or critical + text short enough
    if (trig.type === "EMOTION" || (trig.type === "HOOK" && trig.text?.length < 80)) {
      const chance = behavior.quote ?? 0.15;
      if (roll(rng, chance) && trig.text) {
        candidates.push({
          compositionId: "quote",
          slotContent: { quote: trig.text, speaker: true },
          reason: `${trig.type} → quote`,
          duration: Math.min(4, jitter(rng, 2.5, 3.5)),
          priority: 0.75,
          confidence: trig.confidence * 0.85,
        });
      }
    }

    // Pega o candidato de maior prioridade
    if (!candidates.length) continue;
    const chosen = candidates.reduce((best, cur) => (cur.priority > best.priority ? cur : best), candidates[0]);
    const start = trig.t;
    const end = Math.min(duration, start + chosen.duration);

    // Cap max non-speaker duration
    const effectiveEnd = Math.min(end, start + MAX_NON_SPEAKER_DURATION);

    // Não sobrepor: se último segment ainda ativo em start, pula
    const last = segments[segments.length - 1];
    if (last && last.end > start - 0.1) continue;
    // Cooldown speaker: se último segment terminou < MIN_SPEAKER_GAP atrás, pula
    if (last && start - last.end < MIN_SPEAKER_GAP) continue;

    segments.push({
      compositionId: chosen.compositionId,
      start, end: effectiveEnd,
      slotContent: chosen.slotContent,
      reason: chosen.reason,
      confidence: chosen.confidence,
      events: [trig],
    });
  }

  // Preenche gaps com full_speaker
  const filled = fillGapsWithSpeaker(segments, duration);

  return {
    segments: filled,
    summary: {
      total: filled.length,
      byComposition: filled.reduce((acc, s) => {
        acc[s.compositionId] = (acc[s.compositionId] || 0) + 1;
        return acc;
      }, {}),
      nonSpeakerRatio: filled.filter((s) => s.compositionId !== "full_speaker")
                             .reduce((sum, s) => sum + (s.end - s.start), 0) / Math.max(0.1, duration),
    },
  };
}

function fillGapsWithSpeaker(segments, duration) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const filled = [];
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.start > cursor + 0.05) {
      filled.push({
        compositionId: "full_speaker",
        start: cursor, end: seg.start,
        slotContent: { speaker: true },
        reason: "default full_speaker",
        confidence: 1.0, events: [],
      });
    }
    filled.push(seg);
    cursor = seg.end;
  }
  if (cursor < duration - 0.05) {
    filled.push({
      compositionId: "full_speaker",
      start: cursor, end: duration,
      slotContent: { speaker: true },
      reason: "default full_speaker",
      confidence: 1.0, events: [],
    });
  }
  return filled;
}

/**
 * Retorna a composição ativa em um instante t.
 */
export function compositionAt(schedule, t) {
  if (!schedule?.segments?.length) return null;
  return schedule.segments.find((s) => t >= s.start && t < s.end) || schedule.segments[0];
}
