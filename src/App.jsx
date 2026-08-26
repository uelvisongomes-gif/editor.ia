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
import { createHistory, pushState, undo as undoHistory, redo as redoHistory, canUndo, canRedo } from "./services/edlHistory.js";
import { createUsageLog, addUsageEntry, summarizeUsage } from "./services/usageLog.js";
import { buildProjectSnapshot, saveProject, loadProject, listProjects, deleteProject } from "./services/projectRepository.js";
import { stampsForProject } from "./services/pipelineVersion.js";
import { scaleAt as computeSmartZoomScale, ZOOM_LEVELS, BASE_ZOOM, effectiveScale } from "./services/smartZoom.js";

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
  { id: "classic", label: "Clássico", textColor: "#ffffff", strokeColor: null, strokeWidth: 0, bg: "rgba(0,0,0,0.65)", position: "bottom", uppercase: false, weight: 700, sizeScale: 1 },
  { id: "impact", label: "Destaque", textColor: "#ffffff", strokeColor: "#000000", strokeWidth: 8, bg: null, position: "middle-bottom", uppercase: true, weight: 900, sizeScale: 1.3 },
  { id: "yellow", label: "Amarelo impacto", textColor: "#FFD400", strokeColor: "#000000", strokeWidth: 8, bg: null, position: "bottom", uppercase: true, weight: 900, sizeScale: 1.2 },
  { id: "minimal", label: "Minimalista", textColor: "#ffffff", strokeColor: null, strokeWidth: 0, bg: null, position: "bottom", uppercase: false, weight: 500, sizeScale: 0.85 },
  { id: "brand", label: "Caixa laranja", textColor: "#1A0A02", strokeColor: null, strokeWidth: 0, bg: "#FF6A2B", position: "bottom", uppercase: false, weight: 700, sizeScale: 1 },
];

const CAPTION_Y_FRACTION = { bottom: 0.93, "middle-bottom": 0.78, top: 0.12, center: 0.5 };

const TRANSITION_DURATION = 0.25; // seconds each fade takes

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
  if (cue) {
    const text = captionStyle.uppercase ? cue.text.toUpperCase() : cue.text;
    const fontSize = Math.max(14, Math.round(canvas.height * 0.045 * captionStyle.sizeScale));
    ctx.font = `${captionStyle.weight} ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxWidth = canvas.width * 0.88;
    const yFrac = CAPTION_Y_FRACTION[captionStyle.position] ?? 0.93;
    const y = canvas.height * yFrac;
    const textWidth = Math.min(maxWidth, ctx.measureText(text).width);
    if (captionStyle.bg) {
      const paddingX = 20, paddingY = 12;
      const boxWidth = textWidth + paddingX * 2;
      const boxHeight = fontSize + paddingY * 2;
      const boxX = canvas.width / 2 - boxWidth / 2;
      const boxY = y - boxHeight / 2;
      ctx.fillStyle = captionStyle.bg;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
        ctx.fill();
      } else {
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
      }
    }
    if (captionStyle.strokeColor && captionStyle.strokeWidth) {
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.lineWidth = captionStyle.strokeWidth;
      ctx.strokeStyle = captionStyle.strokeColor;
      ctx.strokeText(text, canvas.width / 2, y, maxWidth);
    }
    ctx.fillStyle = captionStyle.textColor;
    ctx.fillText(text, canvas.width / 2, y, maxWidth);
  }
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
function buildCaptionsFromWords(words, maxWords = 8, pauseGap = 0.6) {
  const cues = [];
  let current = [];
  let cueStart = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (current.length === 0) cueStart = w.start;
    current.push(w);
    const next = words[i + 1];
    const gapToNext = next ? next.start - w.end : Infinity;
    const endsSentence = /[.!?]$/.test((w.word || "").trim());
    if (current.length >= maxWords || gapToNext >= pauseGap || endsSentence || !next) {
      cues.push({
        id: "cap-" + cues.length,
        start: cueStart,
        end: w.end,
        text: current.map((c) => c.word).join(" ").trim(),
      });
      current = [];
    }
  }
  return cues;
}

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

function computeTransitionOpacity(t, seg, segIndex, totalSegs, enabled, transitionDuration) {
  if (!enabled) return 1;
  let opacity = 1;
  const elapsed = t - seg.start;
  const remaining = seg.end - t;
  if (segIndex > 0 && elapsed < transitionDuration) {
    opacity = Math.min(opacity, elapsed / transitionDuration);
  }
  if (segIndex < totalSegs - 1 && remaining < transitionDuration) {
    opacity = Math.min(opacity, remaining / transitionDuration);
  }
  return Math.max(0, opacity);
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
  { id: "educacional", label: "Conteúdo Educacional", desc: "Otimizado para ensino", icon: GraduationCap, bias: { cutPace: ["medio"], zoom: ["leve", "medio"], color: ["neutro"], captionIds: ["classic", "brand"] } },
  { id: "autoridade", label: "Autoridade", desc: "Posicionamento e credibilidade", icon: ShieldCheck, bias: { cutPace: ["medio", "suave"], zoom: ["leve"], color: ["neutro", "frio"], captionIds: ["classic", "brand"] } },
  { id: "storytelling", label: "Storytelling", desc: "Histórias que prendem atenção", icon: BookOpen, bias: { cutPace: ["suave", "medio"], zoom: ["leve", "medio"], color: ["quente", "neutro"], captionIds: ["classic", "minimal"] } },
  { id: "viral", label: "Viral / Retenção", desc: "Máxima retenção e dinamismo", icon: Flame, bias: { cutPace: ["rapido"], zoom: ["forte"], color: ["vivido"], captionIds: ["impact", "yellow"] } },
  { id: "redes_sociais", label: "Redes Sociais", desc: "Reels, TikTok e Shorts", icon: Heart, bias: { cutPace: ["rapido", "medio"], zoom: ["medio", "forte"], color: ["vivido"], captionIds: ["yellow", "impact"] } },
  { id: "personal_brand", label: "Personal Brand", desc: "Conteúdo pessoal e autêntico", icon: User, bias: { cutPace: ["medio"], zoom: ["leve"], color: ["neutro", "quente"], captionIds: ["classic", "minimal"] } },
  { id: "vendas", label: "Vendas", desc: "Foco em conversão", icon: ShoppingBag, bias: { cutPace: ["rapido", "rapido", "medio"], zoom: ["forte", "medio"], color: ["vivido", "quente"], captionIds: ["impact", "yellow"] } },
  { id: "tiktok_shop", label: "TikTok Shop / Produto", desc: "Feito para vender produtos", icon: ShoppingCart, bias: { cutPace: ["rapido"], zoom: ["forte"], color: ["vivido"], captionIds: ["yellow", "impact"] } },
  { id: "marketing", label: "Marketing & Anúncios", desc: "Criativos para performance", icon: Megaphone, bias: { cutPace: ["rapido", "medio"], zoom: ["medio", "forte"], color: ["vivido", "quente"], captionIds: ["impact", "yellow"] } },
  { id: "podcast", label: "Podcast / Cortes", desc: "Conversas em conteúdo viral", icon: Mic, bias: { cutPace: ["suave", "medio"], zoom: ["leve"], color: ["neutro"], captionIds: ["classic", "minimal"] } },
  { id: "vlog", label: "Vlog / Lifestyle", desc: "Pessoal, dinâmico e imersivo", icon: Camera, bias: { cutPace: ["medio"], zoom: ["medio"], color: ["quente"], captionIds: ["minimal", "classic"] } },
  { id: "corporativo", label: "Corporativo", desc: "Profissional e institucional", icon: Briefcase, bias: { cutPace: ["medio", "suave"], zoom: ["leve"], color: ["neutro", "frio"], captionIds: ["classic", "brand"] } },
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
  { id: "volume", label: "Volume", icon: Volume2, desc: "Ajusta o volume do vídeo" },
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
  const [captionStyleId, setCaptionStyleId] = useState("classic");
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
  const [volume, setVolume] = useState(1);

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
  // Seleção de zoom para edição (excluir/redimensionar/mover/nível).
  const [selectedZoomId, setSelectedZoomId] = useState(null);
  // Ref pra drag state
  const zoomDragRef = useRef(null);
  // Toggle "Zoom automático" na Edição Inteligente. Padrão ON.
  const [smartZoomEnabled, setSmartZoomEnabled] = useState(true);
  // Legendas automáticas
  const [autoCaptionsEnabled, setAutoCaptionsEnabled] = useState(false);
  const [captionStylePreset, setCaptionStylePreset] = useState("classic");
  const [captionPosition, setCaptionPosition] = useState("bottom");
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
      setNarrativeTopic(result.semantic.topic || "");
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

  const activeCaption = captions.find((c) => currentTime >= c.start && currentTime < c.end);

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
      try {
        const vStream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
        const audioTracks = vStream.getAudioTracks();
        if (audioTracks.length) canvasStream.addTrack(audioTracks[0]);
      } catch (err) {
        console.warn("Áudio não incluído na exportação:", err);
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
        captions,
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
            <img src="/logo.png" alt="Logo CRIE Studios" className="w-12 h-12 rounded-full flex-shrink-0 object-cover" />
            <div>
              <h1 className="text-2xl font-extrabold leading-tight tracking-tight">EDIÇÃO DE VÍDEO COM IA</h1>
              <p style={{ color: "#9A9AA5" }} className="text-xs">Corte, remova silêncios e gere legendas direto no navegador</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {edl.length > 0 && (
              <>
                <button
                  onClick={doUndo}
                  disabled={!canUndo(history)}
                  title="Desfazer (Ctrl+Z)"
                  style={{ background: "#131318", border: "1px solid #1F1F26", color: canUndo(history) ? "#C9C9D1" : "#4A4A54" }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                >
                  <Undo2 size={13} /> ↶
                </button>
                <button
                  onClick={doRedo}
                  disabled={!canRedo(history)}
                  title="Refazer (Ctrl+Y)"
                  style={{ background: "#131318", border: "1px solid #1F1F26", color: canRedo(history) ? "#C9C9D1" : "#4A4A54" }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                >
                  <RotateCcw size={13} /> ↷
                </button>
              </>
            )}
            <button
              onClick={toggleExpand}
              style={{ background: "#131318", border: "1px solid #1F1F26", color: "#C9C9D1" }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
            >
              {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              {expanded ? "Sair da tela cheia" : "Tela cheia"}
            </button>
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
              style={{ background: "#FF6A2B", color: "#1A0A02" }}
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
                    style={{ background: "#1B1B21", color: "#F09595" }}
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
                    return (
                      <button
                        key={tool.id}
                        onClick={() => setActiveTool(tool.id)}
                        style={{
                          background: active ? "#FF6A2B" : "transparent",
                          color: active ? "#1A0A02" : "#F5F5F7",
                        }}
                        className="flex items-start gap-2.5 p-2.5 rounded-lg text-left transition-colors"
                      >
                        <Icon size={16} className="mt-0.5 flex-shrink-0" />
                        <span>
                          <span className="block text-sm font-medium">{tool.label}</span>
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

                  <p style={{ color: "#6B6B75" }} className="text-[10px] font-bold uppercase tracking-wide mb-1.5">
                    Intensidade da edição
                  </p>
                  <div className="flex flex-col gap-1.5 mb-3">
                    {Object.values(EDITING_PROFILES).map((p) => {
                      const selected = intensityId === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setIntensityId(p.id)}
                          disabled={smartBusy}
                          style={{
                            background: selected ? "#2A1B10" : "#0F0F13",
                            border: selected ? "1px solid #FF6A2B" : "1px solid #1F1F26",
                            opacity: smartBusy ? 0.6 : 1,
                          }}
                          className="text-left p-2 rounded-lg"
                        >
                          <span className="block text-xs font-semibold" style={{ color: "#F5F5F7" }}>
                            {p.label}
                          </span>
                          <span className="block text-[10px] leading-snug" style={{ color: "#9A9AA5" }}>
                            {p.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <label className="flex items-center justify-between mb-2 cursor-pointer" style={{ background: "#0F0F13", border: "1px solid #1F1F26" }} onClick={(e) => e.stopPropagation()}>
                    <span className="text-[11px] px-2 py-1.5" style={{ color: "#C9C9D1" }}>Zoom automático</span>
                    <span className="pr-2">
                      <input
                        type="checkbox"
                        checked={smartZoomEnabled}
                        onChange={(e) => setSmartZoomEnabled(e.target.checked)}
                      />
                    </span>
                  </label>
                  <label className="flex items-center justify-between mb-3 cursor-pointer" style={{ background: "#0F0F13", border: "1px solid #1F1F26" }} onClick={(e) => e.stopPropagation()}>
                    <span className="text-[11px] px-2 py-1.5" style={{ color: "#C9C9D1" }}>Legendas automáticas</span>
                    <span className="pr-2">
                      <input
                        type="checkbox"
                        checked={autoCaptionsEnabled}
                        onChange={(e) => {
                          setAutoCaptionsEnabled(e.target.checked);
                          // Se ligando agora e já temos words, gera na hora.
                          if (e.target.checked && wordTimestamps.length) {
                            setCaptions(buildCaptionsFromWords(wordTimestamps, 7));
                          } else if (!e.target.checked) {
                            setCaptions([]);
                          }
                        }}
                      />
                    </span>
                  </label>

                  {autoCaptionsEnabled && (
                    <div className="mb-3">
                      <p style={{ color: "#6B6B75" }} className="text-[10px] font-bold uppercase tracking-wide mb-1.5">Estilo da legenda</p>
                      <div className="grid grid-cols-2 gap-1.5 mb-2">
                        {CAPTION_STYLES.map((s) => {
                          const active = captionStylePreset === s.id;
                          return (
                            <button
                              key={s.id}
                              onClick={() => { setCaptionStylePreset(s.id); setCaptionStyleId(s.id); }}
                              style={{ background: active ? "#2A1B10" : "#0F0F13", border: active ? "1px solid #FF6A2B" : "1px solid #1F1F26" }}
                              className="text-left p-1.5 rounded-lg"
                            >
                              <div className="flex items-center justify-center h-8 mb-1" style={{ background: "#000", borderRadius: 3 }}>
                                <span
                                  style={{
                                    background: s.bg || "transparent",
                                    color: s.textColor,
                                    fontWeight: s.weight,
                                    fontSize: 9,
                                    textTransform: s.uppercase ? "uppercase" : "none",
                                    padding: s.bg ? "1px 5px" : 0,
                                    borderRadius: 2,
                                    WebkitTextStroke: s.strokeColor ? `0.7px ${s.strokeColor}` : undefined,
                                  }}
                                >
                                  Exemplo
                                </span>
                              </div>
                              <span className="block text-[10px] text-center" style={{ color: active ? "#FF6A2B" : "#C9C9D1" }}>{s.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-1 mb-1">
                        <span style={{ color: "#6B6B75" }} className="text-[10px]">Posição:</span>
                        {[["bottom", "Inferior"], ["middle-bottom", "Centro-baixo"], ["top", "Topo"]].map(([id, label]) => (
                          <button key={id} onClick={() => setCaptionPosition(id)}
                            style={{ background: captionPosition === id ? "#FF6A2B" : "#1B1B21", color: captionPosition === id ? "#1A0A02" : "#C9C9D1" }}
                            className="text-[10px] px-2 py-0.5 rounded font-semibold">
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={runIntelligentEdit}
                    disabled={smartBusy}
                    style={{ background: "#FF6A2B", color: "#1A0A02" }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold disabled:opacity-60"
                  >
                    {smartBusy ? <Loader2 size={16} className="animate-spin" /> : <Brain size={16} />}
                    {smartBusy ? "Analisando..." : (edl.length ? "Reanalisar com esse perfil" : "Analisar e propor cortes")}
                  </button>

                  {smartBusy && (
                    <>
                      <p style={{ color: "#9A9AA5" }} className="text-xs mt-2">{smartStep}</p>
                      <button
                        onClick={cancelIntelligentEdit}
                        style={{ background: "#1B1B21", color: "#F09595", border: "1px solid #5A2323" }}
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
                    style={{ background: "#FF6A2B", color: "#1A0A02" }}
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
                      <div style={{ background: "#1B1B21" }} className="w-full h-1.5 rounded-full overflow-hidden">
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
                    style={{ background: "#FF6A2B", color: "#1A0A02" }}
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
                    style={{ background: "#1B1B21" }}
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
                    style={{ background: "#FF6A2B", color: "#1A0A02" }}
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
                    style={{ background: "#1B1B21" }}
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
                    style={{ background: "#FF6A2B", color: "#1A0A02" }}
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
                    style={{ background: "#1B1B21" }}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium mt-1"
                  >
                    <Undo2 size={14} /> Redefinir
                  </button>
                </Panel>
              )}

              {activeTool === "volume" && (
                <Panel title="Volume">
                  <SliderRow label="Volume" value={Math.round(volume * 100)} min={0} max={100}
                    onChange={(v) => setVolume(v / 100)} suffix="%" />
                  <p style={{ color: "#9A9AA5" }} className="text-xs mt-1">
                    Afeta a pré-visualização. A exportação usa o áudio original do arquivo.
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
                <div style={{ background: "#131318", border: "1px solid #1F1F26", color: "#9A9AA5" }} className="rounded-xl p-3 text-xs">
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
                    const posStyle = {
                      bottom: { bottom: "6%" },
                      "middle-bottom": { bottom: "22%" },
                      top: { top: "8%" },
                      center: { top: "45%" },
                    }[captionStyle.position] || { bottom: "6%" };
                    const text = captionStyle.uppercase ? activeCaption.text.toUpperCase() : activeCaption.text;
                    return (
                      <div className="absolute left-1/2 -translate-x-1/2 max-w-[85%] text-center" style={posStyle}>
                        <span
                          style={{
                            background: captionStyle.bg || "transparent",
                            color: captionStyle.textColor,
                            fontWeight: captionStyle.weight,
                            fontSize: `${0.95 * captionStyle.sizeScale}rem`,
                            WebkitTextStroke: captionStyle.strokeColor ? `1.5px ${captionStyle.strokeColor}` : undefined,
                            padding: captionStyle.bg ? "6px 14px" : 0,
                            borderRadius: captionStyle.bg ? 8 : 0,
                          }}
                          className="inline-block"
                        >
                          {text}
                        </span>
                      </div>
                    );
                  })()}
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
                {!showingEdited && (
                  <div className="flex items-center gap-3 mt-3 flex-wrap">
                    <button onClick={togglePlay} style={{ background: "#FF6A2B", color: "#1A0A02" }} className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0">
                      {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                    </button>
                    <span style={{ color: "#9A9AA5" }} className="text-xs tabular-nums">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                    {edl.length > 0 && (
                      <button
                        onClick={togglePreviewMode}
                        title="Toca só os trechos que a IA decidiu manter, em sequência"
                        style={{
                          background: previewMode ? "#1F3C2A" : "#1B1B21",
                          color: previewMode ? "#A0E8C0" : "#C9C9D1",
                          border: previewMode ? "1px solid #2E6845" : "1px solid #26262E",
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold"
                      >
                        {previewMode ? "Prévia editada ligada" : "Ver versão editada"}
                      </button>
                    )}
                    <span style={{ color: "#5C5C66" }} className="text-xs truncate ml-auto">{fileName}</span>
                    <button onClick={() => fileInputRef.current?.click()} style={{ color: "#9A9AA5" }} className="text-xs flex items-center gap-1 flex-shrink-0">
                      <X size={12} /> Trocar vídeo
                    </button>
                    <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                  </div>
                )}
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
                      style={{ background: "#1B1B21", color: "#C9C9D1" }}
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
                  <button onClick={handleCut} style={{ background: "#1B1B21" }} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium">
                    <Scissors size={13} /> Cortar no ponto atual
                  </button>
                  <button onClick={resetSegments} style={{ background: "#1B1B21" }} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium">
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
                          <div style={{ background: "#1B1B21" }} className="w-full h-3 rounded" />
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
                        <div className="relative w-full h-full">
                          {segments.map((seg) => {
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
                            return (
                              <div
                                key={seg.id}
                                onClick={(e) => { e.stopPropagation(); setSelectedSegId(seg.id); handleSeek(seg.start); }}
                                title={seg.action === "review" ? "A revisar" : seg.deleted ? "Será cortado" : "Mantido"}
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
                              />
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
                          {captions.map((c) => (
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
                          {smartZoomEnabled && zoomEvents.map((ev) => {
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
                    <div className="absolute left-0 right-0" style={{ top: 178, height: 18 }}>
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
                          <button onClick={() => handlePlayRange(ev.start - 0.2, ev.end + 0.2)} style={{ background: "#1B1B21", color: "#C9C9D1" }} className="flex items-center gap-1 px-2 py-1 rounded text-[10px]">
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
                              style={{ background: active ? "#FF6A2B" : "#1B1B21", color: active ? "#1A0A02" : "#C9C9D1" }}
                              className="text-[10px] px-2 py-0.5 rounded font-semibold">
                              {spec.label}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => updateZoomEvent(ev.id, isOut ? { mode: "zoom_in", scale: ZOOM_LEVELS.medium.value, level: "medium" } : { mode: "zoom_out", scale: ZOOM_LEVELS.out_light.value, level: "out_light" })}
                          style={{ background: "#1B1B21", color: "#78BAFF" }}
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
              {debugMode && (edl.length > 0 || smartBusy) && (
                <Panel title="Diagnóstico do pipeline">
                  <p style={{ color: "#9A9AA5" }} className="text-[11px] mb-2 leading-snug">
                    Rebobina o vídeo até o início do erro, clique <strong>Marcar início</strong>,
                    depois até o fim e clique <strong>Marcar fim</strong>. O sistema captura o que
                    o pipeline viu naquela janela.
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap mb-2">
                    <button onClick={markMissedStart}
                      style={{ background: "#1B1B21", color: markStart != null ? "#5DCAA5" : "#C9C9D1" }}
                      className="text-[11px] px-2 py-1 rounded-md font-semibold">
                      {markStart != null ? `Início: ${markStart.toFixed(2)}s` : "Marcar início"}
                    </button>
                    <button onClick={markMissedEnd}
                      disabled={markStart == null}
                      style={{ background: markStart != null ? "#FF6A2B" : "#1B1B21", color: markStart != null ? "#1A0A02" : "#4A4A54" }}
                      className="text-[11px] px-2 py-1 rounded-md font-semibold">
                      Marcar fim
                    </button>
                    <button onClick={exportDiagnostic}
                      style={{ background: "#1B1B21", color: "#78BAFF" }}
                      className="text-[11px] px-2 py-1 rounded-md font-semibold">
                      ⇩ Exportar JSON
                    </button>
                  </div>
                  {missedDetections.length > 0 && (
                    <div style={{ background: "#0F0F13", border: "1px solid #1F1F26" }} className="rounded-lg p-2 mb-2">
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ color: "#FFB020" }} className="text-[10px] font-bold uppercase">Erros não detectados ({missedDetections.length})</span>
                        <button onClick={clearMissedDetections} style={{ color: "#F09595" }} className="text-[10px]">limpar</button>
                      </div>
                      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                        {missedDetections.map((m) => (
                          <div key={m.id} className="text-[10px]" style={{ color: "#C9C9D1" }}>
                            <div className="flex justify-between">
                              <span style={{ color: "#F5F5F7" }}>{m.start.toFixed(2)}→{m.end.toFixed(2)} ({m.duration}s)</span>
                              <span style={{ color: m.detectedBySpeechError || m.detectedBySemantic || m.detectedBySilence ? "#5DCAA5" : "#F09595" }}>
                                {m.detectedBySpeechError || m.detectedBySemantic || m.detectedBySilence ? "detectado" : "NÃO detectado"}
                              </span>
                            </div>
                            {m.rawText && <div style={{ color: "#9A9AA5" }} className="italic">"{m.rawText.slice(0, 120)}"</div>}
                            <div style={{ color: "#6B6B75" }}>
                              speechError:{m.detectedBySpeechError ? "sim" : "não"} · semantic:{m.detectedBySemantic ? "sim" : "não"} · silence:{m.detectedBySilence ? "sim" : "não"} · candidatos:{m.candidatesInRange.length}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Panel>
              )}

              {(edl.length > 0 || smartBusy) && (
                <Panel title="Problemas encontrados">
                  <div className="flex items-center justify-between mb-3 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={doUndo}
                        disabled={!canUndo(history)}
                        title="Desfazer (Ctrl+Z)"
                        style={{ background: "#1B1B21", color: canUndo(history) ? "#C9C9D1" : "#4A4A54" }}
                        className="px-2 py-1 rounded-md font-semibold flex items-center gap-1"
                      >
                        <Undo2 size={12} /> Desfazer
                      </button>
                      <button
                        onClick={doRedo}
                        disabled={!canRedo(history)}
                        title="Refazer (Ctrl+Y)"
                        style={{ background: "#1B1B21", color: canRedo(history) ? "#C9C9D1" : "#4A4A54" }}
                        className="px-2 py-1 rounded-md font-semibold flex items-center gap-1"
                      >
                        <RotateCcw size={12} /> Refazer
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
                </Panel>
              )}
              <Panel title="Exportação">
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {["720p", "1080p", "4K"].map((r) => (
                    <button
                      key={r}
                      onClick={() => setResolution(r)}
                      style={{ background: resolution === r ? "#FF6A2B" : "#1B1B21", color: resolution === r ? "#1A0A02" : "#F5F5F7" }}
                      className="py-1.5 rounded-lg text-xs font-semibold"
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div className="flex items-start gap-1.5 mb-3" style={{ color: "#9A9AA5" }}>
                  <Info size={12} className="mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] leading-snug">
                    Processado no seu navegador. O arquivo gerado é .webm (compatível com a maioria dos players e navegadores).
                  </p>
                </div>
                <button
                  onClick={handleExport}
                  disabled={isExporting}
                  style={{ background: "#FF6A2B", color: "#1A0A02" }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold disabled:opacity-60"
                >
                  {isExporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  {isExporting ? `Exportando... ${exportProgress}%` : "Exportar vídeo"}
                </button>
                {isExporting && (
                  <div style={{ background: "#1B1B21" }} className="w-full h-1.5 rounded-full mt-2 overflow-hidden">
                    <div style={{ background: "#FF6A2B", width: `${exportProgress}%` }} className="h-full transition-all" />
                  </div>
                )}
                {exportError && <p style={{ color: "#FF8A8A" }} className="text-xs mt-2">{exportError}</p>}
                {exportedUrl && (
                  <a href={exportedUrl} download={(fileName.replace(/\.[^.]+$/, "") || "video") + "-editado.webm"}
                    style={{ background: "#1B1B21", color: "#5DCAA5" }}
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

              <div style={{ background: "#131318", border: "1px solid #1F1F26" }} className="rounded-xl p-3.5">
                <span
                  style={{ background: "#FF6A2B", color: "#1A0A02" }}
                  className="inline-block text-xs font-bold px-2.5 py-1 rounded-md mb-3"
                >
                  ESTATÍSTICAS
                </span>
                <StatRow label="Duração original" value={formatTime(duration)} />
                <StatRow label="Duração final" value={formatTime(finalDuration)} />
                <StatRow label="Redução" value={`${Math.max(0, reductionPct)}%`} />
                <StatRow label="Resolução de saída" value={resolution} />
                <StatRow label="Cortes aplicados" value={cutsApplied} />
                <StatRow label="Trechos removidos" value={removedCount} />
                <StatRow label="Legendas geradas" value={captions.length} />
                <StatRow label="Cor ajustada" value={colorIsAdjusted ? "Sim" : "Padrão"} />
                <QualityGauge score={qualityScore} label={qualityLabel} />
              </div>
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
            background: "#1B1B21",
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
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: "#131318", border: "1px solid #1F1F26" }} className="rounded-xl p-3.5">
      {title && <h3 className="text-sm font-semibold mb-3">{title}</h3>}
      {children}
    </div>
  );
}

function Badge({ icon, label }) {
  return (
    <span style={{ background: "#131318", border: "1px solid #1F1F26", color: "#C9C9D1" }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium">
      {icon} {label}
    </span>
  );
}

function StepLabel({ n, text }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <span
        style={{ background: "#FF6A2B", color: "#1A0A02" }}
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
  const groups = platforms.reduce((acc, p) => {
    const key = `${p.ratio[0]}:${p.ratio[1]}`;
    (acc[key] = acc[key] || []).push(p);
    return acc;
  }, {});
  const orderedKeys = Object.keys(groups).sort((a, b) => {
    const [aw] = a.split(":").map(Number);
    const [bw] = b.split(":").map(Number);
    return aw - bw; // 1:1 primeiro, 9:16, 16:9
  });
  const selectedRatios = new Set(
    platforms.filter((p) => selected.includes(p.id)).map((p) => `${p.ratio[0]}:${p.ratio[1]}`)
  );
  const activeRatio = (() => {
    const first = platforms.find((p) => p.id === selected[0]);
    return first ? `${first.ratio[0]}:${first.ratio[1]}` : null;
  })();
  const hasMultipleRatios = selectedRatios.size > 1;
  return (
    <div className="flex flex-col gap-2">
      {orderedKeys.map((ratio) => (
        <div key={ratio} className="flex items-center gap-2 flex-wrap">
          <span
            title={ratio === activeRatio ? "Formato ativo de exportação" : "Formato disponível"}
            style={{
              color: ratio === activeRatio ? "#FF6A2B" : "#6B6B75",
              background: ratio === activeRatio ? "#2A1B10" : "#0F0F13",
              border: ratio === activeRatio ? "1px solid #FF6A2B" : "1px solid #1F1F26",
            }}
            className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded"
          >
            {ratio}
          </span>
          <div className="flex flex-wrap gap-1">
            {groups[ratio].map((p) => {
              const on = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => onToggle(p.id)}
                  title={p.label}
                  style={{
                    background: on ? "#FF6A2B" : "#1B1B21",
                    color: on ? "#1A0A02" : "#C9C9D1",
                  }}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {hasMultipleRatios && (
        <p style={{ color: "#FFB020" }} className="text-[10px] leading-snug flex items-start gap-1">
          <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
          Você marcou destinos com proporções diferentes. A exportação vai usar {activeRatio} (a primeira marcada).
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
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#1B1B21" strokeWidth="9" />
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
