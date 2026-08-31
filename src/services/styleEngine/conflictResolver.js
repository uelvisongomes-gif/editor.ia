// Effect Conflict Resolver — Item 13.
// Quando múltiplos efeitos overlapam no mesmo instante, escolhe os
// compatíveis segundo:
//   - prioridade categórica (fala > narrativa > produto > legenda > efeito)
//   - confidence
//   - "não empilhar tudo": max 1 por categoria (exceto caption, sempre)
//
// Item 14 hierarquia:
//   1 fala · 2 narrativa · 3 produto · 4 clareza · 5 elemento visual
//   6 legenda · 7 efeito · 8 decoração

const CATEGORY_PRIORITY = {
  camera:     10,  // reframe é fala/clareza
  caption:    9,   // sempre mantida
  media:      8,   // B-roll = elemento visual principal
  text:       7,
  graphic:    6,
  zoom:       5,
  transition: 4,
  special:    3,
  sfx:        2,
};

// Grupos que NÃO podem coexistir simultaneamente
const EXCLUSIVE_GROUPS = [
  ["zoom", "camera"],           // não zoom + reframe brusco juntos
  ["text", "graphic", "media"], // um dos três dominantes de cada vez
];

/**
 * @param {TimelineEvent[]} events
 * @param {object} opts
 * @param {number} [opts.overlapTolerance=0.05]  - seg
 * @returns {{ kept: TimelineEvent[], dropped: TimelineEvent[] }}
 */
export function resolveConflicts(events = [], { overlapTolerance = 0.05 } = {}) {
  if (!events.length) return { kept: [], dropped: [] };
  const sorted = [...events].sort((a, b) => a.start - b.start || CATEGORY_PRIORITY[b.category] - CATEGORY_PRIORITY[a.category]);
  const kept = [];
  const dropped = [];

  for (const evt of sorted) {
    const active = kept.filter((k) => k.end > evt.start - overlapTolerance && k.start < evt.end + overlapTolerance);
    let conflict = null;

    // 1. Caption sempre passa
    if (evt.category === "caption") { kept.push(evt); continue; }

    // 2. Categoria já ocupada?
    conflict = active.find((a) => a.category === evt.category);
    if (conflict && evt.category !== "caption") {
      const evtScore = scoreEvent(evt);
      const conflictScore = scoreEvent(conflict);
      if (evtScore > conflictScore) {
        removeFromKept(kept, conflict); dropped.push({ ...conflict, droppedBy: evt.id });
      } else {
        dropped.push({ ...evt, droppedBy: conflict.id }); continue;
      }
    }

    // 3. Grupos exclusivos
    let dropByGroup = false;
    for (const group of EXCLUSIVE_GROUPS) {
      if (!group.includes(evt.category)) continue;
      const groupActive = active.filter((a) => group.includes(a.category) && a.category !== evt.category);
      for (const ga of groupActive) {
        if (scoreEvent(ga) >= scoreEvent(evt)) {
          dropped.push({ ...evt, droppedBy: ga.id, reason: "exclusive_group" });
          dropByGroup = true;
          break;
        } else {
          removeFromKept(kept, ga); dropped.push({ ...ga, droppedBy: evt.id, reason: "exclusive_group" });
        }
      }
      if (dropByGroup) break;
    }
    if (dropByGroup) continue;

    kept.push(evt);
  }

  return { kept, dropped };
}

function scoreEvent(e) {
  const priority = CATEGORY_PRIORITY[e.category] || 0;
  const conf = (e.confidence ?? 0.5);
  return priority + conf * 3;
}

function removeFromKept(kept, evt) {
  const i = kept.findIndex((k) => k.id === evt.id);
  if (i >= 0) kept.splice(i, 1);
}
