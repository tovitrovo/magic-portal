"use client";

import { useEffect, useMemo, useState } from "react";
import { calcBonusCards, calcTierPrice, calcTotalQty, defaultState, loadState, saveState, type PortalState } from "@/lib/storage";

const guilds = ["Azorius","Dimir","Rakdos","Gruul","Selesnya","Orzhov","Izzet","Golgari","Boros","Simic"];

export default function Home() {
  const [state, setState] = useState<PortalState>(defaultState);

  useEffect(() => setState(loadState()), []);
  useEffect(() => saveState(state), [state]);

  const totalQty = useMemo(() => calcTotalQty(state.wants), [state.wants]);
  const currentPrice = useMemo(() => calcTierPrice(totalQty), [totalQty]);

  const locked = state.lockedOrder;
  const bonus = locked ? calcBonusCards(locked.lockedUnitPrice, currentPrice, locked.totalQty) : null;

  function lockOrder() {
    const totalPaid = totalQty * state.tierUnitPrice;
    setState(s => ({
      ...s,
      tierUnitPrice: currentPrice,
      lockedOrder: {
        createdAt: new Date().toISOString(),
        lockedUnitPrice: currentPrice,
        totalQty,
        totalPaid
      }
    }));
  }

  return (
    <div className="grid">
      <div className="col-12 card">
        <h1 className="h1">Encomenda em grupo</h1>
        <div className="small">
          Quanto mais o grupo compra, menor o preço. Se o preço cair depois que você travar seu pedido, a diferença vira cartas bônus.
        </div>
        <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
          <a className="btn primary" href="/auth">Entrar / Criar conta</a>
          <a className="btn" href="/wants">Montar wants</a>
          <a className="btn" href="/checkout">Ir pro checkout</a>
        </div>
        <hr />
        <div className="grid">
          <div className="col-6">
            <div className="h2">1) Escolha sua guilda</div>
            <select
              className="input"
              value={state.guild}
              onChange={(e) => setState(s => ({...s, guild: e.target.value}))}
            >
              {guilds.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <div className="small" style={{marginTop:8}}>Tema salvo no seu navegador.</div>
          </div>

          <div className="col-6">
            <div className="h2">2) Preço do grupo</div>
            <div className="row" style={{alignItems:"center", justifyContent:"space-between"}}>
              <span className="tag">Total wants: <b style={{marginLeft:6}}>{totalQty}</b></span>
              <span className="tag">Preço atual: <b style={{marginLeft:6}}>R$ {currentPrice}</b></span>
            </div>
            <div className="small" style={{marginTop:8}}>
              Tiers: 0-9 (23) • 10-19 (21) • 20-49 (19) • 50+ (17)
            </div>
          </div>
        </div>

        <hr />

        <div className="row" style={{justifyContent:"space-between", alignItems:"center"}}>
          <div>
            <div className="h2" style={{marginBottom:2}}>3) Travar pedido</div>
            <div className="small">Trava o preço atual e gera um snapshot do seu pedido.</div>
          </div>
          <button className="btn" onClick={lockOrder} disabled={totalQty <= 0}>
            Travar agora
          </button>
        </div>

        {locked && (
          <>
            <hr />
            <div className="grid">
              <div className="col-6 card">
                <div className="h2">Seu pedido travado</div>
                <div className="small">Data: {new Date(locked.createdAt).toLocaleString()}</div>
                <div className="row" style={{marginTop:10}}>
                  <span className="tag">Qtd: <b style={{marginLeft:6}}>{locked.totalQty}</b></span>
                  <span className="tag">Preço travado: <b style={{marginLeft:6}}>R$ {locked.lockedUnitPrice}</b></span>
                </div>
              </div>
              <div className="col-6 card">
                <div className="h2">Bônus (se o preço caiu)</div>
                {bonus ? (
                  <>
                    <div className="row" style={{marginTop:10}}>
                      <span className="tag">Crédito: <b style={{marginLeft:6}}>R$ {bonus.credit.toFixed(2)}</b></span>
                      <span className="tag">Bônus: <b style={{marginLeft:6}}>{bonus.bonus} carta(s)</b></span>
                    </div>
                    <div className="small" style={{marginTop:8}}>
                      Regra: diferença total / preço atual = bônus.
                    </div>
                  </>
                ) : (
                  <div className="small">Trave um pedido pra ver.</div>
                )}
              </div>
            </div>
          </>
        )}

        <hr />
        <div className="row">
          <a className="btn secondary" href="/wants">Editar wants</a>
          <a className="btn" href="/checkout">Ir pro checkout</a>
        </div>
      </div>
    </div>
  );
}
