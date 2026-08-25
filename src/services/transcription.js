// Transcription service — turns a video URL into an array of word-level
// timestamps. The default provider hits our Whisper-backed /api/transcribe
// endpoint, but the module exposes `transcribe(videoUrl, { provider })` so a
// different backend (Deepgram, local whisper.cpp, etc.) can be swapped in
// without any other module knowing.

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
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
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

async function whisperProvider(audioBlob) {
  const resp = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": audioBlob.type || "audio/webm" },
    body: audioBlob,
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error?.message || data?.error || "Falha na transcrição.");
  }
  return (data.words || []).map((w) => ({
    word: (w.word || "").trim(),
    start: Number(w.start),
    end: Number(w.end),
  }));
}

/**
 * @param {string} videoUrl - blob: or data: URL of the video
 * @param {object} [opts]
 * @param {(audio:Blob)=>Promise<Array<{word:string,start:number,end:number}>>} [opts.provider]
 * @returns {Promise<Array<{word:string,start:number,end:number}>>}
 */
export async function transcribe(videoUrl, { provider = whisperProvider } = {}) {
  const audio = await extractAudioBlob(videoUrl);
  const words = await provider(audio);
  if (!words.length) throw new Error("Nenhuma palavra foi reconhecida no áudio.");
  return words;
}

export { extractAudioBlob };
