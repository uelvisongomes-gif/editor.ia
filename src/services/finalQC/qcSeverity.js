// QC Severity — taxonomia dos 5 níveis (Item 2 da Fase 5).
// Toda issue emitida por checkers usa uma dessas.

export const SEVERITY = {
  INFO:     "info",
  LOW:      "low",
  MEDIUM:   "medium",
  HIGH:     "high",
  CRITICAL: "critical",
};

export const SEVERITY_ORDER = [
  SEVERITY.INFO, SEVERITY.LOW, SEVERITY.MEDIUM, SEVERITY.HIGH, SEVERITY.CRITICAL,
];

export const SEVERITY_LABEL_PTBR = {
  info:     "Informativo",
  low:      "Baixa",
  medium:   "Média",
  high:     "Alta",
  critical: "Crítico",
};

export const SEVERITY_COLOR = {
  info:     "#7060A0",
  low:      "#5DCAA5",
  medium:   "#FFB020",
  high:     "#FF6A2B",
  critical: "#FF3E3E",
};

export function severityRank(sev) {
  const i = SEVERITY_ORDER.indexOf(sev);
  return i < 0 ? 0 : i;
}

export function highestSeverity(issues = []) {
  if (!issues.length) return SEVERITY.INFO;
  return issues.reduce((max, i) => severityRank(i.severity) > severityRank(max) ? i.severity : max, SEVERITY.INFO);
}

/**
 * Cria um Issue tipado. Todos os checkers usam.
 * @param {object} props
 * @returns {import("./qcReport.js").QCIssue}
 */
export function makeIssue({ type, severity = SEVERITY.MEDIUM, start = null, end = null, description = "", auto_fixable = false, params = {}, checker = "unknown" }) {
  if (!type) throw new Error("makeIssue requer type");
  return {
    type, severity, start, end, description,
    auto_fixable, params, checker,
    fixed: false,
    createdAt: Date.now(),
  };
}
