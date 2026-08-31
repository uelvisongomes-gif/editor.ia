// Effect Decision Layer — Items 9, 10, 15, 31.
// Recebe triggers + style.triggers → escolhe animações usando priority/chance/requires.
//
// A IA definiu QUANDO (triggers). O style define COMO. Este layer casa os dois.

import { runAnimation, animationExists } from "./animationRegistry.js";
import { roll } from "./seedRandom.js";

/**
 * Verifica se um TriggerBinding pode ser aplicado.
 * `requires` lista strings simples como "hasNumber", "notInCta".
 */
function requirementsMet(binding, trigger, ctx) {
  if (!binding.requires?.length) return true;
  for (const req of binding.requires) {
    switch (req) {
      case "hasNumber":  if (trigger.type !== "NUMBER") return false; break;
      case "hasPrice":   if (trigger.type !== "PRICE") return false; break;
      case "notInCta":   if (ctx.recentCta && Math.abs(trigger.t - ctx.recentCta) < 3) return false; break;
      case "isCritical": if ((trigger.meta?.importance) !== "critical") return false; break;
      case "hasProduct": if (!ctx.hasProduct) return false; break;
      default: break;
    }
  }
  return true;
}

/**
 * @param {object} args
 * @param {import("./triggerEngine.js").Trigger[]} args.triggers
 * @param {import("./styleSchema.js").StyleConfig} args.style
 * @param {Function} args.rng
 * @param {object} args.context   - hasProduct, recentCta, etc.
 * @returns {import("./animationRegistry.js").TimelineEvent[]}
 */
export function decideEffects({ triggers = [], style, rng = Math.random, context = {} } = {}) {
  if (!style?.triggers) return [];
  const events = [];
  let recentCta = null;

  for (const trigger of triggers) {
    if (trigger.type === "CTA") recentCta = trigger.t;
    const bindings = style.triggers[trigger.type];
    if (!bindings?.length) continue;

    // Ordena bindings por priority desc + chance (com seed)
    const eligible = bindings
      .filter((b) => animationExists(b.animation))
      .filter((b) => requirementsMet(b, trigger, { ...context, recentCta }))
      .filter((b) => roll(rng, b.chance ?? 1));

    if (!eligible.length) continue;

    // Escolhe o de maior priority (empate resolvido pela ordem do array)
    const chosen = eligible.reduce((best, cur) => (cur.priority ?? 0.5) > (best.priority ?? 0.5) ? cur : best, eligible[0]);

    const evt = runAnimation(chosen.animation, {
      t: trigger.t,
      tEnd: trigger.tEnd,
      brandKit: style.brandKit,
      trigger,
      styleId: style.id,
      rng,
    }, chosen.params || {}, chosen.fallback || "hard_cut");

    if (evt) events.push(evt);
  }
  return events;
}
