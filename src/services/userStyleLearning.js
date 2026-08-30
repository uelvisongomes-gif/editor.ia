// User Style Learning — deriva um "estilo pessoal" do usuário a partir do
// log de decisões (edlHistory feedback) e ajusta thresholds do perfil.
//
// Fase 6 · Aprendizado. Não invasivo — só sugere override quando há
// SINAL CONSISTENTE (>= 3 vídeos com padrão similar).
//
// Persistência: localStorage por enquanto (chave 'editoria.userStyle.v1').
// Migrar pra Supabase quando fizer sentido.

const STORAGE_KEY = "editoria.userStyle.v1";

/**
 * @typedef {Object} UserStyleProfile
 * @property {number} videosAnalyzed
 * @property {Object} counters
 * @property {Object} adjustments   - overrides sugeridos pra thresholds
 * @property {string} suggestedProfile - qual profile serve mais o usuário
 * @property {string} updatedAt
 */

export function loadUserStyle() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function saveUserStyle(profile) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch {}
}

export function resetUserStyle() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

/**
 * Registra decisões do usuário nesta sessão (accepted/rejected/kept)
 * pra alimentar o aprendizado.
 *
 * @param {Array<{candidateId, primaryType, action, userDecision}>} decisions
 */
export function recordUserDecisions(decisions = []) {
  const current = loadUserStyle() || {
    videosAnalyzed: 0,
    counters: {
      totalDecisions: 0,
      kept: 0,           // usuário DESFEZ um corte (queria manter)
      accepted: 0,       // usuário aceitou o corte da IA
      keptByType: {},    // { long_pause: 3, filler: 1, ... }
      acceptedByType: {},
    },
    adjustments: {},
    suggestedProfile: null,
    updatedAt: new Date().toISOString(),
  };

  current.videosAnalyzed += 1;
  for (const d of decisions) {
    current.counters.totalDecisions += 1;
    const type = d.primaryType || "unknown";
    if (d.userDecision === "keep") {
      current.counters.kept += 1;
      current.counters.keptByType[type] = (current.counters.keptByType[type] || 0) + 1;
    } else if (d.userDecision === "accept") {
      current.counters.accepted += 1;
      current.counters.acceptedByType[type] = (current.counters.acceptedByType[type] || 0) + 1;
    }
  }

  // Deriva adjustments: se o usuário sempre restaura long_pause, aumenta
  // threshold pra deadAir.
  const adjustments = {};
  for (const [type, kept] of Object.entries(current.counters.keptByType)) {
    const accepted = current.counters.acceptedByType[type] || 0;
    const total = kept + accepted;
    if (total < 3) continue; // sinal fraco
    const keepRate = kept / total;
    if (keepRate > 0.6) {
      // Usuário rejeita a maioria — subir threshold
      adjustments[type] = { thresholdBoost: 0.10, note: `mantém ${Math.round(keepRate * 100)}% de ${type}` };
    } else if (keepRate < 0.15) {
      // Usuário aceita quase tudo — pode baixar threshold
      adjustments[type] = { thresholdBoost: -0.05, note: `aceita ${Math.round((1 - keepRate) * 100)}% de ${type}` };
    }
  }
  current.adjustments = adjustments;

  // Sugere um profile baseado no comportamento
  const totalKept = current.counters.kept;
  const totalAcc = current.counters.accepted;
  if (current.videosAnalyzed >= 3) {
    const acceptRate = totalAcc / Math.max(1, totalKept + totalAcc);
    if (acceptRate > 0.8) current.suggestedProfile = "agressiva";
    else if (acceptRate > 0.5) current.suggestedProfile = "equilibrada";
    else current.suggestedProfile = "leve";
  }

  current.updatedAt = new Date().toISOString();
  saveUserStyle(current);
  return current;
}

/**
 * Aplica os ajustes do estilo pessoal a um profile do editingProfiles.
 * Retorna cópia modificada.
 *
 * @param {object} baseProfile
 * @returns {object}
 */
export function applyUserStyleToProfile(baseProfile) {
  const style = loadUserStyle();
  if (!style?.adjustments) return baseProfile;
  const boost = Object.values(style.adjustments).reduce((sum, a) => sum + (a.thresholdBoost || 0), 0);
  if (Math.abs(boost) < 0.02) return baseProfile;
  // Ajusta thresholds em bulk
  return {
    ...baseProfile,
    executeThreshold: Math.min(0.98, Math.max(0.50, (baseProfile.executeThreshold || 0.80) + boost)),
    executeThresholdSemantic: Math.min(0.98, Math.max(0.60, (baseProfile.executeThresholdSemantic || 0.88) + boost)),
    _userStyleApplied: true,
    _userStyleBoost: boost,
  };
}
