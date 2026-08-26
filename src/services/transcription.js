// Transcription service — video URL → words[] with timestamps.
// The default provider hits our Whisper-backed /api/transcribe endpoint.
// Both onUsage(entry) and signal (AbortController) are propagated so the
// pipeline can measure cost and let the user cancel a long transcription.

import { getAccessToken } from "./auth/authProvider.js";

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

async function whisperProvider(audioBlob, { signal, onUsage } = {}) {
  const token = await getAccessToken();
  const headers = { "Content-Type": audioBlob.type || "audio/webm" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch("/api/transcribe", {
    method: "POST",
    headers,
    body: audioBlob,
    signal,
  });
  if (resp.status === 401) throw new Error("Você precisa entrar para transcrever.");
  if (resp.status === 429) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data?.error || "Quota mensal de transcrição esgotada.");
  }
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error?.message || data?.error || "Falha na transcrição.");
  }
  if (data._usage && typeof onUsage === "function") {
    try {
      onUsage({ operation: "transcription", ...data._usage });
    } catch (err) {
      console.warn("onUsage callback failed:", err);
    }
  }
  const words = (data.words || []).map((w) => ({
    word: (w.word || "").trim(),
    start: Number(w.start),
    end: Number(w.end),
  }));
  if (typeof console !== "undefined" && data._source) {
    console.log(`[transcription] source=${data._source} rawWords=${data._rawWhisperWords} finalWords=${words.length}`);
  }
  return words;
}

export async function transcribe(videoUrl, { provider = whisperProvider, signal, onUsage } = {}) {
  const audio = await extractAudioBlob(videoUrl);
  if (signal?.aborted) throw new DOMException("Cancelado pelo usuário", "AbortError");
  const words = await provider(audio, { signal, onUsage });
  if (!words.length) throw new Error("Nenhuma palavra foi reconhecida no áudio.");
  return words;
}

export { extractAudioBlob };
