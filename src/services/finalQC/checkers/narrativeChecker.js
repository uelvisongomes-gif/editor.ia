// Narrative Checker — Item 6.
// Compara mapa narrativo com o que SOBREVIVEU aos cortes.
// Se algo essencial (hook/CTA/proof) foi removido acidentalmente → alerta.

import { makeIssue, SEVERITY } from "../qcSeverity.js";

export function checkNarrative({ narrative, segments = [] } = {}) {
  if (!narrative?.timeline) return [];
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  const inActive = (t) => active.some((s) => t >= s.start && t < s.end);
  const issues = [];

  const roles = ["hook", "cta", "proof", "solution", "point"];
  for (const role of roles) {
    const originalOfRole = narrative.timeline.filter((n) => n.role === role);
    if (!originalOfRole.length) continue;
    const survived = originalOfRole.filter((n) => inActive(n.start) || inActive(n.end));
    if (originalOfRole.length && !survived.length) {
      const first = originalOfRole[0];
      issues.push(makeIssue({
        type: "narrative_element_lost",
        severity: (role === "hook" || role === "cta") ? SEVERITY.CRITICAL : SEVERITY.HIGH,
        start: first.start,
        end: first.end,
        description: `Elemento narrativo "${role}" foi removido dos cortes finais`,
        auto_fixable: false,
        params: { role, count: originalOfRole.length },
        checker: "narrative",
      }));
    } else if (originalOfRole.length > 1 && survived.length < originalOfRole.length / 2) {
      issues.push(makeIssue({
        type: "narrative_element_reduced",
        severity: SEVERITY.MEDIUM,
        description: `"${role}": ${survived.length}/${originalOfRole.length} sobreviveram`,
        auto_fixable: false,
        params: { role, survived: survived.length, total: originalOfRole.length },
        checker: "narrative",
      }));
    }
  }
  return issues;
}
