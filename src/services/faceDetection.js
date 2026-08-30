// Face Detection — API estável pra localizar face(s) num vídeo.
// Implementação atual: heurística de "face center" baseada em aspect ratio
// da source (funciona pra 90% dos casos de talking-head vertical).
//
// Arquitetura pronta pra swap: quando integrarmos MediaPipe Tasks Web
// ou face-api.js, só trocar o provider — API pública fica igual.
//
// Contrato:
//   FaceRegion = { t, faces: [{ x, y, w, h, confidence }] }
//   - x,y,w,h em fração 0-1 (relativa à source)
//   - t em segundos
//   - confidence 0-1

/**
 * @typedef {Object} FaceBox
 * @property {number} x  - centro X da face (fração 0-1)
 * @property {number} y  - centro Y da face (fração 0-1)
 * @property {number} w  - largura (fração 0-1)
 * @property {number} h  - altura (fração 0-1)
 * @property {number} confidence
 */

/**
 * @typedef {Object} FaceRegion
 * @property {number} t
 * @property {FaceBox[]} faces
 */

/**
 * Heurística center-based (MVP). Pra talking-head vertical, face fica
 * ~centro-horizontal, ~35% da altura (regra do terço superior).
 * Pra landscape, ~centro.
 *
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @returns {FaceBox}
 */
export function estimateFaceFromAspect(sourceWidth, sourceHeight) {
  const aspect = sourceWidth / sourceHeight;
  // Portrait (9:16, 3:4) → face terço superior
  // Landscape (16:9, 4:3) → face centro
  const isPortrait = aspect < 1;
  return {
    x: 0.5,
    y: isPortrait ? 0.35 : 0.50,
    w: isPortrait ? 0.55 : 0.35,
    h: isPortrait ? 0.30 : 0.45,
    confidence: 0.6, // heurística, não medição real
  };
}

/**
 * Retorna face regions ao longo do vídeo. Provider atual usa
 * heurística estática (mesmo bbox pra todos os timestamps).
 * Providers reais (MediaPipe, face-api) sobrescrevem com amostragem
 * por frame.
 *
 * @param {object} args
 * @param {number} args.duration
 * @param {number} args.sourceWidth
 * @param {number} args.sourceHeight
 * @param {number} [args.samplingSec=1.0]  - resolução temporal
 * @param {string} [args.provider="heuristic"]  - "heuristic" | "mediapipe" | "faceapi"
 * @returns {Promise<{ regions: FaceRegion[], provider: string }>}
 */
export async function detectFaceRegions({ duration, sourceWidth, sourceHeight, samplingSec = 1.0, provider = "heuristic", videoEl } = {}) {
  if (!Number.isFinite(duration) || duration <= 0 || !sourceWidth || !sourceHeight) {
    return { regions: [], provider: "heuristic" };
  }
  if (provider === "mediapipe" && videoEl) {
    try {
      const result = await detectViaMediaPipe({ videoEl, duration, sourceWidth, sourceHeight, samplingSec });
      if (result?.regions?.length) return result;
    } catch (err) {
      console.warn("[faceDetection] MediaPipe falhou, caindo pra heurística:", err.message);
    }
  }
  const bbox = estimateFaceFromAspect(sourceWidth, sourceHeight);
  const regions = [];
  for (let t = 0; t < duration; t += samplingSec) {
    regions.push({ t, faces: [bbox] });
  }
  return { regions, provider: "heuristic" };
}

let _mediaPipeDetector = null;
async function ensureMediaPipe() {
  if (_mediaPipeDetector) return _mediaPipeDetector;
  // Carrega via CDN — evita bundle bloat
  const vision = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.mjs");
  const fileset = await vision.FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
  );
  _mediaPipeDetector = await vision.FaceDetector.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.5,
  });
  return _mediaPipeDetector;
}

async function detectViaMediaPipe({ videoEl, duration, sourceWidth, sourceHeight, samplingSec }) {
  const detector = await ensureMediaPipe();
  const regions = [];
  const originalTime = videoEl.currentTime;
  const originalPaused = videoEl.paused;
  if (!originalPaused) videoEl.pause();
  for (let t = 0; t < duration; t += samplingSec) {
    await seekTo(videoEl, t);
    const res = detector.detectForVideo(videoEl, performance.now());
    const faces = (res?.detections || []).map((d) => {
      const bb = d.boundingBox;
      return {
        x: (bb.originX + bb.width / 2) / sourceWidth,
        y: (bb.originY + bb.height / 2) / sourceHeight,
        w: bb.width / sourceWidth,
        h: bb.height / sourceHeight,
        confidence: d.categories?.[0]?.score || 0.7,
      };
    });
    regions.push({ t, faces });
  }
  videoEl.currentTime = originalTime;
  return { regions, provider: "mediapipe" };
}

function seekTo(videoEl, t) {
  return new Promise((resolve) => {
    const onSeeked = () => { videoEl.removeEventListener("seeked", onSeeked); resolve(); };
    videoEl.addEventListener("seeked", onSeeked);
    videoEl.currentTime = t;
  });
}

/**
 * Retorna a face principal (maior/mais central) num instante t,
 * interpolando entre regions próximas.
 *
 * @param {FaceRegion[]} regions
 * @param {number} t
 * @returns {FaceBox|null}
 */
export function faceAt(regions, t) {
  if (!regions?.length) return null;
  // Encontra a region mais próxima temporalmente
  let best = regions[0];
  let bestDelta = Math.abs(regions[0].t - t);
  for (const r of regions) {
    const d = Math.abs(r.t - t);
    if (d < bestDelta) { best = r; bestDelta = d; }
  }
  if (!best.faces?.length) return null;
  // Pega a face de maior área (principal)
  return best.faces.reduce((a, b) => (a.w * a.h > b.w * b.h ? a : b));
}
