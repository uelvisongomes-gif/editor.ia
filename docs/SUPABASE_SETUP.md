# Setup Supabase (Auth + Quota)

O editor usa Supabase como backend de auth. O código está atrás de uma **fachada agnóstica** (`src/services/auth/authProvider.js`), então trocar por Firebase / Clerk / Auth0 depois é só reescrever um adapter.

## 1. Criar projeto no Supabase

1. https://supabase.com/dashboard → **New project**.
2. Copie:
   - **Project URL** → `SUPABASE_URL` / `VITE_SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE` (só servidor, nunca client)

## 2. Criar a tabela `usage_log`

No **SQL Editor** do Supabase, rode:

```sql
create table if not exists usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null,        -- 'transcriptionMinutes' | 'llmCalls' | 'exports'
  amount numeric not null,
  created_at timestamptz default now(),
  meta jsonb
);

create index if not exists usage_log_user_month
  on usage_log (user_id, created_at);

-- RLS opcional: usuários leem só o próprio consumo.
-- (O adapter usa service_role, então bypass RLS de qualquer jeito, mas
--  se você quiser expor consumo pro cliente no futuro, ligue isso.)
alter table usage_log enable row level security;
create policy "usage_log self read"
  on usage_log for select
  using (auth.uid() = user_id);
```

## 3. Setar `plan` no user_metadata

O plano é lido de `user.user_metadata.plan`. Default = `free`.

Para promover um usuário manualmente pra `pro`, no SQL Editor:

```sql
update auth.users
set raw_user_meta_data = jsonb_set(coalesce(raw_user_meta_data,'{}'), '{plan}', '"pro"')
where email = 'fulano@exemplo.com';
```

Planos válidos hoje (definidos em `api/_lib/authGuard.js`):

| Plano       | transcriptionMinutes/mês | llmCalls/mês | exports/mês |
| ----------- | -----------------------: | -----------: | ----------: |
| `free`      | 5                        | 30           | 2           |
| `starter`   | 60                       | 300          | 20          |
| `pro`       | 600                      | 3000         | 200         |
| `unlimited` | ∞                        | ∞            | ∞           |

## 4. Configurar env vars na Vercel

**Settings → Environment Variables**, adicionar (com scope = Production **e** Preview):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE`
- `OPENAI_API_KEY` (já existia)

## 5. Testar local

Copie `.env.example` → `.env.local`, preencha, `npm run dev`.

Se ver erro **"Supabase não configurado"**, é env faltando ou nome errado (lembra do prefixo `VITE_` no cliente).

## Trocar de provider (futuro)

1. Cria `src/services/auth/<meuProvider>AuthAdapter.js` exportando o mesmo shape do `supabaseAuthAdapter`.
2. Cria `api/_lib/<meuProvider>ServerAdapter.js` exportando `verifyToken/getMonthlyUsage/logUsage`.
3. Muda 2 imports: `main.jsx` (client) e `api/_lib/authGuard.js` (server).

Nenhum outro arquivo precisa saber que a coisa mudou.
