"use client";

import { useEffect, useMemo, useState } from "react";
import { getUser } from "@/lib/auth";
import { calcTierPrice, calcTotalQty, defaultState, loadState, saveState, type WantItem } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { loadWantsFromDb, saveWantsToDb } from "@/lib/db";

export default function WantsPage() {
  const [guild, setGuild] = useState(defaultState.guild);
  const [wants, setWants] = useState<WantItem[]>([]);
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const [dbStatus, setDbStatus] = useState<string>(supabase ? "DB: conectado" : "DB: desligado");

  useEffect(() => {
    const u = getUser();
    if (!u) {
      alert("Você precisa entrar pra mexer na lista.");
      window.location.href = "/auth";
      return;
    }
    const s = loadState();
    setGuild(s.guild);
    setWants(s.wants);
  }, []);

  // se tiver Supabase e a lista local vier vazia, tenta puxar do DB
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) return;
      if (wants.length > 0) return;
      setDbStatus("DB: carregando wants...");
      const dbWants = await loadWantsFromDb();
      if (cancelled) return;
      if (dbWants && dbWants.length) {
        setWants(dbWants);
        setDbStatus(`DB: wants carregados (${dbWants.length})`);
      } else {
        setDbStatus("DB: sem wants salvos");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = loadState();
    saveState({ ...s, guild, wants });
  }, [guild, wants]);

  // autosave no banco com debounce (não trava UX)
  useEffect(() => {
    if (!supabase) return;
    const t = setTimeout(async () => {
      setDbStatus("DB: salvando wants...");
      const ok = await saveWantsToDb(wants);
      setDbStatus(ok ? "DB: wants salvos" : "DB: erro ao salvar wants");
    }, 800);
    return () => clearTimeout(t);
  }, [wants]);

  const totalQty = useMemo(() => calcTotalQty(wants), [wants]);
  const price = useMemo(() => calcTierPrice(totalQty), [totalQty]);

  function add() {
    const n = name.trim();
    if (!n) return;
    setWants(prev => {
      const copy = [...prev];
      const idx = copy.findIndex(w => w.name.toLowerCase() === n.toLowerCase());
      if (idx >= 0) copy[idx] = { ...copy[idx], qty: copy[idx].qty + Math.max(1, qty) };
      else copy.unshift({ name: n, qty: Math.max(1, qty) });
      return copy;
    });
    setName("");
    setQty(1);
  }

  function remove(i: number) {
    setWants(prev => prev.filter((_, idx) => idx !== i));
  }

  function setItemQty(i: number, v: number) {
    setWants(prev => prev.map((w, idx) => idx === i ? { ...w, qty: Math.max(1, v || 1) } : w));
  }

  return (
    <div className="grid">
      <div className="col-12 card">
        <h1 className="h1">Wants</h1>
        <div className="small" style={{opacity:0.8, marginTop:-8, marginBottom:10}}>{dbStatus}</div>
        <div className="row" style={{justifyContent:"space-between", alignItems:"center"}}>
          <span className="tag">Total: <b style={{marginLeft:6}}>{totalQty}</b></span>
          <span className="tag">Preço atual: <b style={{marginLeft:6}}>R$ {price}</b></span>
        </div>

        <hr />

        <div className="grid">
          <div className="col-6">
            <div className="h2">Adicionar</div>
            <input className="input" placeholder="Nome da carta (ex: Lightning Bolt)" value={name} onChange={e=>setName(e.target.value)} />
            <div style={{height:10}} />
            <input className="input" type="number" min={1} value={qty} onChange={e=>setQty(parseInt(e.target.value || "1", 10))} />
            <div style={{height:10}} />
            <button className="btn" onClick={add}>Adicionar</button>
          </div>

          <div className="col-6">
            <div className="h2">Sua lista</div>
            {wants.length === 0 ? (
              <div className="small">Sem wants ainda.</div>
            ) : (
              <div className="card" style={{padding:12}}>
                {wants.map((w, i) => (
                  <div key={w.name} className="row" style={{alignItems:"center", justifyContent:"space-between", marginBottom:8}}>
                    <div style={{minWidth:200}}>
                      <div style={{fontWeight:800}}>{w.name}</div>
                      <div className="small">Qtd</div>
                    </div>
                    <input className="input" style={{maxWidth:120}} type="number" min={1} value={w.qty} onChange={e=>setItemQty(i, parseInt(e.target.value||"1",10))} />
                    <button className="btn secondary" onClick={()=>remove(i)}>Remover</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <hr />
        <div className="row">
          <a className="btn secondary" href="/">Voltar</a>
          <a className="btn" href="/checkout">Checkout</a>
        </div>
      </div>
    </div>
  );
}
