// Implementação Supabase do authProvider.
// Espera env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (públicos, ok
// no cliente — o RLS/policy do Supabase é o que protege dados).
//
// Se você quiser trocar por Firebase, Clerk, Auth0, etc, escreva um
// arquivo similar com a mesma superfície pública e chame setAuthAdapter().

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Cliente único do módulo (Supabase recomenda). Se URL/KEY não estão
// configuradas, exporta um adapter dummy que sempre falha explicitamente
// — evita crash silencioso quando o usuário esquece o .env.
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

function requireClient() {
  if (!supabase) {
    throw new Error(
      "Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nas variáveis de ambiente (Vercel/local .env)."
    );
  }
  return supabase;
}

function normalizeUser(sbUser) {
  if (!sbUser) return null;
  return {
    id: sbUser.id,
    email: sbUser.email,
    createdAt: sbUser.created_at,
    plan: sbUser.user_metadata?.plan || "free",
  };
}

let cachedUser = null;
const authChangeCallbacks = new Set();

// Inicializa cache lendo a sessão persistida.
if (supabase) {
  supabase.auth.getSession().then(({ data }) => {
    cachedUser = normalizeUser(data?.session?.user || null);
    for (const cb of authChangeCallbacks) { try { cb(cachedUser); } catch {} }
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedUser = normalizeUser(session?.user || null);
    for (const cb of authChangeCallbacks) { try { cb(cachedUser); } catch {} }
  });
}

export const supabaseAuthAdapter = {
  async signInWithEmail(email, password) {
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return { user: normalizeUser(data.user) };
  },

  async signUpWithEmail(email, password) {
    const { data, error } = await requireClient().auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    return {
      user: normalizeUser(data.user),
      // Se seu Supabase tem confirmação de email ligada, session vem null.
      needsConfirmation: !data.session,
    };
  },

  async signInWithMagicLink(email) {
    const { error } = await requireClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
    });
    if (error) throw new Error(error.message);
    return { sent: true };
  },

  async signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  },

  getCurrentUser() {
    return cachedUser;
  },

  async getAccessToken() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  },

  onAuthChange(cb) {
    authChangeCallbacks.add(cb);
    // Dispara com estado atual imediatamente.
    try { cb(cachedUser); } catch {}
    return () => authChangeCallbacks.delete(cb);
  },
};

// Exposto pra o server-side adapter poder pegar o mesmo cliente
// (raw supabase para queries diretas de usage/quota).
export const supabaseRawClient = supabase;
