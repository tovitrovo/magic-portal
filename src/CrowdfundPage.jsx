// Página do financiamento coletivo: pacotes de cartas em português.
//
// Três coisas numa tela só, nessa ordem:
//   1. por que entrar agora (faixas de preço e a meta);
//   2. comprar pacote ou caixa (preço cotado pela fila, pago no Mercado Pago);
//   3. votar nas cartas (busca no Scryfall, só cartas sem selo holográfico).
// Preço e vagas vêm do servidor (/api/crowdfund); a cotação local é só prévia.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock, Heart, Loader, Minus, Package, Plus, RefreshCw, Search, Sparkles, Trophy, X } from 'lucide-react';
import { BRL, SUGGESTION_PRESETS, quotePledge, scryfallQuery, scryfallToVote } from '../shared/crowdfund';
import { SFX, Btn, Card, Tag, Spin, CardThumb } from './kit';

async function api(token, body) {
  const res = await fetch('/api/crowdfund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function timeLeft(deadline) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return 'encerrado';
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((ms % 3600000) / 60000)}min`;
}

const PLEDGE_STATUS = {
  PENDING: { label: 'Aguardando pagamento', color: 'var(--gold)' },
  PAID: { label: 'Confirmado', color: 'var(--ok)' },
  REFUNDED: { label: 'Reembolsado', color: 'var(--text-dim)' },
};

const section = { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' };
const h2 = { fontSize: 'var(--fs-lg)', fontWeight: 650, color: 'var(--text-strong)', letterSpacing: -0.2 };
const muted = { fontSize: 'var(--fs-sm)', color: 'var(--text-dim)', lineHeight: 1.5 };

export default function CrowdfundPage({ token, toast, returnedFromPayment }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { setData(await api(token, { action: 'get' })); setErr(''); }
    catch (e) { setErr(e.message); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Voltou do Mercado Pago: confere os pendentes uma vez.
  const synced = useRef(false);
  useEffect(() => {
    if (!returnedFromPayment || synced.current || !data?.myPledges) return;
    synced.current = true;
    const pending = data.myPledges.filter(p => p.status === 'PENDING');
    Promise.all(pending.map(p => api(token, { action: 'sync', pledgeId: p.id }).catch(() => null))).then(load);
  }, [returnedFromPayment, data, token, load]);

  if (err) return <Card><div style={muted}>Não foi possível carregar a campanha: {err}</div><Btn variant="secondary" onClick={load} style={{ marginTop: 12 }}><RefreshCw size={15} /> Tentar de novo</Btn></Card>;
  if (!data) return <div style={{ display: 'grid', placeItems: 'center', padding: 60 }}><Spin size={24} /></div>;
  if (!data.campaign) return <Card><div style={muted}>Nenhuma campanha aberta agora. Fique de olho no seu e-mail!</div></Card>;

  const { campaign: c, progress: pr } = data;
  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)', paddingBottom: 40 }}>
    <Hero c={c} pr={pr} voters={data.voters} />
    <TierLadder c={c} pr={pr} />
    <BuyBox c={c} pr={pr} isOpen={data.isOpen} token={token} toast={toast} onDone={load} />
    {data.myPledges?.length > 0 && <MyPledges pledges={data.myPledges} c={c} token={token} toast={toast} onChange={load} />}
    {c.final_cards?.length > 0
      ? <FinalList cards={c.final_cards} total={c.cards_per_pack} />
      : <Voting c={c} ranking={data.ranking} myVotes={data.myVotes} token={token} toast={toast} onChange={load} />}
    <HowItWorks c={c} />
  </div>);
}

// ── 1. Hero ──────────────────────────────────────────────
function Hero({ c, pr, voters }) {
  const left = timeLeft(c.deadline);
  return (<div style={{ ...section, gap: 'var(--sp-4)' }}>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <Tag color="var(--ok)">🇧🇷 Em português</Tag>
      <Tag>{c.cards_per_pack} cartas diferentes</Tag>
      {c.finish !== 'Normal' && <Tag color="var(--gold)"><Sparkles size={12} /> {c.finish}</Tag>}
      {left && <Tag><Clock size={12} /> {left}</Tag>}
    </div>
    <h2 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, lineHeight: 1.15, letterSpacing: -0.6, color: 'var(--text-strong)' }}>{c.title}</h2>
    {c.subtitle && <p style={{ ...muted, fontSize: 'var(--fs-md)' }}>{c.subtitle}</p>}

    <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <b style={{ fontSize: 'var(--fs-xl)', color: 'var(--text-strong)' }}>{pr.paid} <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)', fontWeight: 500 }}>de {pr.goal} pacotes para imprimir</span></b>
        <span style={{ fontWeight: 700, color: pr.goalReached ? 'var(--ok)' : 'var(--text-strong)' }}>{pr.goalPct}%</span>
      </div>
      <div style={{ height: 10, borderRadius: 10, background: 'var(--fill-soft)', overflow: 'hidden' }}>
        <div style={{ width: pr.goalPct + '%', height: '100%', background: pr.goalReached ? 'var(--ok)' : 'var(--gp)', transition: 'width .6s' }} />
      </div>
      <div style={{ ...muted, fontSize: 'var(--fs-xs)' }}>
        {pr.goalReached ? '🎉 Meta batida: o lote vai ser impresso! Ainda dá para garantir o seu.' : `Faltam ${pr.goal - pr.paid} pacotes pagos para o lote sair. Se não bater até o prazo, todo mundo recebe o dinheiro de volta.`}
        {' '}{pr.backers} apoiador(es) · {voters} votante(s).
      </div>
    </Card>
  </div>);
}

// ── Faixas de preço ──────────────────────────────────────
function TierLadder({ c, pr }) {
  return (<div style={section}>
    <h3 style={h2}>Quem chega primeiro paga menos</h3>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {pr.tiers.map(t => {
        const on = t.state === 'current', done = t.state === 'done';
        return (<div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 'var(--r-card)', border: '1px solid ' + (on ? 'var(--gp)' : 'var(--line-soft)'), background: on ? 'var(--fill-soft)' : 'transparent', opacity: done ? .5 : 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <b style={{ color: 'var(--text-strong)', textDecoration: done ? 'line-through' : 'none' }}>{t.label}</b>
              {on && <Tag color="var(--gp)" style={{ padding: '2px 8px' }}>agora</Tag>}
              {done && <Tag style={{ padding: '2px 8px' }}>esgotado</Tag>}
            </div>
            <div style={{ ...muted, fontSize: 'var(--fs-xs)' }}>Pacotes {t.from}–{t.upto} · {on ? `restam ${t.upto - pr.taken}` : `${t.size} vagas`}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <b style={{ color: 'var(--text-strong)', fontSize: 'var(--fs-md)' }}>{BRL(t.per_card_brl)}<span style={{ fontWeight: 500, color: 'var(--text-dim)', fontSize: 'var(--fs-xs)' }}>/carta</span></b>
            <div style={{ ...muted, fontSize: 'var(--fs-xs)' }}>{BRL(t.per_card_brl * c.cards_per_pack)} o pacote</div>
          </div>
        </div>);
      })}
    </div>
  </div>);
}

// ── 2. Comprar ───────────────────────────────────────────
function BuyBox({ c, pr, isOpen, token, toast, onDone }) {
  const [packs, setPacks] = useState(c.box_packs);
  const [busy, setBusy] = useState(false);
  const tiers = pr.tiers.map(({ upto, per_card_brl, label }) => ({ upto, per_card_brl, label }));
  const q = useMemo(() => quotePledge({ tiers, taken: pr.taken, packs, cardsPerPack: c.cards_per_pack }), [pr.taken, packs, c.cards_per_pack]); // eslint-disable-line react-hooks/exhaustive-deps
  const available = pr.capacity - pr.taken;

  async function pledge() {
    setBusy(true);
    try {
      const r = await api(token, { action: 'pledge', packs });
      SFX.confirm();
      window.location.href = r.mpLink;
    } catch (e) { toast(e.message, 'error'); setBusy(false); onDone(); }
  }

  if (!isOpen) return <Card><b style={{ color: 'var(--text-strong)' }}>{pr.soldOut ? 'Esgotado!' : 'Apoios encerrados'}</b><div style={muted}>{pr.soldOut ? 'Todos os pacotes desse lote foram vendidos.' : 'Essa campanha não está aceitando novos apoios.'}</div></Card>;
  if (pr.soldOut) return <Card><b>Esgotado!</b></Card>;

  const options = [
    { n: 1, title: '1 pacote', sub: `${c.cards_per_pack} cartas, uma de cada` },
    { n: c.box_packs, title: `Caixa com ${c.box_packs}`, sub: `Playset: ${c.box_packs} cópias de cada carta`, best: true },
  ];
  return (<div style={section} id="apoiar">
    <h3 style={h2}>Garanta o seu</h3>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {options.map(o => {
        const on = packs === o.n;
        const oq = quotePledge({ tiers, taken: pr.taken, packs: o.n, cardsPerPack: c.cards_per_pack });
        return (<button key={o.n} disabled={o.n > available} onClick={() => { SFX.toggle(); setPacks(o.n); }} style={{ textAlign: 'left', padding: 14, borderRadius: 'var(--r-card)', border: '1.5px solid ' + (on ? 'var(--gp)' : 'var(--line)'), background: on ? 'var(--fill-soft)' : 'var(--card-bg)', color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 4, opacity: o.n > available ? .4 : 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Package size={15} /><b style={{ color: 'var(--text-strong)' }}>{o.title}</b></span>
          <span style={{ ...muted, fontSize: 'var(--fs-xs)' }}>{o.sub}</span>
          <b style={{ fontSize: 'var(--fs-lg)', color: 'var(--text-strong)', marginTop: 4 }}>{oq.ok ? BRL(oq.total) : '—'}</b>
          {o.best && <Tag color="var(--ok)" style={{ alignSelf: 'flex-start', padding: '2px 8px' }}>deck completo</Tag>}
        </button>);
      })}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <span style={muted}>Outra quantidade</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="mp-tap" aria-label="Menos um pacote" onClick={() => setPacks(p => Math.max(1, p - 1))} style={stepBtn}><Minus size={15} /></button>
        <b style={{ minWidth: 28, textAlign: 'center', color: 'var(--text-strong)' }}>{packs}</b>
        <button className="mp-tap" aria-label="Mais um pacote" onClick={() => setPacks(p => Math.min(12, available, p + 1))} style={stepBtn}><Plus size={15} /></button>
      </div>
    </div>
    {q.ok && <Card style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 14 }}>
      {q.breakdown.map(b => <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)' }}><span style={{ color: 'var(--text-dim)' }}>{b.packs}× {b.label} ({BRL(b.per_card_brl)}/carta)</span><span>{BRL(b.packs * b.per_pack_brl)}</span></div>)}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--text-strong)', borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}><span>Total</span><span>{BRL(q.total)}</span></div>
      <div style={{ ...muted, fontSize: 'var(--fs-xs)' }}>Média de {BRL(q.perCardAvg)} por carta · frete à parte, calculado quando o lote chegar.</div>
    </Card>}
    {!q.ok && <div style={{ ...muted, color: 'var(--danger)' }}>{q.error}</div>}
    <Btn full disabled={!q.ok || busy || !token} onClick={pledge}>{busy ? <Spin size={16} color="currentColor" /> : <>Apoiar com {q.ok ? BRL(q.total) : '—'}</>}</Btn>
    <div style={{ ...muted, fontSize: 'var(--fs-xs)', textAlign: 'center' }}>Seus pacotes ficam reservados por 45 minutos enquanto você paga. Pix ou cartão pelo Mercado Pago.</div>
  </div>);
}
const stepBtn = { width: 36, height: 36, borderRadius: 18, border: '1px solid var(--line)', background: 'var(--fill-soft)', color: 'var(--text-strong)', display: 'grid', placeItems: 'center', cursor: 'pointer' };

function MyPledges({ pledges, c, token, toast, onChange }) {
  const [busy, setBusy] = useState('');
  async function act(action, p) {
    setBusy(action + p.id);
    try {
      const r = await api(token, { action, pledgeId: p.id });
      if (action === 'pay') { window.location.href = r.mpLink; return; }
      if (action === 'sync') toast(r.status === 'PAID' ? 'Pagamento confirmado!' : 'Ainda não recebemos o pagamento.', r.status === 'PAID' ? 'success' : 'info');
      await onChange();
    } catch (e) { toast(e.message, 'error'); await onChange(); }
    setBusy('');
  }
  const paidPacks = pledges.filter(p => p.status === 'PAID').reduce((s, p) => s + p.packs, 0);
  return (<div style={section}>
    <h3 style={h2}>Meus apoios {paidPacks > 0 && <span style={{ color: 'var(--ok)', fontSize: 'var(--fs-sm)' }}>· {paidPacks} pacote(s) garantido(s)</span>}</h3>
    {pledges.filter(p => !p.expired).map(p => {
      const st = PLEDGE_STATUS[p.status] || PLEDGE_STATUS.PENDING;
      return (<Card key={p.id} style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div><b style={{ color: 'var(--text-strong)' }}>{p.packs} pacote(s) · {BRL(p.total_brl)}</b><div style={{ ...muted, fontSize: 'var(--fs-xs)' }}>Pacote nº {p.first_pack}{p.packs > 1 ? `–${p.first_pack + p.packs - 1}` : ''} · {(p.breakdown || []).map(b => b.label).join(' + ')}</div></div>
          <Tag color={st.color} style={{ alignSelf: 'flex-start' }}>{st.label}</Tag>
        </div>
        {p.status === 'PENDING' && <div style={{ display: 'flex', gap: 6 }}>
          <Btn style={{ flex: 1, minHeight: 40, padding: '8px 14px' }} disabled={!!busy} onClick={() => act('pay', p)}>{busy === 'pay' + p.id ? <Spin size={14} color="currentColor" /> : 'Pagar'}</Btn>
          <Btn variant="secondary" style={{ minHeight: 40, padding: '8px 14px' }} disabled={!!busy} onClick={() => act('sync', p)}>{busy === 'sync' + p.id ? <Spin size={14} /> : 'Já paguei'}</Btn>
          <Btn variant="ghost" style={{ minHeight: 40, padding: '8px 10px' }} disabled={!!busy} onClick={() => act('cancel', p)} title="Desistir"><X size={15} /></Btn>
        </div>}
      </Card>);
    })}
  </div>);
}

// ── 3. Votação ───────────────────────────────────────────
function Voting({ c, ranking, myVotes, token, toast, onChange }) {
  const [term, setTerm] = useState('');
  const [preset, setPreset] = useState('commander');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState('');
  const mine = useMemo(() => new Set(myVotes || []), [myVotes]);
  const votesById = useMemo(() => new Map((ranking || []).map(r => [r.oracle_id, r.votes])), [ranking]);
  const left = Math.max(0, (c.max_votes_per_user || 20) - mine.size);

  // Busca no Scryfall direto do navegador (a API deles aceita CORS).
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      if (!term.trim() && !preset) { setResults([]); return; }
      setSearching(true);
      const { q, order } = scryfallQuery(term, term.trim() ? null : preset);
      try {
        const r = await fetch(`https://api.scryfall.com/cards/search?unique=cards&order=${order}&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
        const d = await r.json();
        if (alive) setResults((d.data || []).slice(0, 30).map(scryfallToVote).filter(Boolean));
      } catch { if (alive) setResults([]); }
      if (alive) setSearching(false);
    }, term ? 350 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [term, preset]);

  async function toggle(card) {
    const voted = mine.has(card.oracle_id);
    if (!voted && left <= 0) { toast(`Você já usou seus ${c.max_votes_per_user} votos. Tire um para votar em outra.`, 'error'); return; }
    setBusy(card.oracle_id);
    try { await api(token, { action: voted ? 'unvote' : 'vote', oracle_id: card.oracle_id }); if (!voted) SFX.addCard(); await onChange(); }
    catch (e) { toast(e.message, 'error'); }
    setBusy('');
  }

  return (<div style={section}>
    <div>
      <h3 style={h2}>Quais cartas você quer em português?</h3>
      <p style={muted}>Vote em até {c.max_votes_per_user} cartas. As {c.cards_per_pack} mais pedidas viram o pacote. Só aparecem cartas que têm versão sem selo holográfico. {token && <b style={{ color: 'var(--text-strong)' }}>Você tem {left} voto(s).</b>}</p>
    </div>

    {ranking?.length > 0 && <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Trophy size={15} /><b style={{ color: 'var(--text-strong)' }}>Mais votadas</b><span style={{ ...muted, fontSize: 'var(--fs-xs)' }}>· top {c.cards_per_pack} entra no pacote</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 420, overflowY: 'auto', border: '1px solid var(--line-soft)', borderRadius: 'var(--r-card)' }}>
        {ranking.slice(0, 80).map((r, i) => (
          <div key={r.oracle_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: i < c.cards_per_pack ? 'transparent' : 'var(--fill-soft)', borderBottom: i === c.cards_per_pack - 1 ? '2px dashed var(--gp)' : 'none' }}>
            <span style={{ width: 24, fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', fontWeight: 700 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.pt_name || r.card_name}</div>
              {r.pt_name && <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' }}>{r.card_name}</div>}
            </div>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)' }}>{r.votes} voto{r.votes > 1 ? 's' : ''}</span>
            <VoteBtn on={r.mine} busy={busy === r.oracle_id} onClick={() => toggle(r)} disabled={!token} />
          </div>
        ))}
      </div>
    </>}

    <div style={{ position: 'relative' }}>
      <Search size={17} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
      <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Buscar carta (nome em inglês)" type="search" style={{ width: '100%', padding: '13px 14px 13px 42px', borderRadius: 'var(--r-control)', border: '1px solid var(--line)', background: 'var(--field-bg)', color: 'var(--text)', fontSize: 16, fontFamily: 'inherit' }} />
    </div>
    {!term.trim() && <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
      {SUGGESTION_PRESETS.map(p => <button key={p.key} onClick={() => { SFX.toggle(); setPreset(p.key); }} style={{ flexShrink: 0, padding: '7px 12px', borderRadius: 'var(--r-pill)', border: '1px solid ' + (preset === p.key ? 'var(--text-strong)' : 'var(--line)'), background: preset === p.key ? 'var(--text-strong)' : 'transparent', color: preset === p.key ? 'var(--bg)' : 'var(--text)', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{p.label}</button>)}
    </div>}
    {searching && <div style={{ display: 'grid', placeItems: 'center', padding: 20 }}><Spin /></div>}
    {!searching && results.length === 0 && term.trim() && <div style={muted}>Nada encontrado sem selo holográfico.</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
      {results.map(card => {
        const on = mine.has(card.oracle_id);
        return (<div key={card.oracle_id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ position: 'relative' }}>
            <CardThumb card={{ name: card.card_name, image_url: card.image_url }} radius={8} />
            {votesById.get(card.oracle_id) > 0 && <span style={{ position: 'absolute', top: 4, left: 4, background: 'var(--overlay-bg)', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>♥ {votesById.get(card.oracle_id)}</span>}
          </div>
          <button disabled={!token || busy === card.oracle_id} onClick={() => toggle(card)} style={{ padding: '7px 4px', borderRadius: 'var(--r-pill)', border: '1px solid ' + (on ? 'var(--ok)' : 'var(--line)'), background: on ? 'rgba(var(--ok-rgb),.12)' : 'transparent', color: on ? 'var(--ok)' : 'var(--text-strong)', fontSize: 'var(--fs-2xs)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            {busy === card.oracle_id ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : on ? <><Check size={12} /> Votei</> : <><Heart size={12} /> Votar</>}
          </button>
        </div>);
      })}
    </div>
  </div>);
}

function VoteBtn({ on, busy, onClick, disabled }) {
  return <button onClick={onClick} disabled={disabled || busy} aria-label={on ? 'Tirar voto' : 'Votar'} style={{ width: 34, height: 34, borderRadius: 17, border: '1px solid ' + (on ? 'var(--ok)' : 'var(--line)'), background: on ? 'rgba(var(--ok-rgb),.12)' : 'transparent', color: on ? 'var(--ok)' : 'var(--text-dim)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
    {busy ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Heart size={14} fill={on ? 'currentColor' : 'none'} />}
  </button>;
}

function FinalList({ cards, total }) {
  return (<div style={section}>
    <h3 style={h2}>As {cards.length} cartas do pacote</h3>
    <p style={muted}>Escolhidas pela votação{cards.length < total ? ` (${total - cards.length} ainda em definição)` : ''}.</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
      {cards.map(card => <div key={card.oracle_id}><CardThumb card={{ name: card.card_name, image_url: card.image_url }} radius={8} /><div style={{ fontSize: 'var(--fs-2xs)', marginTop: 4, color: 'var(--text-strong)', fontWeight: 600 }}>{card.pt_name || card.card_name}</div></div>)}
    </div>
  </div>);
}

function HowItWorks({ c }) {
  const items = [
    ['O que vem no pacote?', `${c.cards_per_pack} cartas diferentes, todas em português e iguais em todos os pacotes. A caixa com ${c.box_packs} pacotes dá ${c.box_packs} cópias de cada carta: um playset completo.`],
    ['Por que o preço muda?', 'Os primeiros apoios pagam a impressão do lote inteiro, por isso pagam menos. Cada faixa que esgota libera a próxima, mais cara.'],
    ['E se a meta não bater?', `O lote só é encomendado com ${c.goal_packs} pacotes pagos. Se não bater até o prazo, devolvemos 100% do valor pelo Mercado Pago.`],
    ['Quando chega?', 'Depois que a meta bate, encomendamos a impressão. Avisamos cada etapa por e-mail e aqui no portal. O frete é cobrado à parte quando o lote chegar.'],
    ['São cartas oficiais?', 'Não. São impressões personalizadas para jogar casual e em mesa de amigos, não para torneio oficial.'],
  ];
  return (<div style={section}>
    <h3 style={h2}>Como funciona</h3>
    {items.map(([q, a]) => <details key={q} style={{ borderBottom: '1px solid var(--line-soft)', paddingBottom: 10 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-strong)', fontSize: 'var(--fs-sm)' }}>{q}</summary>
      <p style={{ ...muted, marginTop: 6 }}>{a}</p>
    </details>)}
  </div>);
}
