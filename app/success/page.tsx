"use client";

import React, { useEffect, useMemo, useState } from "react";
import { loadState, calcBonusCards, calcTierPrice, calcTotalQty } from "@/lib/storage";

export default function SuccessPage() {
  const state = useMemo(() => loadState(), []);
  const [mp, setMp] = useState<{ status?: string; payment_id?: string; preference_id?: string } | null>(null);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const status = url.searchParams.get("status") || undefined;
      const payment_id = url.searchParams.get("payment_id") || url.searchParams.get("collection_id") || undefined;
      const preference_id = url.searchParams.get("preference_id") || undefined;
      setMp({ status, payment_id: payment_id || undefined, preference_id });
    } catch {
      setMp({});
    }
  }, []);

  const qty = calcTotalQty(state.wants);
  const unit = calcTierPrice(qty);
  const bonus = calcBonusCards(state.lastPaidUnitPrice, unit, qty);

  return (
    <main className="container">
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Pedido registrado</h1>
        <p className="muted">
          Se você veio do Mercado Pago, abaixo vai aparecer o status que ele mandou pra gente.
        </p>

        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Resumo</h3>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>Quantidade</span>
            <b>{qty}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>Preço unitário</span>
            <b>R$ {unit.toFixed(2)}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>Total</span>
            <b>R$ {(qty * unit).toFixed(2)}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>Bônus</span>
            <b>{bonus.bonusCards} cartas</b>
          </div>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Status do pagamento</h3>
          <div className="small">
            <div>Status: <b>{mp?.status ?? "—"}</b></div>
            <div>Payment ID: <b>{mp?.payment_id ?? "—"}</b></div>
            <div>Preference ID: <b>{mp?.preference_id ?? "—"}</b></div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Se o status não apareceu, não tem problema — o importante é você ter finalizado o checkout.
          </p>
        </div>

        <div style={{ marginTop: 16 }} className="row">
          <a className="btn" href="/wants">Voltar pra lista</a>
          <a className="btn primary" href="/checkout">Ver checkout</a>
        </div>
      </div>
    </main>
  );
}
