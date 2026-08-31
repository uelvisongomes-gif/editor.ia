// Style Engine — Item 3 e 40. Orquestrador central.
//
// Fluxo:
//   analyses (Fase 1-4) → extractTriggers → decideEffects (by style) →
//   applyCooldowns → applyDensityBudget → resolveConflicts → TimelineEvent[]
//
// Determinístico com seed opcional (Item 23). Não substitui pipeline — só
// PRODUZ decisões visuais coerentes a partir do que a IA já sabe.

import { getStyleById, markRecent } from "./styleRegistry.js";
import { extractTriggers } from "./triggerEngine.js";
import { decideEffects } from "./effectDecisionLayer.js";
import { applyCooldowns, applyDensityBudget } from "./visualDensityBudget.js";
import { resolveConflicts } from "./conflictResolver.js";
import { createSeededRng } from "./seedRandom.js";
import { scheduleCompositions } from "./compositionEngine.js";

/**
 * @param {object} args
 * @param {string} args.styleId
 * @param {object} args.analysis        - pipeline result (narrative, words, audioReport, productMoments, patternInterrupts, brollPlan, ...)
 * @param {number} args.duration
 * @param {string} [args.seed]          - project-scoped, default = "no-seed"
 * @param {object} [args.overrides]     - style overrides no vôo (Item 21 hierarchy)
 * @param {object} [args.context]       - hasProduct etc
 * @param {Function} [args.onLog]       - DEV logs
 * @returns {{ style, events, triggers, dropped, summary }}
 */
export function runStyleEngine({
  styleId, analysis, duration = 60, seed = "no-seed", overrides, context = {}, onLog,
} = {}) {
  const styleRaw = getStyleById(styleId);
  // Se overrides for um styleConfig completo (com triggers e budget), usa-o direto
  // Caso contrário busca no registry e aplica overrides parciais
  let style;
  if (overrides && overrides.triggers && overrides.budget) {
    style = { ...overrides, brandKit: { ...(overrides.brandKit || {}) } };
  } else if (styleRaw) {
    style = overrides ? mergeOverrides(styleRaw, overrides) : styleRaw;
  } else {
    return emptyResult(`style "${styleId}" not found and no complete override`);
  }

  const rng = createSeededRng(`${seed}::${style.id}::${style.version}`);
  // 1. Extrai triggers
  const triggers = extractTriggers({
    narrative: analysis?.narrative,
    words: analysis?.words,
    audioReport: analysis?.audioReport,
    productMoments: analysis?.productMoments,
    patternInterrupts: analysis?.patternInterrupts,
  });
  onLog?.({ phase: "triggers", count: triggers.length });

  // 2. Decide efeitos
  const enrichedContext = {
    hasProduct: (analysis?.productMoments?.moments?.length || 0) > 0,
    ...context,
  };
  const rawEvents = decideEffects({ triggers, style, rng, context: enrichedContext });
  onLog?.({ phase: "decide", count: rawEvents.length });

  // 3. Cooldowns
  const { kept: afterCooldown, dropped: droppedCd } = applyCooldowns(rawEvents, style.budget.cooldowns);
  onLog?.({ phase: "cooldowns", kept: afterCooldown.length, dropped: droppedCd.length });

  // 4. Density budget
  const { kept: afterBudget, dropped: droppedBudget, summary: budgetSummary } = applyDensityBudget(afterCooldown, {
    density: style.budget.density, maxEventsPerMin: style.budget.maxEventsPerMin, duration,
  });
  onLog?.({ phase: "density", ...budgetSummary });

  // 5. Conflict resolver
  const { kept: finalEvents, dropped: droppedConflict } = resolveConflicts(afterBudget);
  onLog?.({ phase: "conflict", kept: finalEvents.length, dropped: droppedConflict.length });

  // 6. Composition scheduler — decide COMO A TELA É COMPOSTA por momento
  const compositionBehavior = context.compositionBehavior || style.compositionBehavior || {};
  const brollSuggestions = analysis?.brollPlan?.suggestions || [];
  const compositionSchedule = scheduleCompositions({
    narrative: analysis?.narrative, triggers, brollSuggestions,
    compositionBehavior, duration, rng,
  });
  onLog?.({ phase: "composition", total: compositionSchedule.segments.length, byComp: compositionSchedule.summary.byComposition });

  markRecent(style.id);

  return {
    style, events: finalEvents, triggers,
    compositionSchedule,
    dropped: {
      cooldown: droppedCd, budget: droppedBudget, conflict: droppedConflict,
      totalDropped: droppedCd.length + droppedBudget.length + droppedConflict.length,
    },
    summary: {
      styleId: style.id, styleName: style.name, category: style.category, version: style.version,
      triggerCount: triggers.length,
      rawEventCount: rawEvents.length,
      finalEventCount: finalEvents.length,
      byCategory: finalEvents.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + 1; return acc; }, {}),
      effectiveDensityPerMin: budgetSummary.effectiveDensityPerMin,
      compositionCount: compositionSchedule.segments.length,
      compositionsByType: compositionSchedule.summary.byComposition,
      nonSpeakerRatio: compositionSchedule.summary.nonSpeakerRatio,
    },
  };
}

function mergeOverrides(base, overrides) {
  return {
    ...base,
    pacing: { ...base.pacing, ...(overrides.pacing || {}) },
    budget: {
      ...base.budget,
      ...(overrides.budget || {}),
      cooldowns: { ...base.budget.cooldowns, ...(overrides.budget?.cooldowns || {}) },
    },
    brandKit: { ...base.brandKit, ...(overrides.brandKit || {}) },
    triggers: { ...base.triggers, ...(overrides.triggers || {}) },
  };
}

function emptyResult(reason) {
  return { style: null, events: [], triggers: [], dropped: {}, summary: { reason, finalEventCount: 0 } };
}
