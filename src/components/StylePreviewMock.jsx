// Preview procedural — mini-mock CSS animado que demonstra visualmente
// o LAYOUT/COMPOSIÇÃO real de cada estilo (não é só cor, é layout).
//
// Substituído automaticamente por vídeo real quando arquivo .mp4 existir.

import React from "react";

const CONFIGS = {
  creator_dynamic: {
    scenes: [
      { comp: "full_speaker", dur: 1400 },
      { comp: "top_media_bottom_speaker", dur: 1600 },
      { comp: "full_speaker", dur: 1200 },
      { comp: "big_number_composed", dur: 1400, num: "97%" },
    ],
    accent: "#FF6A2B", accentAlt: "#FF3EA5",
  },
  clean_pro: {
    scenes: [
      { comp: "full_speaker", dur: 3200 },
      { comp: "full_speaker_zoom", dur: 2400 },
    ],
    accent: "#3B82F6", accentAlt: "#1E293B",
  },
  viral_fast: {
    scenes: [
      { comp: "big_number_composed", dur: 900, num: "10K" },
      { comp: "top_media_bottom_speaker", dur: 900 },
      { comp: "picture_in_picture", dur: 800 },
      { comp: "full_broll", dur: 900 },
      { comp: "big_number_composed", dur: 900, num: "R$500" },
    ],
    accent: "#FFEB3B", accentAlt: "#FF0050",
  },
  storytelling: {
    scenes: [
      { comp: "full_speaker", dur: 2400 },
      { comp: "full_broll", dur: 2200 },
      { comp: "full_speaker", dur: 2200 },
    ],
    accent: "#D4A373", accentAlt: "#264653",
  },
  tiktok_shop: {
    scenes: [
      { comp: "top_media_bottom_speaker", dur: 1400 },
      { comp: "product_focus_mock", dur: 1600 },
      { comp: "big_number_composed", dur: 1200, num: "R$97" },
      { comp: "full_speaker", dur: 1000 },
    ],
    accent: "#00F2EA", accentAlt: "#FF0050",
  },
  podcast_clips: {
    scenes: [
      { comp: "full_speaker", dur: 2400 },
      { comp: "picture_in_picture", dur: 1800 },
      { comp: "full_speaker", dur: 2000 },
    ],
    accent: "#FBBF24", accentAlt: "#7C3AED",
  },
  tutorial_pro: {
    scenes: [
      { comp: "full_speaker", dur: 1400 },
      { comp: "step_mock", dur: 1400, num: "1" },
      { comp: "step_mock", dur: 1400, num: "2" },
      { comp: "step_mock", dur: 1200, num: "3" },
    ],
    accent: "#F59E0B", accentAlt: "#2563EB",
  },
  ugc_ads: {
    scenes: [
      { comp: "big_number_composed", dur: 900, num: "97%" },
      { comp: "top_media_bottom_speaker", dur: 1000 },
      { comp: "full_speaker", dur: 900 },
      { comp: "big_number_composed", dur: 1100, num: "CTA" },
    ],
    accent: "#FFEB3B", accentAlt: "#FF6A2B",
  },
};

export function StylePreviewMock({ presetId, animate = true }) {
  const cfg = CONFIGS[presetId] || CONFIGS.creator_dynamic;
  const totalDur = cfg.scenes.reduce((s, x) => s + x.dur, 0);
  const [sceneIdx, setSceneIdx] = React.useState(0);

  React.useEffect(() => {
    if (!animate) return;
    let cursor = 0;
    const timers = [];
    cfg.scenes.forEach((sc, i) => {
      const timer = setTimeout(() => setSceneIdx(i), cursor);
      timers.push(timer);
      cursor += sc.dur;
    });
    const loop = setTimeout(() => setSceneIdx(0), totalDur);
    timers.push(loop);
    return () => timers.forEach(clearTimeout);
  }, [presetId, animate, totalDur]);

  React.useEffect(() => {
    if (!animate) return;
    // Repeat forever
    const interval = setInterval(() => {
      let cursor = 0;
      cfg.scenes.forEach((sc, i) => {
        setTimeout(() => setSceneIdx(i), cursor);
        cursor += sc.dur;
      });
    }, totalDur);
    return () => clearInterval(interval);
  }, [presetId, animate, totalDur]);

  const scene = cfg.scenes[sceneIdx] || cfg.scenes[0];

  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "#0F0621",
      overflow: "hidden",
    }}>
      <Scene comp={scene.comp} num={scene.num} accent={cfg.accent} accentAlt={cfg.accentAlt} />
    </div>
  );
}

function Scene({ comp, num, accent, accentAlt }) {
  const speaker = (style) => (
    <div style={{
      position: "absolute", background: "linear-gradient(180deg,#2A1F3A,#1A0F28)",
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)",
      ...style,
    }}>
      <div style={{
        width: "40%", height: "45%",
        background: `radial-gradient(circle at 50% 40%, ${accent}66, transparent 65%)`,
        borderRadius: "50%",
      }} />
    </div>
  );
  const media = (style) => (
    <div style={{
      position: "absolute",
      background: `linear-gradient(140deg,${accent},${accentAlt})`,
      transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)",
      ...style,
    }}>
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.25), transparent 60%)",
      }} />
    </div>
  );
  const caption = () => (
    <div style={{
      position: "absolute", bottom: "6%", left: "10%", right: "10%",
      height: "10%", background: "rgba(0,0,0,0.65)",
      borderRadius: 4,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ width: "60%", height: "35%", background: "#F5EFFF", borderRadius: 2 }} />
    </div>
  );

  switch (comp) {
    case "full_speaker":
      return <>{speaker({ inset: 0 })}{caption()}</>;
    case "full_speaker_zoom":
      return <><div style={{ position: "absolute", inset: 0, transform: "scale(1.15)", transformOrigin: "50% 40%" }}>{speaker({ inset: 0 })}</div>{caption()}</>;
    case "top_media_bottom_speaker":
      return <>{media({ top: 0, left: 0, width: "100%", height: "50%" })}{speaker({ top: "50%", left: 0, width: "100%", height: "50%" })}{caption()}</>;
    case "picture_in_picture":
      return <>{speaker({ inset: 0 })}{media({ top: "6%", right: "6%", width: "36%", height: "26%", borderRadius: 6 })}{caption()}</>;
    case "full_broll":
      return <>{media({ inset: 0 })}{caption()}</>;
    case "big_number_composed":
      return (
        <>
          <div style={{
            position: "absolute", top: 0, left: 0, width: "100%", height: "55%",
            background: `linear-gradient(180deg, #08040E 40%, transparent 100%)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              fontFamily: "'Archivo Black',sans-serif",
              fontSize: 36, fontWeight: 900,
              background: `linear-gradient(92deg,${accent},${accentAlt})`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              textShadow: `0 2px 12px ${accentAlt}66`,
              animation: "fxBigNumber 0.5s cubic-bezier(0.34,1.56,0.64,1)",
            }}>{num || "97%"}</div>
          </div>
          {speaker({ top: "55%", left: 0, width: "100%", height: "45%" })}
          {caption()}
        </>
      );
    case "product_focus_mock":
      return (
        <>
          {media({ top: "15%", left: "15%", width: "70%", height: "55%", borderRadius: 12 })}
          {speaker({ top: "70%", left: 0, width: "100%", height: "30%" })}
          <div style={{ position: "absolute", top: "8%", right: "8%", background: accent, color: "#000", padding: "3px 8px", fontSize: 10, fontWeight: 900, borderRadius: 999 }}>-30%</div>
        </>
      );
    case "step_mock":
      return (
        <>
          {speaker({ inset: 0 })}
          <div style={{
            position: "absolute", top: "10%", left: "10%",
            background: `linear-gradient(92deg,${accent},${accentAlt})`, color: "#000",
            padding: "8px 14px", borderRadius: 6, fontFamily: "'Archivo Black',sans-serif",
            fontSize: 20, fontWeight: 900,
          }}>#{num}</div>
          {caption()}
        </>
      );
    default:
      return speaker({ inset: 0 });
  }
}
