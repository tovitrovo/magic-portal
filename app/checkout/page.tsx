"use client";

import { useEffect, useMemo, useState } from "react";
import { calcBonusCards, calcTierPrice, calcTotalQty, loadState } from "@/lib/storage";
import { getUser } from "@/lib/auth";
import { saveOrderToDb } from "@/lib/db";

type ShippingQuote = {
  ok: boolean;
  price?: number;
  deadline_days?: number;
  carrier?: string;
  raw?: any;
  error?: string;
};

export default function CheckoutPage() {
  const [cep, setCep] = useState("");
  const [email, setEmail] = useState("");
  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [loadingFrete, setLoadingFrete] = useState(false);
  const [loadingPay, setLoadingPay] = useState(false);

  const state = useMemo(() => loadState(), []);
  const totalQty = useMemo(() => calcTotalQty(state.wants), [state.wants]);
  const unit = useMemo(() => calcTierPrice(totalQty), [totalQty]);
  const subtotal = useMemo(() => totalQty * unit, [totalQty, unit]);
  const total = useMemo(() => subtotal + (quote?.price ?? 0), [subtotal, quote]);
  const bonusInfo = useMemo(() => {
    if (!state.lockedOrder) return { credit: 0, bonus: 0 };
    return calcBonusCards(state.lockedOrder.lockedUnitPrice, unit, totalQty);
  }, [state.lockedOrder, unit, totalQty]);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      alert("Você precisa entrar antes de pagar.");
      window.location.href = "/auth";
      return;
    }
    setEmail(u.email);
  }, []);

  async function calcFrete() {
    setLoadingFrete(true);
    setQuote(null);
    try {
      const res = await fetch("/api/shipping/quote", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          cep_destino: cep,
          // valores default (ajusta depois)
          peso_kg: 0.2,
          largura_cm: 16,
          altura_cm: 3,
          comprimento_cm: 22,
          valor_declarado: subtotal
        })
      });
      // Em alguns erros de proxy/DNS/WAF o Cloudflare devolve HTML/texto (ex: "error code: 1016"),
      // e o res.json() quebra com "Unexpected token".
      const raw = await res.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error(
          `Resposta de frete não é JSON. Primeiros caracteres: ${raw
            .replace(/\s+/g, " ")
            .slice(0, 140)}`
        );
      }
      setQuote(data);
    } catch (e:any) {
      setQuote({ ok:false, error: e?.message || "Erro desconhecido" });
    } finally {
      setLoadingFrete(false);
    }
  }

  async function pagar() {
    setLoadingPay(true);
    try {
      const res = await fetch("/api/mp/create-preference", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          email,
          items: [
            { title: "Encomenda de cartas", quantity: totalQty, unit_price: unit }
          ],
          shipping: quote?.price ? { cost: quote.price, carrier: quote.carrier || "Manda Bem" } : undefined
        })
      });
      const data = await res.json();
      if (!data?.init_point) throw new Error(data?.error || "Não veio init_point");

      // salva no banco (se Supabase estiver configurado). não bloqueia o pagamento.
      try {
        await saveOrderToDb({
          state: { ...state, tierUnitPrice: unit },
          shipping: quote ?? null,
          mp_preference_id: data?.preference_id,
          total_brl: Number(total.toFixed(2)),
          unit_price_brl: Number(unit),
          bonus_cards: bonusInfo.bonus,
        });
      } catch (e) {
        console.warn("saveOrderToDb failed", e);
      }

      window.location.href = data.init_point;
    } catch (e:any) {
      alert(e?.message || "Erro no checkout");
    } finally {
      setLoadingPay(false);
    }
  }

  return (
    <div className="grid">
      <div className="col-12 card">
        <h1 className="h1">Checkout</h1>
        <div className="small">Pagamento via Mercado Pago + frete via Manda Bem (via Cloudflare Functions).</div>

        <hr />

        <div className="grid">
          <div className="col-6">
            <div className="h2">Resumo</div>
            <div className="row" style={{justifyContent:"space-between"}}>
              <span className="tag">Qtd: <b style={{marginLeft:6}}>{totalQty}</b></span>
              <span className="tag">Unit: <b style={{marginLeft:6}}>R$ {unit}</b></span>
            </div>
            <div style={{height:10}} />
            <div className="row" style={{justifyContent:"space-between"}}>
              <span className="tag">Subtotal</span>
              <span className="tag"><b>R$ {subtotal.toFixed(2)}</b></span>
            </div>
            <div style={{height:10}} />
            <div className="row" style={{justifyContent:"space-between"}}>
              <span className="tag">Frete</span>
              <span className="tag"><b>R$ {(quote?.price ?? 0).toFixed(2)}</b></span>
            </div>
            <div style={{height:10}} />
            <div className="row" style={{justifyContent:"space-between"}}>
              <span className="tag">Total</span>
              <span className="tag"><b>R$ {total.toFixed(2)}</b></span>
            </div>

            {bonusInfo.bonus > 0 && (
              <div style={{marginTop:12}} className="notice">
                <b>Cartas bônus:</b> {bonusInfo.bonus} <span className="small">(crédito: R$ {bonusInfo.credit.toFixed(2)})</span>
              </div>
            )}
          </div>

          <div className="col-6">
            <div className="h2">Frete</div>
            <input className="input" placeholder="CEP destino (somente números)" value={cep} onChange={e=>setCep(e.target.value)} />
            <div style={{height:10}} />
            <button className="btn secondary" onClick={calcFrete} disabled={loadingFrete || cep.trim().length < 8}>
              {loadingFrete ? "Calculando..." : "Calcular frete"}
            </button>

            {quote && (
              <div style={{marginTop:12}} className="card">
                {quote.ok ? (
                  <>
                    <div className="row" style={{justifyContent:"space-between"}}>
                      <span className="tag">{quote.carrier || "Frete"}</span>
                      <span className="tag"><b>R$ {Number(quote.price || 0).toFixed(2)}</b></span>
                    </div>
                    <div className="small" style={{marginTop:8}}>
                      Prazo estimado: {quote.deadline_days ?? "?"} dia(s)
                    </div>
                  </>
                ) : (
                  <div className="small" style={{color:"var(--bad)"}}>
                    Erro no frete: {quote.error || "desconhecido"}
                  </div>
                )}
              </div>
            )}

            <hr />

            <div className="h2">Pagamento</div>
            <input className="input" placeholder="Seu e-mail (pra nota do pedido)" value={email} onChange={e=>setEmail(e.target.value)} />
            <div style={{height:10}} />
            <button className="btn" onClick={pagar} disabled={loadingPay || totalQty <= 0}>
              {loadingPay ? "Abrindo Mercado Pago..." : "Pagar no Mercado Pago"}
            </button>
            <div className="small" style={{marginTop:8}}>
              Você vai ser redirecionado pro Mercado Pago.
            </div>
          </div>
        </div>

        <hr />
        <div className="row">
          <a className="btn secondary" href="/wants">Voltar</a>
        </div>
      </div>
    </div>
  );
}
