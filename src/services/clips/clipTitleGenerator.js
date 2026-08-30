// Clip Title Generator — Items 7.19 e 7.20.
// Gera título curto interno + sugestão de hook text para overlay.
// Determinístico (regex heurístico). LLM opcional pode vir depois.

/**
 * @param {import("./clipDiscoveryEngine.js").ClipCandidate} clip
 * @returns {{ title: string, hookText: string, hashtags: string[] }}
 */
export function generateClipTitle(clip) {
  const hook = (clip.hook || clip.topic || "").trim();
  // Título: até 60 chars, tira aspas
  let title = hook.replace(/["""'`]/g, "").split(/[.!?]/)[0].trim();
  if (title.length > 60) title = title.slice(0, 57) + "...";
  if (!title) title = `Clip ${clip.momentType}`;
  // Hook text: até 40 chars, MAIÚSCULAS pra impacto
  let hookText = hook.split(/[.!?]/)[0].trim().slice(0, 40);
  if (hookText.length < 10 && clip.payoff) hookText = clip.payoff.slice(0, 40);
  hookText = hookText.toUpperCase();
  // Hashtags: baseadas no momentType
  const hashtagsByType = {
    INSIGHT: ["#dica", "#insight"],
    STORY: ["#storytime", "#historia"],
    TUTORIAL: ["#tutorial", "#comofazer"],
    OPINION: ["#opiniao"],
    CONTROVERSY: ["#polemica"],
    SURPRISE: ["#uau"],
    RESULT: ["#resultado", "#antesedepois"],
    BEFORE_AFTER: ["#transformacao"],
    PRODUCT: ["#produto", "#tiktokshop"],
    DEMONSTRATION: ["#demo"],
    FAQ: ["#faq"],
    TIP: ["#dica"],
    WARNING: ["#atencao"],
    MISTAKE: ["#erro", "#cuidado"],
    MYTH: ["#mito"],
    CTA: ["#linknabio"],
  };
  const hashtags = hashtagsByType[clip.momentType] || [];
  return { title, hookText, hashtags };
}
