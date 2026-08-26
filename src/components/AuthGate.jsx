// Barra fina no topo: mostra usuário logado ou botão de entrar.
// Componente auto-contido — só depende de authProvider (fachada
// agnóstica). Trocar Supabase por outro provider não afeta nada aqui.

import React, { useEffect, useState } from "react";
import { LogIn, LogOut, User } from "lucide-react";
import {
  onAuthChange, signInWithEmail, signUpWithEmail, signInWithMagicLink,
  signOut, getCurrentUser,
} from "../services/auth/authProvider.js";
import { supabaseConfigured } from "../services/auth/supabaseAuthAdapter.js";

export function AuthGate({ onUserChange }) {
  // Sem Supabase configurado o app roda em modo aberto — nada de UI de auth.
  if (!supabaseConfigured) return null;

  const [user, setUser] = useState(() => getCurrentUser());
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("signIn"); // signIn | signUp | magic
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => onAuthChange((u) => {
    setUser(u);
    if (u) { setOpen(false); setErr(""); setInfo(""); }
    onUserChange?.(u);
  }), [onUserChange]);

  const doSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(""); setInfo("");
    try {
      if (mode === "signIn") await signInWithEmail(email.trim(), password);
      else if (mode === "signUp") {
        const r = await signUpWithEmail(email.trim(), password);
        if (r.needsConfirmation) setInfo("Verifique seu email para confirmar a conta.");
      } else {
        await signInWithMagicLink(email.trim());
        setInfo("Link enviado. Verifique sua caixa de entrada.");
      }
    } catch (e) {
      setErr(e?.message || "Falha na autenticação.");
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
        style={{ background: "#131318", border: "1px solid #1F1F26", color: "#C9C9D1" }}>
        <User size={13} />
        <span className="truncate max-w-[160px]">{user.email}</span>
        <span style={{ background: "#2A1B10", color: "#FF9C60" }} className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">{user.plan || "free"}</span>
        <button onClick={signOut} title="Sair" style={{ color: "#9A9AA5" }} className="ml-1">
          <LogOut size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)}
        style={{ background: "#FF6A2B", color: "#1A0A02" }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold">
        <LogIn size={13} /> Entrar
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 1000, minWidth: 280, background: "#131318", border: "1px solid #1F1F26", borderRadius: 12, padding: 12 }}>
          <div className="flex items-center gap-1 mb-2">
            {[["signIn", "Entrar"], ["signUp", "Criar conta"], ["magic", "Link mágico"]].map(([id, label]) => (
              <button key={id} onClick={() => { setMode(id); setErr(""); setInfo(""); }}
                style={{ background: mode === id ? "#FF6A2B" : "#1B1B21", color: mode === id ? "#1A0A02" : "#C9C9D1" }}
                className="text-[11px] px-2 py-0.5 rounded font-semibold">{label}</button>
            ))}
          </div>
          <form onSubmit={doSubmit} className="flex flex-col gap-1.5">
            <input type="email" required placeholder="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              style={{ background: "#0F0F13", border: "1px solid #26262E", color: "#F5F5F7" }}
              className="w-full text-xs px-2 py-1.5 rounded" />
            {mode !== "magic" && (
              <input type="password" required minLength={6} placeholder="senha (6+ chars)"
                value={password} onChange={(e) => setPassword(e.target.value)}
                style={{ background: "#0F0F13", border: "1px solid #26262E", color: "#F5F5F7" }}
                className="w-full text-xs px-2 py-1.5 rounded" />
            )}
            <button type="submit" disabled={busy}
              style={{ background: "#FF6A2B", color: "#1A0A02" }}
              className="text-xs px-2 py-1.5 rounded font-bold disabled:opacity-60">
              {busy ? "..." : mode === "signIn" ? "Entrar" : mode === "signUp" ? "Criar conta" : "Enviar link"}
            </button>
            {err && <p style={{ color: "#F09595" }} className="text-[10px]">{err}</p>}
            {info && <p style={{ color: "#5DCAA5" }} className="text-[10px]">{info}</p>}
          </form>
        </div>
      )}
    </div>
  );
}
