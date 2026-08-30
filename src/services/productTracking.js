// Product Tracking — heurística inicial pra detectar momentos onde o
// apresentador está mostrando/mencionando produto. Foco em TikTok Shop.
//
// MVP: detecta menção lexical (palavras tipo "produto", "esse aqui",
// "olha", "esse item", nome do produto se conhecido). Sem CV.
// Arquitetura pronta pra plugar visão computacional depois (YOLO, MediaPipe
// Objects, etc).
//
// Não bloqueia — só emite protectedRanges que outras camadas honram:
//   - autoReframe: não pode croppar área com produto
//   - captionLayoutEngine: não pode posicionar legenda sobre produto
//   - brollDirector: nunca substituir com B-roll

const PRODUCT_MENTION_MARKERS = [
  "produto", "esse aqui", "esse item", "olha esse", "olha só",
  "olha só isso", "olha aqui", "veja bem", "veja isso", "esse pequeno",
  "esse grande", "esse modelo", "esse tipo", "essa cor", "essa marca",
  "vou mostrar", "vou te mostrar", "aqui é", "aqui está", "aqui tá",
  "eu tenho aqui", "esse é o", "essa é a",
];

const DEMO_MARKERS = [
  "funciona assim", "aperta aqui", "vira aqui", "gira", "encaixa",
  "clica aqui", "arrasta", "ajusta", "regula", "abre", "fecha",
  "coloca", "tira", "aplica",
];

/**
 * @typedef {Object} ProductMoment
 * @property {number} start
 * @property {number} end
 * @property {"mention"|"demonstration"} kind
 * @property {string[]} markers
 * @property {number} confidence
 * @property {string} text
 */

/**
 * @param {object} args
 * @param {Array} args.words
 * @param {Array} args.segments
 * @returns {{ moments: ProductMoment[], summary: object }}
 */
export function detectProductMoments({ words = [], segments = [] } = {}) {
  const moments = [];
  const activeSegs = segments.filter((s) => !s.deleted && s.action !== "review" && s.action !== "trim");
  const inActive = (t) => activeSegs.some((s) => t >= s.start - 0.05 && t < s.end + 0.05);

  // Concatena palavras num texto contínuo com posições, faz sliding window search
  const windowSec = 3.0;
  const step = 1.0;
  if (!words.length) return { moments: [], summary: { total: 0 } };

  const totalDur = words[words.length - 1].end;
  for (let t = 0; t < totalDur; t += step) {
    const inWindow = words.filter((w) => w.start >= t && w.start < t + windowSec);
    if (inWindow.length < 2) continue;
    if (!inActive(t)) continue;
    const text = inWindow.map((w) => w.word || "").join(" ").toLowerCase();

    const mentionHits = PRODUCT_MENTION_MARKERS.filter((m) => text.includes(m));
    const demoHits = DEMO_MARKERS.filter((m) => text.includes(m));

    if (!mentionHits.length && !demoHits.length) continue;

    const kind = demoHits.length ? "demonstration" : "mention";
    const conf = Math.min(0.95, 0.6 + (mentionHits.length + demoHits.length) * 0.1);

    // Estende o range 1s antes e 2s depois pra pegar contexto
    const start = Math.max(0, t - 0.5);
    const end = Math.min(totalDur, t + windowSec + 1.5);

    // Merge com o último se overlap
    const prev = moments[moments.length - 1];
    if (prev && start < prev.end) {
      prev.end = Math.max(prev.end, end);
      prev.markers = [...new Set([...prev.markers, ...mentionHits, ...demoHits])];
      prev.confidence = Math.max(prev.confidence, conf);
      if (demoHits.length) prev.kind = "demonstration";
      continue;
    }

    moments.push({
      start, end, kind,
      markers: [...mentionHits, ...demoHits],
      confidence: conf,
      text: text.slice(0, 100),
    });
  }

  return {
    moments,
    summary: {
      total: moments.length,
      mentions: moments.filter((m) => m.kind === "mention").length,
      demonstrations: moments.filter((m) => m.kind === "demonstration").length,
    },
  };
}
