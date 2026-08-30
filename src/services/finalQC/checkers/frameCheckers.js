// Frame-level Checkers — Items 13, 14, 15, 16.
// Requer HTMLVideoElement + <canvas> pra sample de frames.
// Sample estratégico: 1 frame / 2s + denso ao redor de cortes.
//
// Diferencia black frame intencional (fade) de erro (mídia não carregou).

import { makeIssue, SEVERITY } from "../qcSeverity.js";

const SAMPLE_INTERVAL_SEC = 2.0;
const DENSE_WINDOW_SEC = 0.4;
const CANVAS_SIZE = 64; // small pra performance

/**
 * @param {object} args
 * @param {HTMLVideoElement} args.videoEl
 * @param {Array} args.segments
 * @param {number} args.duration
 * @returns {Promise<import("../qcReport.js").QCIssue[]>}
 */
export async function checkFrames({ videoEl, segments = [], duration = 0 } = {}) {
  if (!videoEl || duration <= 0) return [];
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // Constrói sample points: cada 2s + denso em cortes
  const cutPoints = [];
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  for (let i = 1; i < active.length; i++) {
    if (Math.abs(active[i].start - active[i - 1].end) > 0.001) {
      cutPoints.push(active[i - 1].end, active[i].start);
    }
  }
  const samplePoints = new Set();
  for (let t = 0; t < duration; t += SAMPLE_INTERVAL_SEC) samplePoints.add(round(t, 2));
  for (const cp of cutPoints) {
    for (let d = -DENSE_WINDOW_SEC; d <= DENSE_WINDOW_SEC; d += 0.1) {
      const t = round(cp + d, 2);
      if (t >= 0 && t <= duration) samplePoints.add(t);
    }
  }
  const points = Array.from(samplePoints).sort((a, b) => a - b);

  const wasPaused = videoEl.paused;
  const wasTime = videoEl.currentTime;
  const wasMuted = videoEl.muted;
  videoEl.muted = true;
  if (!wasPaused) videoEl.pause();

  const luminances = [];
  const meanColors = [];
  const issues = [];

  try {
    let prevImg = null;
    for (const t of points) {
      await seekTo(videoEl, t);
      try {
        ctx.drawImage(videoEl, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      } catch { continue; }
      const img = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const lum = avgLuminance(img.data);
      luminances.push({ t, lum });
      meanColors.push({ t, r: avgChannel(img.data, 0), g: avgChannel(img.data, 1), b: avgChannel(img.data, 2) });

      // Black frame (Item 13) — luminância < 5 (0-255 scale)
      const isNearCut = cutPoints.some((cp) => Math.abs(cp - t) < DENSE_WINDOW_SEC);
      if (lum < 5) {
        if (!isNearCut) {
          issues.push(makeIssue({
            type: "black_frame",
            severity: SEVERITY.HIGH,
            start: t, end: t + 0.1,
            description: `Frame preto inesperado em ${t.toFixed(2)}s (lum=${lum.toFixed(1)})`,
            auto_fixable: false,
            params: { lum, t },
            checker: "blackFrame",
          }));
        }
      }

      // Duplicate / Freeze (Items 14, 15) — MSE < 1 com frame anterior E gap > 0.5s
      if (prevImg) {
        const mse = computeMSE(prevImg.data, img.data);
        const gap = t - prevImg.t;
        if (mse < 1.5 && gap >= 1.5 && !isNearCut) {
          issues.push(makeIssue({
            type: "freeze_frame",
            severity: SEVERITY.MEDIUM,
            start: prevImg.t, end: t,
            description: `Frame congelado por ${gap.toFixed(1)}s (MSE=${mse.toFixed(2)})`,
            auto_fixable: false,
            params: { mse, gap },
            checker: "freezeFrame",
          }));
        }
      }
      prevImg = { t, data: img.data };
    }

    // Visual continuity (Item 16) — MSE muito alto entre frames adjacentes a cut
    for (const cp of cutPoints) {
      const before = pickNearest(luminances, cp - 0.1);
      const after = pickNearest(luminances, cp + 0.1);
      if (before && after && Math.abs(before.lum - after.lum) > 80) {
        issues.push(makeIssue({
          type: "visual_jump",
          severity: SEVERITY.MEDIUM,
          start: cp - 0.1, end: cp + 0.1,
          description: `Salto visual agressivo no corte ${cp.toFixed(2)}s (Δlum=${Math.abs(before.lum - after.lum).toFixed(0)})`,
          auto_fixable: true,
          params: { deltaLum: Math.abs(before.lum - after.lum), t: cp, action: "add_transition" },
          checker: "visualContinuity",
        }));
      }
    }
  } finally {
    videoEl.currentTime = wasTime;
    videoEl.muted = wasMuted;
    if (!wasPaused) { try { await videoEl.play(); } catch {} }
  }

  return issues;
}

function seekTo(videoEl, t) {
  return new Promise((resolve) => {
    if (Math.abs(videoEl.currentTime - t) < 0.02) return resolve();
    const onSeeked = () => { videoEl.removeEventListener("seeked", onSeeked); resolve(); };
    videoEl.addEventListener("seeked", onSeeked);
    try { videoEl.currentTime = t; } catch { resolve(); }
    // safety timeout
    setTimeout(() => { videoEl.removeEventListener("seeked", onSeeked); resolve(); }, 400);
  });
}

function avgLuminance(data) {
  let sum = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count++;
  }
  return sum / Math.max(1, count);
}

function avgChannel(data, offset) {
  let sum = 0, n = 0;
  for (let i = offset; i < data.length; i += 4) { sum += data[i]; n++; }
  return sum / Math.max(1, n);
}

function computeMSE(a, b) {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  const step = 4;
  for (let i = 0; i < a.length; i += step) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum / (a.length / step);
}

function pickNearest(arr, t) {
  if (!arr.length) return null;
  return arr.reduce((best, cur) => Math.abs(cur.t - t) < Math.abs(best.t - t) ? cur : best, arr[0]);
}

function round(n, d) { return Math.round(n * 10 ** d) / 10 ** d; }
