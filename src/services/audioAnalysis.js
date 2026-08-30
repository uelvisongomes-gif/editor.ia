// Reads the video's audio track and produces a bucketed peak-envelope
// waveform. Used both for the UI's visual waveform and as the raw signal
// for silence detection.

export async function analyzeWaveform(videoUrl, duration, { returnAudioBuffer = false } = {}) {
  const resp = await fetch(videoUrl);
  const arrayBuf = await resp.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuf);
    const channel = audioBuffer.getChannelData(0);
    const sr = audioBuffer.sampleRate;
    const bucketCount = Math.min(600, Math.max(120, Math.floor(duration * 6)));
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
    if (returnAudioBuffer) return { waveform: buckets, audioBuffer };
    return buckets;
  } finally {
    ctx.close();
  }
}
