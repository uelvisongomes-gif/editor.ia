// Transcription endpoint. DUAL-MODEL:
//   1. gpt-4o-mini-transcribe → texto FIEL (preserva disfluências, sem
//      normalizar). Sem timestamps.
//   2. whisper-1 → words com timestamps. Normalização acontece, mas OK
//      porque só usamos os TIMINGS.
// Depois alinhamos: onde gpt-4o tem mais palavras que whisper (repetição
// escondida), dividimos o tempo do whisper entre as palavras extras.
// Se gpt-4o falhar, cai pra só whisper (funcionalidade equivalente ao
// que existia antes).

import { authGuard } from "./_lib/authGuard.js";

export const config = { api: { bodyParser: false } };

const VERBATIM_PROMPT =
  "Transcrição VERBATIM em português brasileiro. Preserve TODAS as disfluências exatamente como faladas: repetições (na na, das das, eu eu, o o, é é), muletas (é, tipo, né, hum, ah, eh), hesitações (ééé, aaah, uhm), falsos começos (isso é... quer dizer... isso é), palavras cortadas ou incompletas. Não junte. Não normalize. Se ouvir a palavra duas vezes, escreva duas vezes.";

async function callOpenAI(model, buffer, contentType, { verbose } = {}) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), "audio.webm");
  form.append("model", model);
  form.append("temperature", "0");
  form.append("prompt", VERBATIM_PROMPT);
  form.append("language", "pt");
  if (verbose) {
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
  } else {
    form.append("response_format", "json");
  }
  const t0 = Date.now();
  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  const data = await resp.json();
  return { ok: resp.ok, status: resp.status, data, latencyMs: Date.now() - t0 };
}

// Normaliza palavra pra comparação (case-fold, sem pontuação, sem acentos).
function norm(w) {
  return (w || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[.,!?;:"'()]/g, "")
    .trim();
}

// Alinha o texto verbatim do gpt-4o com os timings do whisper. Quando o
// gpt tem palavras extras (repetição escondida), pega o tempo da palavra
// esticada do whisper e divide.
function alignWords(gptText, whisperWords) {
  const gptTokens = (gptText || "").split(/\s+/).filter(Boolean);
  if (!gptTokens.length || !whisperWords?.length) return whisperWords || [];

  const result = [];
  let gi = 0;
  let wi = 0;
  while (gi < gptTokens.length && wi < whisperWords.length) {
    const g = norm(gptTokens[gi]);
    const w = norm(whisperWords[wi].word);
    if (!g) { gi++; continue; }
    if (!w) { wi++; continue; }
    if (g === w) {
      result.push({
        word: gptTokens[gi],
        start: whisperWords[wi].start,
        end: whisperWords[wi].end,
      });
      gi++; wi++;
      continue;
    }
    // Look-ahead: whisper[wi] aparece nos próximos 5 tokens do gpt?
    let gLook = -1;
    for (let k = 1; k <= 5 && gi + k < gptTokens.length; k++) {
      if (norm(gptTokens[gi + k]) === w) { gLook = k; break; }
    }
    if (gLook > 0) {
      // Gpt tem `gLook` palavras extras antes de bater com whisper[wi].
      // Escolhe entre pegar tempo da palavra ANTERIOR ou da ATUAL — a
      // que estiver mais esticada. Caso comum: whisper.das = 1.74s pra
      // acomodar "na maioria das" (2 extras + das). Sem isso, extras
      // ficariam empilhadas em 0.05s.
      const extras = gptTokens.slice(gi, gi + gLook);
      const prev = whisperWords[wi - 1];
      const cur = whisperWords[wi];
      const prevDur = prev ? (prev.end - prev.start) : 0;
      const curDur = cur.end - cur.start;
      let availStart, availEnd;
      if (curDur > 0.7 && curDur >= prevDur) {
        // Palavra ATUAL esticada — pega a cabeça, deixa pelo menos 0.2s
        // pro áudio real da palavra atual no fim.
        const holdOut = Math.min(0.25, curDur * 0.25);
        availStart = cur.start;
        availEnd = cur.end - holdOut;
        cur.start = availEnd; // atualiza start da atual pro depois dos extras
      } else if (prevDur > 0.4) {
        // Palavra anterior esticada — pega a cauda dela.
        availStart = prev.start + Math.min(0.25, prevDur * 0.3);
        availEnd = prev.end;
        if (result.length > 0 && Math.abs(result[result.length - 1].end - prev.end) < 0.01) {
          result[result.length - 1].end = availStart;
        }
      } else {
        // Nenhuma cauda/cabeça — janelinha entre elas.
        availStart = Math.max(prev ? prev.end : 0, cur.start - 0.5);
        availEnd = cur.start;
      }
      const span = Math.max(0.05, availEnd - availStart);
      const slice = span / extras.length;
      for (let k = 0; k < extras.length; k++) {
        result.push({
          word: extras[k],
          start: availStart + slice * k,
          end: availStart + slice * (k + 1),
        });
      }
      gi += gLook;
      continue;
    }
    // Look-ahead reverso: gpt[gi] aparece nos próximos 3 tokens do whisper?
    let wLook = -1;
    for (let k = 1; k <= 3 && wi + k < whisperWords.length; k++) {
      if (norm(whisperWords[wi + k].word) === g) { wLook = k; break; }
    }
    if (wLook > 0) {
      // Whisper tem palavras extras (sujeira) — pula.
      wi += wLook;
      continue;
    }
    // Sem match — usa o whisper como está e avança ambos.
    result.push({
      word: whisperWords[wi].word,
      start: whisperWords[wi].start,
      end: whisperWords[wi].end,
    });
    gi++; wi++;
  }
  // Flush do whisper restante.
  while (wi < whisperWords.length) {
    result.push({
      word: whisperWords[wi].word,
      start: whisperWords[wi].start,
      end: whisperWords[wi].end,
    });
    wi++;
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({
      error: "OPENAI_API_KEY não está configurada nas variáveis de ambiente do projeto na Vercel.",
    });
    return;
  }

  const guard = await authGuard(req, res, { require: "transcriptionMinutes" });
  if (!guard) return;

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    if (!buffer.length) {
      res.status(400).json({ error: "Nenhum áudio recebido." });
      return;
    }

    const contentType = req.headers["content-type"] || "audio/webm";

    // Chama os dois em paralelo. gpt-4o-mini-transcribe é ~50% mais barato
    // que whisper-1 (por minuto) e captura muito melhor as disfluências.
    const [gpt4oResult, whisperResult] = await Promise.all([
      callOpenAI("gpt-4o-mini-transcribe", buffer, contentType, { verbose: false }).catch((err) => {
        console.warn("gpt-4o-mini-transcribe failed:", err?.message || err);
        return { ok: false };
      }),
      callOpenAI("whisper-1", buffer, contentType, { verbose: true }),
    ]);

    if (!whisperResult.ok) {
      res.status(whisperResult.status || 500).json({
        error: whisperResult.data?.error?.message || "Falha na transcrição (whisper).",
      });
      return;
    }

    const whisperWords = (whisperResult.data.words || []).map((w) => ({
      word: (w.word || "").trim(),
      start: Number(w.start),
      end: Number(w.end),
    }));

    let finalWords = whisperWords;
    let source = "whisper-1";
    let gptText = null;

    if (gpt4oResult?.ok && typeof gpt4oResult.data?.text === "string") {
      gptText = gpt4oResult.data.text;
      const aligned = alignWords(gptText, whisperWords);
      if (aligned.length >= whisperWords.length) {
        finalWords = aligned;
        source = "gpt-4o-mini+whisper-1";
      }
    }

    const audioSec = typeof whisperResult.data.duration === "number" ? whisperResult.data.duration : 0;
    const audioMinutes = audioSec / 60;
    await guard.tick({
      transcriptionMinutes: audioMinutes,
      meta: { audioBytes: buffer.length, source },
    });

    res.status(200).json({
      words: finalWords,
      duration: audioSec,
      text: gptText || whisperResult.data.text || "",
      _source: source,
      _rawWhisperWords: whisperWords.length,
      _rawGptText: gptText,
      _usage: {
        model: source,
        audioDurationSec: audioSec,
        audioBytes: buffer.length,
        latencyMs: (whisperResult.latencyMs || 0) + (gpt4oResult?.latencyMs || 0),
      },
      _quota: guard.quota,
    });
  } catch (err) {
    console.error("Transcription error:", err);
    res.status(500).json({ error: err.message || "Erro interno ao transcrever o áudio." });
  }
}
