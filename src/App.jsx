import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  Play, Pause, Upload, Scissors, Volume2, Sparkles, Palette,
  MessageSquareText, Zap, ShieldCheck, Download, Trash2, RotateCcw,
  Loader2, Film, SlidersHorizontal, Info, X, Undo2, Maximize2, Minimize2,
  AlertTriangle, ZoomIn, VolumeX, Minus, Plus, GraduationCap, BookOpen,
  Flame, ShoppingBag, ShoppingCart, Heart, Mic, Megaphone, User, Camera,
  Briefcase, Brain
} from "lucide-react";
import { runEditingPipeline } from "./services/pipeline.js";
import { EDITING_PROFILES, DEFAULT_PROFILE_ID } from "./services/editingProfiles.js";
import { EdlReview } from "./components/EdlReview.jsx";
import { ProblemsFound } from "./components/ProblemsFound.jsx";
import { IntegrityAndTimelineDebug } from "./components/IntegrityAndTimelineDebug.jsx";
import { AIAnalysisPanel } from "./components/AIAnalysisPanel.jsx";
import { MusicLibrary } from "./components/MusicLibrary.jsx";
import { getMusicById } from "./services/musicCatalog.js";
import { AuthGate } from "./components/AuthGate.jsx";
import { createHistory, pushState, undo as undoHistory, redo as redoHistory, canUndo, canRedo } from "./services/edlHistory.js";
import { createUsageLog, addUsageEntry, summarizeUsage } from "./services/usageLog.js";
import { buildProjectSnapshot, saveProject, loadProject, listProjects, deleteProject } from "./services/projectRepository.js";
import { stampsForProject } from "./services/pipelineVersion.js";
import { scaleAt as computeSmartZoomScale, ZOOM_LEVELS, BASE_ZOOM, effectiveScale } from "./services/smartZoom.js";
import { buildCaptionsFromWords, remapCaptionsToCompiledTime, clipCaptionsToKeepSegments } from "./services/captionCompilation.js";

let idCounter = 1;
const genId = () => "seg-" + idCounter++;

function formatTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function splitAtPoint(segs, t) {
  return segs.flatMap((seg) => {
    if (t <= seg.start + 0.05 || t >= seg.end - 0.05) return [seg];
    return [
      { ...seg, id: genId(), end: t },
      { ...seg, id: genId(), start: t },
    ];
  });
}

function splitSegmentsAtRange(segs, rangeStart, rangeEnd) {
  const result = [];
  for (const seg of segs) {
    if (rangeEnd <= seg.start || rangeStart >= seg.end) {
      result.push(seg);
      continue;
    }
    const points = [
      seg.start,
      Math.max(seg.start, rangeStart),
      Math.min(seg.end, rangeEnd),
      seg.end,
    ];
    const unique = [...new Set(points)].sort((a, b) => a - b);
    for (let i = 0; i < unique.length - 1; i++) {
      const s = unique[i];
      const e = unique[i + 1];
      if (e - s < 0.02) continue;
      const inRange = s >= rangeStart - 0.02 && e <= rangeEnd + 0.02;
      result.push({ id: genId(), start: s, end: e, deleted: inRange ? true : seg.deleted });
    }
  }
  return result;
}

function applyFilterString(c) {
  return `brightness(${c.brightness}%) contrast(${c.contrast}%) saturate(${c.saturate}%)`;
}

const ZOOM_PERIOD = 5; // seconds between automatic punch-ins (fallback when no speech cues)
const ZOOM_DURATION = 0.6; // seconds each punch-in effect lasts

function computeZoomScale(t, zoomEnabled, zoomIntensity, zoomCues = null) {
  if (!zoomEnabled) return 1;
  if (zoomCues && zoomCues.length) {
    const cue = zoomCues.find((c) => t >= c && t < c + ZOOM_DURATION);
    if (!cue) return 1;
    const progress = (t - cue) / ZOOM_DURATION;
    return zoomIntensity - (zoomIntensity - 1) * progress;
  }
  const cyclePos = t % ZOOM_PERIOD;
  if (cyclePos >= ZOOM_DURATION) return 1;
  const progress = cyclePos / ZOOM_DURATION;
  return zoomIntensity - (zoomIntensity - 1) * progress;
}

const CAPTION_STYLES = [
  {
    id: "classico", label: "01. Clássico",
    textColor: "#FFFFFF", weight: 700, sizeScale: 0.95,
    bg: "rgba(0,0,0,0.88)", position: "middle-bottom", pillRadius: 8,
    fontFamily: "'Inter', sans-serif",
  },
  {
    id: "elegante", label: "02. Elegante",
    textColor: "#FFFFFF", accentColor: "#D4AF37", accentTarget: "last",
    weight: 500, sizeScale: 1.0, italic: true,
    bg: null, position: "middle-bottom",
    fontFamily: "'Georgia', serif",
    shadow: { color: "rgba(0,0,0,0.7)", blur: 8, offsetY: 3 },
  },
  {
    id: "minimalista", label: "03. Minimalista",
    textColor: "#FFFFFF", weight: 600, sizeScale: 0.92,
    bg: null, position: "middle-bottom",
    fontFamily: "'Inter', sans-serif",
    shadow: { color: "rgba(0,0,0,0.85)", blur: 6, offsetY: 3 },
  },
  {
    id: "moderno", label: "04. Moderno",
    textColor: "#FFFFFF", accentBg: "#8B5CF6", accentTextColor: "#FFFFFF",
    accentTarget: "last", weight: 700, sizeScale: 1.0,
    bg: null, position: "middle-bottom",
    fontFamily: "'Inter', sans-serif",
    shadow: { color: "rgba(0,0,0,0.55)", blur: 5, offsetY: 2 },
  },
  {
    id: "bold", label: "05. Bold",
    textColor: "#FFFFFF", accentColor: "#FFD400", accentTarget: "last",
    weight: 900, sizeScale: 1.2, uppercase: true, bg: null,
    position: "middle-bottom",
    fontFamily: "'Inter', 'Arial Black', sans-serif",
    shadow: { color: "rgba(0,0,0,0.6)", blur: 6, offsetY: 3 },
  },
  {
    id: "destaque", label: "06. Destaque",
    textColor: "#1A1A1A", bg: "#FFD400", position: "middle-bottom",
    weight: 800, sizeScale: 1.0, pillRadius: 4,
    fontFamily: "'Inter', sans-serif",
  },
  {
    id: "cinema", label: "07. Cinema",
    textColor: "#FFFFFF", weight: 500, sizeScale: 0.95, uppercase: true,
    bg: null, position: "middle-bottom",
    fontFamily: "'Inter', sans-serif",
    letterSpacing: 0.18,
    shadow: { color: "rgba(0,0,0,0.75)", blur: 6, offsetY: 3 },
  },
  {
    id: "caixa", label: "08. Caixa",
    textColor: "#FFFFFF", weight: 600, sizeScale: 1.0,
    bg: "rgba(0,0,0,0.55)", borderColor: "#FFFFFF", borderWidth: 2,
    position: "middle-bottom", pillRadius: 4,
    fontFamily: "'Inter', sans-serif",
  },
  {
    id: "social", label: "09. Social Media",
    textColor: "#1A1A1A", accentColor: "#FF3EA5", accentTarget: "last",
    weight: 700, sizeScale: 1.0, bg: "#FFFFFF",
    position: "middle-bottom", pillRadius: 999,
    fontFamily: "'Inter', sans-serif",
  },
  {
    id: "dynamic", label: "10. Dynamic",
    textColor: "#FFFFFF", accentColor: "#00E5FF", accentTarget: "last",
    weight: 900, sizeScale: 1.15, uppercase: true, italic: true,
    bg: null, position: "middle-bottom",
    fontFamily: "'Inter', 'Arial Black', sans-serif",
    shadow: { color: "rgba(0,0,0,0.7)", blur: 6, offsetY: 3 },
  },
  {
    id: "clean", label: "11. Clean",
    textColor: "#1A1A1A", weight: 600, sizeScale: 0.95,
    bg: "#FFFFFF", position: "middle-bottom", pillRadius: 12,
    fontFamily: "'Inter', sans-serif",
  },
  {
    id: "gradient", label: "12. Gradient",
    textColor: "#FFFFFF", weight: 700, sizeScale: 1.0,
    bgGradient: { from: "#FF6B9D", to: "#8B5CF6" },
    position: "middle-bottom", pillRadius: 12,
    fontFamily: "'Inter', sans-serif",
  },
  // ==== Word-highlight variants (referência CapCut LIFE IN MOTION) ====
  {
    id: "hl_cyan", label: "13. Highlight Cyan",
    textColor: "#FFFFFF", weight: 800, sizeScale: 1.0, uppercase: true,
    bg: null, accentBg: "#00E5FF", accentTextColor: "#0A1F24", accentTarget: "last",
    position: "middle-bottom", fontFamily: "'Inter', sans-serif",
    shadow: { color: "rgba(0,0,0,0.7)", blur: 6, offsetY: 2 },
  },
  {
    id: "hl_magenta", label: "14. Highlight Magenta",
    textColor: "#FFFFFF", weight: 800, sizeScale: 1.0, uppercase: true,
    bg: null, accentBg: "#FF2E93", accentTextColor: "#FFFFFF", accentTarget: "last",
    position: "middle-bottom", fontFamily: "'Inter', sans-serif",
    shadow: { color: "rgba(0,0,0,0.7)", blur: 6, offsetY: 2 },
  },
  {
    id: "hl_red", label: "15. Highlight Red",
    textColor: "#FFFFFF", weight: 800, sizeScale: 1.05, uppercase: true,
    bg: null, accentBg: "#E11D48", accentTextColor: "#FFFFFF", accentTarget: "last",
    position: "middle-bottom", fontFamily: "'Inter', sans-serif",
    strokeColor: "rgba(0,0,0,0.6)", strokeWidth: 1,
  },
  {
    id: "hl_lime", label: "16. Highlight Lime",
    textColor: "#FFFFFF", weight: 800, sizeScale: 1.0, uppercase: true,
    bg: null, accentBg: "#A3E635", accentTextColor: "#1A2010", accentTarget: "last",
    position: "middle-bottom", fontFamily: "'Inter', sans-serif",
    shadow: { color: "rgba(0,0,0,0.7)", blur: 6, offsetY: 2 },
  },
  // ==== Pills e barras solidas ====
  {
    id: "black_pill", label: "17. Pill Preto",
    textColor: "#FFFFFF", weight: 700, sizeScale: 0.98,
    bg: "#000000", position: "middle-bottom", pillRadius: 999,
    fontFamily: "'Inter', sans-serif",
  },
  {
    id: "red_bar", label: "18. Barra Vermelha",
    textColor: "#FFFFFF", weight: 800, sizeScale: 1.0, uppercase: true,
    bg: "#DC2626", position: "middle-bottom", pillRadius: 3,
    fontFamily: "'Inter', sans-serif", letterSpacing: 0.02,
  },
  {
    id: "blue_bar", label: "19. Barra Azul",
    textColor: "#FFFFFF", weight: 700, sizeScale: 0.98, uppercase: true,
    bg: "#2563EB", position: "middle-bottom", pillRadius: 4,
    fontFamily: "'Inter', sans-serif",
  },
  // ==== Karaoke (per-word active highlight) ====
  {
    id: "karaoke_yellow", label: "20. Karaokê Amarelo",
    textColor: "#FFFFFF", weight: 800, sizeScale: 1.0, uppercase: true,
    bg: null, perWord: true, highlightColor: "#FDE047",
    position: "middle-bottom", fontFamily: "'Inter', sans-serif",
    shadow: { color: "rgba(0,0,0,0.75)", blur: 6, offsetY: 2 },
  },
  {
    id: "karaoke_orange", label: "21. Karaokê Laranja",
    textColor: "#FFFFFF", weight: 800, sizeScale: 1.0, uppercase: true,
    bg: null, perWord: true, highlightColor: "#FB923C",
    position: "middle-bottom", fontFamily: "'Inter', sans-serif",
    shadow: { color: "rgba(0,0,0,0.75)", blur: 6, offsetY: 2 },
  },
  {
    id: "karaoke_cyan", label: "22. Karaokê Ciano",
    textColor: "#FFFFFF", weight: 800, sizeScale: 1.0, uppercase: true,
    bg: null, perWord: true, highlightColor: "#22D3EE",
    position: "middle-bottom", fontFamily: "'Inter', sans-serif",
    strokeColor: "#000000", strokeWidth: 2,
  },
  // ==== Tipografia forte ====
  {
    id: "impact_stroke", label: "23. Impact Outline",
    textColor: "#FFFFFF", weight: 900, sizeScale: 1.2, uppercase: true,
    bg: null, position: "middle-bottom",
    fontFamily: "'Inter', 'Arial Black', sans-serif",
    strokeColor: "#000000", strokeWidth: 4,
    letterSpacing: 0.02,
  },
  {
    id: "impact_yellow", label: "24. Impact Amarelo",
    textColor: "#FDE047", weight: 900, sizeScale: 1.15, uppercase: true,
    bg: null, position: "middle-bottom",
    fontFamily: "'Inter', 'Arial Black', sans-serif",
    strokeColor: "#000000", strokeWidth: 3,
  },
  {
    id: "retro_yellow", label: "25. Retrô Amarelo",
    textColor: "#FCD34D", weight: 700, sizeScale: 1.0, italic: true,
    bg: null, position: "middle-bottom",
    fontFamily: "'Georgia', serif",
    shadow: { color: "rgba(0,0,0,0.8)", blur: 4, offsetY: 3 },
  },
  {
    id: "italic_light", label: "26. Itálico Leve",
    textColor: "#FFFFFF", weight: 400, sizeScale: 1.0, italic: true,
    bg: null, position: "middle-bottom",
    fontFamily: "'Georgia', serif",
    shadow: { color: "rgba(0,0,0,0.7)", blur: 8, offsetY: 3 },
  },
  // ==== Efeitos de luz ====
  {
    id: "glow_purple", label: "27. Glow Roxo",
    textColor: "#FFFFFF", weight: 700, sizeScale: 1.0,
    bg: null, position: "middle-bottom",
    fontFamily: "'Inter', sans-serif",
    shadow: { color: "rgba(139,92,246,0.95)", blur: 14, offsetY: 0 },
  },
  {
    id: "glow_cyan", label: "28. Glow Ciano",
    textColor: "#FFFFFF", weight: 700, sizeScale: 1.0, uppercase: true,
    bg: null, position: "middle-bottom",
    fontFamily: "'Inter', sans-serif",
    shadow: { color: "rgba(34,211,238,0.95)", blur: 14, offsetY: 0 },
  },
  {
    id: "glow_pink", label: "29. Glow Rosa",
    textColor: "#FFFFFF", weight: 700, sizeScale: 1.0,
    bg: null, position: "middle-bottom",
    fontFamily: "'Inter', sans-serif",
    shadow: { color: "rgba(244,114,182,0.95)", blur: 14, offsetY: 0 },
  },
  // ==== Backgrounds especiais ====
  {
    id: "white_bg", label: "30. Fundo Branco",
    textColor: "#111111", weight: 800, sizeScale: 1.0, uppercase: true,
    bg: "#FFFFFF", position: "middle-bottom", pillRadius: 6,
    fontFamily: "'Inter', sans-serif",
  },
  {
    id: "yellow_bg", label: "31. Fundo Amarelo",
    textColor: "#111111", weight: 800, sizeScale: 1.0, uppercase: true,
    bg: "#FDE047", position: "middle-bottom", pillRadius: 6,
    fontFamily: "'Inter', sans-serif",
  },
  {
    id: "gradient_ocean", label: "32. Gradient Oceano",
    textColor: "#FFFFFF", weight: 700, sizeScale: 1.0, uppercase: true,
    bgGradient: { from: "#06B6D4", to: "#3B82F6" },
    position: "middle-bottom", pillRadius: 12,
    fontFamily: "'Inter', sans-serif",
  },
];

// Safe-area calibrada pra 9:16: UI do TikTok/Reels ocupa base ~18% e topo
// ~10%. Legenda nunca gruda em borda.
const CAPTION_Y_FRACTION = { bottom: 0.82, "middle-bottom": 0.70, top: 0.18, center: 0.5 };
// Safe width — legenda ocupa 90% da largura ÚTIL DO VÍDEO (canvas.width,
// não container). Prioridade HORIZONTAL: cresce em largura antes de
// quebrar linha; nunca colada nas bordas.
const CAPTION_SAFE_WIDTH_FRAC = 0.90;
const CAPTION_FADE_SEC = 0.12;

const TRANSITION_DURATION = 0.08; // 80ms — quase imperceptível, evita "escurecer" no zoom-cut

function wrapTextByWidth(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const totalWidth = ctx.measureText(text).width;
  if (totalWidth <= maxWidth) return [text];
  // HARD CAP: 2 linhas. Se não couber, o Layout Engine já era pra ter
  // dividido em outra cue. Aqui só balanceamos.
  const targetLines = 2;
  const target = totalWidth / targetLines;
  const lines = [];
  let cur = "";
  let curWidth = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const wSpace = cur ? " " + w : w;
    const wWidth = ctx.measureText(wSpace).width;
    const nextWidth = curWidth + wWidth;
    const remainingWords = words.length - i - 1;
    const shouldBreak = (nextWidth > maxWidth && cur) ||
                        (nextWidth >= target && cur && remainingWords >= 1 && lines.length < targetLines - 1);
    if (shouldBreak) {
      lines.push(cur);
      cur = w;
      curWidth = ctx.measureText(w).width;
    } else {
      cur = cur ? cur + " " + w : w;
      curWidth = nextWidth;
    }
  }
  if (cur) lines.push(cur);
  // Se sobrou 3ª linha, força junção nas 2 primeiras (fallback defensivo).
  if (lines.length > 2) {
    const merged = lines.slice(1).join(" ");
    return [lines[0], merged];
  }
  return lines.length ? lines : [text];
}

function drawFrame(ctx, video, canvas, colorAdjust, captions, t, zoomScale = 1, captionStyle = CAPTION_STYLES[0], opacity = 1) {
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (zoomScale !== 1) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoomScale, zoomScale);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
  }
  ctx.filter = applyFilterString(colorAdjust);
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  const { sx, sy, sw, sh } = computeCoverDraw(video.videoWidth, video.videoHeight, canvas.width, canvas.height);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.restore();

  const cue = captions.find((c) => t >= c.start && t < c.end);
  if (!cue) return;

  const rawText = cue.text || "";
  const text = captionStyle.uppercase ? rawText.toUpperCase() : rawText;
  const fontSize = Math.max(14, Math.round(canvas.height * 0.045 * captionStyle.sizeScale));
  const fontFamily = captionStyle.fontFamily || "sans-serif";
  const italicPrefix = captionStyle.italic ? "italic " : "";
  ctx.font = `${italicPrefix}${captionStyle.weight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Safe width — nunca colada nas bordas.
  const maxWidth = canvas.width * CAPTION_SAFE_WIDTH_FRAC;
  const yFrac = CAPTION_Y_FRACTION[captionStyle.position] ?? 0.82;
  const centerY = canvas.height * yFrac;
  // Fade curto de entrada/saída (não competir com a fala).
  const inLeft = (t - cue.start) / CAPTION_FADE_SEC;
  const inRight = (cue.end - t) / CAPTION_FADE_SEC;
  const captionAlpha = Math.max(0, Math.min(1, inLeft, inRight, 1));
  ctx.globalAlpha = captionAlpha;

  // Modo karaokê: renderiza palavra-a-palavra com a atual em destaque.
  if (captionStyle.perWord && cue.words?.length) {
    const activeIdx = cue.words.findIndex((w) => t >= w.start && t < w.end);
    // Divide as palavras em linhas usando medição
    const items = cue.words.map((w) => (captionStyle.uppercase ? (w.word || "").toUpperCase() : (w.word || "")));
    const lines = [];
    const idxToLine = [];
    let curItems = [];
    let curIdxs = [];
    const spaceW = ctx.measureText(" ").width;
    let curWidth = 0;
    for (let i = 0; i < items.length; i++) {
      const wtxt = items[i];
      const w = ctx.measureText(wtxt).width;
      const add = (curItems.length ? spaceW : 0) + w;
      if (curWidth + add > maxWidth && curItems.length) {
        lines.push({ items: curItems, idxs: curIdxs });
        curItems = []; curIdxs = []; curWidth = 0;
      }
      curItems.push(wtxt); curIdxs.push(i);
      curWidth += (curItems.length > 1 ? spaceW : 0) + w;
    }
    if (curItems.length) lines.push({ items: curItems, idxs: curIdxs });
    lines.forEach((ln) => ln.idxs.forEach((idx, k) => idxToLine[idx] = { lineIdx: lines.indexOf(ln), posInLine: k }));

    const lineHeight = fontSize * 1.15;
    const totalHeight = lineHeight * lines.length;
    const startY = centerY - totalHeight / 2 + lineHeight / 2;

    lines.forEach((ln, li) => {
      const lineText = ln.items.join(" ");
      const lineWidth = ctx.measureText(lineText).width;
      const y = startY + li * lineHeight;
      let cursorX = canvas.width / 2 - lineWidth / 2;
      ctx.textAlign = "left";
      // Stroke primeiro pra toda a linha
      if (captionStyle.strokeColor && captionStyle.strokeWidth) {
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.lineWidth = captionStyle.strokeWidth;
        ctx.strokeStyle = captionStyle.strokeColor;
        applyShadowFor(ctx, captionStyle);
        ctx.strokeText(lineText, cursorX, y);
        clearShadow(ctx);
      }
      // Fill palavra por palavra
      let x = cursorX;
      for (let k = 0; k < ln.items.length; k++) {
        const wtxt = ln.items[k];
        const globalIdx = ln.idxs[k];
        const isActive = globalIdx === activeIdx;
        ctx.fillStyle = isActive ? (captionStyle.highlightColor || "#FFEB3B") : captionStyle.textColor;
        applyShadowFor(ctx, captionStyle);
        ctx.fillText(wtxt, x, y);
        clearShadow(ctx);
        x += ctx.measureText(wtxt).width + spaceW;
      }
      ctx.textAlign = "center"; // reset
    });
    ctx.globalAlpha = 1;
    return;
  }

  // Modo normal: quebra em linhas se necessário
  const lines = wrapTextByWidth(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.20;
  const totalHeight = lineHeight * lines.length;
  const startY = centerY - totalHeight / 2 + lineHeight / 2;

  // ==== Background: gradiente, cor sólida, ou nada ====
  if (captionStyle.bg || captionStyle.bgGradient) {
    const paddingX = 28, paddingY = 14;
    const widest = Math.max(...lines.map((l) => measureTextWithSpacing(ctx, l, captionStyle.letterSpacing, fontSize)));
    const boxWidth = widest + paddingX * 2;
    const boxHeight = totalHeight + paddingY * 2;
    const boxX = canvas.width / 2 - boxWidth / 2;
    const boxY = centerY - boxHeight / 2;
    const radius = captionStyle.pillRadius ?? 12;
    let fill;
    if (captionStyle.bgGradient) {
      fill = ctx.createLinearGradient(boxX, boxY, boxX + boxWidth, boxY);
      fill.addColorStop(0, captionStyle.bgGradient.from);
      fill.addColorStop(1, captionStyle.bgGradient.to);
    } else {
      fill = captionStyle.bg;
    }
    ctx.fillStyle = fill;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, Math.min(radius, boxHeight / 2));
      ctx.fill();
    } else {
      ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    }
    if (captionStyle.borderColor && captionStyle.borderWidth) {
      ctx.lineWidth = captionStyle.borderWidth;
      ctx.strokeStyle = captionStyle.borderColor;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, Math.min(radius, boxHeight / 2));
        ctx.stroke();
      } else {
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
      }
    }
  }

  // ==== Palavras em destaque (accent) ====
  // Prioridade: emphasisWordIdx canônico da cue (semântico) > accentTarget
  // do template ("last"/"first" — fallback estético).
  const accentWordIdx = pickAccentWordIndex(text, captionStyle.accentTarget, cue);

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    drawStyledLine(ctx, line, canvas.width / 2, y, captionStyle, fontSize, accentWordIdx, text);
  });

  // Reset alpha pra não vazar pro próximo frame.
  ctx.globalAlpha = 1;
}

function pickAccentWordIndex(fullText, target, cue) {
  // 1) Semântica canônica vinda do captionLayoutEngine
  if (cue && Number.isInteger(cue.emphasisWordIdx) && cue.emphasisWordIdx >= 0) {
    return cue.emphasisWordIdx;
  }
  if (!target) return -1;
  const words = fullText.trim().split(/\s+/);
  if (target === "last") return words.length - 1;
  if (target === "first") return 0;
  return -1;
}

function measureTextWithSpacing(ctx, text, letterSpacing, fontSize) {
  if (!letterSpacing) return ctx.measureText(text).width;
  let w = 0;
  const spacing = letterSpacing * fontSize;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return w - spacing; // último char não soma spacing
}

function drawStyledLine(ctx, line, cxCenter, y, style, fontSize, accentWordIdx, fullText) {
  // Extrai palavras da linha e identifica quais são "accent" comparando
  // com o índice no texto completo.
  const fullWords = fullText.trim().split(/\s+/);
  const lineWords = line.trim().split(/\s+/);
  const firstIdxInFull = fullWords.findIndex((w, k) => {
    for (let j = 0; j < lineWords.length; j++) {
      if (fullWords[k + j] !== lineWords[j]) return false;
    }
    return true;
  });

  const spacing = (style.letterSpacing || 0) * fontSize;
  const spaceW = ctx.measureText(" ").width + spacing * 2;

  // Mede cada palavra da linha (com letter-spacing se aplicável)
  const wordWidths = lineWords.map((w) => measureTextWithSpacing(ctx, w, style.letterSpacing, fontSize));
  const totalLineWidth = wordWidths.reduce((s, w) => s + w, 0) + spaceW * (lineWords.length - 1);
  let x = cxCenter - totalLineWidth / 2;

  ctx.textAlign = "left";

  // Stroke primeiro pra toda a linha (efeito outline sob o fill)
  if (style.strokeColor && style.strokeWidth) {
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = style.strokeWidth;
    ctx.strokeStyle = style.strokeColor;
    let xs = x;
    lineWords.forEach((w, k) => {
      applyShadowFor(ctx, style);
      strokeWithSpacing(ctx, w, xs, y, spacing);
      clearShadow(ctx);
      xs += wordWidths[k] + spaceW;
    });
  }

  // Fill (com accent bg / accent color quando aplicável)
  lineWords.forEach((w, k) => {
    const globalIdx = firstIdxInFull >= 0 ? firstIdxInFull + k : -1;
    const isAccent = globalIdx === accentWordIdx;
    const wWidth = wordWidths[k];

    // Accent bg (pill atrás da palavra em destaque)
    if (isAccent && style.accentBg) {
      const padX = fontSize * 0.20, padY = fontSize * 0.10;
      const bgX = x - padX;
      const bgY = y - fontSize / 2 - padY + fontSize * 0.08;
      const bgW = wWidth + padX * 2;
      const bgH = fontSize + padY * 2;
      const r = Math.min(bgH / 2, 8);
      ctx.fillStyle = style.accentBg;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(bgX, bgY, bgW, bgH, r);
        ctx.fill();
      } else {
        ctx.fillRect(bgX, bgY, bgW, bgH);
      }
    }

    applyShadowFor(ctx, style);
    const wColor = isAccent
      ? (style.accentTextColor || style.accentColor || style.textColor)
      : style.textColor;
    ctx.fillStyle = wColor;
    fillWithSpacing(ctx, w, x, y, spacing);
    clearShadow(ctx);

    x += wWidth + spaceW;
  });

  ctx.textAlign = "center";
}

function fillWithSpacing(ctx, text, x, y, spacing) {
  if (!spacing) { ctx.fillText(text, x, y); return; }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}
function strokeWithSpacing(ctx, text, x, y, spacing) {
  if (!spacing) { ctx.strokeText(text, x, y); return; }
  let cx = x;
  for (const ch of text) {
    ctx.strokeText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

function applyShadowFor(ctx, style) {
  if (!style.shadow) return;
  ctx.shadowColor = style.shadow.color || "rgba(0,0,0,0.6)";
  ctx.shadowBlur = style.shadow.blur || 6;
  ctx.shadowOffsetY = style.shadow.offsetY || 0;
  ctx.shadowOffsetX = style.shadow.offsetX || 0;
}
function clearShadow(ctx) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowOffsetX = 0;
}

function wordRangeToTime(startWord, endWord, totalWords, duration) {
  const start = Math.max(0, Math.min(1, startWord / totalWords)) * duration;
  const end = Math.max(0, Math.min(1, (endWord + 1) / totalWords)) * duration;
  return [start, Math.max(start + 0.05, end)];
}

// Re-plays the decoded audio track through MediaRecorder to get a small,
// real audio-only file to send for transcription (much smaller than the video).
async function extractAudioBlob(videoUrl) {
  const resp = await fetch(videoUrl);
  const arrayBuf = await resp.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  const audioBuffer = await ctx.decodeAudioData(arrayBuf);
  const dest = ctx.createMediaStreamDestination();
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(dest);
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  const recorder = new MediaRecorder(dest.stream, { mimeType });
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  recorder.start();
  source.start(0);
  await new Promise((resolve) => {
    source.onended = resolve;
  });
  recorder.stop();
  await stopped;
  ctx.close();
  return new Blob(chunks, { type: "audio/webm" });
}

// Builds precisely-timed caption cues directly from word-level timestamps
// (no AI call needed for timing once we have real transcription).
// buildCaptionsFromWords foi extraído pra src/services/captionCompilation.js.
// Import feito no topo do arquivo.

// Finds moments right after a natural pause in speech — good spots for a
// punch-in zoom, since that's usually where emphasis/a new idea starts.
function findZoomCuesFromWords(words, pauseGap = 0.5, minGapBetweenCues = 3) {
  const cues = [];
  let lastCueTime = -Infinity;
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap >= pauseGap && words[i].start - lastCueTime >= minGapBetweenCues) {
      cues.push(words[i].start);
      lastCueTime = words[i].start;
    }
  }
  return cues;
}

function computeTransitionOpacity(_t, _seg, _segIndex, _totalSegs, _enabled, _transitionDuration) {
  // Desabilitado: usuário pediu para NUNCA escurecer nos cortes.
  // A "transição" entre cortes agora é feita pelo Zoom In pós-corte
  // (smartZoom.js). Mantém a assinatura pra compat com callers.
  return 1;
}

function pickTickInterval(duration) {
  if (duration <= 30) return 5;
  if (duration <= 90) return 10;
  if (duration <= 300) return 30;
  if (duration <= 900) return 60;
  return 120;
}

const TIMELINE_LEGEND = [
  { label: "Mantido", color: "#378ADD" },
  { label: "Será cortado", color: "#FF6A2B" },
  { label: "A revisar", color: "#FFB020" },
  { label: "Áudio", color: "#7C5CFF" },
];

function seekTo(video, time) {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

function playSegment(video, endTime, onFrame) {
  return new Promise((resolve, reject) => {
    video
      .play()
      .then(() => {
        const step = () => {
          if (video.currentTime >= endTime - 0.01 || video.ended) {
            video.pause();
            resolve();
            return;
          }
          onFrame(video.currentTime);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      })
      .catch(reject);
  });
}

const CUT_PACE_OPTIONS = [
  { id: "rapido", label: "Ritmo rápido", silence: 0.035, minSilenceDur: 0.35, maxWords: 5 },
  { id: "medio", label: "Ritmo médio", silence: 0.022, minSilenceDur: 0.6, maxWords: 7 },
  { id: "suave", label: "Ritmo suave", silence: 0.012, minSilenceDur: 0.9, maxWords: 10 },
];

const ZOOM_LEVEL_OPTIONS = [
  { id: "leve", label: "Zoom leve", intensity: 1.06 },
  { id: "medio", label: "Zoom médio", intensity: 1.14 },
  { id: "forte", label: "Zoom forte", intensity: 1.25 },
];

const COLOR_GRADE_OPTIONS = [
  { id: "neutro", label: "Neutro", adjust: { brightness: 100, contrast: 100, saturate: 100 } },
  { id: "quente", label: "Quente", adjust: { brightness: 104, contrast: 106, saturate: 112 } },
  { id: "frio", label: "Frio", adjust: { brightness: 100, contrast: 108, saturate: 92 } },
  { id: "vivido", label: "Contraste alto", adjust: { brightness: 102, contrast: 120, saturate: 130 } },
];

const VIDEO_TYPES = [
  { id: "educacional", label: "Conteúdo Educacional", desc: "Otimizado para ensino", icon: GraduationCap, bias: { cutPace: ["medio"], zoom: ["leve", "medio"], color: ["neutro"], captionIds: ["classico", "clean"] } },
  { id: "autoridade", label: "Autoridade", desc: "Posicionamento e credibilidade", icon: ShieldCheck, bias: { cutPace: ["medio", "suave"], zoom: ["leve"], color: ["neutro", "frio"], captionIds: ["classico", "clean"] } },
  { id: "storytelling", label: "Storytelling", desc: "Histórias que prendem atenção", icon: BookOpen, bias: { cutPace: ["suave", "medio"], zoom: ["leve", "medio"], color: ["quente", "neutro"], captionIds: ["classico", "minimalista"] } },
  { id: "viral", label: "Viral / Retenção", desc: "Máxima retenção e dinamismo", icon: Flame, bias: { cutPace: ["rapido"], zoom: ["forte"], color: ["vivido"], captionIds: ["bold", "destaque"] } },
  { id: "redes_sociais", label: "Redes Sociais", desc: "Reels, TikTok e Shorts", icon: Heart, bias: { cutPace: ["rapido", "medio"], zoom: ["medio", "forte"], color: ["vivido"], captionIds: ["destaque", "bold"] } },
  { id: "personal_brand", label: "Personal Brand", desc: "Conteúdo pessoal e autêntico", icon: User, bias: { cutPace: ["medio"], zoom: ["leve"], color: ["neutro", "quente"], captionIds: ["classico", "minimalista"] } },
  { id: "vendas", label: "Vendas", desc: "Foco em conversão", icon: ShoppingBag, bias: { cutPace: ["rapido", "rapido", "medio"], zoom: ["forte", "medio"], color: ["vivido", "quente"], captionIds: ["bold", "destaque"] } },
  { id: "tiktok_shop", label: "TikTok Shop / Produto", desc: "Feito para vender produtos", icon: ShoppingCart, bias: { cutPace: ["rapido"], zoom: ["forte"], color: ["vivido"], captionIds: ["destaque", "bold"] } },
  { id: "marketing", label: "Marketing & Anúncios", desc: "Criativos para performance", icon: Megaphone, bias: { cutPace: ["rapido", "medio"], zoom: ["medio", "forte"], color: ["vivido", "quente"], captionIds: ["bold", "destaque"] } },
  { id: "podcast", label: "Podcast / Cortes", desc: "Conversas em conteúdo viral", icon: Mic, bias: { cutPace: ["suave", "medio"], zoom: ["leve"], color: ["neutro"], captionIds: ["classico", "minimalista"] } },
  { id: "vlog", label: "Vlog / Lifestyle", desc: "Pessoal, dinâmico e imersivo", icon: Camera, bias: { cutPace: ["medio"], zoom: ["medio"], color: ["quente"], captionIds: ["minimalista", "classico"] } },
  { id: "corporativo", label: "Corporativo", desc: "Profissional e institucional", icon: Briefcase, bias: { cutPace: ["medio", "suave"], zoom: ["leve"], color: ["neutro", "frio"], captionIds: ["classico", "clean"] } },
];

const VIDEO_TYPE_GROUPS = [
  { title: "Conteúdo", ids: ["educacional", "autoridade", "storytelling", "viral", "redes_sociais", "personal_brand"] },
  { title: "Comercial / Formato", ids: ["vendas", "tiktok_shop", "marketing", "podcast", "vlog", "corporativo"] },
];

const PLATFORMS = [
  { id: "tiktok", label: "TikTok", ratio: [9, 16] },
  { id: "reels", label: "Instagram Reels", ratio: [9, 16] },
  { id: "feed", label: "Instagram Feed", ratio: [1, 1] },
  { id: "shorts", label: "YouTube Shorts", ratio: [9, 16] },
  { id: "youtube", label: "YouTube", ratio: [16, 9] },
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickStyleProfile(videoTypeId) {
  const type = VIDEO_TYPES.find((t) => t.id === videoTypeId) || VIDEO_TYPES[0];
  const cutPace = CUT_PACE_OPTIONS.find((o) => o.id === pickRandom(type.bias.cutPace));
  const zoom = ZOOM_LEVEL_OPTIONS.find((o) => o.id === pickRandom(type.bias.zoom));
  const color = COLOR_GRADE_OPTIONS.find((o) => o.id === pickRandom(type.bias.color));
  const captionStyleId = pickRandom(type.bias.captionIds);
  return { cutPace, zoom, color, captionStyleId };
}

// Computes a "cover" crop (like CSS object-fit: cover) so a source video of
// any aspect ratio fills the target canvas size without distortion.
function computeCoverDraw(srcW, srcH, dstW, dstH) {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;
  let sx, sy, sw, sh;
  if (srcRatio > dstRatio) {
    sh = srcH;
    sw = sh * dstRatio;
    sx = (srcW - sw) / 2;
    sy = 0;
  } else {
    sw = srcW;
    sh = sw / dstRatio;
    sx = 0;
    sy = (srcH - sh) / 2;
  }
  return { sx, sy, sw, sh };
}

// Menu enxugado: capacidades técnicas (silence, speechErrors, transitions)
// vivem DENTRO da Edição Inteligente e não são mais escolhas do usuário.
// Cor / Volume seguem como ajustes manuais complementares.
const TOOLS = [
  { id: "smart", label: "Edição inteligente", icon: Brain, desc: "IA edita seu vídeo automaticamente" },
  { id: "color", label: "Correção de cor", icon: Palette, desc: "Brilho, contraste, saturação" },
  { id: "music", label: "Música", icon: Volume2, desc: "Biblioteca de trilhas" },
  { id: "volume", label: "Volume", icon: Volume2, desc: "Fala, música e ambiente" },
];

export default function AiVideoEditor() {
  const [videoUrl, setVideoUrl] = useState(null);
  const [rawFile, setRawFile] = useState(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [fileName, setFileName] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [segments, setSegments] = useState([]);
  const [selectedSegId, setSelectedSegId] = useState(null);
  const [thumbnails, setThumbnails] = useState([]);
  const [generatingThumbs, setGeneratingThumbs] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [activeTool, setActiveTool] = useState("smart");

  const [waveform, setWaveform] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [silenceThreshold, setSilenceThreshold] = useState(0.02);
  const [silenceBusy, setSilenceBusy] = useState(false);

  const [transcript, setTranscript] = useState("");
  const [wordTimestamps, setWordTimestamps] = useState([]);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState("");

  const [autoEditBusy, setAutoEditBusy] = useState(false);
  const [autoEditElapsed, setAutoEditElapsed] = useState(0);
  const [autoEditEstimate, setAutoEditEstimate] = useState(0);
  const [autoEditStep, setAutoEditStep] = useState("");
  const [autoEditError, setAutoEditError] = useState("");
  const [autoEditDone, setAutoEditDone] = useState(false);

  const [captions, setCaptions] = useState([]);
  const [generatingCaptions, setGeneratingCaptions] = useState(false);
  const [captionError, setCaptionError] = useState("");
  const [maxCaptionWords, setMaxCaptionWords] = useState(8);
  const [captionStyleId, setCaptionStyleId] = useState("classico");
  const captionStyle = CAPTION_STYLES.find((s) => s.id === captionStyleId) || CAPTION_STYLES[0];

  const [findingMistakes, setFindingMistakes] = useState(false);
  const [mistakeError, setMistakeError] = useState("");
  const [mistakesFound, setMistakesFound] = useState(0);

  const [zoomEnabled, setZoomEnabled] = useState(false);
  const [zoomIntensity, setZoomIntensity] = useState(1.12);
  const [zoomScale, setZoomScale] = useState(1);

  const [transitionsEnabled, setTransitionsEnabled] = useState(false);
  const [previewOpacity, setPreviewOpacity] = useState(1);

  const [colorAdjust, setColorAdjust] = useState({ brightness: 100, contrast: 100, saturate: 100 });
  // Volumes independentes por track. `volume` fica como "fala" (do vídeo).
  const [volume, setVolume] = useState(1);              // fala (áudio do vídeo)
  // Referência do usuário: se voz=10, música=2.5-3 (padrão 2.8) — mantém
  // fala nítida sem música competir. Auto ajusta ao selecionar.
  const [musicVolume, setMusicVolume] = useState(0.28);
  const [ambientVolume, setAmbientVolume] = useState(0.15);
  const [selectedMusicId, setSelectedMusicId] = useState(null);
  // Track completo — cobre uploads e resultados remotos que não estão
  // no catálogo local. Se null cai no getMusicById(catálogo).
  const [selectedMusicTrack, setSelectedMusicTrack] = useState(null);
  const musicAudioRef = useRef(null);
  const resolveMusicTrack = (id) => selectedMusicTrack || getMusicById(id);
  const handleMusicSelect = (id, track) => {
    setSelectedMusicId(id);
    setSelectedMusicTrack(id ? (track || null) : null);
    // Ao selecionar nova música, reajusta volume pra ratio ideal ~28%
    // da voz (2.8:10) — voz nítida sem música competir. Se o usuário já
    // ajustou pra >0.5 (queria alta), respeita.
    if (id && musicVolume > 0.5) return;
    if (id) setMusicVolume(0.28);
  };

  const [videoTypeId, setVideoTypeId] = useState("vendas");
  const [platformIds, setPlatformIds] = useState(["tiktok"]);
  const togglePlatform = (id) => {
    setPlatformIds((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((p) => p !== id) : prev) : [...prev, id]
    );
  };
  const [lastStyleProfile, setLastStyleProfile] = useState(null);
  const platform = PLATFORMS.find((p) => p.id === platformIds[0]) || PLATFORMS[0];

  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef(null);

  const [resolution, setResolution] = useState("1080p");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState("");
  const [exportedUrl, setExportedUrl] = useState(null);
  const [editedVideoUrl, setEditedVideoUrl] = useState(null);
  const [showingEdited, setShowingEdited] = useState(false);

  // --- Intelligent editing (semantic pipeline) ---
  const [intensityId, setIntensityId] = useState(DEFAULT_PROFILE_ID);
  const [smartBusy, setSmartBusy] = useState(false);
  const [smartStep, setSmartStep] = useState("");
  const [smartError, setSmartError] = useState("");
  const [edl, setEdl] = useState([]);
  const [problemCandidates, setProblemCandidates] = useState([]);
  const [narrativeTopic, setNarrativeTopic] = useState("");
  const [zoomEvents, setZoomEvents] = useState([]);
  // Integrity check + debug report — expostos pelo pipeline.
  const [integrityReport, setIntegrityReport] = useState(null);
  const [debugTimelineReport, setDebugTimelineReport] = useState(null);
  // Fase 3 · artefatos completos da análise da IA
  const [narrativeMap, setNarrativeMap] = useState(null);
  const [visualPlan, setVisualPlan] = useState(null);
  const [brollPlan, setBrollPlan] = useState(null);
  const [graphicsPlan, setGraphicsPlan] = useState(null);
  const [productMoments, setProductMoments] = useState(null);
  const [protectedRanges, setProtectedRanges] = useState(null);
  const [patternInterrupts, setPatternInterrupts] = useState(null);
  // Fase 5 · QC score dimensional
  const [dimensionalQuality, setDimensionalQuality] = useState(null);
  const [reprocessBusy, setReprocessBusy] = useState(false);
  // Seleção de zoom para edição (excluir/redimensionar/mover/nível).
  const [selectedZoomId, setSelectedZoomId] = useState(null);
  // Ref pra drag state
  const zoomDragRef = useRef(null);
  // Toggle "Zoom automático" na Edição Inteligente. Padrão ON.
  // Desligado por padrão — foco em edição/corte. Usuário liga manualmente
  // quando os cortes estiverem prontos.
  const [smartZoomEnabled, setSmartZoomEnabled] = useState(false);
  // Legendas automáticas
  const [autoCaptionsEnabled, setAutoCaptionsEnabled] = useState(false);
  const [captionStylePreset, setCaptionStylePreset] = useState("classico");
  const [captionPosition, setCaptionPosition] = useState("bottom");
  const [captionStyleGridOpen, setCaptionStyleGridOpen] = useState(true);
  const captionGridRef = useRef(null);
  // Fecha automaticamente ao clicar fora do grid de estilos.
  useEffect(() => {
    if (!captionStyleGridOpen) return;
    const onDocClick = (e) => {
      if (!captionGridRef.current) return;
      if (captionGridRef.current.contains(e.target)) return;
      setCaptionStyleGridOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [captionStyleGridOpen]);
  // Debug panel só aparece com ?debug=1 na URL.
  const debugMode = typeof window !== "undefined" && window.location.search.includes("debug=1");
  // --- Diagnóstico forense ---
  // Cada entrada captura o que o pipeline "viu" numa janela específica que o
  // usuário marcou manualmente como erro NÃO detectado.
  const [missedDetections, setMissedDetections] = useState([]);
  const [markStart, setMarkStart] = useState(null); // timestamp em s ou null
  const [smartDone, setSmartDone] = useState(false);
  // Toggles the "watch edited version" mode. When true, the player jumps
  // through segments with action !== "review" && !deleted, in order.
  const [previewMode, setPreviewMode] = useState(false);
  // If not null, playback plays this [start,end] once then pauses (used
  // by "Reproduzir trecho" in the EDL review panel).
  const playRangeRef = useRef(null);
  // Reuses across pipeline runs — skips re-transcribing when only the profile changes.
  const cachedRef = useRef({ videoUrl: null, words: null, waveform: null });

  // --- Phase 2: history, persistence, telemetry ---
  const [history, setHistory] = useState(() => createHistory([]));
  const [projectId, setProjectId] = useState(null);
  const [projectName, setProjectName] = useState("");
  const [projectCreatedAt, setProjectCreatedAt] = useState(null);
  const [savedProjects, setSavedProjects] = useState([]);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [showUsage, setShowUsage] = useState(false);
  const [usageLog, setUsageLog] = useState(() => createUsageLog());
  const usageLogRef = useRef(usageLog);
  usageLogRef.current = usageLog;
  const abortRef = useRef(null);
  const autosaveTimerRef = useRef(null);
  const projectSnapshotRef = useRef({});
  // Discreet toast for undo/redo feedback ("Corte desfeito").
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 1800);
  }, []);

  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (videoUrl && videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
      if (exportedUrl) URL.revokeObjectURL(exportedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Música: sincroniza com play/pause do vídeo + aplica volume.
  useEffect(() => {
    const audio = musicAudioRef.current;
    if (!audio) return;
    const track = selectedMusicId ? resolveMusicTrack(selectedMusicId) : null;
    if (!track) { audio.pause(); audio.src = ""; return; }
    if (audio.src !== track.url) audio.src = track.url;
    audio.volume = musicVolume;
    audio.loop = true;
    if (isPlaying) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [selectedMusicId, musicVolume, isPlaying]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume, videoUrl]);

  useEffect(() => {
    if (!autoEditBusy) return;
    const start = Date.now();
    setAutoEditElapsed(0);
    const interval = setInterval(() => {
      setAutoEditElapsed((Date.now() - start) / 1000);
    }, 250);
    return () => clearInterval(interval);
  }, [autoEditBusy]);

  const toggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      if (next && containerRef.current && containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen().catch(() => {});
      } else if (!next && document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    } catch (err) {
      // Fullscreen API unavailable in this context; the CSS "expanded" state below still applies.
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    if (videoUrl && videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    if (editedVideoUrl) URL.revokeObjectURL(editedVideoUrl);
    const url = URL.createObjectURL(file);
    setRawFile(file);
    setUsedFallback(false);
    setVideoUrl(url);
    setFileName(file.name);
    setSegments([]);
    setCaptions([]);
    setWaveform([]);
    setExportedUrl(null);
    setExportError("");
    setAnalyzeError("");
    setCurrentTime(0);
    setDuration(0);
    setEditedVideoUrl(null);
    setShowingEdited(false);
    setActiveTool("smart");
    setEdl([]);
    setProblemCandidates([]);
    setZoomEvents([]);
    setDimensionalQuality(null);
    setNarrativeTopic("");
    setSmartDone(false);
    setSmartError("");
    // If the user just re-attached a file with the same name as the loaded
    // project, keep the project id (they're resuming). Otherwise start fresh.
    if (!projectSnapshotRef.current?.video || projectSnapshotRef.current.video.fileName !== file.name) {
      setProjectId(null);
      setProjectName(file.name);
      setProjectCreatedAt(null);
      setUsageLog(createUsageLog());
      setHistory(createHistory([]));
      projectSnapshotRef.current = {};
    }
    cachedRef.current = { videoUrl: null, words: null, waveform: null };
  };

  const [metadataError, setMetadataError] = useState("");

  const onLoadedMetadata = async (e) => {
    const v = e.target;
    setMetadataError("");
    let d = v.duration;
    if (!isFinite(d) || d <= 0) {
      // Some containers (webm without an index, some mp4s) report Infinity
      // until the player is forced to seek near the end once.
      await new Promise((resolve) => {
        const onDurationChange = () => {
          if (isFinite(v.duration) && v.duration > 0) {
            v.removeEventListener("durationchange", onDurationChange);
            resolve();
          }
        };
        v.addEventListener("durationchange", onDurationChange);
        try {
          v.currentTime = 1e101;
        } catch (err) {
          resolve();
        }
        setTimeout(resolve, 1500);
      });
      try {
        v.currentTime = 0;
      } catch (err) {}
      d = v.duration;
    }
    if (!isFinite(d) || d <= 0) {
      setMetadataError("Não consegui ler a duração deste vídeo. Tente converter para MP4 (H.264) e envie novamente.");
      return;
    }
    setDuration(d);
    setSegments([{ id: genId(), start: 0, end: d, deleted: false }]);
  };

  const onVideoError = (e) => {
    if (!usedFallback && rawFile) {
      setUsedFallback(true);
      setMetadataError("O carregamento padrão falhou. Tentando um método alternativo...");
      const reader = new FileReader();
      reader.onload = () => {
        if (videoUrl && videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
        setMetadataError("");
        setVideoUrl(reader.result);
      };
      reader.onerror = () => {
        setMetadataError(
          "Não foi possível carregar este vídeo neste navegador, nem pelo método alternativo. Tente outro arquivo ou outro navegador (Chrome costuma ser o mais compatível)."
        );
      };
      reader.readAsDataURL(rawFile);
      return;
    }
    const err = e.target && e.target.error;
    let detail = "";
    if (err) {
      switch (err.code) {
        case err.MEDIA_ERR_ABORTED:
          detail = "O carregamento foi interrompido.";
          break;
        case err.MEDIA_ERR_NETWORK:
          detail = "Erro de rede ao carregar o arquivo.";
          break;
        case err.MEDIA_ERR_DECODE:
          detail = "O navegador não conseguiu decodificar este vídeo (codec não suportado, ex: HEVC/H.265).";
          break;
        case err.MEDIA_ERR_SRC_NOT_SUPPORTED:
          detail = "Formato ou codec deste arquivo não é suportado por este navegador.";
          break;
        default:
          detail = "Motivo desconhecido.";
      }
    }
    setMetadataError(
      `O navegador não conseguiu carregar este vídeo mesmo pelo método alternativo. ${detail} Tente outro arquivo ou outro navegador (Chrome costuma ser o mais compatível).`
    );
  };

  const onTimeUpdate = (e) => {
    const t = e.target.currentTime;
    setCurrentTime(t);
    // "Play a specific range once" — used by EDL review's Play Trecho button.
    if (playRangeRef.current) {
      const { end } = playRangeRef.current;
      if (t >= end - 0.02) {
        e.target.pause();
        playRangeRef.current = null;
        return;
      }
    }
    // Prioridade 1: smartZoom (novo, do pipeline). Fallback: zoom legado.
    // Quando smartZoom está ligado, o preview roda com BASE_ZOOM constante
    // (~1.10) pra zoom_out (<1.0) não revelar bordas pretas.
    if (smartZoomEnabled && zoomEvents.length) {
      const conceptual = computeSmartZoomScale(zoomEvents, t);
      const s = effectiveScale(conceptual);
      if (Math.abs(s - zoomScale) > 0.001) setZoomScale(s);
    } else if (smartZoomEnabled) {
      // Sem eventos ativos ainda mantém BASE_ZOOM pra continuidade.
      if (Math.abs(BASE_ZOOM - zoomScale) > 0.001) setZoomScale(BASE_ZOOM);
    } else if (zoomEnabled) {
      setZoomScale(computeZoomScale(t, zoomEnabled, zoomIntensity, zoomCues));
    } else if (zoomScale !== 1) {
      setZoomScale(1);
    }
    // In preview mode we only "see" segments that are actively kept and NOT
    // pending review — everything else is skipped, giving the user a real
    // watch of the proposed final cut.
    const activeSegs = segments
      .filter((s) => (previewMode ? !s.deleted && s.action !== "review" : !s.deleted))
      .sort((a, b) => a.start - b.start);
    if (!activeSegs.length) return;
    const curIndex = activeSegs.findIndex((s) => t >= s.start - 0.05 && t < s.end);
    if (curIndex >= 0) {
      setPreviewOpacity(
        computeTransitionOpacity(t, activeSegs[curIndex], curIndex, activeSegs.length, transitionsEnabled, TRANSITION_DURATION)
      );
    } else if (previewOpacity !== 1) {
      setPreviewOpacity(1);
    }
    if (curIndex < 0) {
      const next = activeSegs.find((s) => s.start > t - 0.05);
      if (next) {
        e.target.currentTime = next.start;
      } else {
        e.target.pause();
      }
    }
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) v.pause();
    else v.play();
  };

  const handleSeek = (t) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setCurrentTime(t);
  };

  const handleTimelineClick = (e) => {
    if (!timelineRef.current || !duration) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const gutter = 46;
    const usableWidth = rect.width - gutter;
    if (usableWidth <= 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left - gutter) / usableWidth));
    handleSeek(ratio * duration);
  };

  const handleCut = () => {
    if (!duration) return;
    setSegments((segs) => splitAtPoint(segs, currentTime));
  };

  const toggleDeleteSegment = (id) => {
    setSegments((segs) => segs.map((s) => (s.id === id ? { ...s, deleted: !s.deleted } : s)));
  };

  const resetSegments = () => {
    setSegments([{ id: genId(), start: 0, end: duration, deleted: false }]);
    setSelectedSegId(null);
  };

  const activeSegments = useMemo(
    () => segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start),
    [segments]
  );
  const zoomCues = useMemo(
    () => (wordTimestamps.length ? findZoomCuesFromWords(wordTimestamps) : null),
    [wordTimestamps]
  );
  const finalDuration = useMemo(
    () => activeSegments.reduce((sum, s) => sum + (s.end - s.start), 0),
    [activeSegments]
  );
  const removedCount = segments.filter((s) => s.deleted).length;
  const cutsApplied = Math.max(0, segments.length - 1);
  const reductionPct = duration ? Math.round((1 - finalDuration / duration) * 100) : 0;
  const colorIsAdjusted = colorAdjust.brightness !== 100 || colorAdjust.contrast !== 100 || colorAdjust.saturate !== 100;
  const qualityScore = Math.min(
    100,
    (captions.length > 0 ? 25 : 0) +
      (zoomEnabled ? 15 : 0) +
      (transitionsEnabled ? 10 : 0) +
      (colorIsAdjusted ? 15 : 0) +
      (removedCount > 0 ? 15 : 0) +
      (resolution === "1080p" || resolution === "4K" ? 10 : 0) +
      (cutsApplied > 0 ? 10 : 0)
  );
  const qualityLabel =
    qualityScore >= 85 ? "Excelente!" : qualityScore >= 65 ? "Bom" : qualityScore >= 40 ? "Razoável" : "Básico";

  const generateThumbnails = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !duration) return;
    setGeneratingThumbs(true);
    const wasTime = video.currentTime;
    const wasPaused = video.paused;
    try {
      const count = Math.min(24, Math.max(8, Math.round(duration / 4)));
      const canvas = document.createElement("canvas");
      canvas.width = 80;
      canvas.height = 45;
      const ctx = canvas.getContext("2d");
      const thumbs = [];
      for (let i = 0; i < count; i++) {
        const t = Math.min(duration - 0.05, (i / count) * duration);
        await seekTo(video, t);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        thumbs.push(canvas.toDataURL("image/jpeg", 0.5));
      }
      setThumbnails(thumbs);
    } catch (err) {
      console.error("Não foi possível gerar as miniaturas:", err);
    } finally {
      try {
        video.currentTime = wasTime;
        if (!wasPaused) video.play();
      } catch (err) {}
      setGeneratingThumbs(false);
    }
  }, [duration]);

  useEffect(() => {
    if (duration > 0 && videoUrl) {
      setThumbnails([]);
      generateThumbnails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, videoUrl]);

  const analyzeAudio = useCallback(async () => {
    if (!videoUrl || !duration) return [];
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const resp = await fetch(videoUrl);
      const arrayBuf = await resp.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const audioBuffer = await ctx.decodeAudioData(arrayBuf);
      const channel = audioBuffer.getChannelData(0);
      const sr = audioBuffer.sampleRate;
      const bucketCount = Math.min(300, Math.max(80, Math.floor(duration * 3)));
      const bucketDur = duration / bucketCount;
      const samplesPerBucket = Math.max(1, Math.floor(bucketDur * sr));
      const buckets = [];
      for (let b = 0; b < bucketCount; b++) {
        const startSample = Math.floor(b * samplesPerBucket);
        const endSample = Math.min(channel.length, startSample + samplesPerBucket);
        let peak = 0;
        for (let i = startSample; i < endSample; i++) {
          const v = Math.abs(channel[i]);
          if (v > peak) peak = v;
        }
        buckets.push({ start: b * bucketDur, end: (b + 1) * bucketDur, level: peak });
      }
      setWaveform(buckets);
      ctx.close();
      return buckets;
    } catch (err) {
      console.error(err);
      setAnalyzeError("Não foi possível analisar o áudio deste vídeo neste navegador.");
      return [];
    } finally {
      setAnalyzing(false);
    }
  }, [videoUrl, duration]);

  const removeSilence = useCallback(async (thresholdOverride, minDurOverride) => {
    setSilenceBusy(true);
    setAnalyzeError("");
    try {
      const wf = waveform.length ? waveform : await analyzeAudio();
      if (!wf.length) return;
      const threshold = thresholdOverride ?? silenceThreshold;
      const minSilenceDur = minDurOverride ?? 0.8;
      const ranges = [];
      let start = null;
      for (let i = 0; i < wf.length; i++) {
        const isSilent = wf[i].level < threshold;
        if (isSilent && start === null) start = wf[i].start;
        if ((!isSilent || i === wf.length - 1) && start !== null) {
          const end = isSilent ? wf[i].end : wf[i].start;
          if (end - start >= minSilenceDur) ranges.push([start, end]);
          start = null;
        }
      }
      if (!ranges.length) {
        setAnalyzeError("Nenhum silêncio significativo foi encontrado com o limiar atual.");
        return;
      }
      setSegments((segs) => ranges.reduce((acc, [s, e]) => splitSegmentsAtRange(acc, s, e), segs));
    } finally {
      setSilenceBusy(false);
    }
  }, [waveform, silenceThreshold, analyzeAudio]);

  const transcribeAudio = useCallback(async () => {
    if (!videoUrl || !duration) return { words: null, error: "Nenhum vídeo carregado." };
    setTranscribing(true);
    setTranscribeError("");
    try {
      const audioBlob = await extractAudioBlob(videoUrl);
      const resp = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": audioBlob.type || "audio/webm" },
        body: audioBlob,
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error((data && (data.error?.message || data.error)) || "Falha na transcrição.");
      }
      const words = (data.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end }));
      if (!words.length) throw new Error("Nenhuma palavra foi reconhecida no áudio.");
      setWordTimestamps(words);
      setTranscript(words.map((w) => w.word).join(" "));
      return { words, error: null };
    } catch (err) {
      console.error(err);
      const message = err.message || "Não foi possível transcrever o áudio automaticamente.";
      setTranscribeError(message);
      return { words: null, error: message };
    } finally {
      setTranscribing(false);
    }
  }, [videoUrl, duration]);

  const generateCaptions = async () => {
    if (wordTimestamps.length) {
      setCaptions(buildCaptionsFromWords(wordTimestamps, maxCaptionWords));
      return;
    }
    if (!transcript.trim()) {
      setCaptionError("Cole ou digite a transcrição da fala do vídeo primeiro, ou use a transcrição automática.");
      return;
    }
    if (!duration) {
      setCaptionError("Carregue um vídeo antes de gerar legendas.");
      return;
    }
    setGeneratingCaptions(true);
    setCaptionError("");
    try {
      const prompt =
        `Você é um editor de legendas de vídeo. Divida a transcrição abaixo em cues de legenda curtas ` +
        `(no máximo ${maxCaptionWords} palavras cada), respeitando pausas naturais da fala. ` +
        `O vídeo tem ${duration.toFixed(2)} segundos no total. Distribua os tempos de início e fim de forma ` +
        `proporcional à quantidade de palavras de cada cue, começando em 0.0 e terminando em ${duration.toFixed(2)}, ` +
        `sem sobreposição entre cues. Responda APENAS com um array JSON válido, sem markdown e sem texto adicional, ` +
        `no formato exato: [{"start":0.0,"end":2.3,"text":"..."}]. Transcrição: """${transcript}"""`;
      const resp = await fetch("/api/ai-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, maxTokens: 2000 }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Falha ao gerar legendas.");
      const clean = data.text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      const withIds = parsed.map((c, i) => ({
        id: "cap-" + i,
        start: Number(c.start),
        end: Number(c.end),
        text: String(c.text),
      }));
      setCaptions(withIds);
    } catch (err) {
      console.error(err);
      setCaptionError("Não foi possível gerar as legendas agora. Tente novamente.");
    } finally {
      setGeneratingCaptions(false);
    }
  };

async function callMistakeDetectionAPI(words) {
  const prompt =
    `Abaixo está a transcrição de uma fala, com cada palavra numerada pelo índice dela (começando em 0), ` +
    `separada por espaços. Identifique trechos que são claramente erros de fala: gagueira/repetições ` +
    `("eu eu acho", "vamos vamos fazer"), começos falsos corrigidos logo depois ("na terça- na quarta-feira"), ` +
    `hesitações longas transcritas como palavras de preenchimento ("é... tipo... né"), ou frases visivelmente ` +
    `incompletas e reiniciadas. NÃO marque frases apenas informais ou hesitações curtas naturais (uma única ` +
    `"né" ou "tipo" isolada não conta). Responda APENAS com um array JSON válido, sem markdown, no formato ` +
    `exato [{"startWord":0,"endWord":2,"reason":"repetição"}], usando os índices de palavra abaixo. Se não ` +
    `houver nenhum erro claro, responda com um array vazio []. Transcrição indexada: """${words
      .map((w, i) => `${i}:${w}`)
      .join(" ")}"""`;
  const resp = await fetch("/api/ai-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, maxTokens: 1500 }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Falha na detecção de erros de fala.");
  const clean = data.text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

  const detectMistakes = async () => {
    if (!transcript.trim()) {
      setMistakeError("Cole a transcrição da fala do vídeo primeiro (mesmo texto usado nas legendas), ou use a transcrição automática.");
      return;
    }
    if (!duration) {
      setMistakeError("Carregue um vídeo antes de detectar erros.");
      return;
    }
    setFindingMistakes(true);
    setMistakeError("");
    setMistakesFound(0);
    try {
      const words = transcript.trim().split(/\s+/);
      const parsed = await callMistakeDetectionAPI(words);
      if (!Array.isArray(parsed) || !parsed.length) {
        setMistakeError("Nenhum erro claro de fala foi encontrado na transcrição.");
        return;
      }
      const totalWords = words.length;
      const ranges = parsed
        .filter((m) => Number.isFinite(m.startWord) && Number.isFinite(m.endWord))
        .map((m) => {
          if (wordTimestamps.length === words.length) {
            const startW = wordTimestamps[m.startWord];
            const endW = wordTimestamps[m.endWord];
            if (startW && endW) return [startW.start, endW.end];
          }
          return wordRangeToTime(m.startWord, m.endWord, totalWords, duration);
        });
      setSegments((segs) => ranges.reduce((acc, [s, e]) => splitSegmentsAtRange(acc, s, e), segs));
      setMistakesFound(ranges.length);
    } catch (err) {
      console.error(err);
      setMistakeError("Não foi possível analisar a transcrição agora. Tente novamente.");
    } finally {
      setFindingMistakes(false);
    }
  };

  // Wraps a segments mutation with a history push and pulls out AI-vs-user
  // feedback when the caller supplies enough context (e.g. changed segment id).
  const applySegmentsChange = (updater, meta = {}) => {
    setSegments((prev) => {
      const next = updater(prev);
      // Only record if the caller passed us enough context. Otherwise this
      // is an internal update (like the initial load) — no history entry.
      if (meta.label) {
        let changedSeg = null;
        let aiDecision = null;
        if (meta.changedSegmentId) {
          changedSeg = prev.find((s) => s.id === meta.changedSegmentId);
          if (changedSeg) aiDecision = changedSeg.action;
        }
        setHistory((h) =>
          pushState(h, next, {
            ...meta,
            aiDecision: meta.aiDecision ?? aiDecision,
            reason: meta.reason ?? changedSeg?.reason,
            confidence: meta.confidence ?? changedSeg?.confidence,
            text: meta.text ?? changedSeg?.text,
          })
        );
      }
      return next;
    });
  };

  const runIntelligentEdit = async () => {
    if (!videoUrl || !duration || smartBusy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setSmartBusy(true);
    setSmartError("");
    setSmartDone(false);
    setSmartStep("Iniciando...");
    // Fresh usage log per run — costs are per pipeline execution.
    const runLog = createUsageLog();
    try {
      const reuseSameVideo = cachedRef.current.videoUrl === videoUrl;
      const result = await runEditingPipeline({
        videoUrl,
        duration,
        profileId: intensityId,
        onStep: (_id, label) => setSmartStep(label),
        signal: controller.signal,
        onUsage: (entry) => addUsageEntry(runLog, entry),
        reuse: reuseSameVideo
          ? { words: cachedRef.current.words, waveform: cachedRef.current.waveform }
          : {},
      });
      cachedRef.current = { videoUrl, words: result.words, waveform: result.waveform };
      setUsageLog(runLog);
      // Keep the visual waveform + word timestamps in sync with the manual tools
      // so pause/mistake panels still work after running the smart pipeline.
      setWaveform(result.waveform);
      setWordTimestamps(result.words);
      setTranscript(result.words.map((w) => w.word).join(" "));
      setEdl(result.edl);
      setProblemCandidates(result.problemCandidates || []);
      setZoomEvents(result.zoomEvents || []);
      setIntegrityReport(result.integrity || null);
      setDebugTimelineReport(result.debugReport || null);
      setNarrativeMap(result.narrative || null);
      setVisualPlan(result.visualPlan || null);
      setBrollPlan(result.brollPlan || null);
      setGraphicsPlan(result.graphicsPlan || null);
      setProductMoments(result.productMoments || null);
      setProtectedRanges(result.protectedRanges || null);
      setPatternInterrupts(result.patternInterrupts || null);
      setDimensionalQuality(result.qualityScore || null);
      setNarrativeTopic(result.semantic.topic || "");
      // Auto-color: aplica SEMPRE após analise, boost "social ready"
      // (Reels/TikTok). Referência do usuário: "levemente mais claro,
      // mas não demais". Ajuste conservador — se quiser mudar, mexe
      // nos sliders manualmente que sobrescreve.
      setColorAdjust({ brightness: 108, contrast: 112, saturate: 116 });
      showToast("Cor ajustada automaticamente");
      // Se legendas automáticas ligadas, gera direto do word timestamps
      // sem call LLM extra.
      if (autoCaptionsEnabled && result.words?.length) {
        setCaptions(buildCaptionsFromWords(result.words, 7));
      }
      setSegments(result.segments);
      // Transições passam a ser tratamento automático da junção: sempre
      // que a IA gera cortes, ligamos o fade curto no ponto de cada corte.
      // Isso torna a junção suave sem exigir escolha do usuário.
      const hasCuts = result.segments.some((s) => s.deleted);
      if (hasCuts) setTransitionsEnabled(true);
      // Reset history to this new baseline so undo doesn't roll back into
      // some stale pre-analysis state.
      setHistory(createHistory(result.segments));
      setSelectedSegId(null);
      setSmartDone(true);
      setSmartStep("Edição inteligente pronta.");
      // Ativa preview "video editado" automaticamente — timeline vira
      // faixa contínua sem cortes visíveis. Usuário clica "Video original"
      // pra voltar.
      setPreviewMode(true);
    } catch (err) {
      if (err?.name === "AbortError") {
        setSmartStep("Análise cancelada.");
      } else {
        console.error(err);
        setSmartError(err.message || "Falha na edição inteligente.");
      }
    } finally {
      setSmartBusy(false);
      abortRef.current = null;
    }
  };

  const cancelIntelligentEdit = () => {
    if (abortRef.current) abortRef.current.abort();
  };

  const doUndo = useCallback(() => {
    setHistory((h) => {
      if (!canUndo(h)) return h;
      const next = undoHistory(h);
      setSegments(next.present);
      showToast("Alteração desfeita");
      return next;
    });
  }, [showToast]);
  const doRedo = useCallback(() => {
    setHistory((h) => {
      if (!canRedo(h)) return h;
      const next = redoHistory(h);
      setSegments(next.present);
      showToast("Alteração refeita");
      return next;
    });
  }, [showToast]);

  // Global keyboard shortcuts. Respects input/textarea/contentEditable so
  // native text-editing Ctrl+Z keeps working.
  useEffect(() => {
    const isEditableTarget = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const onKeyDown = (e) => {
      const mod = e.ctrlKey || e.metaKey; // Ctrl on Win/Linux, Cmd on macOS
      if (!mod) return;
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        // Se há operação de zoom mais recente na pilha, desfaz zoom primeiro.
        if (zoomHistoryRef.current.length > 0) undoZoom();
        else doUndo();
      } else if ((key === "y") || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        if (zoomFutureRef.current.length > 0) redoZoom();
        else doRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doUndo, doRedo]);

  // --- Autosave (debounced) ---
  const scheduleAutosave = useCallback(() => {
    if (!fileName) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setSaveState((cur) => (cur === "idle" ? "idle" : cur));
    autosaveTimerRef.current = setTimeout(async () => {
      setSaveState("saving");
      try {
        const originalDur = duration || 0;
        const editedDur = segments.filter((s) => !s.deleted && s.action !== "review").reduce((a, s) => a + (s.end - s.start), 0);
        const removedCount = segments.filter((s) => s.deleted && s.action !== "review").length;
        const reviewCount = segments.filter((s) => s.action === "review").length;
        const snapshot = buildProjectSnapshot({
          id: projectId,
          name: projectName || fileName,
          createdAt: projectCreatedAt || new Date().toISOString(),
          video: { fileName, size: rawFile?.size ?? null, durationSec: originalDur },
          intensityId,
          transcript,
          words: wordTimestamps,
          edl,
          segments,
          zoomEvents,
          narrativeTopic,
          metrics: {
            durationSec: originalDur,
            editedSec: editedDur,
            reductionPct: originalDur > 0 ? Math.round(((originalDur - editedDur) / originalDur) * 100) : 0,
            removedCount,
            reviewCount,
          },
          feedback: history.feedback,
          usage: usageLogRef.current,
          stamps: projectSnapshotRef.current?.stamps || stampsForProject(),
        });
        const saved = await saveProject(snapshot);
        projectSnapshotRef.current = saved;
        if (!projectId) setProjectId(saved.id);
        if (!projectCreatedAt) setProjectCreatedAt(saved.createdAt);
        setSavedProjects(await listProjects());
        setSaveState("saved");
      } catch (err) {
        console.warn("Autosave falhou:", err);
        setSaveState("error");
      }
    }, 800);
  }, [projectId, projectName, projectCreatedAt, fileName, rawFile, duration, intensityId, transcript, wordTimestamps, edl, segments, narrativeTopic, history.feedback]);

  useEffect(() => {
    // Anything that affects the saved snapshot triggers a debounced save.
    if (fileName && (edl.length || segments.length)) scheduleAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, edl, narrativeTopic, intensityId]);

  useEffect(() => {
    // First time — populate the "resume" list.
    (async () => setSavedProjects(await listProjects()))();
  }, []);

  // Restores project state (without the video blob, which the user must
  // re-attach with the same file). Returns true if we found something.
  const resumeProject = async (id) => {
    const snap = await loadProject(id);
    if (!snap) return false;
    setProjectId(snap.id);
    setProjectName(snap.name);
    setProjectCreatedAt(snap.createdAt);
    setIntensityId(snap.intensityId || DEFAULT_PROFILE_ID);
    setTranscript(snap.transcript || "");
    setWordTimestamps(snap.words || []);
    setEdl(snap.edl || []);
    setSegments(snap.segments || []);
    setZoomEvents(snap.zoomEvents || []);
    setNarrativeTopic(snap.narrativeTopic || "");
    setUsageLog(snap.usage || createUsageLog());
    setHistory(createHistory(snap.segments || []));
    setSmartDone((snap.edl || []).length > 0);
    setSmartStep((snap.edl || []).length > 0 ? "Projeto retomado — reanexe o vídeo para reproduzir." : "");
    projectSnapshotRef.current = snap;
    return true;
  };

  const handleConfirmReview = (segId, shouldRemove) => {
    let touchedEdlId = null;
    applySegmentsChange(
      (segs) =>
        segs.map((s) => {
          if (s.id !== segId) return s;
          touchedEdlId = s.edlId;
          return { ...s, action: shouldRemove ? "remove" : "keep", deleted: !!shouldRemove };
        }),
      {
        label: shouldRemove ? "confirm_remove" : "confirm_keep",
        changedSegmentId: segId,
        aiDecision: "review",
        userDecision: shouldRemove ? "remove" : "keep",
      }
    );
    if (touchedEdlId) {
      setEdl((prev) =>
        prev.map((item) =>
          item.id === touchedEdlId
            ? { ...item, action: shouldRemove ? "remove" : "keep" }
            : item
        )
      );
    }
  };

  const handleRestoreSegment = (segId) => {
    applySegmentsChange(
      (segs) => segs.map((s) => (s.id === segId ? { ...s, deleted: false, action: "keep" } : s)),
      { label: "restore", changedSegmentId: segId, userDecision: "keep" }
    );
  };

  const handleDeleteSegment = (segId) => {
    applySegmentsChange(
      (segs) => segs.map((s) => (s.id === segId ? { ...s, deleted: true, action: "remove" } : s)),
      { label: "delete", changedSegmentId: segId, userDecision: "remove" }
    );
  };

  // Nudge segment boundaries by ±delta seconds. Clamped so a segment can't
  // invert or spill into a neighbor. Goes through history — each nudge is
  // an undoable step.
  const handleNudgeStart = (segId, delta) => {
    applySegmentsChange((segs) => {
      const idx = segs.findIndex((s) => s.id === segId);
      if (idx < 0) return segs;
      const seg = segs[idx];
      const prev = segs[idx - 1];
      const minStart = prev ? prev.start + 0.05 : 0;
      const nextStart = Math.max(minStart, Math.min(seg.end - 0.05, seg.start + delta));
      const updated = segs.map((s) => (s.id === segId ? { ...s, start: nextStart } : s));
      if (prev && updated[idx - 1].end !== nextStart) updated[idx - 1] = { ...updated[idx - 1], end: nextStart };
      return updated;
    }, { label: "nudge_start", changedSegmentId: segId });
  };
  const handleNudgeEnd = (segId, delta) => {
    applySegmentsChange((segs) => {
      const idx = segs.findIndex((s) => s.id === segId);
      if (idx < 0) return segs;
      const seg = segs[idx];
      const next = segs[idx + 1];
      const maxEnd = next ? next.end - 0.05 : duration;
      const nextEnd = Math.min(maxEnd, Math.max(seg.start + 0.05, seg.end + delta));
      const updated = segs.map((s) => (s.id === segId ? { ...s, end: nextEnd } : s));
      if (next && updated[idx + 1].start !== nextEnd) updated[idx + 1] = { ...updated[idx + 1], start: nextEnd };
      return updated;
    }, { label: "nudge_end", changedSegmentId: segId });
  };

  // Drag handles nas bordas dos segmentos na timeline. Usa ref pra
  // capturar bounds do container e converter pixels em segundos.
  // Durante o drag atualiza segments direto (sem history); no mouseup
  // finaliza com applySegmentsChange (1 entrada no history).
  const timelineTrackRef = useRef(null);
  const dragBoundaryRef = useRef(null); // { segId, edge, containerRect }

  const beginBoundaryDrag = (e, segId, edge) => {
    e.stopPropagation();
    e.preventDefault();
    const container = timelineTrackRef.current;
    if (!container || !duration) return;
    const rect = container.getBoundingClientRect();
    dragBoundaryRef.current = { segId, edge, rect };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMove = (e) => {
      const st = dragBoundaryRef.current;
      if (!st || !duration) return;
      const { segId, edge, rect } = st;
      const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
      const t = (x / rect.width) * duration;
      setSegments((segs) => {
        const idx = segs.findIndex((s) => s.id === segId);
        if (idx < 0) return segs;
        const seg = segs[idx];
        if (edge === "start") {
          const prev = segs[idx - 1];
          const minStart = prev ? prev.start + 0.05 : 0;
          const nextStart = Math.max(minStart, Math.min(seg.end - 0.05, t));
          const updated = segs.map((s) => (s.id === segId ? { ...s, start: nextStart } : s));
          if (prev) updated[idx - 1] = { ...updated[idx - 1], end: nextStart };
          return updated;
        }
        const next = segs[idx + 1];
        const maxEnd = next ? next.end - 0.05 : duration;
        const nextEnd = Math.min(maxEnd, Math.max(seg.start + 0.05, t));
        const updated = segs.map((s) => (s.id === segId ? { ...s, end: nextEnd } : s));
        if (next) updated[idx + 1] = { ...updated[idx + 1], start: nextEnd };
        return updated;
      });
    };
    const onUp = () => {
      const st = dragBoundaryRef.current;
      if (!st) return;
      dragBoundaryRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Commit ao history (usa snapshot atual)
      applySegmentsChange((segs) => segs, { label: "drag_boundary", changedSegmentId: st.segId });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [duration]);

  const handlePlayRange = (start, end) => {
    const v = videoRef.current;
    if (!v) return;
    playRangeRef.current = { start, end };
    v.currentTime = start;
    v.play().catch(() => {});
  };

  const togglePreviewMode = () => setPreviewMode((v) => !v);

  // ==================== ZOOM EDITING ====================
  // Registra mudança de zoomEvents no history da mesma pilha da EDL —
  // guardamos o snapshot antes e adicionamos ao autosave via debounce.
  const zoomHistoryRef = useRef([]);
  const zoomFutureRef = useRef([]);
  const pushZoomHistory = (before) => {
    zoomHistoryRef.current.push(before);
    if (zoomHistoryRef.current.length > 100) zoomHistoryRef.current.shift();
    zoomFutureRef.current = [];
  };
  const undoZoom = () => {
    if (!zoomHistoryRef.current.length) return false;
    const prev = zoomHistoryRef.current.pop();
    zoomFutureRef.current.push([...zoomEvents]);
    setZoomEvents(prev);
    showToast("Zoom desfeito");
    return true;
  };
  const redoZoom = () => {
    if (!zoomFutureRef.current.length) return false;
    const next = zoomFutureRef.current.pop();
    zoomHistoryRef.current.push([...zoomEvents]);
    setZoomEvents(next);
    showToast("Zoom refeito");
    return true;
  };

  const updateZoomEvent = (id, patch) => {
    pushZoomHistory([...zoomEvents]);
    setZoomEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };
  const deleteZoomEvent = (id) => {
    pushZoomHistory([...zoomEvents]);
    setZoomEvents((prev) => prev.filter((e) => e.id !== id));
    setSelectedZoomId(null);
    showToast("Zoom removido");
  };
  const setZoomLevel = (id, levelKey) => {
    const spec = ZOOM_LEVELS[levelKey];
    if (!spec) return;
    const mode = levelKey.startsWith("out") ? "zoom_out" : "zoom_in";
    updateZoomEvent(id, { scale: spec.value, level: levelKey, mode });
  };

  // Drag handlers — precisam do container da timeline pra converter px→segundos.
  const startZoomDrag = (e, evId, mode) => {
    e.stopPropagation();
    e.preventDefault();
    if (!timelineRef.current || !duration) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const gutter = 46;
    const usableWidth = rect.width - gutter;
    const secPerPx = duration / usableWidth;
    const target = zoomEvents.find((z) => z.id === evId);
    if (!target) return;
    // Snapshot antes da drag inteira — undo volta pra ANTES da drag.
    pushZoomHistory([...zoomEvents]);
    zoomDragRef.current = {
      id: evId,
      mode, // "move" | "resize-left" | "resize-right"
      startX: e.clientX,
      origStart: target.start,
      origEnd: target.end,
      secPerPx,
    };
    const onMove = (ev) => {
      const d = zoomDragRef.current; if (!d) return;
      const dx = ev.clientX - d.startX;
      const dt = dx * d.secPerPx;
      setZoomEvents((prev) => prev.map((z) => {
        if (z.id !== d.id) return z;
        if (d.mode === "move") {
          let ns = d.origStart + dt;
          let ne = d.origEnd + dt;
          if (ns < 0) { ne -= ns; ns = 0; }
          if (ne > duration) { ns -= (ne - duration); ne = duration; }
          return { ...z, start: ns, end: ne };
        }
        if (d.mode === "resize-left") {
          const ns = Math.max(0, Math.min(z.end - 0.3, d.origStart + dt));
          return { ...z, start: ns };
        }
        if (d.mode === "resize-right") {
          const ne = Math.min(duration, Math.max(z.start + 0.3, d.origEnd + dt));
          return { ...z, end: ne };
        }
        return z;
      }));
    };
    const onUp = () => {
      zoomDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // --- Diagnóstico: marcar erro não detectado ---
  const markMissedStart = () => {
    setMarkStart(currentTime);
    showToast(`Início marcado em ${currentTime.toFixed(2)}s`);
  };
  const markMissedEnd = () => {
    if (markStart == null) {
      showToast("Marque o início primeiro (Play até o ponto e clique 'Marcar início')");
      return;
    }
    const start = Math.min(markStart, currentTime);
    const end = Math.max(markStart, currentTime);
    if (end - start < 0.1) {
      showToast("Janela curta demais");
      return;
    }
    // Captura tudo que o pipeline viu naquela janela.
    const words = cachedRef.current.words || [];
    const overlap = 0.3;
    const wordsInRange = words.filter((w) => w.start >= start - overlap && w.end <= end + overlap);
    const rawText = wordsInRange.map((w) => w.word).join(" ");
    const candidatesInRange = problemCandidates.filter((c) => {
      const ov = Math.max(0, Math.min(c.end, end) - Math.max(c.start, start));
      return ov > 0;
    });
    const segmentsInRange = segments.filter((s) => {
      const ov = Math.max(0, Math.min(s.end, end) - Math.max(s.start, start));
      return ov > 0;
    });
    const capture = {
      id: "missed-" + Date.now().toString(36),
      markedAt: new Date().toISOString(),
      start, end,
      duration: +(end - start).toFixed(2),
      rawText,
      wordsInRange,
      candidatesInRange,
      segmentsInRange,
      detectedBySpeechError: candidatesInRange.some((c) => c.detectors?.some((d) => d.detector === "heuristic" || d.detector === "llm")),
      detectedBySemantic: candidatesInRange.some((c) => c.detectors?.some((d) => d.detector === "semantic" || d.detector === "narrative")),
      detectedBySilence: candidatesInRange.some((c) => c.detectors?.some((d) => d.detector === "silence")),
      finalActions: candidatesInRange.map((c) => ({ id: c.id, type: c.primaryType, action: c.finalAction, confidence: c.confidence, blocked: c.blockedReasons })),
    };
    setMissedDetections((prev) => [...prev, capture]);
    setMarkStart(null);
    showToast(`Erro marcado (${capture.duration}s) — ${candidatesInRange.length} candidato(s) na janela`);
    console.log("[missedDetection] captured:", capture);
  };
  const clearMissedDetections = () => setMissedDetections([]);

  // Exporta um JSON completo pra debug offline.
  const exportDiagnostic = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      video: { fileName, durationSec: duration, size: rawFile?.size ?? null },
      profile: intensityId,
      narrativeTopic,
      words: cachedRef.current.words || [],
      transcript: (cachedRef.current.words || []).map((w) => w.word).join(" "),
      edl,
      segments,
      problemCandidates,
      missedDetections,
      usage: usageLogRef.current,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diagnostico-${projectName || fileName || "editor"}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Ao aceitar/rejeitar um problemCandidate do painel, aplicamos o efeito
  // na timeline. Se já existe um segment cobrindo o candidato, apenas
  // toggla deleted/action. Se não existe (o candidato era "detected_only"
  // ou "dropped" e nunca virou segment), splita a timeline no intervalo.
  const applyCandidateDecision = (cand, shouldRemove) => {
    applySegmentsChange((segs) => {
      // Procura segment que cubra este candidato.
      const covering = segs.find(
        (s) => s.start <= cand.start + 0.05 && s.end >= cand.end - 0.05
      );
      if (covering && Math.abs(covering.start - cand.start) < 0.05 && Math.abs(covering.end - cand.end) < 0.05) {
        // Segment bate exatamente — só flipa.
        return segs.map((s) =>
          s.id === covering.id
            ? { ...s, deleted: !!shouldRemove, action: shouldRemove ? "remove" : "keep" }
            : s
        );
      }
      // Precisa splitar: partir cada segment que intersecta [start, end].
      const result = [];
      for (const s of segs) {
        if (cand.end <= s.start || cand.start >= s.end) { result.push(s); continue; }
        const points = [s.start, Math.max(s.start, cand.start), Math.min(s.end, cand.end), s.end]
          .filter((v, i, arr) => i === 0 || v !== arr[i - 1])
          .sort((a, b) => a - b);
        for (let i = 0; i < points.length - 1; i++) {
          const ps = points[i]; const pe = points[i + 1];
          if (pe - ps < 0.02) continue;
          const inCut = ps >= cand.start - 0.02 && pe <= cand.end + 0.02;
          result.push({
            id: "seg-" + Math.random().toString(36).slice(2, 8),
            start: ps, end: pe,
            deleted: inCut ? !!shouldRemove : s.deleted,
            action: inCut ? (shouldRemove ? "remove" : "keep") : s.action,
            reason: inCut ? cand.primaryType : s.reason,
            text: inCut ? cand.text : s.text,
            confidence: inCut ? cand.confidence : s.confidence,
            source: inCut ? "manual" : s.source,
            narrativeRole: s.narrativeRole,
          });
        }
      }
      return result;
    }, {
      label: shouldRemove ? "candidate_remove" : "candidate_keep",
      aiDecision: cand.finalAction,
      userDecision: shouldRemove ? "remove" : "keep",
      reason: cand.primaryType,
      confidence: cand.confidence,
      text: cand.text,
    });
    // Quando o usuário aceita um corte, ativa o modo "ver versão editada"
    // automaticamente pra ele ver o vídeo compilado fluido, sem os trechos
    // removidos — feedback imediato da decisão.
    if (shouldRemove && !previewMode) {
      setPreviewMode(true);
      showToast("Trecho removido — prévia editada ligada");
    } else {
      showToast(shouldRemove ? "Trecho removido" : "Trecho mantido");
    }
  };

  const runAutoEdit = async () => {
    if (!videoUrl || !duration) return;
    setAutoEditBusy(true);
    setAutoEditDone(false);
    setAutoEditError("");
    setAutoEditEstimate(Math.max(20, Math.round(duration) + 20));
    if (editedVideoUrl) URL.revokeObjectURL(editedVideoUrl);
    setEditedVideoUrl(null);
    setShowingEdited(false);

    const profile = pickStyleProfile(videoTypeId);
    setLastStyleProfile(profile);
    setColorAdjust(profile.color.adjust);
    setZoomIntensity(profile.zoom.intensity);
    setCaptionStyleId(profile.captionStyleId);
    setSilenceThreshold(profile.cutPace.silence);
    setMaxCaptionWords(profile.cutPace.maxWords);

    let localSegments = segments.length ? segments : [{ id: genId(), start: 0, end: duration, deleted: false }];

    setAutoEditStep("Extraindo e transcrevendo áudio...");
    try {
      const { words, error: transcribeErr } = await transcribeAudio();
      if (!words) {
        setAutoEditError(`Falha na transcrição: ${transcribeErr || "motivo desconhecido"}`);
        return;
      }

      setAutoEditStep("Removendo silêncios e pausas...");
      const wf = waveform.length ? waveform : await analyzeAudio();
      if (wf.length) {
        const threshold = profile.cutPace.silence;
        const minSilenceDur = profile.cutPace.minSilenceDur;
        const ranges = [];
        let start = null;
        for (let i = 0; i < wf.length; i++) {
          const isSilent = wf[i].level < threshold;
          if (isSilent && start === null) start = wf[i].start;
          if ((!isSilent || i === wf.length - 1) && start !== null) {
            const end = isSilent ? wf[i].end : wf[i].start;
            if (end - start >= minSilenceDur) ranges.push([start, end]);
            start = null;
          }
        }
        if (ranges.length) {
          localSegments = ranges.reduce((acc, [s, e]) => splitSegmentsAtRange(acc, s, e), localSegments);
          setSegments(localSegments);
        }
      }

      setAutoEditStep("Detectando erros de fala...");
      try {
        const parsed = await callMistakeDetectionAPI(words.map((w) => w.word));
        if (Array.isArray(parsed) && parsed.length) {
          const ranges = parsed
            .filter((m) => Number.isFinite(m.startWord) && Number.isFinite(m.endWord) && words[m.startWord] && words[m.endWord])
            .map((m) => [words[m.startWord].start, words[m.endWord].end]);
          localSegments = ranges.reduce((acc, [s, e]) => splitSegmentsAtRange(acc, s, e), localSegments);
          setSegments(localSegments);
          setMistakesFound(ranges.length);
        }
      } catch (err) {
        console.error("Detecção automática de erros falhou, seguindo o resto do fluxo:", err);
      }

      setAutoEditStep("Gerando legendas...");
      const localCaptions = buildCaptionsFromWords(words, profile.cutPace.maxWords);
      setCaptions(localCaptions);

      setAutoEditStep("Ativando zoom automático...");
      setZoomEnabled(true);
      setTransitionsEnabled(true);
      const localZoomCues = findZoomCuesFromWords(words);

      const activeSegsLocal = localSegments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
      const editedDuration = activeSegsLocal.reduce((sum, s) => sum + (s.end - s.start), 0);
      // The render step also plays through the video in real time, so add that
      // to the estimate now that we know the actual edited length.
      setAutoEditEstimate((prev) => prev + Math.max(5, Math.round(editedDuration)));

      setAutoEditStep("Renderizando vídeo editado...");
      try {
        const localCaptionStyle = CAPTION_STYLES.find((s) => s.id === profile.captionStyleId) || CAPTION_STYLES[0];
        const blob = await renderVideo({
          segs: activeSegsLocal,
          colorAdjust: profile.color.adjust,
          captions: localCaptions,
          captionStyleOverride: localCaptionStyle,
          zoomEnabled: true,
          zoomIntensity: profile.zoom.intensity,
          zoomCues: localZoomCues,
          resolutionLabel: "720p",
          transitionsOn: true,
        });
        setEditedVideoUrl(URL.createObjectURL(blob));
        setShowingEdited(true);
      } catch (err) {
        console.error("Falha ao renderizar a prévia editada:", err);
        setAutoEditError(
          "Os cortes e ajustes foram aplicados, mas não deu pra gerar a prévia já editada automaticamente. Você ainda pode exportar manualmente."
        );
      }

      setAutoEditStep("Pronto!");
      setAutoEditDone(true);
    } catch (err) {
      console.error(err);
      setAutoEditError("Algo deu errado na edição automática. Você ainda pode ajustar tudo manualmente nas outras ferramentas.");
    } finally {
      setAutoEditBusy(false);
    }
  };

  // Cues limpas — cortadas nas bordas dos KEEPs, timings originais.
  // Se um cue atravessa REMOVE ele vira 2 cues, evita legenda ficando
  // "presa" na tela durante um trecho removido.
  const clippedCaptions = useMemo(
    () => clipCaptionsToKeepSegments(captions, segments),
    [captions, segments]
  );
  const activeCaption = clippedCaptions.find((c) => currentTime >= c.start && currentTime < c.end);

  const renderVideo = useCallback(
    async ({ segs, colorAdjust, captions, captionStyleOverride, zoomEnabled, zoomIntensity, zoomCues, resolutionLabel, transitionsOn, onProgress }) => {
      const video = videoRef.current;
      if (!video) throw new Error("Vídeo não carregado.");
      if (!segs.length) throw new Error("Todo o vídeo foi marcado como removido. Restaure ao menos um trecho.");
      if (typeof video.captureStream !== "function" && typeof video.mozCaptureStream !== "function") {
        throw new Error("Este navegador não suporta exportação de vídeo. Tente usar Chrome ou Edge.");
      }
      const wasVolume = video.volume;
      const baseLong = resolutionLabel === "4K" ? 2160 : resolutionLabel === "720p" ? 720 : 1080;
      const [ratioW, ratioH] = platform.ratio;
      const canvas = document.createElement("canvas");
      if (ratioH >= ratioW) {
        canvas.height = baseLong;
        canvas.width = Math.round((baseLong * ratioW) / ratioH / 2) * 2;
      } else {
        canvas.width = baseLong;
        canvas.height = Math.round((baseLong * ratioH) / ratioW / 2) * 2;
      }
      const ctx = canvas.getContext("2d");
      const canvasStream = canvas.captureStream(30);
      // D10: se o áudio não for capturado, FALHA VISÍVEL. Antes esse
      // catch engolia o erro e exportava mudo em silêncio — usuário só
      // descobria ao abrir o arquivo. Ruim demais pra deixar assim.
      let audioCaptureError = null;
      try {
        const vStream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
        const audioTracks = vStream.getAudioTracks();
        if (audioTracks.length === 0) {
          audioCaptureError = "O vídeo carregado não tem faixa de áudio detectável (pode ser codec não suportado, ex: HEVC/H.265 do iPhone).";
        } else {
          canvasStream.addTrack(audioTracks[0]);
        }
      } catch (err) {
        audioCaptureError = `Não foi possível capturar o áudio deste vídeo neste navegador (${err?.message || err}). Tente converter o arquivo para MP4/H.264 antes de importar.`;
      }
      if (audioCaptureError) {
        throw new Error("Exportação abortada: " + audioCaptureError + " Sem isso o vídeo sairia mudo.");
      }
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const recorder = new MediaRecorder(canvasStream, { mimeType });
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      recorder.start();
      try {
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i];
          await seekTo(video, seg.start);
          await playSegment(video, seg.end, (t) => {
            const scale = computeZoomScale(t, zoomEnabled, zoomIntensity, zoomCues);
            const fadeOpacity = computeTransitionOpacity(t, seg, i, segs.length, transitionsOn, TRANSITION_DURATION);
            drawFrame(ctx, video, canvas, colorAdjust, captions, t, scale, captionStyleOverride, fadeOpacity);
            if (onProgress) {
              const segFraction = (t - seg.start) / Math.max(0.001, seg.end - seg.start);
              onProgress(Math.round(((i + segFraction) / segs.length) * 100));
            }
          });
        }
      } finally {
        recorder.stop();
        await stopped;
        video.pause();
        video.volume = wasVolume;
      }
      return new Blob(chunks, { type: "video/webm" });
    },
    [platform]
  );

  const handleExport = async () => {
    if (!videoRef.current || !duration) return;
    setIsExporting(true);
    setExportProgress(0);
    setExportError("");
    setExportedUrl(null);
    try {
      const blob = await renderVideo({
        segs: activeSegments,
        colorAdjust,
        captions: clippedCaptions,
        captionStyleOverride: captionStyle,
        zoomEnabled,
        zoomIntensity,
        zoomCues,
        resolutionLabel: resolution,
        transitionsOn: transitionsEnabled,
        onProgress: setExportProgress,
      });
      setExportedUrl(URL.createObjectURL(blob));
      setExportProgress(100);
    } catch (err) {
      console.error(err);
      setExportError(err.message || "Falha ao exportar o vídeo.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        background: "#0A0A0D",
        minHeight: "100vh",
        color: "#F5F5F7",
        fontFamily: "system-ui, sans-serif",
        ...(expanded
          ? { position: "fixed", inset: 0, zIndex: 9999, overflow: "auto" }
          : {}),
      }}
      className="p-4 md:p-6"
    >
      <div className="max-w-7xl mx-auto flex flex-col gap-4">

        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Logo CRIE Studios: img real com blend-mode screen (fundo preto
                vira transparente sobre o dark). Fallback = texto simples se
                o PNG não existir. */}
            <img
              src="/logo.png"
              alt="CRIE Studios"
              style={{ height: 56, width: "auto", display: "block" }}
            />
            <span style={{
              display: "none",
              fontFamily: "'Archivo Black', 'Inter Tight', sans-serif",
              fontSize: 32, letterSpacing: "0.02em",
              background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>CRIE STUDIOS</span>
            <div>
              <p style={{
                fontFamily: "'Inter Tight',sans-serif",
                color: "#A090B8", fontSize: 12,
                letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 500,
              }}>Editor com IA</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {edl.length > 0 && (
              <>
                <button
                  onClick={doUndo}
                  disabled={!canUndo(history)}
                  title="Desfazer (Ctrl+Z)"
                  style={{ background: "#12081C", border: "1px solid #1F1F26", color: canUndo(history) ? "#C9C9D1" : "#4A4A54" }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                >
                  <Undo2 size={13} /> ↶
                </button>
                <button
                  onClick={doRedo}
                  disabled={!canRedo(history)}
                  title="Refazer (Ctrl+Y)"
                  style={{ background: "#12081C", border: "1px solid #1F1F26", color: canRedo(history) ? "#C9C9D1" : "#4A4A54" }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                >
                  <RotateCcw size={13} /> ↷
                </button>
              </>
            )}
            <button
              onClick={toggleExpand}
              style={{ background: "#12081C", border: "1px solid #1F1F26", color: "#C9C9D1" }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
            >
              {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              {expanded ? "Sair da tela cheia" : "Tela cheia"}
            </button>
            <AuthGate />
          </div>
        </header>

        {!videoUrl && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
            style={{ border: "2px dashed #2A2A32", background: "#111116" }}
            className="rounded-2xl flex flex-col items-center justify-center gap-3 py-24 text-center"
          >
            <Upload size={32} color="#FF6A2B" />
            <div>
              <p className="font-semibold">Arraste um vídeo aqui</p>
              <p style={{ color: "#9A9AA5" }} className="text-sm">ou clique para escolher um arquivo (MP4, WebM, MOV)</p>
              <p style={{ color: "#6B6B75" }} className="text-xs mt-1 max-w-xs mx-auto">
                Vídeos de iPhone em HEVC (.mov) podem não funcionar. Em Ajustes → Câmera → Formatos, use "Mais compatível", ou converta para MP4 (H.264) antes de enviar.
              </p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)", color: "#1A0A02", boxShadow: "0 4px 20px rgba(255,92,130,0.3)" }}
              className="px-5 py-2 rounded-lg font-semibold text-sm mt-2"
            >
              Escolher vídeo
            </button>
            <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
          </div>
        )}

        {!videoUrl && savedProjects.length > 0 && (
          <Panel title="Projetos salvos">
            <p style={{ color: "#9A9AA5" }} className="text-xs mb-3">
              Clique para retomar. Você precisará reanexar o mesmo arquivo de vídeo — só as decisões da IA e ajustes ficam salvos.
            </p>
            <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
              {savedProjects.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <button
                    onClick={() => resumeProject(p.id)}
                    style={{ background: "#0F0F13", border: "1px solid #1F1F26", color: "#F5F5F7" }}
                    className="flex-1 text-left px-2.5 py-2 rounded-lg text-xs"
                  >
                    <span className="block font-semibold">{p.name || p.id}</span>
                    <span style={{ color: "#6B6B75" }} className="text-[10px]">Atualizado {new Date(p.updatedAt).toLocaleString("pt-BR")}</span>
                  </button>
                  <button
                    onClick={async () => { await deleteProject(p.id); setSavedProjects(await listProjects()); }}
                    title="Apagar"
                    style={{ background: "#1A0F28", color: "#F09595" }}
                    className="px-2 py-2 rounded-lg text-xs"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {videoUrl && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">

            <div className="md:col-span-3 flex flex-col gap-3">
              <Panel title="Ferramentas de IA">
                <div className="flex flex-col gap-1">
                  {TOOLS.map((tool) => {
                    const Icon = tool.icon;
                    const active = activeTool === tool.id;
                    // "Pronta" quando ha config valida guardada em cada ferramenta
                    const ready =
                      (tool.id === "smart" && (smartZoomEnabled || autoCaptionsEnabled || edl.length > 0)) ||
                      (tool.id === "color" && colorIsAdjusted) ||
                      (tool.id === "music" && !!selectedMusicId) ||
                      (tool.id === "volume" && (volume !== 1 || musicVolume !== 0.28));
                    return (
                      <button
                        key={tool.id}
                        onClick={() => setActiveTool((cur) => (cur === tool.id ? "smart" : tool.id))}
                        style={{
                          background: active ? "#FF6A2B" : "transparent",
                          color: active ? "#1A0A02" : "#F5F5F7",
                        }}
                        className="flex items-start gap-2.5 p-2.5 rounded-lg text-left transition-colors relative"
                      >
                        <Icon size={16} className="mt-0.5 flex-shrink-0" />
                        <span className="flex-1">
                          <span className="block text-sm font-medium">
                            {tool.label}
                            {ready && !active && <span style={{ color: "#5DCAA5" }} className="ml-1.5 text-[10px]">●</span>}
                            {ready && active && <span style={{ color: "#1F3C2A" }} className="ml-1.5 text-[10px]">✓</span>}
                          </span>
                          <span style={{ color: active ? "#4A2410" : "#9A9AA5" }} className="block text-xs">{tool.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Panel>

              {activeTool === "smart" && (
                <Panel title="Edição inteligente">
                  <p style={{ color: "#9A9AA5" }} className="text-xs mb-3">
                    IA encontra erros e edita seu vídeo.
                  </p>

                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <button
                      onClick={() => setSmartZoomEnabled((v) => !v)}
                      style={{
                        background: smartZoomEnabled ? "#FF6A2B" : "#0F0F13",
                        color: smartZoomEnabled ? "#1A0A02" : "#C9C9D1",
                        border: smartZoomEnabled ? "1px solid #FF6A2B" : "1px solid #1F1F26",
                      }}
                      className="py-2 rounded-lg text-xs font-bold"
                    >
                      Zoom
                    </button>
                    <button
                      onClick={() => {
                        const next = !autoCaptionsEnabled;
                        setAutoCaptionsEnabled(next);
                        if (next && wordTimestamps.length) {
                          setCaptions(buildCaptionsFromWords(wordTimestamps, 7));
                        } else if (!next) {
                          setCaptions([]);
                        }
                      }}
                      style={{
                        background: autoCaptionsEnabled ? "#FF6A2B" : "#0F0F13",
                        color: autoCaptionsEnabled ? "#1A0A02" : "#C9C9D1",
                        border: autoCaptionsEnabled ? "1px solid #FF6A2B" : "1px solid #1F1F26",
                      }}
                      className="py-2 rounded-lg text-xs font-bold"
                    >
                      Legenda
                    </button>
                  </div>

                  {autoCaptionsEnabled && (() => {
                    const currentStyle = CAPTION_STYLES.find((s) => s.id === captionStylePreset) || CAPTION_STYLES[0];
                    return (
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <p style={{ color: "#6B6B75" }} className="text-[10px] font-bold uppercase tracking-wide">
                          {captionStyleGridOpen ? `Estilo da legenda (${CAPTION_STYLES.length})` : "Estilo selecionado"}
                        </p>
                        {!captionStyleGridOpen && (
                          <button
                            onClick={() => setCaptionStyleGridOpen(true)}
                            style={{ color: "#FF6A2B", background: "transparent" }}
                            className="text-[10px] font-semibold hover:underline"
                          >
                            Trocar estilo
                          </button>
                        )}
                      </div>
                      {!captionStyleGridOpen && (
                        <button
                          onClick={() => setCaptionStyleGridOpen(true)}
                          style={{ background: "#0F0F13", border: "1px solid #FF6A2B" }}
                          className="w-full p-1 rounded-lg mb-2"
                          title="Clique pra escolher outro estilo"
                        >
                          <div className="flex items-center justify-center overflow-hidden" style={{ background: "#0A0A0A", borderRadius: 6, height: 60 }}>
                            <span style={{
                              background: currentStyle.bg || (currentStyle.bgGradient ? `linear-gradient(90deg, ${currentStyle.bgGradient.from}, ${currentStyle.bgGradient.to})` : "transparent"),
                              color: currentStyle.textColor,
                              fontWeight: currentStyle.weight,
                              fontFamily: currentStyle.fontFamily || "sans-serif",
                              fontSize: 12,
                              textTransform: currentStyle.uppercase ? "uppercase" : "none",
                              padding: (currentStyle.bg || currentStyle.bgGradient) ? "3px 8px" : 0,
                              borderRadius: (currentStyle.bg || currentStyle.bgGradient) ? (currentStyle.pillRadius ?? 4) : 0,
                              WebkitTextStroke: currentStyle.strokeColor ? `${Math.min(1.5, currentStyle.strokeWidth || 1)}px ${currentStyle.strokeColor}` : undefined,
                              textShadow: currentStyle.shadow ? `0 ${currentStyle.shadow.offsetY || 2}px ${currentStyle.shadow.blur || 6}px ${currentStyle.shadow.color}` : undefined,
                            }}>THE LIFE IN MOTION</span>
                          </div>
                          <span className="block text-[9px] text-center mt-1" style={{ color: "#FF6A2B" }}>
                            {currentStyle.label.replace(/^\d+\.\s*/, "")}
                          </span>
                        </button>
                      )}
                      {captionStyleGridOpen && (
                      <div ref={captionGridRef} className="grid grid-cols-2 gap-2 mb-2 max-h-[520px] overflow-y-auto pr-1">
                        {CAPTION_STYLES.map((s) => {
                          const active = captionStylePreset === s.id;
                          // Palavra de destaque no mock — "MOTION"/"LIFE" viram
                          // accent quando o template tem accentTarget/accentBg.
                          const words = ["THE", "LIFE", "IN", "MOTION"];
                          const highlightIdx = s.accentTarget === "first" ? 0 : words.length - 1;
                          const bgFill = s.bg || (s.bgGradient ? `linear-gradient(90deg, ${s.bgGradient.from}, ${s.bgGradient.to})` : null);
                          return (
                            <button
                              key={s.id}
                              onClick={() => {
                                setCaptionStylePreset(s.id);
                                setCaptionStyleId(s.id);
                                // Mantém o grid aberto pra o usuário ver que ficou
                                // pronto e continuar interagindo (Zoom/Legenda/Posicao).
                              }}
                              style={{
                                background: active ? "#2A1B10" : "#0F0F13",
                                border: active ? "1px solid #FF6A2B" : "1px solid #1F1F26",
                              }}
                              className="text-left p-1 rounded-lg"
                              title={s.label}
                            >
                              {/* Mini-vídeo: fundo preto tipo player, legenda renderizada real */}
                              <div
                                className="flex items-center justify-center overflow-hidden"
                                style={{ background: "#0A0A0A", borderRadius: 6, height: 60 }}
                              >
                                <div style={{ maxWidth: "94%", textAlign: "center", lineHeight: 1.15 }}>
                                  {s.perWord ? (
                                    <div style={{
                                      fontFamily: s.fontFamily || "sans-serif",
                                      fontWeight: s.weight,
                                      fontStyle: s.italic ? "italic" : "normal",
                                      fontSize: 12,
                                      letterSpacing: s.letterSpacing ? `${s.letterSpacing}em` : "normal",
                                      textShadow: s.shadow ? `0 ${s.shadow.offsetY || 2}px ${s.shadow.blur || 6}px ${s.shadow.color}` : undefined,
                                      WebkitTextStroke: s.strokeColor ? `${Math.min(1.5, s.strokeWidth || 1)}px ${s.strokeColor}` : undefined,
                                    }}>
                                      {words.map((w, i) => (
                                        <span key={i} style={{
                                          color: i === highlightIdx ? (s.highlightColor || "#FFEB3B") : s.textColor,
                                          marginRight: i < words.length - 1 ? 3 : 0,
                                        }}>{w}</span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span
                                      style={{
                                        background: bgFill || "transparent",
                                        color: s.textColor,
                                        fontWeight: s.weight,
                                        fontStyle: s.italic ? "italic" : "normal",
                                        fontFamily: s.fontFamily || "sans-serif",
                                        fontSize: 12,
                                        letterSpacing: s.letterSpacing ? `${s.letterSpacing}em` : "normal",
                                        textTransform: s.uppercase ? "uppercase" : "none",
                                        padding: bgFill ? "3px 8px" : 0,
                                        borderRadius: bgFill ? (s.pillRadius ?? 4) : 0,
                                        border: s.borderColor && s.borderWidth ? `${Math.min(1.5, s.borderWidth)}px solid ${s.borderColor}` : undefined,
                                        WebkitTextStroke: s.strokeColor ? `${Math.min(1.5, s.strokeWidth || 1)}px ${s.strokeColor}` : undefined,
                                        textShadow: s.shadow ? `0 ${s.shadow.offsetY || 2}px ${s.shadow.blur || 6}px ${s.shadow.color}` : undefined,
                                        display: "inline-block",
                                      }}
                                    >
                                      {s.accentBg || s.accentColor ? (
                                        words.map((w, i) => (
                                          <span
                                            key={i}
                                            style={{
                                              background: i === highlightIdx ? s.accentBg : undefined,
                                              color: i === highlightIdx ? (s.accentTextColor || s.accentColor || s.textColor) : undefined,
                                              padding: (i === highlightIdx && s.accentBg) ? "1px 4px" : 0,
                                              borderRadius: (i === highlightIdx && s.accentBg) ? 3 : 0,
                                              marginRight: i < words.length - 1 ? 3 : 0,
                                            }}
                                          >{w}</span>
                                        ))
                                      ) : "THE LIFE IN MOTION"}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="block text-[9px] text-center mt-1 truncate" style={{ color: active ? "#FF6A2B" : "#8A8A94" }}>
                                {s.label.replace(/^\d+\.\s*/, "")}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      )}
                      <div className="flex items-center gap-1 mb-1">
                        <span style={{ color: "#6B6B75" }} className="text-[10px]">Posição:</span>
                        {[["top", "Alta"], ["center", "Média"], ["bottom", "Baixa"]].map(([id, label]) => (
                          <button key={id} onClick={() => setCaptionPosition(id)}
                            style={{ background: captionPosition === id ? "#FF6A2B" : "#1A0F28", color: captionPosition === id ? "#1A0A02" : "#C9C9D1" }}
                            className="text-[10px] px-2 py-0.5 rounded font-semibold">
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    );
                  })()}

                  <button
                    onClick={runIntelligentEdit}
                    disabled={smartBusy}
                    style={{ background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)", color: "#1A0A02", boxShadow: "0 4px 20px rgba(255,92,130,0.3)" }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold disabled:opacity-60"
                  >
                    {smartBusy ? <Loader2 size={16} className="animate-spin" /> : <Brain size={16} />}
                    {smartBusy ? "Analisando..." : (edl.length ? "Rodar novamente" : "Edição inteligente")}
                  </button>

                  {smartBusy && (
                    <>
                      <p style={{ color: "#9A9AA5" }} className="text-xs mt-2">{smartStep}</p>
                      <button
                        onClick={cancelIntelligentEdit}
                        style={{ background: "#1A0F28", color: "#F09595", border: "1px solid #5A2323" }}
                        className="w-full mt-2 py-1.5 rounded-md text-xs font-semibold"
                      >
                        Cancelar análise
                      </button>
                    </>
                  )}
                  {smartError && <p style={{ color: "#FF8A8A" }} className="text-xs mt-2">{smartError}</p>}
                  {smartDone && !smartBusy && (
                    <p style={{ color: "#5DCAA5" }} className="text-xs mt-2">
                      Pronto! Revise a lista de decisões ao lado da linha do tempo.
                    </p>
                  )}
                  <p style={{ color: "#6B6B75" }} className="text-[11px] mt-3 leading-snug">
                    Cada corte tem um motivo (pausa, muleta, repetição, fora do assunto...) e um nível de
                    confiança. Trechos com baixa confiança são marcados como "a revisar" — não são cortados
                    automaticamente até você confirmar.
                  </p>
                </Panel>
              )}

              {activeTool === "auto" && (
                <Panel title="Editar tudo automaticamente">
                  <p style={{ color: "#9A9AA5" }} className="text-xs mb-3">
                    Escolha o tipo do seu vídeo — a IA usa isso pra decidir ritmo de corte, zoom, cor e estilo de
                    legenda automaticamente.
                  </p>
                  <div className="flex flex-col gap-3 mb-4">
                    {VIDEO_TYPE_GROUPS.map((group) => (
                      <div key={group.title}>
                        <p style={{ color: "#6B6B75" }} className="text-[10px] font-bold uppercase tracking-wide mb-1.5">
                          {group.title}
                        </p>
                        <div className="flex flex-col gap-1.5">
                          {group.ids.map((id) => {
                            const t = VIDEO_TYPES.find((v) => v.id === id);
                            if (!t) return null;
                            const Icon = t.icon;
                            const selected = videoTypeId === t.id;
                            return (
                              <button
                                key={t.id}
                                onClick={() => setVideoTypeId(t.id)}
                                style={{
                                  background: selected ? "#2A1B10" : "#0F0F13",
                                  border: selected ? "1px solid #FF6A2B" : "1px solid #1F1F26",
                                }}
                                className="flex items-start gap-2.5 p-2 rounded-lg text-left"
                              >
                                <span style={{ background: "#FF6A2B" }} className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0">
                                  <Icon size={14} color="#1A0A02" />
                                </span>
                                <span>
                                  <span className="block text-xs font-semibold">{t.label}</span>
                                  <span style={{ color: "#9A9AA5" }} className="block text-[10px] leading-snug">{t.desc}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={runAutoEdit}
                    disabled={autoEditBusy}
                    style={{ background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)", color: "#1A0A02", boxShadow: "0 4px 20px rgba(255,92,130,0.3)" }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold disabled:opacity-60"
                  >
                    {autoEditBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    {autoEditBusy ? "Editando..." : "Editar vídeo automaticamente"}
                  </button>
                  {autoEditBusy && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs mb-1 tabular-nums" style={{ color: "#9A9AA5" }}>
                        <span>{formatTime(autoEditElapsed)}</span>
                        <span>-{formatTime(Math.max(0, autoEditEstimate - autoEditElapsed))}</span>
                      </div>
                      <div style={{ background: "#1A0F28" }} className="w-full h-1.5 rounded-full overflow-hidden">
                        <div
                          style={{
                            background: "#FF6A2B",
                            width: `${Math.min(100, (autoEditElapsed / Math.max(1, autoEditEstimate)) * 100)}%`,
                          }}
                          className="h-full transition-all"
                        />
                      </div>
                      <p style={{ color: "#9A9AA5" }} className="text-xs mt-1.5">{autoEditStep}</p>
                    </div>
                  )}
                  {autoEditError && <p style={{ color: "#FF8A8A" }} className="text-xs mt-2">{autoEditError}</p>}
                  {autoEditDone && !autoEditBusy && (
                    <p style={{ color: "#5DCAA5" }} className="text-xs mt-2">
                      Pronto! Confira o resultado na linha do tempo e no vídeo antes de exportar.
                    </p>
                  )}
                  {lastStyleProfile && (
                    <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1F1F26" }}>
                      <p style={{ color: "#9A9AA5" }} className="text-xs mb-1">Última variação sorteada:</p>
                      <p style={{ color: "#C9C9D1" }} className="text-xs">
                        {lastStyleProfile.cutPace.label} · {lastStyleProfile.zoom.label} · {lastStyleProfile.color.label} ·{" "}
                        {CAPTION_STYLES.find((s) => s.id === lastStyleProfile.captionStyleId)?.label}
                      </p>
                    </div>
                  )}
                  <p style={{ color: "#6B6B75" }} className="text-[11px] mt-3 leading-snug">
                    A transcrição usa a API da OpenAI (Whisper) e tem um custo pequeno por minuto de áudio, cobrado na
                    sua própria conta da OpenAI. Isso pode levar cerca do mesmo tempo da duração do vídeo, já que o
                    áudio é processado localmente no navegador antes de ser enviado.
                  </p>
                </Panel>
              )}

              {activeTool === "silence" && (
                <Panel title="Cortar pausas longas">
                  <p style={{ color: "#9A9AA5" }} className="text-xs mb-3">
                    Analisa o áudio real do vídeo no navegador e marca trechos silenciosos (pausas longas) para remoção.
                  </p>
                  <label className="text-xs" style={{ color: "#9A9AA5" }}>Sensibilidade</label>
                  <input
                    type="range" min="0.005" max="0.08" step="0.005"
                    value={silenceThreshold}
                    onChange={(e) => setSilenceThreshold(Number(e.target.value))}
                    className="w-full my-2"
                  />
                  <button
                    onClick={removeSilence}
                    disabled={analyzing || silenceBusy}
                    style={{ background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)", color: "#1A0A02", boxShadow: "0 4px 20px rgba(255,92,130,0.3)" }}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
                  >
                    {(analyzing || silenceBusy) ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
                    {analyzing ? "Analisando áudio..." : silenceBusy ? "Removendo..." : "Detectar e remover pausas"}
                  </button>
                  {analyzeError && <p style={{ color: "#FF8A8A" }} className="text-xs mt-2">{analyzeError}</p>}
                </Panel>
              )}

              {activeTool === "mistakes" && (
                <Panel title="Cortar erros de fala">
                  <p style={{ color: "#9A9AA5" }} className="text-xs mb-3">
                    A IA lê a transcrição, identifica gagueiras, começos falsos e hesitações claramente erradas, e
                    corta esses trechos automaticamente.
                  </p>
                  <StepLabel n={1} text="Transcreva automaticamente, ou cole o texto manualmente abaixo" />
                  <button
                    onClick={transcribeAudio}
                    disabled={transcribing}
                    style={{ background: "#1A0F28" }}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium mb-2 disabled:opacity-60"
                  >
                    {transcribing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                    {transcribing ? "Transcrevendo..." : "Transcrever áudio com IA"}
                  </button>
                  {transcribeError && <p style={{ color: "#FF8A8A" }} className="text-xs mb-2">{transcribeError}</p>}
                  <textarea
                    value={transcript}
                    onChange={(e) => { setTranscript(e.target.value); setWordTimestamps([]); }}
                    placeholder="Cole aqui a transcrição da fala do vídeo..."
                    rows={5}
                    style={{ background: "#0F0F13", border: "1px solid #26262E", color: "#F5F5F7" }}
                    className="w-full rounded-lg p-2 text-xs mb-2 resize-none"
                  />
                  <StepLabel n={2} text="Clique para a IA detectar e cortar" />
                  <button
                    onClick={detectMistakes}
                    disabled={findingMistakes}
                    style={{ background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)", color: "#1A0A02", boxShadow: "0 4px 20px rgba(255,92,130,0.3)" }}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
                  >
                    {findingMistakes ? <Loader2 size={15} className="animate-spin" /> : <AlertTriangle size={15} />}
                    {findingMistakes ? "Analisando fala..." : "Detectar e cortar erros"}
                  </button>
                  {mistakeError && <p style={{ color: "#FF8A8A" }} className="text-xs mt-2">{mistakeError}</p>}
                  {mistakesFound > 0 && (
                    <p style={{ color: "#5DCAA5" }} className="text-xs mt-2">{mistakesFound} trecho(s) com erro cortado(s).</p>
                  )}
                  <p style={{ color: "#6B6B75" }} className="text-[11px] mt-2 leading-snug">
                    Os cortes são baseados na posição das palavras no texto, distribuída proporcionalmente ao longo do
                    vídeo — confira o resultado na linha do tempo antes de exportar.
                  </p>
                </Panel>
              )}

              {activeTool === "zoom" && (
                <Panel title="Zoom automático">
                  <p style={{ color: "#9A9AA5" }} className="text-xs mb-3">
                    Aplica um zoom suave e periódico ao longo do vídeo, dando mais energia à edição — visível assim
                    que ativado, no preview e na exportação.
                  </p>
                  <label className="flex items-center justify-between mb-3">
                    <span className="text-xs" style={{ color: "#9A9AA5" }}>Ativar zoom automático</span>
                    <input
                      type="checkbox"
                      checked={zoomEnabled}
                      onChange={(e) => setZoomEnabled(e.target.checked)}
                    />
                  </label>
                  <SliderRow
                    label="Intensidade"
                    value={Math.round((zoomIntensity - 1) * 100)}
                    min={5} max={40}
                    onChange={(v) => setZoomIntensity(1 + v / 100)}
                    suffix="%"
                  />
                </Panel>
              )}

              {activeTool === "transitions" && (
                <Panel title="Transições entre cortes">
                  <p style={{ color: "#9A9AA5" }} className="text-xs mb-3">
                    Aplica um fade curto (esmaece pra preto e volta) em cada ponto de corte, suavizando a transição —
                    visível no preview, na exportação e na linha do tempo.
                  </p>
                  <label className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: "#9A9AA5" }}>Ativar transições</span>
                    <input
                      type="checkbox"
                      checked={transitionsEnabled}
                      onChange={(e) => setTransitionsEnabled(e.target.checked)}
                    />
                  </label>
                  <p style={{ color: "#6B6B75" }} className="text-[11px] mt-3 leading-snug">
                    Duração fixa de {Math.round(TRANSITION_DURATION * 1000)}ms por fade. Por enquanto só temos esse
                    tipo de transição (fade); outros estilos podem vir depois.
                  </p>
                </Panel>
              )}

              {activeTool === "captions" && (
                <Panel title="Legendas automáticas">
                  <p style={{ color: "#9A9AA5" }} className="text-xs mb-2">
                    Transcreva o áudio automaticamente com IA (legendas ficam cronometradas com precisão), ou cole a
                    transcrição manualmente (o tempo é estimado por proporção).
                  </p>
                  <StepLabel n={1} text="Transcreva automaticamente, ou cole o texto manualmente abaixo" />
                  <button
                    onClick={transcribeAudio}
                    disabled={transcribing}
                    style={{ background: "#1A0F28" }}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium mb-2 disabled:opacity-60"
                  >
                    {transcribing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                    {transcribing ? "Transcrevendo..." : "Transcrever áudio com IA"}
                  </button>
                  {transcribeError && <p style={{ color: "#FF8A8A" }} className="text-xs mb-2">{transcribeError}</p>}
                  <textarea
                    value={transcript}
                    onChange={(e) => { setTranscript(e.target.value); setWordTimestamps([]); }}
                    placeholder="Cole aqui a transcrição da fala do vídeo..."
                    rows={5}
                    style={{ background: "#0F0F13", border: "1px solid #26262E", color: "#F5F5F7" }}
                    className="w-full rounded-lg p-2 text-xs mb-2 resize-none"
                  />
                  <StepLabel n={2} text="Clique para a IA gerar e cronometrar" />
                  <button
                    onClick={generateCaptions}
                    disabled={generatingCaptions}
                    style={{ background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)", color: "#1A0A02", boxShadow: "0 4px 20px rgba(255,92,130,0.3)" }}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
                  >
                    {generatingCaptions ? <Loader2 size={15} className="animate-spin" /> : <MessageSquareText size={15} />}
                    {generatingCaptions ? "Gerando legendas..." : "Gerar legendas com IA"}
                  </button>
                  {captionError && <p style={{ color: "#FF8A8A" }} className="text-xs mt-2">{captionError}</p>}
                  {captions.length > 0 && (
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs" style={{ color: "#9A9AA5" }}>{captions.length} legendas geradas</span>
                      <button onClick={() => setCaptions([])} style={{ color: "#9A9AA5" }} className="text-xs flex items-center gap-1">
                        <Trash2 size={12} /> Limpar
                      </button>
                    </div>
                  )}
                  <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1F1F26" }}>
                    <p style={{ color: "#9A9AA5" }} className="text-xs mb-2">Estilo da legenda</p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {CAPTION_STYLES.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setCaptionStyleId(s.id)}
                          style={{
                            background: captionStyleId === s.id ? "#2A1B10" : "#0F0F13",
                            border: captionStyleId === s.id ? "1px solid #FF6A2B" : "1px solid #1F1F26",
                          }}
                          className="flex items-center justify-between px-2.5 py-2 rounded-lg"
                        >
                          <span style={{ color: "#C9C9D1" }} className="text-xs">{s.label}</span>
                          <span
                            style={{
                              color: s.textColor,
                              background: s.bg || "transparent",
                              padding: s.bg ? "2px 8px" : 0,
                              borderRadius: 4,
                              fontWeight: s.weight,
                              fontSize: 11,
                              textTransform: s.uppercase ? "uppercase" : "none",
                              WebkitTextStroke: s.strokeColor ? `1px ${s.strokeColor}` : undefined,
                            }}
                          >
                            Exemplo
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </Panel>
              )}

              {activeTool === "color" && (
                <Panel title="Correção de cor">
                  <SliderRow label="Brilho" value={colorAdjust.brightness} min={50} max={150}
                    onChange={(v) => setColorAdjust((c) => ({ ...c, brightness: v }))} />
                  <SliderRow label="Contraste" value={colorAdjust.contrast} min={50} max={150}
                    onChange={(v) => setColorAdjust((c) => ({ ...c, contrast: v }))} />
                  <SliderRow label="Saturação" value={colorAdjust.saturate} min={0} max={200}
                    onChange={(v) => setColorAdjust((c) => ({ ...c, saturate: v }))} />
                  <button
                    onClick={() => setColorAdjust({ brightness: 100, contrast: 100, saturate: 100 })}
                    style={{ background: "#1A0F28" }}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium mt-1"
                  >
                    <Undo2 size={14} /> Redefinir
                  </button>
                </Panel>
              )}

              {activeTool === "music" && (
                <Panel title="Música">
                  <MusicLibrary
                    selectedMusicId={selectedMusicId}
                    onSelect={handleMusicSelect}
                  />
                  {selectedMusicId && (() => {
                    const t = resolveMusicTrack(selectedMusicId);
                    return t ? (
                      <p style={{ color: "#9A9AA5" }} className="text-[10px] mt-2 leading-snug">
                        Selecionado: <span style={{ color: "#F5F5F7" }} className="font-semibold">{t.title}</span>. Volume no painel "Volume".
                      </p>
                    ) : null;
                  })()}
                </Panel>
              )}

              {activeTool === "volume" && (
                <Panel title="Volume">
                  <SliderRow label="Fala (vídeo)" value={Math.round(volume * 100)} min={0} max={100}
                    onChange={(v) => setVolume(v / 100)} suffix="%" />
                  <SliderRow label="Música" value={Math.round(musicVolume * 100)} min={0} max={100}
                    onChange={(v) => setMusicVolume(v / 100)} suffix="%" />
                  <SliderRow label="Fundo (ambiente)" value={Math.round(ambientVolume * 100)} min={0} max={100}
                    onChange={(v) => setAmbientVolume(v / 100)} suffix="%" />
                  {selectedMusicId && (() => {
                    const t = resolveMusicTrack(selectedMusicId);
                    return t ? (
                      <div style={{ background: "#0F0F13", border: "1px solid #1F1F26" }} className="rounded-lg p-2 mt-2">
                        <p style={{ color: "#6B6B75" }} className="text-[10px] uppercase font-bold mb-0.5">Música selecionada</p>
                        <p style={{ color: "#F5F5F7" }} className="text-xs font-semibold">{t.title}</p>
                        <p style={{ color: "#9A9AA5" }} className="text-[10px]">{t.artist}</p>
                      </div>
                    ) : null;
                  })()}
                  <p style={{ color: "#9A9AA5" }} className="text-[10px] mt-2 leading-snug">
                    Fala e música tocam mixadas na pré-visualização. Exportação atual mantém áudio original do vídeo — mix final chega na próxima versão.
                  </p>
                </Panel>
              )}
            </div>

            <div className="md:col-span-6 flex flex-col gap-3">
              {metadataError && (
                <div style={{ background: "#2A1414", border: "1px solid #5A2323", color: "#F09595" }} className="rounded-xl p-3 text-xs">
                  {metadataError}
                </div>
              )}
              {!metadataError && duration === 0 && (
                <div style={{ background: "#12081C", border: "1px solid #1F1F26", color: "#9A9AA5" }} className="rounded-xl p-3 text-xs">
                  Carregando informações do vídeo... se isso não mudar em alguns segundos, tente outro arquivo (MP4 costuma ser o mais confiável).
                </div>
              )}
              <Panel>
                {editedVideoUrl && (
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold" style={{ color: "#5DCAA5" }}>
                      {showingEdited ? "Mostrando: vídeo editado" : "Mostrando: vídeo original"}
                    </span>
                    <button
                      onClick={() => setShowingEdited((v) => !v)}
                      style={{ color: "#FF6A2B" }}
                      className="text-xs font-semibold"
                    >
                      {showingEdited ? "Ver vídeo original" : "Ver vídeo editado"}
                    </button>
                  </div>
                )}
                <div
                  className="relative rounded-lg overflow-hidden mx-auto"
                  style={{
                    background: "#000",
                    aspectRatio: `${platform.ratio[0]} / ${platform.ratio[1]}`,
                    maxHeight: 420,
                    width: platform.ratio[1] > platform.ratio[0] ? "auto" : "100%",
                    display: showingEdited && editedVideoUrl ? "none" : "block",
                  }}
                >
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    style={{
                      width: "100%", height: "100%", display: "block",
                      objectFit: "cover",
                      filter: applyFilterString(colorAdjust),
                      transform: `scale(${zoomScale})`,
                      transformOrigin: "center center",
                      opacity: previewOpacity,
                    }}
                    onLoadedMetadata={onLoadedMetadata}
                    onTimeUpdate={onTimeUpdate}
                    onError={onVideoError}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  />
                  {activeCaption && (() => {
                    // Posições relativas ao VIDEO CONTAINER, respeitando
                    // seleção do usuário (Alta/Média/Baixa). Valores da
                    // spec: Alta ~18%, Média ~50%, Baixa ~75%.
                    // Alta 8% e Baixa 92% — safe area ~8% em cima e embaixo.
                    // (25% mais pra fora do que antes, a pedido do usuário)
                    const posStyle = {
                      top:    { top: "8%",  transform: "translate(-50%, -50%)" },
                      center: { top: "50%", transform: "translate(-50%, -50%)" },
                      bottom: { top: "92%", transform: "translate(-50%, -50%)" },
                    }[captionPosition] || { top: "92%", transform: "translate(-50%, -50%)" };
                    const text = captionStyle.uppercase ? activeCaption.text.toUpperCase() : activeCaption.text;
                    // Emphasis: usa idx canonico da cue OU accentTarget (first/last)
                    const emphasisIdx = Number.isInteger(activeCaption.emphasisWordIdx) && activeCaption.emphasisWordIdx >= 0
                      ? activeCaption.emphasisWordIdx
                      : (captionStyle.accentTarget === "first" ? 0 :
                         captionStyle.accentTarget === "last" ? text.trim().split(/\s+/).length - 1 : -1);
                    const words = text.trim().split(/\s+/);
                    // Karaoke: em modo perWord, palavra ATUAL da fala vira active.
                    let karaokeIdx = -1;
                    if (captionStyle.perWord && activeCaption.words?.length) {
                      const w = activeCaption.words.findIndex((wd) => currentTime >= wd.start && currentTime < wd.end);
                      karaokeIdx = w;
                    }
                    return (
                      <>
                        <div
                          className="absolute left-1/2 text-center"
                          style={{
                            ...posStyle,
                            width: "92%",
                            lineHeight: 1.15,
                          }}
                        >
                          <span
                            style={{
                              background: captionStyle.bg || (captionStyle.bgGradient ? `linear-gradient(90deg, ${captionStyle.bgGradient.from}, ${captionStyle.bgGradient.to})` : "transparent"),
                              color: captionStyle.textColor,
                              fontWeight: captionStyle.weight,
                              fontFamily: captionStyle.fontFamily || "sans-serif",
                              fontStyle: captionStyle.italic ? "italic" : "normal",
                              fontSize: `${1.05 * captionStyle.sizeScale}rem`,
                              letterSpacing: captionStyle.letterSpacing ? `${captionStyle.letterSpacing}em` : "normal",
                              WebkitTextStroke: captionStyle.strokeColor ? `${captionStyle.strokeWidth || 1.5}px ${captionStyle.strokeColor}` : undefined,
                              textShadow: captionStyle.shadow
                                ? `0 ${captionStyle.shadow.offsetY || 2}px ${captionStyle.shadow.blur || 6}px ${captionStyle.shadow.color || "rgba(0,0,0,0.7)"}`
                                : undefined,
                              padding: (captionStyle.bg || captionStyle.bgGradient) ? "0.35em 0.7em" : 0,
                              borderRadius: (captionStyle.bg || captionStyle.bgGradient) ? (captionStyle.pillRadius ?? 8) : 0,
                              border: captionStyle.borderColor && captionStyle.borderWidth ? `${captionStyle.borderWidth}px solid ${captionStyle.borderColor}` : undefined,
                              display: "-webkit-box",
                              WebkitBoxOrient: "vertical",
                              WebkitLineClamp: 2,
                              overflow: "hidden",
                              maxWidth: "100%",
                              wordBreak: "normal",
                              overflowWrap: "break-word",
                            }}
                          >
                            {words.map((w, i) => {
                              const isKaraoke = i === karaokeIdx;
                              const isEmphasis = i === emphasisIdx && !captionStyle.perWord;
                              const hasAccentBg = isEmphasis && captionStyle.accentBg;
                              const hasAccentColor = isEmphasis && captionStyle.accentColor;
                              const style = {};
                              if (isKaraoke) {
                                style.color = captionStyle.highlightColor || "#FDE047";
                              } else if (hasAccentBg) {
                                style.background = captionStyle.accentBg;
                                style.color = captionStyle.accentTextColor || captionStyle.textColor;
                                style.padding = "0.05em 0.25em";
                                style.borderRadius = 4;
                                style.marginLeft = 2;
                                style.marginRight = 2;
                                style.display = "inline-block";
                              } else if (hasAccentColor) {
                                style.color = captionStyle.accentColor;
                              }
                              return (
                                <React.Fragment key={i}>
                                  <span style={style}>{w}</span>
                                  {i < words.length - 1 ? " " : ""}
                                </React.Fragment>
                              );
                            })}
                          </span>
                        </div>
                      </>
                    );
                  })()}

                  {/* Graphics overlays: big_number + text_overlay ativos no timestamp */}
                  {graphicsPlan?.overlays?.filter((o) => currentTime >= o.start && currentTime <= o.end).map((o, i) => (
                    <div
                      key={"gfx-" + i}
                      className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
                      style={{
                        top: o.kind === "big_number" ? "18%" : "28%",
                        textAlign: "center",
                        animation: "fadeIn 0.25s ease-out",
                      }}
                    >
                      {o.kind === "big_number" ? (
                        <div style={{
                          fontFamily: "'Archivo Black','Inter Tight',sans-serif",
                          fontSize: "clamp(48px, 10vw, 120px)",
                          fontWeight: 900,
                          lineHeight: 1,
                          background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)",
                          WebkitBackgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                          textShadow: "0 4px 24px rgba(255,62,165,0.5)",
                          whiteSpace: "pre-line",
                        }}>{o.text}</div>
                      ) : (
                        <div style={{
                          fontFamily: "'Archivo Black','Inter Tight',sans-serif",
                          fontSize: "clamp(24px, 5vw, 48px)",
                          fontWeight: 900,
                          background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)",
                          color: "#150610",
                          padding: "6px 16px",
                          borderRadius: 8,
                          boxShadow: "0 8px 32px rgba(255,62,165,0.4)",
                          display: "inline-block",
                        }}>{o.text}</div>
                      )}
                    </div>
                  ))}

                  {/* B-roll — se tem media real, renderiza vídeo em picture-in-picture. Senão só tag. */}
                  {brollPlan?.suggestions?.filter((b) => currentTime >= b.start && currentTime <= b.end).map((b, i) => {
                    const clip = b.media?.[0];
                    if (clip?.url) {
                      return (
                        <div key={"br-" + i} className="absolute inset-0 pointer-events-none" style={{ opacity: 0.85 }}>
                          <video
                            src={clip.url}
                            autoPlay muted loop playsInline
                            style={{ width: "100%", height: "100%", objectFit: "cover", mixBlendMode: "normal" }}
                          />
                          <div className="absolute bottom-2 right-2" style={{
                            background: "rgba(0,0,0,0.6)", color: "#fff",
                            padding: "2px 8px", borderRadius: 4, fontSize: 9,
                            fontFamily: "'Inter Tight',sans-serif",
                          }}>{clip.attribution}</div>
                        </div>
                      );
                    }
                    return (
                      <div key={"br-" + i} className="absolute top-2 right-2 pointer-events-none" style={{
                        background: "rgba(120,186,255,0.9)", color: "#0A1A28",
                        padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                        fontFamily: "'Inter Tight',sans-serif",
                      }}>📹 B-ROLL: {b.query}</div>
                    );
                  })}
                </div>
                {showingEdited && editedVideoUrl && (
                  <div
                    className="relative rounded-lg overflow-hidden mx-auto"
                    style={{
                      background: "#000",
                      aspectRatio: `${platform.ratio[0]} / ${platform.ratio[1]}`,
                      maxHeight: 420,
                      width: platform.ratio[1] > platform.ratio[0] ? "auto" : "100%",
                    }}
                  >
                    <video src={editedVideoUrl} controls style={{ width: "100%", height: "100%", display: "block" }} />
                  </div>
                )}
                {!showingEdited && (() => {
                  // Extrai só a data (YYYY-MM-DD) do nome do arquivo.
                  const dateMatch = fileName?.match(/(\d{4})[-_\.\/](\d{2})[-_\.\/](\d{2})/);
                  const shortName = dateMatch ? `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}` : fileName;
                  return (
                  <>
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                      <button onClick={togglePlay} style={{ background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)", color: "#1A0A02", boxShadow: "0 4px 20px rgba(255,92,130,0.3)" }} className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0">
                        {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                      </button>
                      <span style={{ color: "#9A9AA5" }} className="text-xs tabular-nums">
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </span>
                      <span style={{ color: "#5C5C66" }} className="text-xs truncate ml-auto">{shortName}</span>
                      <button onClick={() => fileInputRef.current?.click()} style={{ color: "#9A9AA5" }} className="text-xs flex items-center gap-1 flex-shrink-0">
                        <X size={12} /> Trocar vídeo
                      </button>
                      <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                    </div>
                    {edl.length > 0 && (
                      <div className="flex items-center justify-center gap-2 mt-3">
                        <button
                          onClick={() => setPreviewMode(false)}
                          title="Vídeo bruto com as sugestões da IA marcadas"
                          style={{
                            background: !previewMode ? "#FF6A2B" : "#1A0F28",
                            color: !previewMode ? "#1A0A02" : "#C9C9D1",
                            border: !previewMode ? "none" : "1px solid #26262E",
                          }}
                          className="flex flex-col items-center leading-tight px-4 py-1.5 rounded-md font-bold shadow"
                        >
                          <span className="text-xs">Vídeo original</span>
                          <span className="text-[10px] tabular-nums opacity-80">{formatTime(duration)}</span>
                        </button>
                        <button
                          onClick={() => setPreviewMode(true)}
                          title="Vídeo compilado com todos os cortes aplicados"
                          style={{
                            background: previewMode ? "#2E7D4F" : "#1A0F28",
                            color: previewMode ? "#FFFFFF" : "#C9C9D1",
                            border: previewMode ? "none" : "1px solid #26262E",
                          }}
                          className="flex flex-col items-center leading-tight px-4 py-1.5 rounded-md font-bold shadow"
                        >
                          <span className="text-xs">Vídeo editado</span>
                          <span className="text-[10px] tabular-nums opacity-80">{formatTime(finalDuration)}</span>
                        </button>
                      </div>
                    )}
                  </>
                  );
                })()}
                {showingEdited && editedVideoUrl && (
                  <div className="flex items-center gap-3 mt-3">
                    <button onClick={() => fileInputRef.current?.click()} style={{ color: "#9A9AA5" }} className="text-xs flex items-center gap-1 flex-shrink-0 ml-auto">
                      <X size={12} /> Trocar vídeo
                    </button>
                    <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                  </div>
                )}
              </Panel>

              <Panel>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-xs font-bold tracking-wide">LINHA DO TEMPO INTELIGENTE</h3>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setTimelineZoom((z) => Math.max(1, z - 0.5))} style={{ color: "#9A9AA5" }} className="p-1">
                      <Minus size={13} />
                    </button>
                    <input
                      type="range" min="1" max="5" step="0.5"
                      value={timelineZoom}
                      onChange={(e) => setTimelineZoom(Number(e.target.value))}
                      style={{ width: 70 }}
                    />
                    <button onClick={() => setTimelineZoom((z) => Math.min(5, z + 0.5))} style={{ color: "#9A9AA5" }} className="p-1">
                      <Plus size={13} />
                    </button>
                    <button
                      onClick={() => setTimelineZoom(1)}
                      style={{ background: "#1A0F28", color: "#C9C9D1" }}
                      className="text-[11px] font-medium px-2 py-1 rounded-lg"
                    >
                      Ajustar
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap mb-3">
                  {TIMELINE_LEGEND.map((l) => (
                    <span key={l.label} className="flex items-center gap-1.5 text-[10px]" style={{ color: "#9A9AA5" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: l.color, display: "inline-block" }} />
                      {l.label}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <button onClick={handleCut} style={{ background: "#1A0F28" }} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium">
                    <Scissors size={13} /> Cortar no ponto atual
                  </button>
                  <button onClick={resetSegments} style={{ background: "#1A0F28" }} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium">
                    <RotateCcw size={13} /> Restaurar tudo
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <div
                    ref={timelineRef}
                    onClick={handleTimelineClick}
                    className="relative cursor-pointer select-none"
                    style={{ height: 196, width: `${timelineZoom * 100}%`, minWidth: "100%" }}
                  >
                    {/* Time ruler */}
                    <div className="absolute left-0 right-0 top-0" style={{ height: 16, paddingLeft: 46 }}>
                      {duration > 0 && (() => {
                        const step = pickTickInterval(duration);
                        const ticks = [];
                        for (let t = 0; t <= duration; t += step) ticks.push(t);
                        return ticks.map((t) => (
                          <span
                            key={t}
                            style={{ position: "absolute", left: `${(t / duration) * 100}%`, color: "#6B6B75" }}
                            className="text-[10px] -translate-x-1/2"
                          >
                            {formatTime(t)}
                          </span>
                        ));
                      })()}
                    </div>

                    {/* Filmstrip */}
                    <div className="absolute left-0 right-0" style={{ top: 18, height: 34 }}>
                      <TrackLabel text="Vídeo" />
                      <div className="absolute inset-0 rounded overflow-hidden flex" style={{ marginLeft: 46, background: "#0F0F13" }}>
                        {thumbnails.length > 0 ? (
                          thumbnails.map((src, i) => (
                            <img key={i} src={src} alt="" style={{ height: "100%", width: `${100 / thumbnails.length}%`, objectFit: "cover", flexShrink: 0 }} />
                          ))
                        ) : (
                          <div className="flex items-center justify-center w-full" style={{ color: "#5C5C66" }}>
                            <span className="text-[10px]">{generatingThumbs ? "Gerando miniaturas..." : ""}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Waveform (mirrored) */}
                    <div className="absolute left-0 right-0" style={{ top: 56, height: 30 }}>
                      <TrackLabel text="Áudio" />
                      <div className="absolute inset-0" style={{ paddingLeft: 46 }}>
                        {waveform.length > 0 ? (
                          <div className="relative w-full h-full">
                            {waveform.map((b, i) => (
                              <div key={i} style={{
                                position: "absolute", left: `${(b.start / duration) * 100}%`,
                                width: `${Math.max(0.3, ((b.end - b.start) / duration) * 100)}%`,
                                top: "50%", transform: "translateY(-50%)",
                                height: `${Math.max(8, b.level * 100)}%`,
                                background: b.level < silenceThreshold ? "#3A3A44" : "#7C5CFF",
                                borderRadius: 1,
                              }} />
                            ))}
                          </div>
                        ) : (
                          <div style={{ background: "#1A0F28" }} className="w-full h-3 rounded" />
                        )}
                      </div>
                    </div>

                    {/* Video segments — cor por status:
                        azul  = keep (mantido)
                        laranja sólido = remove (será cortado)
                        amarelo listrado = review (a revisar)
                        cinza hachurado = trim (encurtar) */}
                    <div className="absolute left-0 right-0" style={{ top: 90, height: 22 }}>
                      <TrackLabel text="Cortes" />
                      <div className="absolute inset-0" style={{ paddingLeft: 46 }}>
                        <div className="relative w-full h-full" ref={timelineTrackRef}>
                          {previewMode ? (
                            <div
                              title="Vídeo editado — faixa contínua"
                              style={{
                                position: "absolute", left: 0, right: 0, top: 2, bottom: 2,
                                background: "#378ADD", borderRadius: 4,
                                border: "1px solid #0A0A0D",
                              }}
                            />
                          ) : segments.map((seg) => {
                            let bg;
                            if (seg.action === "review") {
                              bg = "repeating-linear-gradient(45deg,#FFB020,#FFB020 4px,#7A5510 4px,#7A5510 8px)";
                            } else if (seg.deleted && (seg.action === "remove" || !seg.action)) {
                              bg = "#FF6A2B";
                            } else if (seg.deleted && seg.action === "trim") {
                              bg = "repeating-linear-gradient(45deg,#26262E,#26262E 4px,#1B1B21 4px,#1B1B21 8px)";
                            } else {
                              bg = "#378ADD";
                            }
                            const canDrag = seg.deleted || seg.action === "review";
                            return (
                              <div
                                key={seg.id}
                                onClick={(e) => { e.stopPropagation(); setSelectedSegId(seg.id); handleSeek(seg.start); }}
                                title={seg.action === "review" ? "A revisar — arraste as bordas pra ajustar" : seg.deleted ? "Será cortado — arraste as bordas pra ajustar" : "Mantido"}
                                style={{
                                  position: "absolute",
                                  left: `${(seg.start / duration) * 100}%`,
                                  width: `${Math.max(0.3, ((seg.end - seg.start) / duration) * 100)}%`,
                                  top: 2, bottom: 2,
                                  background: bg,
                                  border: selectedSegId === seg.id ? "1.5px solid #FFFFFF" : "1px solid #0A0A0D",
                                  borderRadius: 4,
                                  cursor: "pointer",
                                }}
                              >
                                {canDrag && (
                                  <>
                                    <div
                                      onMouseDown={(e) => beginBoundaryDrag(e, seg.id, "start")}
                                      title="Arrastar início do corte"
                                      style={{
                                        position: "absolute", left: -3, top: -2, bottom: -2, width: 8,
                                        cursor: "col-resize", background: "transparent",
                                        borderLeft: "2px solid rgba(255,255,255,0.85)", borderRadius: 2,
                                      }}
                                    />
                                    <div
                                      onMouseDown={(e) => beginBoundaryDrag(e, seg.id, "end")}
                                      title="Arrastar fim do corte"
                                      style={{
                                        position: "absolute", right: -3, top: -2, bottom: -2, width: 8,
                                        cursor: "col-resize", background: "transparent",
                                        borderRight: "2px solid rgba(255,255,255,0.85)", borderRadius: 2,
                                      }}
                                    />
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Captions with visible text */}
                    <div className="absolute left-0 right-0" style={{ top: 114, height: 22 }}>
                      <TrackLabel text="Legendas" />
                      <div className="absolute inset-0" style={{ paddingLeft: 46 }}>
                        <div className="relative w-full h-full">
                          {(previewMode ? clippedCaptions : captions).map((c) => (
                            <div key={c.id} title={c.text} style={{
                              position: "absolute",
                              left: `${(c.start / duration) * 100}%`,
                              width: `${Math.max(0.3, ((c.end - c.start) / duration) * 100)}%`,
                              top: 2, bottom: 2, background: "#1D9E75", borderRadius: 4,
                              overflow: "hidden", display: "flex", alignItems: "center", padding: "0 4px",
                            }}>
                              <span style={{ color: "#04140D", fontSize: 9, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {c.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Effects (zoom cues) */}
                    <div className="absolute left-0 right-0" style={{ top: 138, height: 18 }}>
                      <TrackLabel text="Zoom" />
                      <div className="absolute inset-0" style={{ paddingLeft: 46 }}>
                        <div className="relative w-full h-full">
                          {smartZoomEnabled && zoomEvents
                            .filter((ev) => !previewMode || !segments.some((s) => s.deleted && ev.start >= s.start && ev.start < s.end))
                            .map((ev) => {
                            const isOut = ev.mode === "zoom_out";
                            const isSelected = selectedZoomId === ev.id;
                            const levelSpec = ZOOM_LEVELS[ev.level] || {};
                            const label = levelSpec.label ? levelSpec.label[0] : "";
                            return (
                              <div
                                key={ev.id}
                                title={`${isOut ? "Zoom Out" : "Zoom In"} · ${levelSpec.label || ""} · ${ev.reason}`}
                                onClick={(e) => { e.stopPropagation(); setSelectedZoomId(ev.id); }}
                                onMouseDown={(e) => { if (e.button === 0) startZoomDrag(e, ev.id, "move"); }}
                                style={{
                                  position: "absolute",
                                  left: `${(ev.start / duration) * 100}%`,
                                  width: `${Math.max(1.2, ((ev.end - ev.start) / duration) * 100)}%`,
                                  top: 1, bottom: 1,
                                  background: isOut
                                    ? "linear-gradient(90deg,#78BAFF,#4E85C7)"
                                    : "linear-gradient(90deg,#5DCAA5,#3E9B7A)",
                                  borderRadius: 3,
                                  cursor: "grab",
                                  border: isSelected ? "2px solid #FFFFFF" : "1px solid rgba(0,0,0,0.3)",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  color: "#0A140D",
                                  fontSize: 10, fontWeight: 800,
                                  userSelect: "none",
                                }}
                              >
                                {/* Resize handles */}
                                <div
                                  onMouseDown={(e) => startZoomDrag(e, ev.id, "resize-left")}
                                  style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, cursor: "ew-resize" }}
                                />
                                <div
                                  onMouseDown={(e) => startZoomDrag(e, ev.id, "resize-right")}
                                  style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "ew-resize" }}
                                />
                                {isOut ? "OUT" : "IN"}{label && ` · ${label}`}
                              </div>
                            );
                          })}
                          {/* legado */}
                          {!smartZoomEnabled && zoomEnabled && zoomCues && zoomCues.map((t, i) => (
                            <div key={i} title="Zoom (legado)" style={{
                              position: "absolute", left: `${(t / duration) * 100}%`, top: 0,
                              transform: "translateX(-50%)",
                              width: 16, height: 16, borderRadius: "50%",
                              background: "#FFB020", display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <ZoomIn size={10} color="#1A0A02" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Transições (fade at each active cut point) */}
                    <div className="absolute left-0 right-0" style={{ top: 158, height: 18 }}>
                      <TrackLabel text="Transições" />
                      <div className="absolute inset-0" style={{ paddingLeft: 46 }}>
                        <div className="relative w-full h-full">
                          {transitionsEnabled && activeSegments.slice(1).map((seg) => (
                            <div key={"trans-" + seg.id} title={`Fade (${Math.round(TRANSITION_DURATION * 1000)}ms)`} style={{
                              position: "absolute", left: `${(seg.start / duration) * 100}%`, top: 0,
                              transform: "translateX(-50%)",
                              width: 16, height: 16, borderRadius: "50%",
                              background: "#5C8AFF", display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <SlidersHorizontal size={9} color="#0A0A0D" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* IA Aplicada: cut points + removed silence + zoom */}
                    <div className="absolute left-0 right-0" style={{ top: 178, height: 18, display: previewMode ? "none" : "block" }}>
                      <TrackLabel text="IA" />
                      <div className="absolute inset-0" style={{ paddingLeft: 46 }}>
                        <div className="relative w-full h-full">
                          {segments.slice(1).map((seg) => (
                            <div key={"cut-" + seg.id} title="Corte" style={{
                              position: "absolute", left: `${(seg.start / duration) * 100}%`, top: 0,
                              transform: "translateX(-50%)",
                              width: 16, height: 16, borderRadius: "50%",
                              background: "#FF6A2B", display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <Scissors size={9} color="#1A0A02" />
                            </div>
                          ))}
                          {segments.filter((s) => s.deleted).map((seg) => (
                            <div key={"del-" + seg.id} title="Trecho removido" style={{
                              position: "absolute", left: `${((seg.start + seg.end) / 2 / duration) * 100}%`, top: 0,
                              transform: "translateX(-50%)",
                              width: 16, height: 16, borderRadius: "50%",
                              background: "#5C5C66", display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              <VolumeX size={9} color="#0A0A0D" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {duration > 0 && (
                      <div
                        className="absolute top-0 bottom-0"
                        style={{
                          left: `calc(46px + (100% - 46px) * ${Math.min(1, Math.max(0, currentTime / duration))})`,
                          width: 2,
                          background: "#FF6A2B",
                        }}
                      />
                    )}
                  </div>
                </div>

                {selectedSegId && (() => {
                  const seg = segments.find((s) => s.id === selectedSegId);
                  if (!seg) return null;
                  return (
                    <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: "1px solid #1F1F26" }}>
                      <span style={{ color: "#9A9AA5" }} className="text-xs">
                        Trecho: {formatTime(seg.start)} – {formatTime(seg.end)}
                      </span>
                      <button
                        onClick={() => toggleDeleteSegment(seg.id)}
                        style={{ color: seg.deleted ? "#5DCAA5" : "#F09595" }}
                        className="text-xs flex items-center gap-1 font-medium"
                      >
                        {seg.deleted ? <><Undo2 size={12} /> Restaurar trecho</> : <><Trash2 size={12} /> Remover trecho</>}
                      </button>
                    </div>
                  );
                })()}

                {selectedZoomId && (() => {
                  const ev = zoomEvents.find((z) => z.id === selectedZoomId);
                  if (!ev) return null;
                  const isOut = ev.mode === "zoom_out";
                  const inLevels = ["light", "medium", "strong"];
                  const outLevels = ["out_light", "out_medium", "out_strong"];
                  return (
                    <div className="mt-2 pt-2" style={{ borderTop: "1px solid #1F1F26" }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span style={{ color: "#F5F5F7" }} className="text-xs font-semibold">
                          {isOut ? "Zoom Out" : "Zoom In"} · {formatTime(ev.start)} → {formatTime(ev.end)} ({(ev.end - ev.start).toFixed(1)}s)
                        </span>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handlePlayRange(ev.start - 0.2, ev.end + 0.2)} style={{ background: "#1A0F28", color: "#C9C9D1" }} className="flex items-center gap-1 px-2 py-1 rounded text-[10px]">
                            <Play size={10} /> Ouvir
                          </button>
                          <button onClick={() => deleteZoomEvent(ev.id)} style={{ background: "#5A2A1E", color: "#FFB0A0" }} className="flex items-center gap-1 px-2 py-1 rounded text-[10px]">
                            <Trash2 size={10} /> Excluir
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span style={{ color: "#6B6B75" }} className="text-[10px]">Intensidade:</span>
                        {(isOut ? outLevels : inLevels).map((lv) => {
                          const spec = ZOOM_LEVELS[lv];
                          const active = ev.level === lv;
                          return (
                            <button key={lv} onClick={() => setZoomLevel(ev.id, lv)}
                              style={{ background: active ? "#FF6A2B" : "#1A0F28", color: active ? "#1A0A02" : "#C9C9D1" }}
                              className="text-[10px] px-2 py-0.5 rounded font-semibold">
                              {spec.label}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => updateZoomEvent(ev.id, isOut ? { mode: "zoom_in", scale: ZOOM_LEVELS.medium.value, level: "medium" } : { mode: "zoom_out", scale: ZOOM_LEVELS.out_light.value, level: "out_light" })}
                          style={{ background: "#1A0F28", color: "#78BAFF" }}
                          className="text-[10px] px-2 py-0.5 rounded font-semibold ml-2">
                          Trocar para {isOut ? "Zoom In" : "Zoom Out"}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </Panel>
            </div>

            <div className="md:col-span-3 flex flex-col gap-3">
              {/* Painel de Diagnóstico do pipeline removido.
                  Botão "Exportar JSON" agora vive no rodapé de
                  "Problemas encontrados". */}

              {(edl.length > 0 || smartBusy) && (
                <Panel title="Problemas encontrados">
                  <div className="flex items-center justify-between mb-3 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={doUndo}
                        disabled={!canUndo(history)}
                        title="Desfazer (Ctrl+Z)"
                        style={{ background: "#1A0F28", color: canUndo(history) ? "#C9C9D1" : "#4A4A54" }}
                        className="px-2 py-1 rounded-md font-semibold flex items-center gap-1"
                      >
                        <Undo2 size={12} /> Desfazer
                      </button>
                      <button
                        onClick={doRedo}
                        disabled={!canRedo(history)}
                        title="Refazer (Ctrl+Y)"
                        style={{ background: "#1A0F28", color: canRedo(history) ? "#C9C9D1" : "#4A4A54" }}
                        className="px-2 py-1 rounded-md font-semibold flex items-center gap-1"
                      >
                        <RotateCcw size={12} /> Refazer
                      </button>
                      <button
                        onClick={exportDiagnostic}
                        title="Exportar diagnóstico JSON — use pra reportar problemas"
                        style={{ background: "#1A0F28", color: "#78BAFF" }}
                        className="px-2 py-1 rounded-md font-semibold flex items-center gap-1"
                      >
                        ⇩ JSON
                      </button>
                    </div>
                    <span style={{ color: saveState === "error" ? "#F09595" : saveState === "saving" ? "#FFB020" : "#5DCAA5" }}>
                      {saveState === "saving" ? "Salvando..." : saveState === "saved" ? "Salvo" : saveState === "error" ? "Erro ao salvar" : ""}
                    </span>
                  </div>
                  {edl.length > 0 && (() => {
                    const originalDur = duration || 0;
                    const editedDur = segments.filter((s) => !s.deleted && s.action !== "review").reduce((a, s) => a + (s.end - s.start), 0);
                    const removedDur = Math.max(0, originalDur - editedDur);
                    const pct = originalDur > 0 ? Math.round((removedDur / originalDur) * 100) : 0;
                    const removedCount = segments.filter((s) => s.deleted && s.action !== "review").length;
                    const reviewCount = segments.filter((s) => s.action === "review").length;
                    const proposed = segments.filter((s) => s.source && s.source !== "keep").length;
                    const accepted = segments.filter((s) => s.source && s.source !== "keep" && s.deleted).length;
                    const acceptanceRate = proposed > 0 ? Math.round((accepted / proposed) * 100) : null;
                    return (
                      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                        <MetricCell label="Original" value={formatTime(originalDur)} />
                        <MetricCell label="Editado" value={formatTime(editedDur)} accent />
                        <MetricCell label="Redução" value={`-${pct}%`} accent />
                        <MetricCell label="Removido" value={formatTime(removedDur)} />
                        <MetricCell label="Cortes" value={String(removedCount)} />
                        <MetricCell label="A revisar" value={String(reviewCount)} warn={reviewCount > 0} />
                        {acceptanceRate !== null && (
                          <MetricCell label="Aceitação" value={`${acceptanceRate}%`} />
                        )}
                      </div>
                    );
                  })()}

                  {usageLog.entries.length > 0 && (
                    <div className="mb-3">
                      <button
                        onClick={() => setShowUsage((v) => !v)}
                        style={{ color: "#9A9AA5" }}
                        className="text-[11px] flex items-center gap-1 hover:underline"
                      >
                        {showUsage ? "▾" : "▸"} Consumo de IA (debug)
                      </button>
                      {showUsage && (() => {
                        const s = summarizeUsage(usageLog);
                        return (
                          <div style={{ background: "#0F0F13", border: "1px solid #1F1F26" }} className="rounded-lg p-2 mt-1.5 text-[10px]" >
                            <div className="grid grid-cols-2 gap-1" style={{ color: "#C9C9D1" }}>
                              <span>Chamadas</span><span className="text-right tabular-nums">{s.calls}</span>
                              <span>Tokens entrada</span><span className="text-right tabular-nums">{s.inputTokens.toLocaleString("pt-BR")}</span>
                              <span>Tokens saída</span><span className="text-right tabular-nums">{s.outputTokens.toLocaleString("pt-BR")}</span>
                              <span>Latência total</span><span className="text-right tabular-nums">{(s.latencyMs / 1000).toFixed(1)}s</span>
                              <span>Áudio transcrito</span><span className="text-right tabular-nums">{s.audioMinutes.toFixed(1)}min</span>
                              <span>Custo estimado</span><span className="text-right tabular-nums" style={{ color: "#5DCAA5" }}>{s.estimatedCostUSD > 0 ? `US$ ${s.estimatedCostUSD.toFixed(4)}` : "n/d"}</span>
                            </div>
                            <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px solid #1F1F26" }}>
                              {Object.entries(s.byOperation).map(([op, b]) => (
                                <div key={op} className="flex justify-between" style={{ color: "#9A9AA5" }}>
                                  <span>{op}</span>
                                  <span className="tabular-nums">{b.calls}× · {(b.inputTokens + b.outputTokens).toLocaleString("pt-BR")} tokens</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  {narrativeTopic && (
                    <div style={{ background: "#0F0F13", border: "1px solid #1F1F26" }} className="rounded-lg p-2.5 mb-2">
                      <p style={{ color: "#9A9AA5" }} className="text-[10px] font-bold uppercase tracking-wide mb-1">Assunto detectado</p>
                      <p style={{ color: "#F5F5F7" }} className="text-xs leading-snug">{narrativeTopic}</p>
                    </div>
                  )}
                  <ProblemsFound
                    candidates={problemCandidates}
                    onPlay={handlePlayRange}
                    onRemove={(cand) => applyCandidateDecision(cand, true)}
                    onKeep={(cand) => applyCandidateDecision(cand, false)}
                  />
                  <IntegrityAndTimelineDebug
                    integrity={integrityReport}
                    debugReport={debugTimelineReport}
                  />
                  <AIAnalysisPanel
                    narrative={narrativeMap}
                    brollPlan={brollPlan}
                    graphicsPlan={graphicsPlan}
                    productMoments={productMoments}
                    protectedRanges={protectedRanges}
                    patternInterrupts={patternInterrupts}
                    visualPlan={visualPlan}
                  />
                  {dimensionalQuality && (
                    <div style={{ background: "#1A0F28", border: "1px solid #2A1F38" }} className="mt-3 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-semibold" style={{ color: "#F5F5F7" }}>Score de qualidade</div>
                        <div className="text-lg font-black" style={{
                          background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)",
                          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                          fontFamily: "'Archivo Black',sans-serif",
                        }}>{dimensionalQuality.final}</div>
                      </div>
                      <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: "#FF6A2B" }}>{dimensionalQuality.label}</div>
                      <div className="grid grid-cols-2 gap-1 text-[10px]" style={{ color: "#A89EB4" }}>
                        <div>Fala: <b style={{ color: "#F5F5F7" }}>{dimensionalQuality.speech_cleanup}</b></div>
                        <div>Cortes: <b style={{ color: "#F5F5F7" }}>{dimensionalQuality.cut_quality}</b></div>
                        <div>Junções: <b style={{ color: "#F5F5F7" }}>{dimensionalQuality.join_quality}</b></div>
                        <div>Legendas: <b style={{ color: "#F5F5F7" }}>{dimensionalQuality.caption_quality}</b></div>
                        <div>Ritmo: <b style={{ color: "#F5F5F7" }}>{dimensionalQuality.visual_rhythm}</b></div>
                        <div>Sem excesso: <b style={{ color: "#F5F5F7" }}>{dimensionalQuality.overediting_penalty}</b></div>
                      </div>
                      {dimensionalQuality.final < 75 && (
                        <button
                          onClick={runIntelligentEdit}
                          disabled={reprocessBusy || smartBusy}
                          style={{ background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)", color: "#1A0A02" }}
                          className="mt-3 w-full py-1.5 rounded-md text-[11px] font-bold disabled:opacity-60"
                        >
                          {reprocessBusy ? "Reprocessando..." : "Reprocessar aplicando QC"}
                        </button>
                      )}
                    </div>
                  )}
                </Panel>
              )}
              <Panel title="Exportação">
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {["720p", "1080p", "4K"].map((r) => (
                    <button
                      key={r}
                      onClick={() => setResolution(r)}
                      style={{ background: resolution === r ? "#FF6A2B" : "#1A0F28", color: resolution === r ? "#1A0A02" : "#F5F5F7" }}
                      className="py-1.5 rounded-lg text-xs font-semibold"
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleExport}
                  disabled={isExporting}
                  style={{ background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)", color: "#1A0A02", boxShadow: "0 4px 20px rgba(255,92,130,0.3)" }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold disabled:opacity-60"
                >
                  {isExporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  {isExporting ? `Exportando... ${exportProgress}%` : "Exportar vídeo"}
                </button>
                {isExporting && (
                  <div style={{ background: "#1A0F28" }} className="w-full h-1.5 rounded-full mt-2 overflow-hidden">
                    <div style={{ background: "#FF6A2B", width: `${exportProgress}%` }} className="h-full transition-all" />
                  </div>
                )}
                {exportError && <p style={{ color: "#FF8A8A" }} className="text-xs mt-2">{exportError}</p>}
                {exportedUrl && (
                  <a href={exportedUrl} download={(fileName.replace(/\.[^.]+$/, "") || "video") + "-editado.webm"}
                    style={{ background: "#1A0F28", color: "#5DCAA5" }}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium mt-2">
                    <Download size={14} /> Baixar vídeo exportado
                  </a>
                )}
              </Panel>

              <Panel title="Destinos">
                <PlatformChips
                  platforms={PLATFORMS}
                  selected={platformIds}
                  onToggle={togglePlatform}
                />
              </Panel>

            </div>
          </div>
        )}
      </div>
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1A0F28",
            border: "1px solid #2A2A32",
            color: "#F5F5F7",
            padding: "8px 14px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            zIndex: 100000,
            pointerEvents: "none",
          }}
        >
          {toast}
        </div>
      )}
      {/* Áudio da música de fundo — sincronizado com play/pause do vídeo */}
      <audio ref={musicAudioRef} className="hidden" />
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: "#12081C", border: "1px solid #1F1F26" }} className="rounded-xl p-3.5">
      {title && <h3 className="text-sm font-semibold mb-3">{title}</h3>}
      {children}
    </div>
  );
}

function Badge({ icon, label }) {
  return (
    <span style={{ background: "#12081C", border: "1px solid #1F1F26", color: "#C9C9D1" }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium">
      {icon} {label}
    </span>
  );
}

function StepLabel({ n, text }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <span
        style={{ background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)", color: "#1A0A02", boxShadow: "0 4px 20px rgba(255,92,130,0.3)" }}
        className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
      >
        {n}
      </span>
      <span style={{ color: "#C9C9D1" }} className="text-xs">{text}</span>
    </div>
  );
}

function TrackLabel({ text }) {
  return (
    <span style={{ color: "#5C5C66", width: 40 }} className="absolute left-0 top-0 text-[10px] font-medium uppercase tracking-wide">
      {text}
    </span>
  );
}

function SliderRow({ label, value, min, max, onChange, suffix = "" }) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span style={{ color: "#9A9AA5" }} className="text-xs">{label}</span>
        <span className="text-xs font-medium tabular-nums">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </div>
  );
}

function StatRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid #1B1B21" }}>
      <span style={{ color: "#9A9AA5" }} className="text-xs">{label}</span>
      <span className="text-xs font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// Agrupa as plataformas por proporção (9:16 vira uma linha com TikTok/
// Reels/Shorts, etc). O primeiro marcado ainda define o formato ativo,
// mesma regra da UI antiga — só a apresentação mudou.
function PlatformChips({ platforms, selected, onToggle }) {
  // Layout compacto — 2 linhas fixas:
  //   Linha 1: [ ] Feed Insta       [ ] YouTube
  //   Linha 2: [ ] TikTok / Shorts / Reels
  const byId = (id) => platforms.find((p) => p.id === id);
  const feed = byId("feed");
  const youtube = byId("youtube");
  const tiktok = byId("tiktok");
  const shorts = byId("shorts");
  const reels = byId("reels");
  const isOn = (id) => selected.includes(id);

  const Box = ({ id, label }) => {
    if (!id) return null;
    const on = isOn(id);
    return (
      <button
        onClick={() => onToggle(id)}
        title={label}
        className="flex items-center gap-2 text-xs font-semibold"
        style={{ color: on ? "#F5F5F7" : "#9A9AA5" }}
      >
        <span
          style={{
            width: 14, height: 14,
            border: on ? "1.5px solid #FF6A2B" : "1.5px solid #4A4A54",
            background: on ? "#FF6A2B" : "transparent",
            borderRadius: 3,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {on && <span style={{ color: "#1A0A02", fontSize: 10, fontWeight: 900, lineHeight: 1 }}>✓</span>}
        </span>
        <span className="whitespace-nowrap">{label}</span>
      </button>
    );
  };

  const activeRatio = (() => {
    const first = platforms.find((p) => p.id === selected[0]);
    return first ? `${first.ratio[0]}:${first.ratio[1]}` : null;
  })();
  const selectedRatios = new Set(
    platforms.filter((p) => selected.includes(p.id)).map((p) => `${p.ratio[0]}:${p.ratio[1]}`)
  );
  const hasMultipleRatios = selectedRatios.size > 1;

  // TikTok/Shorts/Reels são todos 9:16 — 1 tick só ativa os 3.
  const verticalIds = [tiktok?.id, shorts?.id, reels?.id].filter(Boolean);
  const verticalOn = verticalIds.some((id) => selected.includes(id));
  const toggleVertical = () => {
    if (verticalOn) verticalIds.forEach((id) => selected.includes(id) && onToggle(id));
    else verticalIds.forEach((id) => !selected.includes(id) && onToggle(id));
  };

  const VerticalBox = () => (
    <button
      onClick={toggleVertical}
      title="TikTok · Shorts · Reels (9:16)"
      className="flex items-center gap-2 text-xs font-semibold"
      style={{ color: verticalOn ? "#F5F5F7" : "#9A9AA5" }}
    >
      <span
        style={{
          width: 14, height: 14,
          border: verticalOn ? "1.5px solid #FF6A2B" : "1.5px solid #4A4A54",
          background: verticalOn ? "#FF6A2B" : "transparent",
          borderRadius: 3,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {verticalOn && <span style={{ color: "#1A0A02", fontSize: 10, fontWeight: 900, lineHeight: 1 }}>✓</span>}
      </span>
      <span className="whitespace-nowrap">TikTok · Reels</span>
    </button>
  );

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Box id={feed?.id} label="Feed" />
      <Box id={youtube?.id} label="YouTube" />
      <VerticalBox />
      {hasMultipleRatios && (
        <p style={{ color: "#FFB020" }} className="text-[10px] leading-snug flex items-start gap-1 w-full">
          <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
          Formatos diferentes — exportação usará {activeRatio}.
        </p>
      )}
    </div>
  );
}

function MetricCell({ label, value, accent = false, warn = false }) {
  const color = warn ? "#FFB020" : accent ? "#5DCAA5" : "#F5F5F7";
  return (
    <div style={{ background: "#0F0F13", border: "1px solid #1F1F26" }} className="rounded-lg py-2 px-1.5">
      <p style={{ color: "#6B6B75" }} className="text-[9px] font-bold uppercase tracking-wide">{label}</p>
      <p style={{ color }} className="text-sm font-bold tabular-nums leading-tight">{value}</p>
    </div>
  );
}

function QualityGauge({ score, label }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  return (
    <div className="flex flex-col items-center pt-2">
      <p style={{ color: "#9A9AA5" }} className="text-xs mb-2">Score de Qualidade</p>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="qualityGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FF6A2B" />
            <stop offset="100%" stopColor="#FF2FA0" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#1A0F28" strokeWidth="9" />
        <circle
          cx="50" cy="50" r={radius} fill="none"
          stroke="url(#qualityGradient)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="55" textAnchor="middle" fontSize="22" fontWeight="800" fill="#F5F5F7">{score}%</text>
      </svg>
      <span style={{ color: "#5DCAA5" }} className="text-xs font-semibold -mt-1">{label}</span>
    </div>
  );
}
