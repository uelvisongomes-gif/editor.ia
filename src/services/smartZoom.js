// SmartZoom v2 — deriva zoomEvents da análise semântica existente.
// Zero chamadas LLM extras. Reusa importance, narrativeRole, texto.
//
// Diferente da v1:
//   - Duração acompanha a UNIDADE SEMÂNTICA (a sentença toda, com margens
//     seguras) em vez de um "hold" fixo curto.
//   - 3 níveis de escala (leve/médio/forte) escolhidos pela intensidade
//     do momento — CTA/quebra de expectativa recebe forte; ponto comum
//     recebe leve/médio.
//   - Zoom OUT em transições de tema/respiro depois de momentos fortes.
//   - Meta de ritmo por perfil (3-4 zooms / 30s no equilibrada).
//   - Sem colocar em segments deleted/review.

let _id = 1;
const nextId = () => "zoom-" + _id++;

// Níveis centralizados — calibrados pela REFERÊNCIA VISUAL do usuário:
//   ZOOM_OUT (normal do vídeo) = rosto ocupa ~50% do frame → scale 1.0
//   ZOOM_IN (face-fill)        = rosto ocupa ~80% do frame → ~1.5x
//
// Multiplicados por BASE_ZOOM (1.10) no renderer:
//   light   1.15 * 1.10 = 1.27 efetivo — ênfase leve (14% mais perto)
//   medium  1.28 * 1.10 = 1.41 efetivo — 30% mais perto do rosto
//   strong  1.38 * 1.10 = 1.52 efetivo — face-fill da referência (~50% mais perto)
export const ZOOM_LEVELS = {
  light:  { value: 1.15, label: "Suave" },
  medium: { value: 1.28, label: "Moderado" },
  strong: { value: 1.38, label: "Forte" },
  // Zoom out — retorno suave para NORMAL (nunca abaixo de 1.0 efetivo).
  out_light:  { value: 0.93, label: "Suave" },
  out_medium: { value: 0.87, label: "Moderado" },
  out_strong: { value: 0.80, label: "Forte" },
};

// BASE_ZOOM: o preview começa levemente ampliado (~1.10). Isso garante
// que zoom_out (scale < 1) NÃO revele bordas pretas — o valor efetivo
// aplicado no vídeo é sempre >= 1.
export const BASE_ZOOM = 1.10;

// Converte scale conceitual em scale efetiva (aplicada no video preview).
// zoom_in 1.14 → 1.14 * 1.10 = 1.254
// zoom_out 0.92 → 0.92 * 1.10 = 1.012 (ainda >= 1, sem borda)
export function effectiveScale(conceptualScale) {
  const eff = (conceptualScale || 1) * BASE_ZOOM;
  return Math.max(1.0, eff);
}

import { IMPACT_MARKERS, computeEmphasis } from "./emphasisModel.js";

function normalize(s) { return (s || "").toLowerCase(); }

// Lê emphasisScore canônico da sentence, se disponível. Fallback: calcula
// on-the-fly usando o mesmo modelo (mantém compat com fixtures/testes).
function sentenceScore(sentence) {
  if (typeof sentence.emphasisScore === "number") return sentence.emphasisScore;
  return computeEmphasis(sentence).score;
}

// Decide o nível (light/medium/strong) baseado no score, papel e
// importância. Roles fortes da Fase 2 (turn/cta/hook + importance=critical)
// merecem strong direto.
function pickLevel(sentence, score) {
  const text = normalize(sentence.text);
  const impactHits = IMPACT_MARKERS.filter((m) => text.includes(m)).length;
  const isCritical = sentence.importance === "critical";
  const isHighImportance = sentence.importance === "high";
  const strongRoles = new Set(["turn", "cta", "point", "solution", "hook"]);
  const mediumRoles = new Set(["problem", "proof", "conclusion"]);

  // Trechos críticos com role forte → strong direto
  if (isCritical && strongRoles.has(sentence.role)) return "strong";
  if (score >= 0.85 && (impactHits >= 1 || strongRoles.has(sentence.role))) return "strong";
  if (isCritical) return "medium";
  if (score >= 0.75 && isHighImportance) return "medium";
  if (mediumRoles.has(sentence.role) && isHighImportance) return "medium";
  if (score >= 0.65) return "medium";
  return "light";
}

// Skip: trecho é aside/off_topic OU tem weakness (redundant/no_value/etc)
// — não merece zoom sequer.
function shouldSkipZoom(sentence) {
  if (!sentence) return true;
  if (sentence.role === "aside" || sentence.role === "off_topic") return true;
  if (sentence.weakness) return true;
  return false;
}

function pickScale(level) {
  const spec = ZOOM_LEVELS[level] || ZOOM_LEVELS.light;
  return spec.value;
}

/**
 * @param {object} args
 * @param {{sentences:Array}} args.semantic
 * @param {Array<{start:number,end:number,deleted:boolean,action:string}>} args.segments
 * @param {object} args.profile
 * @returns {Array<{id,type,mode,start,end,scale,fadeIn,fadeOut,reason,confidence,sentenceIndex,text}>}
 */
// Constantes de ritmo — usuário pediu:
//   - Corte SEMPRE gera Zoom In pós-corte (2-4s, seguindo unidade de fala)
//   - Se 10-12s sem corte, procurar melhor momento pra Zoom In
//   - Corte reinicia contador (naturalmente: corte já é anchor visual)
const NO_CUT_GAP_TRIGGER = 11.0;  // janela sem estímulo → força smart zoom
const CUT_ZOOM_MIN_DUR = 2.0;     // corte-zoom nunca menor que isso
const CUT_ZOOM_MAX_DUR = 4.0;     // nem maior que isso
const OVERLAP_TOLERANCE = 0.5;    // pra evitar zoom em cima de outro zoom
// Gap MÍNIMO entre FIM de um zoom e INÍCIO do próximo. Sem isso a imagem
// "sobe → volta → sobe → volta" e parece 2 pulsos distintos ao invés de
// respiração natural.
const MIN_REST_BETWEEN_ZOOMS_SEC = 2.5;

export function computeZoomEvents({ semantic, segments, profile }) {
  const sentences = semantic?.sentences || [];
  const fade = profile.zoomFadeSec ?? 0.5;

  const inActiveSegment = (t) => {
    if (!segments?.length) return true;
    const s = segments.find((s) => t >= s.start - 0.05 && t < s.end + 0.05);
    if (!s) return true;
    return !(s.deleted || s.action === "review" || s.action === "trim");
  };

  // Segments ativos ordenados — usados pra localizar pontos de corte.
  const activeSegs = segments?.length
    ? segments.filter((s) => !s.deleted && s.action !== "review" && s.action !== "trim")
              .sort((a, b) => a.start - b.start)
    : [];

  // Retorna sentença que contém timestamp t (ou null).
  const sentenceAt = (t) => sentences.find((s) => t >= s.start && t < s.end) || null;

  // Retorna sentença que começa depois de t (a próxima na timeline).
  const sentenceStartingAfter = (t) => sentences.find((s) => s.start >= t) || null;

  const events = [];

  // --- FASE 1: cada corte executado gera Zoom In pós-corte ------------
  // A "duração" acompanha a próxima unidade de fala (sentence contendo
  // o cut point) e é clamped em [2s, 4s].
  if (activeSegs.length && (profile.zoomTransitionOnCuts ?? true)) {
    for (let i = 1; i < activeSegs.length; i++) {
      const cutPoint = activeSegs[i].start;
      const segEnd = activeSegs[i].end;
      // Se o segment é curto demais pra segurar o zoom, pula.
      if (segEnd - cutPoint < CUT_ZOOM_MIN_DUR) continue;

      // Fim da unidade de fala: sentence que contém cutPoint, ou a próxima.
      let containing = sentenceAt(cutPoint) || sentenceStartingAfter(cutPoint);
      // Contextual skip: se sentence é aside/off_topic/weakness, não dá zoom.
      if (shouldSkipZoom(containing)) continue;
      let sentenceEnd = containing ? containing.end : cutPoint + 3.0;

      // Duração = até fim da unidade, clamped, e nunca ultrapassa segmento.
      let dur = Math.min(sentenceEnd - cutPoint - 0.15, CUT_ZOOM_MAX_DUR);
      dur = Math.max(CUT_ZOOM_MIN_DUR, dur);
      dur = Math.min(dur, segEnd - cutPoint - 0.1);
      if (dur < CUT_ZOOM_MIN_DUR) continue;

      // Contextual level — cut zoom em role/importance forte vira medium/strong
      const contextualLevel = containing ? pickLevel(containing, sentenceScore(containing)) : "light";
      const level = contextualLevel === "strong" ? "medium" : contextualLevel; // limita strong só pra gaps (pattern interrupt)
      events.push({
        id: nextId(),
        type: "zoom",
        mode: "zoom_in",
        start: cutPoint,
        end: cutPoint + dur,
        scale: ZOOM_LEVELS[level].value,
        fadeIn: 0.15,
        fadeOut: Math.max(0.4, fade),
        reason: "cut_transition",
        level,
        confidence: 1.0,
        sentenceIndex: containing?.index ?? null,
        text: containing?.text || "",
        isTransition: true,
      });
    }
  }

  // --- FASE 2: preencher gaps ≥ 10-12s sem nenhum estímulo visual -----
  // Anchors do ritmo: início do vídeo + cada cut-zoom (que reinicia o
  // contador) + fim do vídeo. Se dois anchors têm gap > NO_CUT_GAP_TRIGGER,
  // insere UM zoom-in semântico no melhor momento dentro do gap.
  if (sentences.length && activeSegs.length) {
    const timelineStart = activeSegs[0].start;
    const timelineEnd = activeSegs[activeSegs.length - 1].end;
    const anchors = [timelineStart, ...events.map((e) => e.start), timelineEnd].sort((a, b) => a - b);

    for (let i = 0; i < anchors.length - 1; i++) {
      const gapStart = anchors[i];
      const gapEnd = anchors[i + 1];
      const gap = gapEnd - gapStart;
      if (gap < NO_CUT_GAP_TRIGGER) continue;

      // Candidatos: sentenças que caem NO MEIO do gap (respiro dos 2s
      // iniciais pós-anchor e 2s finais pré-anchor pra não colidir).
      const searchFrom = gapStart + 2.0;
      const searchTo = gapEnd - 2.0;
      if (searchTo <= searchFrom) continue;

      const candidates = sentences
        .filter((s) => s.start >= searchFrom && s.start < searchTo)
        .filter((s) => inActiveSegment(s.start + 0.15))
        .filter((s) => !shouldSkipZoom(s)) // pula aside/weakness
        .map((s) => ({ s, score: sentenceScore(s) }))
        .filter(({ score }) => score >= 0.35)
        .sort((a, b) => b.score - a.score);
      if (!candidates.length) continue;

      const { s, score } = candidates[0];
      const level = pickLevel(s, score);
      const scale = pickScale(level);
      const zoomStart = s.start + Math.min(0.20, (s.end - s.start) * 0.10);
      const sentDur = s.end - s.start;
      const eventDur = Math.max(CUT_ZOOM_MIN_DUR, Math.min(3.5, sentDur * 0.82));
      const end = Math.min(s.end - 0.1, zoomStart + eventDur);
      if (end - zoomStart < 1.2) continue;

      // Dedup: evita cair em cima de zoom existente.
      const conflict = events.some((e) =>
        Math.max(e.start, zoomStart) < Math.min(e.end, end) + OVERLAP_TOLERANCE
      );
      if (conflict) continue;

      const reason = s.role === "cta" ? "cta" :
                     s.role === "point" ? "main_point" :
                     IMPACT_MARKERS.some((m) => normalize(s.text).includes(m)) ? "impact_moment" :
                     "emphasis";
      events.push({
        id: nextId(),
        type: "zoom",
        mode: "zoom_in",
        start: zoomStart,
        end,
        scale,
        fadeIn: 0.25,
        fadeOut: Math.max(0.5, fade),
        reason,
        level,
        confidence: Math.round(score * 100) / 100,
        sentenceIndex: s.index,
        text: s.text,
      });
    }
  }

  events.sort((a, b) => a.start - b.start);

  // Guard 1 · Max 1 zoom por sentence — impede zoom seguido no meio
  // da mesma unidade de fala (mesmo se veio de cut+gap).
  const zoomsBySentence = new Map();
  const dedupBySentence = [];
  for (const ev of events) {
    const idx = ev.sentenceIndex;
    if (idx == null || idx === undefined) {
      dedupBySentence.push(ev);
      continue;
    }
    const existing = zoomsBySentence.get(idx);
    if (!existing) {
      zoomsBySentence.set(idx, ev);
      dedupBySentence.push(ev);
      continue;
    }
    // Já tem zoom nessa sentence — mantém o de maior prioridade
    // (cut_transition ou strong level ganham).
    const prevScore = (existing.isTransition ? 1 : 0) + { light: 0, medium: 1, strong: 2 }[existing.level || "light"];
    const curScore = (ev.isTransition ? 1 : 0) + { light: 0, medium: 1, strong: 2 }[ev.level || "light"];
    if (curScore > prevScore) {
      // Troca — remove o anterior do array
      const removeIdx = dedupBySentence.indexOf(existing);
      if (removeIdx >= 0) dedupBySentence.splice(removeIdx, 1);
      zoomsBySentence.set(idx, ev);
      dedupBySentence.push(ev);
    }
    // else: descarta o novo silenciosamente
  }

  // Anti-pulso: se dois zooms consecutivos têm gap < MIN_REST_BETWEEN,
  // funde-os OU descarta o de menor prioridade.
  const merged = [];
  for (const ev of dedupBySentence.sort((a, b) => a.start - b.start)) {
    const prev = merged[merged.length - 1];
    if (!prev) { merged.push(ev); continue; }
    const rest = ev.start - prev.end;
    if (rest >= MIN_REST_BETWEEN_ZOOMS_SEC) { merged.push(ev); continue; }

    const prevIsCut = prev.isTransition === true;
    const curIsCut = ev.isTransition === true;
    if (prevIsCut && curIsCut) {
      prev.end = Math.max(prev.end, ev.end);
      prev.reason = "cut_transition_merged";
      prev.text = ev.text || prev.text;
    } else if (prev.confidence >= ev.confidence) {
      // mantém anterior
    } else {
      const desiredStart = prev.end + MIN_REST_BETWEEN_ZOOMS_SEC;
      if (desiredStart < ev.end - 1.5) {
        ev.start = desiredStart;
        merged.push(ev);
      }
    }
  }

  // Guard 2 · Cap por minuto conforme perfil — evita edições poluídas
  // Densidade máxima permitida (zooms por minuto):
  //   leve/natural: 4 · equilibrada/dinâmico: 8 · agressiva/viral: 14
  const MAX_ZOOMS_PER_MIN = {
    leve: 4, equilibrada: 8, agressiva: 14,
    profissional: 3, podcast: 1, tiktokshop: 12, tutorial: 6,
  };
  const maxPerMin = MAX_ZOOMS_PER_MIN[profile?.id] ?? 8;
  const activeDur = activeSegs.length ? (activeSegs[activeSegs.length - 1].end - activeSegs[0].start) : 60;
  const maxTotal = Math.max(1, Math.ceil((activeDur / 60) * maxPerMin));
  let capped = merged;
  if (merged.length > maxTotal) {
    // Ordena por prioridade (isTransition=1 + level rank) DESC, pega top N,
    // depois reordena cronologicamente.
    const priorityRank = (e) => (e.isTransition ? 1 : 0) + { light: 0, medium: 1, strong: 2 }[e.level || "light"];
    capped = [...merged]
      .sort((a, b) => priorityRank(b) - priorityRank(a))
      .slice(0, maxTotal)
      .sort((a, b) => a.start - b.start);
  }

  return capped;
}

/**
 * Interpola a escala aplicada num timestamp — com fade in/out suave
 * (curva cosseno pra parecer câmera profissional em vez de linear).
 */
export function scaleAt(zoomEvents, t) {
  if (!zoomEvents?.length) return 1;
  const easeInOut = (p) => 0.5 - Math.cos(Math.PI * p) / 2;
  for (const e of zoomEvents) {
    if (t < e.start - e.fadeIn) continue;
    if (t > e.end + e.fadeOut) continue;
    if (t < e.start) {
      const p = (t - (e.start - e.fadeIn)) / Math.max(0.001, e.fadeIn);
      return 1 + (e.scale - 1) * easeInOut(p);
    }
    if (t <= e.end) return e.scale;
    const p = (t - e.end) / Math.max(0.001, e.fadeOut);
    return e.scale - (e.scale - 1) * easeInOut(p);
  }
  return 1;
}
