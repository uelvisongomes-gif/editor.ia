// Recebe um problemCandidate cru e devolve uma decisão RASTREÁVEL:
// finalAction (keep | remove | trim | review | detected_only) + a lista
// de razões pelas quais NÃO virou remove automático. Se um candidato
// existe mas nenhum caminho de decisão o promoveu para execução, ele
// ainda aparece no painel "Problemas encontrados" — só não é cortado.
//
// Bandas:
//   confidence >= executeThreshold  → EXECUTE (remove/trim) — sujeito às regras
//   confidence >= reviewThreshold   → REVIEW (mostrar, usuário decide)
//   confidence >= detectionThreshold → DETECTED_ONLY (mostra no painel, não corta)
//   confidence <  detectionThreshold → dropped (não aparece)
//
// Regras que podem downgrade EXECUTE → REVIEW:
//   - context guard falhou (só p/ semânticos)
//   - duração maior que cap do perfil
//   - segmento cai dentro de role protegido (a menos que possa cirurgia)
//   - detecção de baixa qualidade (dur < MIN_TRIM_DUR)

import { evaluateContext } from "./contextGuard.js";
import { TECHNICAL_SOURCES } from "./editingProfiles.js";
import { refineBoundary } from "./boundaryRefinement.js";

const EPSILON = 0.02;
const MIN_TRIM_DUR = 0.12;

// Fontes técnicas vs semânticas — decide qual executeThreshold usar e se
// passa pelo Context Guard.
function isTechnical(candidate) {
  // Qualquer detector técnico ativa a via técnica.
  return candidate.detectors?.some((d) =>
    TECHNICAL_SOURCES.has(d.detector) || d.detector === "silence" || d.detector === "speechError" || d.detector === "heuristic"
  );
}

function pickExecuteThreshold(candidate, profile) {
  return isTechnical(candidate)
    ? profile.executeThreshold
    : (profile.executeThresholdSemantic ?? profile.executeThreshold);
}

/**
 * Devolve decisão + blockedReasons pra cada candidato.
 * @param {object[]} candidates
 * @param {object} args - { profile, semanticSentences, protectedRanges }
 * @returns {Array<{
 *   ...candidate,
 *   proposedAction: string,
 *   finalAction: 'keep'|'remove'|'trim'|'review'|'detected_only',
 *   contextSafe: boolean,
 *   contextGuardReason: string|null,
 *   blockedReasons: string[],
 *   safety: string|null,
 * }>}
 */
export function decideAll(candidates, { profile, semanticSentences = [], protectedRanges = [], words = [] }) {
  return candidates.map((cand) => decideOne(cand, { profile, semanticSentences, protectedRanges, words }));
}

function decideOne(cand, { profile, semanticSentences, protectedRanges, words = [] }) {
  const c = cand.confidence ?? 0.6;
  const blocked = [];
  let finalAction = "detected_only";
  let contextSafe = true;
  let contextGuardReason = null;
  let safety = null;
  // Bordas efetivas do corte — começam iguais à do candidato e podem
  // ser encolhidas pelo boundary refinement mais adiante. Cortes
  // técnicos ganham uma pré-margem (headroom) de 0.3s pra pegar a
  // respiração/preparação que antecede o defeito. Clampado pra não
  // ficar negativo nem invadir palavra anterior próxima.
  let cutStart = cand.start;
  let cutEnd = cand.end;
  let boundaryNote = null;
  if (isTechnical(cand)) {
    const HEADROOM = 0.30;
    let headStart = Math.max(0, cand.start - HEADROOM);
    // Não invade se há palavra que termina dentro da margem — pega até
    // 0.05s depois do fim da palavra anterior (respiração).
    if (words?.length) {
      const prevWord = [...words].reverse().find((w) => w.end <= cand.start);
      if (prevWord && prevWord.end > headStart) {
        headStart = Math.max(headStart, prevWord.end + 0.05);
      }
    }
    cutStart = headStart;
  }

  const executeThreshold = pickExecuteThreshold(cand, profile);
  const reviewThreshold = profile.reviewThreshold ?? 0.6;
  const detectionThreshold = profile.detectionThreshold ?? 0.45;

  // Abaixo do detectionThreshold: candidato descartado silenciosamente.
  if (c < detectionThreshold) {
    return {
      ...cand,
      proposedAction: "detected_only",
      finalAction: "dropped",
      contextSafe: true,
      contextGuardReason: null,
      blockedReasons: [`confidence_below_detection (${c.toFixed(2)} < ${detectionThreshold})`],
      safety: null,
    };
  }

  // Duração mínima — cortes minúsculos não valem a pena e podem ser artefato.
  if (cand.end - cand.start < MIN_TRIM_DUR) {
    return {
      ...cand,
      proposedAction: "detected_only",
      finalAction: "dropped",
      contextSafe: true,
      contextGuardReason: null,
      blockedReasons: ["duration_too_short"],
      safety: null,
    };
  }

  // Se dentro de role protegido e o candidato não pode fazer cirurgia,
  // não vira remove. Ainda aparece como detected_only para o usuário.
  const insideProtected = protectedRanges.some(([a, b]) =>
    cand.start >= a - EPSILON && cand.end <= b + EPSILON
  );
  if (insideProtected && !cand.canOverrideProtection) {
    return {
      ...cand,
      proposedAction: "review",
      finalAction: "review",
      contextSafe: true,
      contextGuardReason: "role_protected",
      blockedReasons: ["role_protected"],
      safety: null,
    };
  }

  // Context Guard — só cortes semânticos.
  if (!isTechnical(cand)) {
    const guard = evaluateContext({
      candidate: {
        start: cand.start,
        end: cand.end,
        source: "semantic",
        reason: cand.primaryType,
        text: cand.text,
        repeatedGroupBestIndex: cand.repeatedGroupBestIndex,
      },
      sentences: semanticSentences,
    });
    contextSafe = guard.ok;
    contextGuardReason = guard.ok ? null : guard.reason;
    if (!guard.ok) blocked.push(`context_guard: ${guard.reason}`);
  }

  // BOUNDARY REFINEMENT — cortes semânticos com > 2s tentam encolher pro
  // subtrecho realmente problemático. Se o refinement NÃO acha nada
  // (no_pattern_found), o candidato é degradado pra review em vez de
  // cortar o bloco inteiro — princípio MINIMUM NECESSARY CUT.
  if (!isTechnical(cand)) {
    const refined = refineBoundary({ candidate: cand, words });
    if (refined.ok) {
      cutStart = refined.cutStart;
      cutEnd = refined.cutEnd;
      boundaryNote = refined.note || refined.reason || null;
    } else {
      // Sem padrão claro dentro do candidato → não corta tudo.
      // Vira review, o usuário decide manualmente.
      blocked.push(`boundary_uncertain: ${refined.note || "no_pattern"}`);
      // Sinaliza pra depois forçar review.
      cand._forceReviewOnly = true;
    }
  }

  // Decide banda de confiança.
  let proposedAction;
  if (c >= executeThreshold) proposedAction = cand.trimOnly ? "trim" : "remove";
  else if (c >= reviewThreshold) proposedAction = "review";
  else proposedAction = "detected_only";

  finalAction = proposedAction;

  // Sempre registra por que não passou para execute (a menos que tenha passado).
  if (c < executeThreshold) {
    blocked.push(`confidence_below_execute (${c.toFixed(2)} < ${executeThreshold})`);
  }

  // Duration cap.
  const durCap = isTechnical(cand)
    ? (profile.maxTechnicalCutDur ?? Infinity)
    : (profile.maxSemanticCutDur ?? Infinity);
  if ((cand.end - cand.start) > durCap) {
    if (finalAction === "remove" || finalAction === "trim") {
      finalAction = "review";
      blocked.push(`cut_too_long (${(cand.end - cand.start).toFixed(1)}s > ${durCap}s)`);
    }
    safety = "cut_too_long";
  }

  // Context guard bloqueia execute — mas mantém como review, não como
  // detected_only, pra que o usuário veja explicitamente.
  if (!contextSafe && (finalAction === "remove" || finalAction === "trim")) {
    finalAction = "review";
  }

  // Boundary refinement falhou → nunca corta o bloco inteiro automático.
  if (cand._forceReviewOnly && (finalAction === "remove" || finalAction === "trim")) {
    finalAction = "review";
  }

  return {
    ...cand,
    // Bordas do CANDIDATO permanecem (região analisada); as bordas de CUT
    // efetivas — o intervalo que a EDL deve remover — vão separadas.
    cutStart,
    cutEnd,
    proposedAction,
    finalAction,
    contextSafe,
    contextGuardReason,
    boundaryNote,
    blockedReasons: blocked,
    safety,
  };
}

// Labels pt-BR para blockedReasons — usadas pelo painel de diagnóstico.
export const BLOCKED_LABELS = {
  role_protected: "Trecho protegido (hook/CTA)",
  duration_too_short: "Corte curto demais",
  cut_too_long: "Corte longo demais",
};

export function labelBlocked(code) {
  // Codes podem vir formatados ("context_guard: xyz") — extrai o prefixo.
  if (!code) return code;
  if (code.startsWith("confidence_below_")) return "Confiança abaixo do necessário";
  if (code.startsWith("context_guard:")) return "Bloqueado pelo Context Guard";
  if (code.startsWith("cut_too_long")) return "Corte longo demais";
  return BLOCKED_LABELS[code] || code;
}
