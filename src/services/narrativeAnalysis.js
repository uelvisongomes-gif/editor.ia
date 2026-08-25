// Turns the classified sentence list from semanticAnalysis into a coherent
// narrative map (Hook / Context / Development / Points / Conclusion / CTA).
// No LLM call needed here — this is a deterministic reduction over roles
// that were already assigned upstream.

/**
 * @param {ReturnType<import('./semanticAnalysis.js').analyzeSemantics> extends Promise<infer T> ? T : never} semantic
 */
export function buildNarrativeMap(semantic) {
  const buckets = {
    hook: [],
    context: [],
    development: [],
    points: [],
    conclusion: [],
    cta: [],
    aside: [],
    offTopic: [],
  };
  for (const s of semantic.sentences) {
    switch (s.role) {
      case "hook":        buckets.hook.push(s); break;
      case "context":     buckets.context.push(s); break;
      case "development": buckets.development.push(s); break;
      case "point":       buckets.points.push(s); break;
      case "conclusion":  buckets.conclusion.push(s); break;
      case "cta":         buckets.cta.push(s); break;
      case "aside":       buckets.aside.push(s); break;
      case "off_topic":   buckets.offTopic.push(s); break;
      default:            buckets.development.push(s);
    }
  }
  return {
    topic: semantic.topic,
    buckets,
    // Total spoken time per role — used to keep at least one hook/CTA around
    // when the editing profile is aggressive.
    durations: Object.fromEntries(
      Object.entries(buckets).map(([k, arr]) => [k, arr.reduce((a, s) => a + (s.end - s.start), 0)])
    ),
  };
}
