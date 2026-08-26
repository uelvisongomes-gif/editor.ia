// Context Guard — semantic safety layer that runs BEFORE the EDL builder
// finalizes a cut. Every candidate that would remove/trim spoken content
// (semantic origin) is inspected here; the guard asks:
//
//   "If this segment disappears, does the previous sentence connect
//    naturally to the next one, and does the message still make sense?"
//
// If YES → contextSafe: true (cut allowed, subject to confidence bands).
// If NO  → contextSafe: false with a reason code; the caller demotes to
//          REVIEW (or KEEP for the most severe cases).
//
// This module is deterministic on purpose. The LLM-supplied
// dependsOnPrev flag is one input among several; we also apply regex
// checks on the text of the SURROUNDING sentences so we don't blindly
// trust the model for a call that the CTA might turn into gibberish.
//
// Technical cuts (silence / stutter / false_start / filler /
// abandoned_phrase / self_correction) are NOT subject to the guard —
// they never remove semantic meaning by design and stay conservative
// through the confidence bands.

// Words at the START of the "next" sentence that likely reference
// something in the sentence we're about to remove. If any of these lead
// the next sentence AND the candidate carried what they refer to, we
// keep the candidate.
const REFERENCE_HEADERS = [
  // pronomes anafóricos
  "ele", "ela", "eles", "elas", "isso", "aquilo", "esse", "essa",
  "isto", "esta", "este", "estes", "estas", "aqueles", "aquelas",
  // conectores que exigem antecedente
  "por isso", "então", "por causa disso", "portanto", "logo",
  "porque", "pois", "como resultado", "assim",
  // adversativos que dependem do argumento anterior
  "mas", "porém", "contudo", "entretanto", "todavia",
  // temporais que assumem ordem
  "depois", "antes", "primeiro", "segundo", "em seguida",
  "por fim", "por último", "finalmente",
  // referências explícitas ao que já foi dito
  "como eu falei", "como expliquei", "como disse", "como mencionei",
  "esse produto", "essa estratégia", "esse problema", "essa situação",
  "essa parte", "essa questão", "esse caso", "essa forma",
  "esse jeito", "esse resultado", "isso tudo",
];

// Words at the END of the "previous" sentence that suggest the previous
// sentence itself needs whatever the candidate would remove (e.g. a list
// that continues, a "porque..." with the reason ahead).
const CONTINUATION_TAILS = [
  "porque", "pois", "que", "onde", "quando", "como", "mas",
  "e", "ou", "então", "isso", "essa", "esse", "essas", "esses",
];

function normalize(text) {
  return (text || "").toLowerCase().replace(/[^a-záàâãéèêíïóôõöúçñ0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function startsWithReferenceHeader(text) {
  const t = normalize(text);
  if (!t) return null;
  // Longest matches first (multi-word first).
  const sorted = [...REFERENCE_HEADERS].sort((a, b) => b.length - a.length);
  // Look in the first 5 words — many references appear right after a
  // small preamble ("Sem isso...", "Por causa disso...", "A partir dele...").
  const words = t.split(" ");
  const prefix = words.slice(0, 5).join(" ");
  for (const ref of sorted) {
    if (prefix === ref || prefix.startsWith(ref + " ") || prefix.includes(" " + ref + " ") || prefix.endsWith(" " + ref)) {
      return ref;
    }
  }
  return null;
}

function endsWithContinuationTail(text) {
  const t = normalize(text);
  if (!t) return null;
  const lastWord = t.split(" ").pop();
  if (CONTINUATION_TAILS.includes(lastWord)) return lastWord;
  return null;
}

// Distances used to decide "prev" and "next" sentence.
const EPSILON = 0.05;

/**
 * Evaluate a single candidate cut against the surrounding sentences.
 *
 * @param {object} args
 * @param {{start:number,end:number,source:string,reason:string,text?:string}} args.candidate
 * @param {Array<{index:number,start:number,end:number,text:string,role:string,dependsOnPrev:boolean}>} args.sentences
 * @returns {{ok:boolean, reason?:string, matched?:string, bestIndexUsed?:boolean}}
 */
export function evaluateContext({ candidate, sentences }) {
  // Technical cuts never go through the semantic guard.
  if (["silence", "speechError"].includes(candidate.source)) {
    return { ok: true };
  }
  if (!sentences?.length) {
    // No semantic context to reason about; treat as safe (falls back to
    // confidence bands upstream, which is already conservative).
    return { ok: true };
  }

  // The candidate range likely spans exactly one sentence; find the sentence
  // that best matches (max overlap) and use its neighbors.
  let bestIdx = -1;
  let bestOverlap = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const overlap = Math.max(0, Math.min(s.end, candidate.end) - Math.max(s.start, candidate.start));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return { ok: true }; // no matching sentence — leave it to confidence bands.

  const target = sentences[bestIdx];
  const nextSentence = sentences[bestIdx + 1] || null;
  const prevSentence = sentences[bestIdx - 1] || null;

  // Rule 1: LLM said the next sentence depends on this one — hard block.
  if (nextSentence?.dependsOnPrev) {
    return { ok: false, reason: "next_segment_depends_on_removed_context" };
  }

  // Rule 2: The next sentence starts with a reference (isso, ele, portanto…)
  // — the reference likely points at content in the candidate. Block.
  if (nextSentence) {
    const matched = startsWithReferenceHeader(nextSentence.text);
    if (matched) {
      return { ok: false, reason: "next_segment_has_unresolved_reference", matched };
    }
  }

  // Rule 3: The previous sentence dangles on a continuation tail
  // (e.g. "…porque"), meaning it needs the removed candidate to complete.
  if (prevSentence) {
    const tail = endsWithContinuationTail(prevSentence.text);
    if (tail) {
      return { ok: false, reason: "previous_segment_expects_continuation", matched: tail };
    }
  }

  // Rule 4: The candidate itself carries a role we always protect
  // (belt-and-suspenders — the EDL builder also protects these).
  if (["hook", "cta"].includes(target.role)) {
    return { ok: false, reason: "role_protected", matched: target.role };
  }

  // Rule 4.4: ENUMERAÇÃO PARALELA — a sentença INTERNAMENTE lista várias
  // coisas com estrutura repetida ("falta X falta Y", "temos A, temos B",
  // "primeiro..., segundo..."). Isso é enumeração, não redundância —
  // cada item é uma informação diferente.
  {
    const t = normalize(target.text);
    const words = t.split(" ").filter(Boolean);
    // Detecta "palavra X palavra Y" onde a mesma palavra abre 2+ itens.
    // Ex: "falta técnica falta método" → "falta" repete no meio.
    for (let i = 0; i < words.length - 2; i++) {
      const anchor = words[i];
      if (anchor.length < 2) continue;
      for (let j = i + 2; j < words.length; j++) {
        if (words[j] === anchor) {
          // Encontrou duas ocorrências da mesma palavra abrindo itens.
          return { ok: false, reason: "internal_enumeration", matched: anchor };
        }
      }
    }
    // Detecta lista com vírgulas ou "e" entre itens curtos.
    const raw = (target.text || "").toLowerCase();
    const commaCount = (raw.match(/,/g) || []).length;
    if (commaCount >= 2 && words.length <= 10) {
      return { ok: false, reason: "internal_enumeration", matched: "vírgulas" };
    }
  }

  // Rule 4.5: ANÁFORA — se a sentença é parte de uma sequência de 2+
  // sentenças consecutivas que começam com a MESMA palavra (ou palavra
  // muito parecida), é recurso retórico. Não removível.
  {
    const idx = bestIdx;
    const targetFirstWord = normalize(target.text).split(" ")[0] || "";
    if (targetFirstWord && targetFirstWord.length >= 2) {
      // Conta vizinhos (antes E depois) que começam com a mesma palavra.
      let anaphoricSiblings = 0;
      for (let j = Math.max(0, idx - 2); j <= Math.min(sentences.length - 1, idx + 2); j++) {
        if (j === idx) continue;
        const s = sentences[j];
        const firstWord = normalize(s.text).split(" ")[0] || "";
        if (firstWord === targetFirstWord) anaphoricSiblings += 1;
      }
      if (anaphoricSiblings >= 1) {
        // Verifica também que a sentença é curta (anáforas costumam ser curtas)
        const wordCount = normalize(target.text).split(" ").filter(Boolean).length;
        if (wordCount <= 8) {
          return { ok: false, reason: "part_of_rhetorical_anaphora", matched: targetFirstWord };
        }
      }
    }
  }

  // Rule 5: Repetition specifically — only allow if the SUBSTITUTE (bestIndex
  // of its group) is textually close in length; otherwise the versions are
  // likely complementary, not redundant. The EDL builder is the one that
  // knows about groups; expose a hook so it can annotate the candidate
  // with repeatedGroupBestIndex when applicable.
  if (candidate.reason === "repeated_idea" && typeof candidate.repeatedGroupBestIndex === "number") {
    const bestSentence = sentences.find((s) => s.index === candidate.repeatedGroupBestIndex);
    if (bestSentence) {
      const a = normalize(target.text).length;
      const b = normalize(bestSentence.text).length;
      // If the two versions differ by more than 25% in length, they're
      // probably complements (one introduces, the other exemplifies).
      const ratio = a > 0 && b > 0 ? Math.min(a, b) / Math.max(a, b) : 0;
      if (ratio < 0.75) {
        return { ok: false, reason: "repetition_versions_look_complementary", matched: `${a}vs${b}` };
      }
    }
  }

  return { ok: true };
}
