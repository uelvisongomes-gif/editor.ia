// Adapter Supabase pro authGuard. Usa service_role key (SÓ SERVIDOR)
// pra ler e gravar sem depender de RLS.
//
// Env necessárias:
//   SUPABASE_URL           — igual ao do cliente
//   SUPABASE_SERVICE_ROLE  — chave secreta (NUNCA VAI PRO CLIENTE)
//
// Espera-se a seguinte tabela no Postgres do Supabase:
//   create table usage_log (
//     id uuid primary key default gen_random_uuid(),
//     user_id uuid not null,
//     kind text not null,           -- 'transcriptionMinutes' | 'llmCalls' | 'exports'
//     amount numeric not null,
//     created_at timestamptz default now(),
//     meta jsonb
//   );
//   create index usage_log_user_month on usage_log(user_id, created_at);
//
// E user_metadata.plan lido do JWT (o próprio Supabase gerencia).

import { createClient } from "@supabase/supabase-js";

export function createSupabaseServerAdapter() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_URL/SUPABASE_SERVICE_ROLE ausentes. Configure nas env vars da Vercel."
    );
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  return {
    async verifyToken(jwt) {
      // getUser valida o JWT contra o Supabase (rede + assinatura).
      const { data, error } = await admin.auth.getUser(jwt);
      if (error || !data?.user) throw new Error(error?.message || "usuário não encontrado");
      return {
        userId: data.user.id,
        email: data.user.email,
        plan: data.user.user_metadata?.plan || "free",
      };
    },

    async getMonthlyUsage(userId) {
      // Soma amount por kind desde o dia 1 do mês corrente.
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { data, error } = await admin
        .from("usage_log")
        .select("kind, amount")
        .eq("user_id", userId)
        .gte("created_at", monthStart);
      if (error) throw new Error(error.message);
      const totals = { transcriptionMinutes: 0, llmCalls: 0, exports: 0 };
      for (const row of data || []) {
        if (totals[row.kind] != null) totals[row.kind] += Number(row.amount) || 0;
      }
      return totals;
    },

    async logUsage(userId, entry) {
      // Grava um row por kind com amount = entry[kind].
      const rows = [];
      for (const [kind, amount] of Object.entries(entry || {})) {
        if (typeof amount === "number" && amount > 0) {
          rows.push({ user_id: userId, kind, amount, meta: entry.meta || null });
        }
      }
      if (!rows.length) return;
      const { error } = await admin.from("usage_log").insert(rows);
      if (error) console.warn("usage_log insert error:", error.message);
    },
  };
}
