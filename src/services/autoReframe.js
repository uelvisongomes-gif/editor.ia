// Auto Reframe — converte vídeo entre aspect ratios diferentes mantendo
// a face/produto/interesse principal dentro do frame.
//
// Consome face regions (faceDetection.js) e computa crop rects pra cada
// timestamp mantendo suavidade temporal (evita "câmera nervosa").
//
// Uso típico:
//   source 16:9 → target 9:16 (horizontal virou vertical p/ TikTok)
//   source 9:16 → target 16:9 (vertical virou horizontal p/ YouTube)
//   source qualquer → 4:5 (Instagram feed)
//   source qualquer → 1:1 (Instagram carrossel)
//
// A saída é uma lista de crop rects timelinados. O renderer aplica.

import { faceAt } from "./faceDetection.js";

/**
 * @typedef {Object} CropRect
 * @property {number} t
 * @property {number} sx      - source x (fração 0-1)
 * @property {number} sy      - source y (fração 0-1)
 * @property {number} sw      - source width (fração 0-1)
 * @property {number} sh      - source height (fração 0-1)
 */

/**
 * Calcula um crop rect centrado no ponto de interesse (face), respeitando
 * o target aspect ratio.
 *
 * @param {object} args
 * @param {number} args.sourceWidth
 * @param {number} args.sourceHeight
 * @param {number} args.targetAspect   - largura/altura do destino (ex: 9/16 = 0.5625)
 * @param {{x, y, w, h}|null} args.focus - ponto principal (face bbox), null usa centro
 * @param {number} [args.paddingFactor=1.4] - quanto MAIS que o bbox pegar (headroom)
 * @returns {CropRect}
 */
export function computeCropForFrame({ sourceWidth, sourceHeight, targetAspect, focus, paddingFactor = 1.4 }) {
  const sourceAspect = sourceWidth / sourceHeight;
  const focusCX = focus ? focus.x : 0.5;
  const focusCY = focus ? focus.y : 0.5;
  const focusW = focus ? focus.w * paddingFactor : 0.6;
  const focusH = focus ? focus.h * paddingFactor : 0.6;

  // Escolhe crop que engloba o focus + respeita target aspect
  let cropW, cropH;
  if (targetAspect > sourceAspect) {
    // Target é mais largo → limita pela altura
    cropH = Math.min(1, focusH);
    cropW = cropH * (targetAspect / sourceAspect);
    if (cropW > 1) { cropW = 1; cropH = cropW * (sourceAspect / targetAspect); }
  } else {
    // Target é mais alto → limita pela largura
    cropW = Math.min(1, focusW);
    cropH = cropW * (sourceAspect / targetAspect);
    if (cropH > 1) { cropH = 1; cropW = cropH * (targetAspect / sourceAspect); }
  }

  // Centraliza no focus, clamp nas bordas
  let sx = focusCX - cropW / 2;
  let sy = focusCY - cropH / 2;
  sx = Math.max(0, Math.min(1 - cropW, sx));
  sy = Math.max(0, Math.min(1 - cropH, sy));

  return { sx, sy, sw: cropW, sh: cropH };
}

/**
 * Gera timeline de crops pro vídeo inteiro, com smoothing (média móvel)
 * pra evitar câmera nervosa.
 *
 * @param {object} args
 * @param {number} args.duration
 * @param {number} args.sourceWidth
 * @param {number} args.sourceHeight
 * @param {number} args.targetAspect
 * @param {Array} args.faceRegions
 * @param {number} [args.samplingSec=0.5]
 * @param {number} [args.smoothWindow=5]  - N samples pra smoothing
 * @returns {{ crops: CropRect[], targetAspect, sourceAspect }}
 */
export function buildReframeTimeline({ duration, sourceWidth, sourceHeight, targetAspect, faceRegions = [], samplingSec = 0.5, smoothWindow = 5 } = {}) {
  const raw = [];
  for (let t = 0; t < duration; t += samplingSec) {
    const focus = faceAt(faceRegions, t);
    const c = computeCropForFrame({ sourceWidth, sourceHeight, targetAspect, focus });
    raw.push({ t, ...c });
  }
  // Smoothing: média móvel simples de smoothWindow samples
  const smooth = raw.map((cur, i) => {
    const from = Math.max(0, i - Math.floor(smoothWindow / 2));
    const to = Math.min(raw.length, i + Math.ceil(smoothWindow / 2));
    const slice = raw.slice(from, to);
    const avg = (key) => slice.reduce((a, x) => a + x[key], 0) / slice.length;
    return {
      t: cur.t,
      sx: avg("sx"),
      sy: avg("sy"),
      sw: avg("sw"),
      sh: avg("sh"),
    };
  });
  return {
    crops: smooth,
    targetAspect,
    sourceAspect: sourceWidth / sourceHeight,
  };
}

/**
 * Aspect ratios padrão pra plataformas.
 */
export const PLATFORM_ASPECTS = {
  tiktok:  9/16,   // 0.5625
  reels:   9/16,
  shorts:  9/16,
  youtube: 16/9,   // 1.7777
  feed:    4/5,    // 0.80
  square:  1/1,
};

/**
 * Retorna o crop rect ativo num timestamp t (interpolando na timeline).
 */
export function cropAt(crops, t) {
  if (!crops?.length) return null;
  // Encontra o mais próximo
  let best = crops[0];
  let bestDelta = Math.abs(crops[0].t - t);
  for (const c of crops) {
    const d = Math.abs(c.t - t);
    if (d < bestDelta) { best = c; bestDelta = d; }
  }
  return best;
}
