import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { setAuthAdapter } from "./services/auth/authProvider.js";
import { supabaseAuthAdapter } from "./services/auth/supabaseAuthAdapter.js";

// Auth provider — Supabase por padrão. Trocar por outro:
// escreva um novo adapter que respeite a interface de authProvider e
// passe aqui. Nada mais no app muda.
setAuthAdapter(supabaseAuthAdapter);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
