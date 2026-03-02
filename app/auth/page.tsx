"use client";

import { useEffect, useState } from "react";
import { clearUser, getUser, setUser } from "@/lib/auth";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");

  useEffect(() => {
    const u = getUser();
    setUserEmail(u?.email ?? null);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();

    // Sem Supabase hoje: login/cadastro local só pra destravar o portal.
    // Amanhã a gente troca por Supabase sem mudar a UI.
    if (!email.includes("@") || senha.length < 4) {
      alert("Coloca um email válido e uma senha com pelo menos 4 caracteres.");
      return;
    }

    setUser({ email });
    setUserEmail(email);
    window.location.href = "/checkout";
  }

  function logout() {
    clearUser();
    setUserEmail(null);
  }

  return (
    <div className="card">
      <h1>Cadastro e Login</h1>
      <p className="muted">
        Hoje está <b>sem banco de dados</b>. Isso aqui é um login local (no seu
        navegador) só pra deixar o portal funcionando.
      </p>

      {userEmail ? (
        <>
          <div className="notice">
            Logado como <b>{userEmail}</b>
          </div>
          <div className="row">
            <a className="btn" href="/checkout">
              Ir pro Checkout
            </a>
            <button className="btn secondary" onClick={logout}>
              Sair
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="tabs">
            <button
              className={mode === "login" ? "tab active" : "tab"}
              onClick={() => setMode("login")}
              type="button"
            >
              Entrar
            </button>
            <button
              className={mode === "signup" ? "tab active" : "tab"}
              onClick={() => setMode("signup")}
              type="button"
            >
              Criar conta
            </button>
          </div>

          <form onSubmit={submit} className="form">
            <label>
              Email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                autoComplete="email"
              />
            </label>
            <label>
              Senha
              <input
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>

            <button className="btn" type="submit">
              {mode === "login" ? "Entrar" : "Criar conta"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
