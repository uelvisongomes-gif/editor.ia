// SmartZoom — deriva zoomEvents A PARTIR da análise semântica que o
// pipeline já produziu. NÃO faz chamada LLM extra: reusa importance,
// narrativeRole e keepAdvice de cada sentença.
//
// Um zoomEvent é NON-DESTRUCTIVE — só um marker temporal que o preview
// interpreta com CSS transform. Nada é renderizado no arquivo.
//
// Saída:
// {
//   id, type:"zoom", mode:"zoom_in", start, end,
//   scale, fadeIn, fadeOut,
//   reason:"main_point"|"cta"|"emphasis",
//   confidence,
//   sentenceIndex
// }

let _id = 1;
const nextId = () => "zoom-" + _id++;

// Peso do papel narrativo — quanto maior, mais "digno" de zoom.
const ROLE_WEIGHT = {
  point: 1.0,          // pontos-chave são o principal alvo
  cta: 0.9,            // CTA merece emphasis
  conclusion: 0.7,
  hook: 0.4,           // hook geralmente já começa forte, evita começar zoomado
  development: 0.3,
  context: 0.15,
  aside: 0,
  off_topic: 0,
};

const IMPORTANCE_WEIGHT = { high: 1.0, medium: 0.5, low: 0 };

// Sinais textuais que reforçam ênfase.
const EMPHASIS_MARKERS = [
  "importante", "essencial", "principal", "fundamental", "crítico",
  "muito", "nunca", "sempre", "único", "só existe",
  "problema", "solução", "resposta", "segredo",
  "atenção", "cuidado", "olha só", "veja bem",
];

function normalize(s) {
  return (s || "").toLowerCase();
}

function scoreSentence(sentence) {
  const role = ROLE_WEIGHT[sentence.role] ?? 0.3;
  const imp = IMPORTANCE_WEIGHT[sentence.importance] ?? 0.5;
  let base = role * 0.6 + imp * 0.4;
  const text = normalize(sentence.text);
  const hits = EMPHASIS_MARKERS.filter((m) => text.includes(m)).length;
  if (hits > 0) base += Math.min(0.25, hits * 0.08);
  // Frases muito curtas raramente pedem zoom; muito longas também não.
  const wc = text.split(/\s+/).filter(Boolean).length;
  if (wc < 4) base -= 0.3;
  if (wc > 30) base -= 0.15;
  return Math.max(0, Math.min(1, base));
}

/**
 * @param {object} args
 * @param {{sentences:Array}} args.semantic
 * @param {Array<{start:number,end:number,deleted:boolean,action:string}>} args.segments
 * @param {object} args.profile
 * @returns {Array<{id:string,type:'zoom',mode:'zoom_in',start:number,end:number,scale:number,fadeIn:number,fadeOut:number,reason:string,confidence:number,sentenceIndex:number}>}
 */
export function computeZoomEvents({ semantic, segments, profile }) {
  const sentences = semantic?.sentences || [];
  if (!sentences.length) return [];
  const maxEvents = profile.zoomMaxEvents ?? 4;
  const minGap = profile.zoomMinGapSec ?? 10;
  const scale = profile.zoomScale ?? 1.06;
  const hold = profile.zoomHoldSec ?? 1.6;
  const fade = profile.zoomFadeSec ?? 0.35;

  // Filtra sentenças que não caem em trecho a ser removido/em review.
  const inActiveSegment = (t) => {
    // Se não temos segments, considera tudo ativo.
    if (!segments?.length) return true;
    const s = segments.find((s) => t >= s.start - 0.05 && t < s.end + 0.05);
    if (!s) return true;
    // Deleted ou review = não coloca zoom lá.
    if (s.deleted || s.action === "review" || s.action === "trim") return false;
    return true;
  };

  // Ordena por score, seleciona top N respeitando gap mínimo.
  const scored = sentences
    .map((s) => ({ s, score: scoreSentence(s) }))
    .filter(({ s, score }) => {
      if (score <= 0.35) return false; // corte de ruído
      // O zoom começa dentro da sentença — checa que a região inicial está ativa
      const zoomStart = s.start + Math.min(0.25, (s.end - s.start) * 0.15);
      if (!inActiveSegment(zoomStart)) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score);

  const events = [];
  for (const { s, score } of scored) {
    if (events.length >= maxEvents) break;
    const zoomStart = s.start + Math.min(0.25, (s.end - s.start) * 0.15);
    // Verifica gap mínimo com todos os zooms já escolhidos.
    const tooClose = events.some((e) => Math.abs(e.start - zoomStart) < minGap);
    if (tooClose) continue;
    // Duração do "hold" limitada pela sentença.
    const maxDur = Math.max(0.6, (s.end - s.start) - 0.2);
    const eventDur = Math.min(hold, maxDur);
    const reason = s.role === "cta" ? "cta" : s.role === "point" ? "main_point" : "emphasis";
    events.push({
      id: nextId(),
      type: "zoom",
      mode: "zoom_in",
      start: zoomStart,
      end: zoomStart + eventDur,
      scale,
      fadeIn: fade,
      fadeOut: fade,
      reason,
      confidence: Math.round(score * 100) / 100,
      sentenceIndex: s.index,
      text: s.text,
    });
  }

  // Ordena cronologicamente pra facilitar renderização.
  events.sort((a, b) => a.start - b.start);
  return events;
}

// Dado um timestamp, devolve a escala atual (1.0 se sem zoom, aplica
// fade in/out suave). Usado pelo preview do player.
export function scaleAt(zoomEvents, t) {
  if (!zoomEvents?.length) return 1;
  for (const e of zoomEvents) {
    if (t < e.start - e.fadeIn) continue;
    if (t > e.end + e.fadeOut) continue;
    // fade in
    if (t < e.start) {
      const p = (t - (e.start - e.fadeIn)) / Math.max(0.001, e.fadeIn);
      return 1 + (e.scale - 1) * p;
    }
    // hold
    if (t <= e.end) return e.scale;
    // fade out
    const p = (t - e.end) / Math.max(0.001, e.fadeOut);
    return e.scale - (e.scale - 1) * p;
  }
  return 1;
}
