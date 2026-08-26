// Chat-completion endpoint. Protegido por authGuard: só usuário logado
// com quota de llmCalls disponível chega no OpenAI.

import { authGuard } from "./_lib/authGuard.js";

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

  const guard = await authGuard(req, res, { require: "llmCalls" });
  if (!guard) return; // 401/429 já respondido

  try {
    const { prompt, maxTokens } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "Prompt ausente ou inválido." });
      return;
    }

    const t0 = Date.now();
    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens || 1500,
        temperature: 0.3,
      }),
    });

    const data = await openaiResp.json();
    const latencyMs = Date.now() - t0;

    if (!openaiResp.ok) {
      res.status(openaiResp.status).json({ error: data.error?.message || "Falha na chamada à IA." });
      return;
    }

    // Grava 1 llmCall no usage do usuário (só se o retorno da OpenAI foi OK).
    await guard.tick({ llmCalls: 1, meta: { model: data.model || "gpt-4o-mini", latencyMs } });

    const usage = data.usage || {};
    res.status(200).json({
      text: data.choices?.[0]?.message?.content || "",
      usage: {
        model: data.model || "gpt-4o-mini",
        inputTokens: usage.prompt_tokens ?? null,
        outputTokens: usage.completion_tokens ?? null,
        totalTokens: usage.total_tokens ?? null,
        latencyMs,
      },
      quota: guard.quota,
    });
  } catch (err) {
    console.error("AI text error:", err);
    res.status(500).json({ error: err.message || "Erro interno ao gerar texto com IA." });
  }
}
