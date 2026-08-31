// Style Events Bridge — traduz TimelineEvents do Style Engine para os
// shapes que o renderer do App.jsx já consome (zoomEvents, graphicsPlan.overlays,
// brollPlan.suggestions). Isso permite Style Engine controlar o visual sem
// reescrever drawFrame/preview.
//
// Bridge é DERIVATIVA: se o usuário não seleciona estilo, App usa os planos
// originais do pipeline; se seleciona, o bridge assume.

/**
 * @param {import("./animationRegistry.js").TimelineEvent[]} events
 * @returns {{ zoomEvents, overlays, brollSuggestions, transitions, sfx }}
 */
export function bridgeStyleEventsToApp(events = []) {
  const zoomEvents = [];
  const overlays = [];
  const brollSuggestions = [];
  const transitions = [];
  const sfx = [];

  for (const e of events) {
    if (e.category === "zoom") {
      zoomEvents.push({
        id: e.id,
        start: e.start,
        end: e.end,
        level: e.params?.scale >= 1.12 ? "high" : e.params?.scale >= 1.06 ? "medium" : "low",
        scale: e.params?.scale ?? 1.06,
        reason: e.reason,
        source: "style_engine",
        animation: e.animation,
      });
      continue;
    }
    if (e.category === "text") {
      overlays.push({
        id: e.id,
        kind: e.animation === "big_number" ? "big_number" : "text_overlay",
        start: e.start,
        end: e.end,
        text: e.params?.text || "",
        colorFrom: e.params?.colorFrom,
        colorTo: e.params?.colorTo,
        font: e.params?.font,
        sizeVw: e.params?.sizeVw,
        position: e.params?.position,
        source: "style_engine",
        animation: e.animation,
      });
      continue;
    }
    if (e.category === "graphic") {
      overlays.push({
        id: e.id,
        kind: "graphic",
        subkind: e.animation,
        start: e.start,
        end: e.end,
        text: e.params?.text || "",
        colorFrom: e.params?.color,
        source: "style_engine",
        animation: e.animation,
      });
      continue;
    }
    if (e.category === "media") {
      brollSuggestions.push({
        id: e.id,
        start: e.start,
        end: e.end,
        query: e.params?.query || "",
        media: e.params?.mediaUrl ? [{ url: e.params.mediaUrl, attribution: "Style Engine" }] : [],
        confidence: e.confidence,
        reason: e.reason,
        source: "style_engine",
        animation: e.animation,
        mode: e.params?.mode || "fullscreen",
        opacity: e.params?.opacity ?? 0.85,
      });
      continue;
    }
    if (e.category === "transition") {
      transitions.push({
        id: e.id,
        t: e.start,
        kind: e.animation,
        durationSec: e.end - e.start,
        source: "style_engine",
      });
      continue;
    }
    if (e.category === "sfx") {
      sfx.push({
        id: e.id,
        t: e.start,
        end: e.end,
        sfxId: e.params?.sfxId,
        volumeDb: e.params?.volumeDb,
        source: "style_engine",
        animation: e.animation,
      });
      continue;
    }
    // camera + special — ficam pra próxima milestone
  }

  return { zoomEvents, overlays, brollSuggestions, transitions, sfx };
}

/**
 * Merge conservativo — quando existe styleResult, ele DOMINA (substitui).
 * Quando não existe, retorna os planos originais.
 */
export function chooseVisualSource({ styleResult, brollPlan, graphicsPlan, zoomEvents, transitionPlan }) {
  if (!styleResult?.events?.length) {
    return {
      zoomEvents: zoomEvents || [],
      overlays: graphicsPlan?.overlays || [],
      brollSuggestions: brollPlan?.suggestions || [],
      transitions: transitionPlan?.transitions || [],
      sfx: [],
      source: "pipeline",
    };
  }
  const bridged = bridgeStyleEventsToApp(styleResult.events);
  return {
    ...bridged,
    source: "style_engine",
  };
}
