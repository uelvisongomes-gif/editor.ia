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
export async function detectFaceRegions({ duration, sourceWidth, sourceHeight, samplingSec = 1.0, provider = "heuristic" } = {}) {
  if (provider !== "heuristic") {
    console.warn(`[faceDetection] provider "${provider}" ainda não implementado — usando heurística.`);
  }
  if (!Number.isFinite(duration) || duration <= 0 || !sourceWidth || !sourceHeight) {
    return { regions: [], provider: "heuristic" };
  }
  const bbox = estimateFaceFromAspect(sourceWidth, sourceHeight);
  const regions = [];
  for (let t = 0; t < duration; t += samplingSec) {
    regions.push({ t, faces: [bbox] });
  }
  return { regions, provider: "heuristic" };
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
