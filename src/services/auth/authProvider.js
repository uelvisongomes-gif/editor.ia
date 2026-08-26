// Interface de autenticação. TODO CÓDIGO DO CLIENTE fala com essa fachada,
// nunca importa Supabase (ou outro provider) direto. Assim trocar de
// provider é escrever uma classe nova e chamar `setAuthAdapter(x)`.
//
// Contrato mínimo que qualquer adapter tem que cumprir:
//   signInWithEmail(email, password)  → { user } | throws
//   signUpWithEmail(email, password)  → { user, needsConfirmation } | throws
//   signInWithMagicLink(email)        → { sent: true } | throws
//   signOut()                         → void
//   getCurrentUser()                  → user | null
//   onAuthChange(cb)                  → unsubscribe fn
//   getAccessToken()                  → jwt string | null
//
// Um `user` normalizado tem: { id, email, createdAt, plan }.

/** @typedef {{ id:string, email:string, createdAt?:string, plan?:string }} AppUser */

let _adapter = null;
const listeners = new Set();

export function setAuthAdapter(adapter) {
  _adapter = adapter;
  // Repassa mudanças do adapter pros listeners globais.
  if (adapter?.onAuthChange) {
    adapter.onAuthChange((user) => {
      for (const l of listeners) {
        try { l(user); } catch (err) { console.warn("auth listener err:", err); }
      }
    });
  }
}

export function currentAdapter() { return _adapter; }

function requireAdapter() {
  if (!_adapter) throw new Error("Auth adapter não configurado. Chame setAuthAdapter() no bootstrap.");
  return _adapter;
}

export async function signInWithEmail(email, password) {
  return requireAdapter().signInWithEmail(email, password);
}
export async function signUpWithEmail(email, password) {
  return requireAdapter().signUpWithEmail(email, password);
}
export async function signInWithMagicLink(email) {
  return requireAdapter().signInWithMagicLink(email);
}
export async function signOut() {
  return requireAdapter().signOut();
}
export function getCurrentUser() {
  return _adapter?.getCurrentUser() || null;
}
export async function getAccessToken() {
  if (!_adapter) return null;
  return _adapter.getAccessToken();
}

/** subscribe global. cb(user | null). retorna unsubscribe. */
export function onAuthChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
