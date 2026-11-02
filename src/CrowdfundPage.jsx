// Landing do financiamento coletivo: pacotes de cartas em português.
//
// Ordem da página, de cima para baixo:
//   1. hero com imagem e a meta (por que entrar agora);
//   2. o que vem no pacote e na caixa (fotos), galeria e detalhe em português;
//   3. faixas de preço e compra (frete do MandaBem cotado na hora);
//   4. votação das cartas (Scryfall, só cartas sem selo holográfico).
// As imagens vêm de campaign.images e são trocadas no console do admin; sem
// imagem, cada espaço mostra um fundo desenhado (e as cartas mais votadas).
// Preço, frete e vagas são do servidor (/api/crowdfund); aqui é só prévia.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock, Heart, ImageIcon, Loader, MapPin, Minus, Package, Plus, RefreshCw, Search, Sparkles, Trophy, Truck, Users, X } from 'lucide-react';
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
const h2 = { fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text-strong)', letterSpacing: -0.4, lineHeight: 1.2 };
const kicker = { fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ok)' };
const muted = { fontSize: 'var(--fs-sm)', color: 'var(--text-dim)', lineHeight: 1.5 };
// Fundo desenhado dos espaços sem foto: verde e amarelo discretos.
const ART_BG = 'radial-gradient(120% 90% at 0% 0%, rgba(0,156,59,.55), transparent 60%), radial-gradient(90% 80% at 100% 100%, rgba(255,223,0,.35), transparent 60%), linear-gradient(160deg,#0f1a14,#0b0b0c)';

/** Espaço de imagem: a foto, ou o fundo desenhado com um rótulo. */
function Slot({ src, ratio = '4/3', label, radius = 'var(--r-card)', children, style }) {
  const [err, setErr] = useState(false);
  const has = src && !err;
  return (<div style={{ position: 'relative', aspectRatio: ratio, borderRadius: radius, overflow: 'hidden', background: has ? '#111' : ART_BG, border: '1px solid var(--line-soft)', ...style }}>
    {has && <img src={src} alt={label || ''} loading="lazy" onError={() => setErr(true)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
    {!has && !children && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.55)' }}><div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', fontWeight: 600 }}><ImageIcon size={26} strokeWidth={1.5} />{label}</div></div>}
    {children}
  </div>);
}

/** Leque de cartas (as mais votadas) para o hero sem foto. */
function CardFan({ cards }) {
  const list = cards.filter(c => c.image_url).slice(0, 5);
  if (!list.length) return <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 90, opacity: .25 }}>🃏</div>;
  const mid = (list.length - 1) / 2;
  return (<div style={{ position: 'absolute', left: 0, right: 0, top: '7%', height: '46%', display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
    {list.map((c, i) => <img key={c.oracle_id} src={c.image_url} alt="" style={{ width: '26%', marginLeft: i ? '-11%' : 0, borderRadius: 10, transform: `rotate(${(i - mid) * 9}deg) translateY(${Math.abs(i - mid) * 10}px)`, transformOrigin: 'bottom center', boxShadow: '0 10px 30px rgba(0,0,0,.5)', zIndex: 10 - Math.abs(i - mid) }} />)}
  </div>);
}

export default function CrowdfundPage({ token, toast, returnedFromPayment, profile, AddressForm, AddressDisplay }) {
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
  const img = c.images || {};
  const go = id => { SFX.nav(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-7, 40px)', paddingBottom: 48 }}>
    <Hero c={c} pr={pr} img={img} ranking={data.ranking} voters={data.voters} onBuy={() => go('apoiar')} onVote={() => go('votar')} />
    <WhatsInside c={c} img={img} />
    <Gallery img={img} ranking={data.ranking} />
    <TierLadder c={c} pr={pr} />
    <BuyBox c={c} pr={pr} isOpen={data.isOpen} token={token} toast={toast} onDone={load} profile={profile} AddressForm={AddressForm} AddressDisplay={AddressDisplay} />
    {data.myPledges?.length > 0 && <MyPledges pledges={data.myPledges} c={c} token={token} toast={toast} onChange={load} />}
    <div id="votar" style={{ scrollMarginTop: 70 }}>
      {c.final_cards?.length > 0
        ? <FinalList cards={c.final_cards} total={c.cards_per_pack} />
        : <Voting c={c} ranking={data.ranking} myVotes={data.myVotes} token={token} toast={toast} onChange={load} />}
    </div>
    <HowItWorks c={c} />
    {data.isOpen && !pr.soldOut && <Btn full onClick={() => go('apoiar')}>Garantir meu pacote</Btn>}
  </div>);
}

// ── 1. Hero ──────────────────────────────────────────────
function Hero({ c, pr, img, ranking, voters, onBuy, onVote }) {
  const left = timeLeft(c.deadline);
  const price = pr.current ? BRL(pr.current.per_card_brl) : null;
  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 0, margin: '-14px -20px 0' }}>
    <Slot src={img.hero} ratio="4/5" radius="0" label="" style={{ border: 'none' }}>
      {!img.hero && <CardFan cards={ranking || []} />}
      <div style={{ position: 'absolute', inset: 0, zIndex: 15, background: 'linear-gradient(180deg, rgba(0,0,0,.15) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,.55) 58%, rgba(0,0,0,.94) 100%)' }} />
      <div style={{ position: 'absolute', left: 20, right: 20, bottom: 22, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 12, color: '#fff' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={pill('#009c3b')}>🇧🇷 Em português</span>
          <span style={pill()}>{c.cards_per_pack} cartas diferentes</span>
          {c.finish !== 'Normal' && <span style={pill('#b8860b')}><Sparkles size={11} /> {c.finish}</span>}
          {left && <span style={pill()}><Clock size={11} /> {left}</span>}
        </div>
        <h2 style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1, textShadow: '0 2px 20px rgba(0,0,0,.4)' }}>{c.title}</h2>
        {c.subtitle && <p style={{ fontSize: 'var(--fs-md)', lineHeight: 1.45, color: 'rgba(255,255,255,.85)' }}>{c.subtitle}</p>}
        {price && <div style={{ fontSize: 'var(--fs-sm)', color: 'rgba(255,255,255,.85)' }}>A partir de <b style={{ color: '#fff', fontSize: 'var(--fs-lg)' }}>{price}</b> por carta na faixa {pr.current.label}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onBuy} style={{ flex: 1, minHeight: 48, borderRadius: 'var(--r-pill)', border: 'none', background: '#fff', color: '#000', fontWeight: 700, fontSize: 'var(--fs-md)', cursor: 'pointer', fontFamily: 'inherit' }}>Garantir o meu</button>
          <button onClick={onVote} style={{ minHeight: 48, padding: '0 18px', borderRadius: 'var(--r-pill)', border: '1px solid rgba(255,255,255,.5)', background: 'rgba(255,255,255,.08)', color: '#fff', fontWeight: 600, fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit', backdropFilter: 'blur(8px)' }}>Votar nas cartas</button>
        </div>
      </div>
    </Slot>

    <div style={{ margin: '-1px 20px 0', position: 'relative' }}>
      <Card style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <b style={{ fontSize: 'var(--fs-xl)', color: 'var(--text-strong)' }}>{pr.paid} <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)', fontWeight: 500 }}>de {pr.goal} pacotes para imprimir</span></b>
          <span style={{ fontWeight: 700, color: pr.goalReached ? 'var(--ok)' : 'var(--text-strong)' }}>{pr.goalPct}%</span>
        </div>
        <div style={{ height: 10, borderRadius: 10, background: 'var(--fill-soft)', overflow: 'hidden' }}>
          <div style={{ width: pr.goalPct + '%', height: '100%', background: 'linear-gradient(90deg,#009c3b,#ffdf00)', transition: 'width .6s' }} />
        </div>
        <div style={{ display: 'flex', gap: 14, ...muted, fontSize: 'var(--fs-xs)' }}>
          <span><Users size={12} style={{ verticalAlign: -2 }} /> {pr.backers} apoiador(es)</span>
          <span><Heart size={12} style={{ verticalAlign: -2 }} /> {voters} votante(s)</span>
          {pr.current && <span><Package size={12} style={{ verticalAlign: -2 }} /> {pr.current.left} vaga(s) de {pr.current.label.toLowerCase()}</span>}
        </div>
        <div style={{ ...muted, fontSize: 'var(--fs-xs)' }}>
          {pr.goalReached ? '🎉 Meta batida: o lote vai ser impresso! Ainda dá para garantir o seu.' : `Faltam ${pr.goal - pr.paid} pacotes pagos para o lote sair. Se não bater até o prazo, todo mundo recebe o dinheiro de volta.`}
        </div>
      </Card>
    </div>
  </div>);
}
const pill = (bg) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999, background: bg || 'rgba(255,255,255,.16)', backdropFilter: 'blur(8px)', fontSize: 'var(--fs-2xs)', fontWeight: 700, color: '#fff' });

// ── 2. O que vem, galeria e detalhe ──────────────────────
function WhatsInside({ c, img }) {
  return (<div style={section}>
    <span style={kicker}>O que vem</span>
    <h3 style={h2}>Um pacote, {c.cards_per_pack} cartas.<br />Uma caixa, um playset.</h3>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <figure style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Slot src={img.pack} ratio="3/4" label="Foto do pacote" />
        <figcaption><b style={{ color: 'var(--text-strong)', fontSize: 'var(--fs-sm)' }}>Pacote</b><div style={{ ...muted, fontSize: 'var(--fs-xs)' }}>{c.cards_per_pack} cartas diferentes, uma de cada</div></figcaption>
      </figure>
      <figure style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Slot src={img.box} ratio="3/4" label="Foto da caixa" />
        <figcaption><b style={{ color: 'var(--text-strong)', fontSize: 'var(--fs-sm)' }}>Caixa com {c.box_packs}</b><div style={{ ...muted, fontSize: 'var(--fs-xs)' }}>{c.box_packs} cópias de cada carta: deck pronto</div></figcaption>
      </figure>
    </div>
    <Slot src={img.back} ratio="16/9" label="Foto de perto do texto em português">
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '28px 16px 14px', background: 'linear-gradient(180deg,transparent,rgba(0,0,0,.8))', color: '#fff' }}>
        <b style={{ fontSize: 'var(--fs-md)' }}>Texto inteiro em português</b>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'rgba(255,255,255,.8)' }}>Para ler na mesa sem tradutor e ensinar quem está começando.</div>
      </div>
    </Slot>
    {c.description && <p style={muted}>{c.description}</p>}
  </div>);
}

function Gallery({ img, ranking }) {
  const photos = img.gallery || [];
  const cards = photos.length ? [] : (ranking || []).filter(r => r.image_url).slice(0, 10);
  if (!photos.length && !cards.length) return null;
  return (<div style={section}>
    <span style={kicker}>{photos.length ? 'Galeria' : 'As mais pedidas até agora'}</span>
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollSnapType: 'x mandatory', margin: '0 -20px', padding: '0 20px 6px' }}>
      {photos.map(u => <Slot key={u} src={u} ratio="4/5" style={{ flex: '0 0 72%', scrollSnapAlign: 'start' }} />)}
      {cards.map(r => <div key={r.oracle_id} style={{ flex: '0 0 42%', scrollSnapAlign: 'start' }}>
        <CardThumb card={{ name: r.card_name, image_url: r.image_url }} radius={10} />
        <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-strong)', marginTop: 4 }}>{r.pt_name || r.card_name}</div>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' }}>♥ {r.votes} voto{r.votes > 1 ? 's' : ''}</div>
      </div>)}
    </div>
  </div>);
}

// ── Faixas de preço ──────────────────────────────────────
function TierLadder({ c, pr }) {
  return (<div style={section}>
    <span style={kicker}>Preço de fundador</span>
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

// ── 3. Comprar (com frete na hora) ───────────────────────
const addressReady = a => a && String(a.cep || '').replace(/\D/g, '').length === 8 && a.rua && a.numero && a.cidade && a.uf;

function BuyBox({ c, pr, isOpen, token, toast, onDone, profile, AddressForm, AddressDisplay }) {
  const available = pr.capacity - pr.taken;
  const [packs, setPacks] = useState(Math.min(c.box_packs, Math.max(1, available)));
  const [busy, setBusy] = useState(false);
  const saved = { cep: profile?.cep || '', rua: profile?.rua || '', numero: profile?.numero || '', complemento: profile?.complemento || '', bairro: profile?.bairro || '', cidade: profile?.cidade || '', uf: profile?.uf || '' };
  const hasSaved = addressReady(saved);
  const [addr, setAddr] = useState(saved);
  const [editAddr, setEditAddr] = useState(!hasSaved);
  const [frete, setFrete] = useState({ loading: false, options: [], error: '' });
  const [service, setService] = useState(null);
  // O perfil chega depois do primeiro render: preenche o endereço salvo.
  useEffect(() => {
    if (hasSaved && !String(addr.cep || '').trim()) { setAddr(saved); setEditAddr(false); }
  }, [hasSaved]); // eslint-disable-line react-hooks/exhaustive-deps
  const tiers = pr.tiers.map(({ upto, per_card_brl, label }) => ({ upto, per_card_brl, label }));
  const q = useMemo(() => quotePledge({ tiers, taken: pr.taken, packs, cardsPerPack: c.cards_per_pack }), [pr.taken, packs, c.cards_per_pack]); // eslint-disable-line react-hooks/exhaustive-deps

  // Frete cotado de novo a cada mudança de quantidade ou de CEP.
  const cep = String(addr.cep || '').replace(/\D/g, '');
  useEffect(() => {
    if (cep.length !== 8 || packs < 1) { setFrete({ loading: false, options: [], error: '' }); return; }
    let alive = true;
    setFrete(f => ({ ...f, loading: true, error: '' }));
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/frete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cepDestino: cep, quantidade: packs * c.cards_per_pack }) });
        const d = await r.json();
        if (!alive) return;
        const opts = (d.opcoes || []).map(o => ({ service: o.nome, price: Number(o.preco), days: o.prazo })).sort((a, b) => a.price - b.price);
        setFrete({ loading: false, options: opts, error: d.error || (opts.length ? '' : 'Sem opções de frete para este CEP') });
        setService(prev => (opts.find(o => o.service === prev) || opts[0])?.service || null);
      } catch { if (alive) setFrete({ loading: false, options: [], error: 'Não foi possível calcular o frete' }); }
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [cep, packs, c.cards_per_pack]);

  const chosen = frete.options.find(o => o.service === service) || null;
  const total = q.ok ? Math.round((q.total + (chosen?.price || 0)) * 100) / 100 : 0;
  const ready = q.ok && addressReady(addr) && chosen && !frete.loading;

  async function pledge() {
    setBusy(true);
    try {
      const r = await api(token, { action: 'pledge', packs, shipping: { service, address: addr }, saveAddress: !hasSaved });
      SFX.confirm();
      window.location.href = r.mpLink;
    } catch (e) { toast(e.message, 'error'); setBusy(false); onDone(); }
  }

  if (!isOpen || pr.soldOut) return <div id="apoiar"><Card><b style={{ color: 'var(--text-strong)' }}>{pr.soldOut ? 'Esgotado!' : 'Apoios encerrados'}</b><div style={muted}>{pr.soldOut ? 'Todos os pacotes desse lote foram vendidos.' : 'Essa campanha não está aceitando novos apoios.'}</div></Card></div>;

  const options = [
    { n: 1, title: '1 pacote', sub: `${c.cards_per_pack} cartas, uma de cada` },
    { n: c.box_packs, title: `Caixa com ${c.box_packs}`, sub: `Playset: ${c.box_packs} cópias de cada`, best: true },
  ];
  return (<div style={{ ...section, scrollMarginTop: 70 }} id="apoiar">
    <span style={kicker}>Garanta o seu</span>
    <h3 style={h2}>Escolha quantos pacotes</h3>
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
        <input aria-label="Pacotes" inputMode="numeric" value={packs} onChange={e => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); setPacks(Number.isFinite(n) ? Math.max(1, Math.min(available, n)) : 1); }} style={{ width: 52, textAlign: 'center', fontWeight: 700, fontSize: 16, padding: '6px 0', borderRadius: 'var(--r-control)', border: '1px solid var(--line)', background: 'var(--field-bg)', color: 'var(--text-strong)', fontFamily: 'inherit' }} />
        <button className="mp-tap" aria-label="Mais um pacote" onClick={() => setPacks(p => Math.min(available, p + 1))} style={stepBtn}><Plus size={15} /></button>
      </div>
    </div>

    <Card style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
      <b style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-strong)' }}><MapPin size={15} /> Entrega</b>
      {!editAddr && AddressDisplay
        ? <AddressDisplay address={addr} onEdit={() => setEditAddr(true)} />
        : AddressForm ? <AddressForm address={addr} setAddress={setAddr} /> : null}
      {frete.loading && <div style={{ ...muted, display: 'flex', gap: 6, alignItems: 'center' }}><Spin size={14} /> Calculando frete…</div>}
      {!frete.loading && frete.error && <div style={{ ...muted, color: 'var(--danger)' }}>{frete.error}</div>}
      {!frete.loading && frete.options.map(o => <label key={o.service} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 'var(--r-control)', border: '1px solid ' + (service === o.service ? 'var(--gp)' : 'var(--line)'), cursor: 'pointer' }}>
        <input type="radio" name="cf-frete" checked={service === o.service} onChange={() => setService(o.service)} />
        <Truck size={15} />
        <span style={{ flex: 1 }}><b style={{ color: 'var(--text-strong)', fontSize: 'var(--fs-sm)' }}>{o.service}</b>{o.days ? <span style={{ ...muted, fontSize: 'var(--fs-xs)' }}> · {o.days} dia(s) úteis depois do envio</span> : null}</span>
        <b style={{ fontSize: 'var(--fs-sm)' }}>{BRL(o.price)}</b>
      </label>)}
      {cep.length !== 8 && <div style={{ ...muted, fontSize: 'var(--fs-xs)' }}>Digite o CEP para calcular o frete.</div>}
    </Card>

    {q.ok && <Card style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 14 }}>
      {q.breakdown.map(b => <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)' }}><span style={{ color: 'var(--text-dim)' }}>{b.packs}× {b.label} ({BRL(b.per_card_brl)}/carta)</span><span>{BRL(b.packs * b.per_pack_brl)}</span></div>)}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)' }}><span style={{ color: 'var(--text-dim)' }}>Frete {chosen ? chosen.service : ''}</span><span>{chosen ? BRL(chosen.price) : '—'}</span></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--text-strong)', borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}><span>Total</span><span>{chosen ? BRL(total) : '—'}</span></div>
      <div style={{ ...muted, fontSize: 'var(--fs-xs)' }}>Média de {BRL(q.perCardAvg)} por carta.</div>
    </Card>}
    {!q.ok && <div style={{ ...muted, color: 'var(--danger)' }}>{q.error}</div>}
    <Btn full disabled={!ready || busy || !token} onClick={pledge}>{busy ? <Spin size={16} color="currentColor" /> : <>Apoiar com {ready ? BRL(total) : '—'}</>}</Btn>
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
          <div><b style={{ color: 'var(--text-strong)' }}>{p.packs} pacote(s) · {BRL(p.total_brl)}</b>{Number(p.shipping_brl) > 0 && <span style={{ ...muted, fontSize: 'var(--fs-2xs)' }}> com frete {p.shipping_service}</span>}<div style={{ ...muted, fontSize: 'var(--fs-xs)' }}>Pacote nº {p.first_pack}{p.packs > 1 ? `–${p.first_pack + p.packs - 1}` : ''} · {(p.breakdown || []).map(b => b.label).join(' + ')}</div></div>
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

// ── 4. Votação ───────────────────────────────────────────
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
      <span style={kicker}>Você escolhe</span>
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
    ['Quando chega?', 'Depois que a meta bate, encomendamos a impressão. Avisamos cada etapa por e-mail e aqui no portal, e enviamos para o endereço do seu apoio.'],
    ['E o frete?', 'É calculado na hora da compra pelo seu CEP e entra no mesmo pagamento. Nada para pagar depois.'],
  ];
  return (<div style={section}>
    <span style={kicker}>Dúvidas</span>
    <h3 style={h2}>Como funciona</h3>
    {items.map(([q, a]) => <details key={q} style={{ borderBottom: '1px solid var(--line-soft)', paddingBottom: 10 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-strong)', fontSize: 'var(--fs-sm)' }}>{q}</summary>
      <p style={{ ...muted, marginTop: 6 }}>{a}</p>
    </details>)}
  </div>);
}
