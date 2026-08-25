// Silence detection that is *aware of the speech*: a pause is only removable
// if there is no speech during it. We also refuse to remove short pauses
// (< profile.minSilenceDur) and prefer to snap the removed range to the exact
// gap between the two surrounding spoken words so we never eat syllables.

/**
 * @param {Array<{start:number,end:number,level:number}>} waveform
 * @param {Array<{word:string,start:number,end:number}>} words
 * @param {{silenceThreshold:number, minSilenceDur:number}} profile
 * @returns {Array<{start:number,end:number,confidence:number,reason:'long_pause'}>}
 */
export function detectSilences(waveform, words, profile) {
  if (!waveform?.length) return [];
  const threshold = profile.silenceThreshold ?? 0.022;
  const minDur = profile.minSilenceDur ?? 0.7;

  // 1. Find raw quiet windows from the waveform.
  const rawRanges = [];
  let start = null;
  for (let i = 0; i < waveform.length; i++) {
    const isSilent = waveform[i].level < threshold;
    if (isSilent && start === null) start = waveform[i].start;
    if ((!isSilent || i === waveform.length - 1) && start !== null) {
      const end = isSilent ? waveform[i].end : waveform[i].start;
      if (end - start >= minDur) rawRanges.push([start, end]);
      start = null;
    }
  }

  if (!words?.length) {
    return rawRanges.map(([s, e]) => ({ start: s, end: e, confidence: 0.7, reason: "long_pause" }));
  }

  // 2. Refine using speech: only consider gaps that fall entirely between
  //    two spoken words, and snap to the true silent gap between them.
  const results = [];
  for (const [rs, re] of rawRanges) {
    const beforeWord = [...words].reverse().find((w) => w.end <= rs + 0.05);
    const afterWord = words.find((w) => w.start >= re - 0.05);
    if (!beforeWord || !afterWord) {
      // Silence at the very head or tail — safe to trim.
      results.push({ start: rs, end: re, confidence: 0.75, reason: "long_pause" });
      continue;
    }
    const gapStart = beforeWord.end;
    const gapEnd = afterWord.start;
    const gapLen = gapEnd - gapStart;
    if (gapLen < minDur) continue; // not really a pause once we align to speech
    // Preserve a small breath around the words so speech doesn't feel clipped.
    const breath = 0.08;
    const trimStart = Math.max(rs, gapStart + breath);
    const trimEnd = Math.min(re, gapEnd - breath);
    if (trimEnd - trimStart < minDur * 0.6) continue;
    // Confidence scales with pause length (longer = more certainly dead air).
    const confidence = Math.min(0.95, 0.6 + (gapLen - minDur) * 0.15);
    results.push({ start: trimStart, end: trimEnd, confidence, reason: "long_pause" });
  }
  return results;
}
