"use client";

import React, { useMemo, useState } from "react";
import { clearPendingSignup, getPendingSignup, setUser } from "@/lib/auth";

type Step = {
  title: string;
  body: React.ReactNode;
};

function Goblin({ mood = "sus" }: { mood?: "sus" | "happy" | "serious" }) {
  // Goblinzinho em ASCII pra não depender de imagens
  const face = mood === "happy" ? "( •‿• )" : mood === "serious" ? "(ಠ_ಠ)" : "(≖_≖ )";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div
        aria-hidden
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          display: "grid",
          placeItems: "center",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.08)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        }}
      >
        {face}
      </div>
      <div>
        <div style={{ fontWeight: 800 }}>Goblin do Portal</div>
        <div className="muted" style={{ fontSize: 13 }}>
          Eu explico rápido. Depois eu sumo.
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const pending = useMemo(() => getPendingSignup(), []);
  const [i, setI] = useState(0);

  const steps: Step[] = [
    {
      title: "Como funciona a encomenda",
      body: (
        <>
          <p>
            Você escolhe as cartas e entra no <b>grupo</b>. Eu junto todo mundo num pedido só.
          </p>
          <p>
            Quanto mais unidades no total, <b>menor o preço por carta</b>.
          </p>
        </>
      ),
    },
    {
      title: "Tier mudou? Você não perde",
      body: (
        <>
          <p>
            Se você comprou quando a unidade estava <b>R$ 23</b> e depois a tier subiu e caiu pra, sei lá, <b>R$ 21</b>,
            a diferença vira <b>crédito</b>.
          </p>
          <p>
            Quando o crédito total passar o valor da unidade atual, isso vira <b>cartas bônus</b>.
          </p>
        </>
      ),
    },
    {
      title: "E se o grupo não bater a meta?",
      body: (
        <>
          <p>
            O pedido <b>ainda acontece</b> — só que pelo <b>valor atual</b> do momento.
          </p>
          <p className="muted">
            (Ou seja: sem drama. Só matemática.)
          </p>
          <p>
            Bora escolher suas cores e começar.
          </p>
        </>
      ),
    },
  ];

  const step = steps[i];

  const next = () => setI((v) => Math.min(v + 1, steps.length - 1));
  const back = () => setI((v) => Math.max(v - 1, 0));

  const finish = () => {
    const email = pending?.email;
    if (!email) {
      window.location.href = "/auth";
      return;
    }
    setUser({ email });
    clearPendingSignup();
    window.location.href = "/wants";
  };

  return (
    <main className="container">
      <div className="card">
        <Goblin mood={i === 2 ? "happy" : i === 1 ? "serious" : "sus"} />

        <div style={{ marginTop: 16 }}>
          <h1 style={{ margin: 0 }}>{step.title}</h1>
          <div style={{ marginTop: 10, lineHeight: 1.55 }}>{step.body}</div>
        </div>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div className="muted" style={{ fontSize: 13 }}>
            {i + 1}/{steps.length}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={back} disabled={i === 0}>
              Voltar
            </button>
            {i < steps.length - 1 ? (
              <button className="btn primary" onClick={next}>
                Próximo
              </button>
            ) : (
              <button className="btn primary" onClick={finish}>
                Entrar no portal
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
