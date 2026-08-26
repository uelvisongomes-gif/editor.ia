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

// Níveis centralizados — se quiser ajustar visual global, mexe aqui.
export const ZOOM_LEVELS = {
  light:  { min: 1.05, max: 1.08 },
  medium: { min: 1.08, max: 1.13 },
  strong: { min: 1.13, max: 1.20 },
  out:    { min: 0.94, max: 0.97 },
};

const ROLE_WEIGHT = {
  point: 1.0,
  cta: 0.95,
  conclusion: 0.75,
  hook: 0.45,
  development: 0.35,
  context: 0.20,
  aside: 0,
  off_topic: 0,
};
const IMPORTANCE_WEIGHT = { high: 1.0, medium: 0.55, low: 0.15 };

// Palavras que reforçam "momento de impacto" — ganham zoom mais forte.
const IMPACT_MARKERS = [
  "olha", "veja", "atenção", "cuidado", "nunca", "sempre",
  "revelação", "segredo", "descobri", "aconteceu", "resultado",
  "antes", "depois", "mas", "porém", "surpresa", "impressionante",
  "único", "só existe", "impossível", "imperdível",
];
const EMPHASIS_MARKERS = [
  "importante", "essencial", "principal", "fundamental", "crítico",
  "muito", "problema", "solução", "resposta",
];
// Sentenças que sinalizam mudança de assunto — bom lugar pra zoom OUT.
const TRANSITION_MARKERS = [
  "depois", "em seguida", "agora", "então vamos", "próximo",
  "outro ponto", "além disso", "por outro lado", "vamos ao",
];

function normalize(s) { return (s || "").toLowerCase(); }

function scoreSentence(sentence) {
  const role = ROLE_WEIGHT[sentence.role] ?? 0.3;
  const imp = IMPORTANCE_WEIGHT[sentence.importance] ?? 0.5;
  let base = role * 0.55 + imp * 0.45;
  const text = normalize(sentence.text);
  const emphHits = EMPHASIS_MARKERS.filter((m) => text.includes(m)).length;
  const impactHits = IMPACT_MARKERS.filter((m) => text.includes(m)).length;
  if (emphHits > 0) base += Math.min(0.20, emphHits * 0.07);
  if (impactHits > 0) base += Math.min(0.25, impactHits * 0.10);
  const wc = text.split(/\s+/).filter(Boolean).length;
  if (wc < 4) base -= 0.30;
  if (wc > 35) base -= 0.15;
  return Math.max(0, Math.min(1, base));
}

// Decide o nível (light/medium/strong) baseado no score e no papel.
function pickLevel(sentence, score) {
  const text = normalize(sentence.text);
  const impactHits = IMPACT_MARKERS.filter((m) => text.includes(m)).length;
  const isCta = sentence.role === "cta";
  const isHighImportance = sentence.importance === "high";
  if (score >= 0.85 && (impactHits >= 1 || isCta)) return "strong";
  if (score >= 0.75 && isHighImportance) return "medium";
  if (score >= 0.65) return "medium";
  return "light";
}

function pickScale(level) {
  const range = ZOOM_LEVELS[level] || ZOOM_LEVELS.light;
  // Meio da faixa — determinístico pra o mesmo vídeo dar o mesmo zoom.
  return +((range.min + range.max) / 2).toFixed(3);
}

// Detecta se depois de uma sentença de impacto há uma "transição" — vale
// um zoom out curto pra criar respiro.
function isTransitionAfter(currentSentence, nextSentence) {
  if (!nextSentence) return false;
  const text = normalize(nextSentence.text);
  return TRANSITION_MARKERS.some((m) => text.startsWith(m) || text.includes(" " + m + " "));
}

/**
 * @param {object} args
 * @param {{sentences:Array}} args.semantic
 * @param {Array<{start:number,end:number,deleted:boolean,action:string}>} args.segments
 * @param {object} args.profile
 * @returns {Array<{id,type,mode,start,end,scale,fadeIn,fadeOut,reason,confidence,sentenceIndex,text}>}
 */
export function computeZoomEvents({ semantic, segments, profile }) {
  const sentences = semantic?.sentences || [];
  if (!sentences.length) return [];
  const zoomsPerMinute = (profile.zoomTargetPer30s ?? 3) * 2; // dobra pra minuto
  const fade = profile.zoomFadeSec ?? 0.4;
  const minGap = profile.zoomMinGapSec ?? 6;
  // Duração total ativa (não conta segments removidos) — usada pra alvo.
  const activeDuration = segments?.length
    ? segments.filter((s) => !s.deleted && s.action !== "review").reduce((a, s) => a + (s.end - s.start), 0)
    : (sentences[sentences.length - 1].end - sentences[0].start);
  const targetEvents = Math.max(1, Math.round((activeDuration / 60) * zoomsPerMinute));
  const hardMax = profile.zoomMaxEvents ?? 12;

  const inActiveSegment = (t) => {
    if (!segments?.length) return true;
    const s = segments.find((s) => t >= s.start - 0.05 && t < s.end + 0.05);
    if (!s) return true;
    return !(s.deleted || s.action === "review" || s.action === "trim");
  };

  // Score todas + filtra ativas + threshold mínimo
  const scored = sentences
    .map((s) => ({ s, score: scoreSentence(s) }))
    .filter(({ s, score }) => {
      if (score < 0.4) return false;
      const zoomStart = s.start + Math.min(0.20, (s.end - s.start) * 0.10);
      return inActiveSegment(zoomStart);
    })
    .sort((a, b) => b.score - a.score);

  const events = [];
  const wantEvents = Math.min(hardMax, targetEvents);

  for (const { s, score } of scored) {
    if (events.length >= wantEvents) break;
    const zoomStart = s.start + Math.min(0.20, (s.end - s.start) * 0.10);
    if (events.some((e) => Math.abs(e.start - zoomStart) < minGap)) continue;
    const level = pickLevel(s, score);
    const scale = pickScale(level);
    // Duração acompanha a sentença: dura ~80% do intervalo dela, com
    // limites conservadores (mínimo 1.2s, máximo 7s).
    const sentDur = s.end - s.start;
    const eventDur = Math.max(1.2, Math.min(7.0, sentDur * 0.82));
    const start = zoomStart;
    const end = Math.min(s.end - 0.1, start + eventDur);
    const reason = s.role === "cta" ? "cta" :
                   s.role === "point" ? "main_point" :
                   IMPACT_MARKERS.some((m) => normalize(s.text).includes(m)) ? "impact_moment" :
                   "emphasis";
    events.push({
      id: nextId(),
      type: "zoom",
      mode: "zoom_in",
      start, end,
      scale,
      fadeIn: fade,
      fadeOut: fade,
      reason,
      level,
      confidence: Math.round(score * 100) / 100,
      sentenceIndex: s.index,
      text: s.text,
    });
    // Se a sentença seguinte é uma transição, adiciona zoom OUT curto
    // depois desse evento (respiro visual). Não conta pro wantEvents.
    const nextSentence = sentences[s.index + 1];
    if (isTransitionAfter(s, nextSentence) && (events.length < hardMax)) {
      const outStart = end + 0.15;
      const outEnd = Math.min(nextSentence.end - 0.1, outStart + 1.6);
      if (outEnd > outStart + 0.4 && inActiveSegment(outStart)) {
        const outScale = pickScale("out");
        events.push({
          id: nextId(),
          type: "zoom",
          mode: "zoom_out",
          start: outStart, end: outEnd,
          scale: outScale,
          fadeIn: fade, fadeOut: fade,
          reason: "topic_transition",
          level: "out",
          confidence: 0.7,
          sentenceIndex: nextSentence.index,
          text: nextSentence.text,
        });
      }
    }
  }

  events.sort((a, b) => a.start - b.start);
  return events;
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
