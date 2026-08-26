// Middleware server-side. Chamado no topo de cada endpoint /api/* que
// deve custar dinheiro. Verifica JWT via adapter injetado + checa quota
// mensal por usuário/plano.
//
// Contrato do adapter:
//   verifyToken(jwt)       → { userId, email, plan } | throws
//   getMonthlyUsage(userId)→ { transcriptionMinutes, llmCalls, exports }
//   logUsage(userId, entry)→ void
//
// Trocar Supabase por outro backend = escrever outro adapter e mudar 1 linha
// no factory abaixo.

import { createSupabaseServerAdapter } from "./supabaseServerAdapter.js";

// Factory único. Se um dia migrar, mude aqui.
let _adapter = null;
function adapter() {
  if (!_adapter) _adapter = createSupabaseServerAdapter();
  return _adapter;
}

// Cotas por plano — números conservadores pra começar. Ajuste na conta
// Supabase depois se quiser, o adapter lê daqui como fonte da verdade.
const PLAN_LIMITS = {
  free:    { transcriptionMinutes: 5,   llmCalls: 30,   exports: 2   },
  starter: { transcriptionMinutes: 60,  llmCalls: 300,  exports: 20  },
  pro:     { transcriptionMinutes: 600, llmCalls: 3000, exports: 200 },
  unlimited: { transcriptionMinutes: Infinity, llmCalls: Infinity, exports: Infinity },
};

function extractBearer(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization;
  if (!auth || typeof auth !== "string") return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Verifica auth + quota. Retorna { user, quota, tick } ou responde 401/429
 * direto no res.
 * tick({ transcriptionMinutes?, llmCalls?, exports? }) → grava consumo.
 *
 * Uso:
 *   const guard = await authGuard(req, res, { require: "llmCalls" });
 *   if (!guard) return; // resposta já foi enviada
 *   ...faz a chamada...
 *   await guard.tick({ llmCalls: 1 });
 */
export async function authGuard(req, res, { require } = {}) {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: "Auth necessária. Envie header Authorization: Bearer <jwt>." });
    return null;
  }
  let user;
  try {
    user = await adapter().verifyToken(token);
  } catch (err) {
    res.status(401).json({ error: "Token inválido ou expirado.", detail: err?.message });
    return null;
  }
  const plan = user.plan || "free";
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  let usage;
  try {
    usage = await adapter().getMonthlyUsage(user.userId);
  } catch (err) {
    console.warn("authGuard: getMonthlyUsage falhou, permitindo por default:", err);
    usage = { transcriptionMinutes: 0, llmCalls: 0, exports: 0 };
  }
  if (require && (usage[require] ?? 0) >= (limits[require] ?? Infinity)) {
    res.status(429).json({
      error: `Quota mensal do plano ${plan} atingida para ${require} (${usage[require]}/${limits[require]}). Faça upgrade ou aguarde o próximo mês.`,
      quota: { plan, usage, limits },
    });
    return null;
  }
  return {
    user,
    plan,
    quota: { usage, limits },
    async tick(entry) {
      try {
        await adapter().logUsage(user.userId, entry);
      } catch (err) {
        console.warn("logUsage falhou (não bloqueia resposta):", err);
      }
    },
  };
}

export { PLAN_LIMITS };
