// User Style Learning — Fase 6 completa.
// Aprende com comportamento observado: accept/reject/modify em zoom, B-roll,
// captions, música, SFX, transições, textos. Usa frequency + consistency +
// recency + context + confidence.
//
// Regras de ouro (item 6.13):
//   1. Segurança/QC nunca sobrescrita
//   2. Integridade da fala nunca sobrescrita
//   3. Narrativa nunca sobrescrita
//   4. Intenção atual (config manual) sempre acima do estilo pessoal
//   5. Estilo pessoal só influencia quando confidence >= MEDIUM
//
// Persistência: localStorage (multi-user separando por email).

const STORAGE_PREFIX = "editoria.userStyle";
const SCHEMA_VERSION = "v2";
const MIN_SAMPLES_FOR_SIGNAL = 3;
const HIGH_CONFIDENCE_SAMPLES = 12;
const DECAY_RECENT_WEIGHT = 1.5;

const DIMENSIONS = [
  "cut_pace",         // agressividade de corte (0-1)
  "zoom_frequency",   // 0-1
  "broll_frequency",  // 0-1
  "caption_density",  // 0-1
  "caption_position", // "top" | "middle" | "bottom"
  "caption_size",     // 0-1
  "transition_intensity", // 0-1
  "music_frequency",  // 0-1
  "music_volume",     // 0-1
  "sfx_density",      // 0-1
];

const CONTEXTS = ["platform", "mode", "duration_band"];

/**
 * @typedef {Object} UserEvent
 * @property {string} kind             - "accept" | "reject" | "modify" | "restore" | "undo" | "delete" | "add"
 * @property {string} target           - "zoom" | "broll" | "caption" | "music" | "sfx" | "transition" | "cut" | "text"
 * @property {string} [primaryType]    - refinamento (ex: "long_pause", "filler")
 * @property {object} [before]         - estado antes da mudança
 * @property {object} [after]          - estado depois
 * @property {string} [context]        - "podcast|tiktokshop|..." (context bucket)
 * @property {string} [reason]         - "correction" | "preference" (item 6.15)
 * @property {number} timestamp
 */

function storageKey(userId = "default") {
  return `${STORAGE_PREFIX}.${SCHEMA_VERSION}.${userId}`;
}

export function loadUserStyle(userId = "default") {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return newEmptyStyle();
    const parsed = JSON.parse(raw);
    return normalize(parsed);
  } catch { return newEmptyStyle(); }
}

export function saveUserStyle(profile, userId = "default") {
  try { localStorage.setItem(storageKey(userId), JSON.stringify(profile)); } catch {}
}

export function resetUserStyle(userId = "default") {
  try { localStorage.removeItem(storageKey(userId)); } catch {}
}

function newEmptyStyle() {
  return {
    schemaVersion: SCHEMA_VERSION,
    videosAnalyzed: 0,
    events: [],
    dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, {
      value: null,       // valor aprendido
      samples: 0,        // quantidade de sinais
      confidence: "LOW", // LOW | MEDIUM | HIGH
      lastUpdated: null,
      byContext: {},     // { podcast: {value, samples}, tiktokshop: {...} }
    }])),
    suggestedProfile: null,
    updatedAt: new Date().toISOString(),
  };
}

function normalize(profile) {
  if (!profile) return newEmptyStyle();
  const base = newEmptyStyle();
  return {
    ...base,
    ...profile,
    dimensions: { ...base.dimensions, ...(profile.dimensions || {}) },
    events: Array.isArray(profile.events) ? profile.events.slice(-500) : [],
  };
}

/**
 * Registra um evento simples (accept/reject/modify).
 */
export function recordEvent(event, userId = "default") {
  const style = loadUserStyle(userId);
  const now = Date.now();
  const enriched = { ...event, timestamp: event.timestamp || now };
  style.events.push(enriched);
  // Cap em 500 eventos (rolling window)
  if (style.events.length > 500) style.events = style.events.slice(-500);
  recomputeDimensions(style);
  style.updatedAt = new Date().toISOString();
  saveUserStyle(style, userId);
  return style;
}

/**
 * Registra várias decisões de uma vez (compat com API antiga).
 */
export function recordUserDecisions(decisions = [], { userId = "default", context } = {}) {
  const style = loadUserStyle(userId);
  style.videosAnalyzed += 1;
  const now = Date.now();
  for (const d of decisions) {
    style.events.push({
      kind: d.userDecision === "keep" ? "restore" : (d.userDecision === "accept" ? "accept" : "modify"),
      target: mapPrimaryToTarget(d.primaryType),
      primaryType: d.primaryType,
      context,
      reason: "preference",
      timestamp: now,
    });
  }
  if (style.events.length > 500) style.events = style.events.slice(-500);
  recomputeDimensions(style);
  style.updatedAt = new Date().toISOString();
  saveUserStyle(style, userId);
  return style;
}

function mapPrimaryToTarget(primaryType) {
  if (!primaryType) return "cut";
  if (["long_pause", "silence", "filler", "hesitation", "cut"].includes(primaryType)) return "cut";
  if (["zoom", "zoom_event"].includes(primaryType)) return "zoom";
  if (["broll", "b_roll"].includes(primaryType)) return "broll";
  if (["caption", "captions"].includes(primaryType)) return "caption";
  if (["music"].includes(primaryType)) return "music";
  if (["sfx"].includes(primaryType)) return "sfx";
  if (["transition"].includes(primaryType)) return "transition";
  return "cut";
}

/**
 * Recomputa as dimensões a partir dos eventos, aplicando recency decay
 * e confidence baseado em samples.
 */
function recomputeDimensions(style) {
  const now = Date.now();
  const events = style.events || [];
  // Filtra events por target e calcula ratio accept vs reject/restore
  const dimByTarget = {
    zoom_frequency:        { target: "zoom" },
    broll_frequency:       { target: "broll" },
    caption_density:       { target: "caption", subKey: "wordCount" },
    caption_position:      { target: "caption", subKey: "position" },
    caption_size:          { target: "caption", subKey: "size" },
    transition_intensity:  { target: "transition" },
    music_frequency:       { target: "music" },
    music_volume:          { target: "music", subKey: "volume" },
    sfx_density:           { target: "sfx" },
    cut_pace:              { target: "cut" },
  };

  for (const [dim, cfg] of Object.entries(dimByTarget)) {
    const rel = events.filter((e) => {
      // Item 6.15 — não confundir correction com preference
      return e.target === cfg.target && (e.reason !== "correction");
    });
    if (!rel.length) continue;

    // Se dimensão tem subKey (position/size/volume), tira média/moda dos modify+add
    if (cfg.subKey) {
      const values = rel.map((e) => e.after?.[cfg.subKey] ?? e.before?.[cfg.subKey]).filter((v) => v != null);
      if (!values.length) continue;
      const isNumeric = typeof values[0] === "number";
      const value = isNumeric
        ? weightedAverage(values.map((v, i) => ({ v, ts: rel[i].timestamp })), now)
        : modeWithRecency(values.map((v, i) => ({ v, ts: rel[i].timestamp })), now);
      const samples = values.length;
      style.dimensions[dim] = {
        value,
        samples,
        confidence: samples >= HIGH_CONFIDENCE_SAMPLES ? "HIGH" : samples >= MIN_SAMPLES_FOR_SIGNAL ? "MEDIUM" : "LOW",
        lastUpdated: new Date().toISOString(),
        byContext: computeByContext(rel, cfg.subKey, isNumeric, now),
      };
      continue;
    }

    // Sem subKey — frequency = ratio accept / (accept + reject + restore + delete)
    const accepts = rel.filter((e) => e.kind === "accept" || e.kind === "add").length;
    const rejects = rel.filter((e) => e.kind === "reject" || e.kind === "restore" || e.kind === "delete").length;
    const total = accepts + rejects;
    if (total < MIN_SAMPLES_FOR_SIGNAL) continue;

    // Recency-weighted acceptance rate
    const now2 = now;
    const weighted = rel.reduce((acc, e) => {
      const ageDays = (now2 - e.timestamp) / 86400000;
      const weight = ageDays < 7 ? DECAY_RECENT_WEIGHT : Math.max(0.3, 1 - ageDays / 60);
      const isAccept = e.kind === "accept" || e.kind === "add";
      acc.total += weight;
      if (isAccept) acc.accept += weight;
      return acc;
    }, { accept: 0, total: 0 });

    const frequency = weighted.total ? Math.max(0, Math.min(1, weighted.accept / weighted.total)) : 0.5;
    style.dimensions[dim] = {
      value: Math.round(frequency * 100) / 100,
      samples: total,
      confidence: total >= HIGH_CONFIDENCE_SAMPLES ? "HIGH" : total >= MIN_SAMPLES_FOR_SIGNAL ? "MEDIUM" : "LOW",
      lastUpdated: new Date().toISOString(),
      byContext: computeByContext(rel, null, true, now),
    };
  }

  // Sugestão de profile
  const zoomF = style.dimensions.zoom_frequency?.value ?? 0.5;
  const brollF = style.dimensions.broll_frequency?.value ?? 0.5;
  const overall = (zoomF + brollF) / 2;
  if (style.videosAnalyzed >= 3) {
    if (overall > 0.75) style.suggestedProfile = "agressiva";
    else if (overall > 0.45) style.suggestedProfile = "equilibrada";
    else style.suggestedProfile = "leve";
  }
}

function weightedAverage(entries, now) {
  let sumV = 0, sumW = 0;
  for (const { v, ts } of entries) {
    const ageDays = (now - ts) / 86400000;
    const w = ageDays < 7 ? DECAY_RECENT_WEIGHT : Math.max(0.3, 1 - ageDays / 60);
    sumV += v * w;
    sumW += w;
  }
  return sumW ? Math.round((sumV / sumW) * 100) / 100 : 0;
}

function modeWithRecency(entries, now) {
  const counts = new Map();
  for (const { v, ts } of entries) {
    const ageDays = (now - ts) / 86400000;
    const w = ageDays < 7 ? DECAY_RECENT_WEIGHT : Math.max(0.3, 1 - ageDays / 60);
    counts.set(v, (counts.get(v) || 0) + w);
  }
  let bestV, bestW = 0;
  for (const [v, w] of counts) if (w > bestW) { bestV = v; bestW = w; }
  return bestV;
}

function computeByContext(events, subKey, isNumeric, now) {
  const byCtx = {};
  const ctxs = new Set(events.map((e) => e.context).filter(Boolean));
  for (const ctx of ctxs) {
    const rel = events.filter((e) => e.context === ctx);
    if (rel.length < MIN_SAMPLES_FOR_SIGNAL) continue;
    if (subKey) {
      const values = rel.map((e) => e.after?.[subKey] ?? e.before?.[subKey]).filter((v) => v != null);
      if (!values.length) continue;
      byCtx[ctx] = {
        value: isNumeric ? weightedAverage(values.map((v, i) => ({ v, ts: rel[i].timestamp })), now) : modeWithRecency(values.map((v, i) => ({ v, ts: rel[i].timestamp })), now),
        samples: values.length,
      };
    } else {
      const accepts = rel.filter((e) => e.kind === "accept" || e.kind === "add").length;
      const total = rel.length;
      byCtx[ctx] = { value: Math.round((accepts / total) * 100) / 100, samples: total };
    }
  }
  return byCtx;
}

/**
 * Aplica estilo aprendido a um profile do editingProfiles.
 * Item 6.13: apenas dimensões com confidence >= MEDIUM.
 *
 * @param {object} baseProfile
 * @param {object} [ctx]  - { platform, mode, duration }
 * @returns {object}
 */
export function applyUserStyleToProfile(baseProfile, ctx = {}) {
  const style = loadUserStyle();
  if (!style?.dimensions) return baseProfile;
  const dims = style.dimensions;
  const modified = { ...baseProfile, _userStyleApplied: false };

  const pick = (dimName) => {
    const d = dims[dimName];
    if (!d || d.confidence === "LOW") return null;
    // Preferência por context-specific
    if (ctx.mode && d.byContext?.[ctx.mode]?.samples >= MIN_SAMPLES_FOR_SIGNAL) {
      return d.byContext[ctx.mode].value;
    }
    return d.value;
  };

  // Zoom frequency
  const zoomF = pick("zoom_frequency");
  if (zoomF != null && Number.isFinite(zoomF)) {
    // Se usuário aceita zoom < 20%, cap zooms per min
    modified.zoomsPerMin = Math.round((baseProfile.zoomsPerMin || 7) * (0.4 + zoomF));
    modified._userStyleApplied = true;
  }

  // B-roll frequency
  const brollF = pick("broll_frequency");
  if (brollF != null && Number.isFinite(brollF)) {
    modified.brollPreference = brollF;
    modified._userStyleApplied = true;
  }

  // Caption position
  const capPos = pick("caption_position");
  if (capPos && ["top", "middle", "bottom"].includes(capPos)) {
    modified.preferredCaptionPosition = capPos;
    modified._userStyleApplied = true;
  }

  // Caption size
  const capSize = pick("caption_size");
  if (capSize != null && Number.isFinite(capSize)) {
    modified.preferredCaptionSize = capSize;
    modified._userStyleApplied = true;
  }

  // Music frequency
  const musicF = pick("music_frequency");
  if (musicF != null && Number.isFinite(musicF)) {
    modified.musicPreference = musicF;
    modified._userStyleApplied = true;
  }

  // SFX density
  const sfxD = pick("sfx_density");
  if (sfxD != null && Number.isFinite(sfxD)) {
    modified.sfxDensityFactor = sfxD;
    modified._userStyleApplied = true;
  }

  // Cut pace — soma small boost em thresholds
  const cutP = pick("cut_pace");
  if (cutP != null && Number.isFinite(cutP)) {
    const shift = (cutP - 0.5) * 0.1; // -0.05 a +0.05
    modified.executeThreshold = Math.min(0.98, Math.max(0.5, (baseProfile.executeThreshold || 0.8) - shift));
    modified.executeThresholdSemantic = Math.min(0.98, Math.max(0.6, (baseProfile.executeThresholdSemantic || 0.88) - shift));
    modified._userStyleApplied = true;
  }

  return modified;
}

/**
 * Snapshot resumido pra UI "Meu estilo de edição" (item 6.18).
 */
export function summarizeStyleForUI() {
  const style = loadUserStyle();
  if (!style || style.videosAnalyzed === 0) return null;

  const bucket = (v) => v == null ? "—" : v < 0.35 ? "Baixo" : v < 0.7 ? "Médio" : "Alto";
  const musicBucket = (v) => v == null ? "—" : v < 0.2 ? "Nunca" : v < 0.6 ? "Quando faz sentido" : "Frequente";
  const cutBucket = (v) => v == null ? "—" : v < 0.35 ? "Natural" : v < 0.7 ? "Equilibrado" : "Dinâmico";

  return {
    videosAnalyzed: style.videosAnalyzed,
    lastUpdated: style.updatedAt,
    cortes: cutBucket(style.dimensions.cut_pace?.value),
    zoom: bucket(style.dimensions.zoom_frequency?.value),
    broll: bucket(style.dimensions.broll_frequency?.value),
    musica: musicBucket(style.dimensions.music_frequency?.value),
    legendaPosicao: style.dimensions.caption_position?.value || "—",
    sfx: bucket(style.dimensions.sfx_density?.value),
    suggestedProfile: style.suggestedProfile,
    confidenceByDim: Object.fromEntries(
      Object.entries(style.dimensions).map(([k, v]) => [k, v?.confidence || "LOW"])
    ),
  };
}

/**
 * GLOBAL vs PERSONAL (item 6.20) — separação simples.
 * personalUserId isola por email; global usa "shared".
 * Nunca cruzamos dados entre usuários.
 */
export function withUser(userId) {
  return {
    load: () => loadUserStyle(userId),
    save: (p) => saveUserStyle(p, userId),
    reset: () => resetUserStyle(userId),
    record: (event) => recordEvent(event, userId),
    recordDecisions: (decisions, ctx) => recordUserDecisions(decisions, { userId, ...(ctx || {}) }),
  };
}
