// Console do financiamento coletivo: progresso, dinheiro, votação, apoios e convite.
import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Mail, Plus, RefreshCw, Send, Trash2, Undo2 } from 'lucide-react';
import { BRL, financeSummary, SUPPLIER_LOT_USD } from '../../../shared/crowdfund';
import { SFX, Spin } from '../../kit';
import { Badge, Empty, Loading, SectionTitle, Segmented, timeAgo } from '../ui';

const STATUS = [
  { key: 'DRAFT', label: 'Rascunho', color: 'var(--text-dim)', hint: 'Só você vê' },
  { key: 'OPEN', label: 'Aberta', color: 'var(--ok)', hint: 'Aceitando apoios e votos' },
  { key: 'FUNDED', label: 'Meta batida', color: 'var(--gp)', hint: 'Ainda vendendo' },
  { key: 'CLOSED', label: 'Encerrada', color: 'var(--gold)', hint: 'Sem novos apoios' },
  { key: 'CANCELLED', label: 'Cancelada', color: 'var(--danger)', hint: 'Reembolsos' },
];
const PLEDGE_COLORS = { PAID: 'var(--ok)', PENDING: 'var(--gold)', EXPIRED: 'var(--text-dim)', CANCELLED: 'var(--text-dim)', REFUNDED: 'var(--danger)' };
const PLEDGE_LABELS = { PAID: 'Pago', PENDING: 'Pendente', EXPIRED: 'Venceu', CANCELLED: 'Desistiu', REFUNDED: 'Reembolsado' };

async function copy(text, toast) {
  try { await navigator.clipboard.writeText(text); toast && toast('Copiado!', 'success'); }
  catch { toast && toast('Não foi possível copiar', 'error'); }
}

export default function CrowdfundView({ ctx }) {
  const { apiPost, toast } = ctx;
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('overview');
  async function load(body = { action: 'get' }) {
    try { const r = await apiPost('/api/admin-crowdfund', body); setD(r); setErr(''); return r; }
    catch (e) { setErr(e.message || String(e)); throw e; }
  }
  useEffect(() => { load().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !d) return <div className="adm-info is-bad">{err}<br />Rode <b className="adm-mono">supabase/migrations/crowdfund.sql</b> no SQL Editor do Supabase.</div>;
  if (!d) return <Loading />;
  const paidCount = d.pledges.filter(p => p.status === 'PAID').length;
  return (<>
    <Segmented value={tab} onChange={setTab} options={[
      { key: 'overview', label: 'Resumo' },
      { key: 'setup', label: 'Campanha' },
      { key: 'cards', label: 'Cartas', count: d.ranking.length },
      { key: 'pledges', label: 'Apoios', count: paidCount },
      { key: 'email', label: 'Convite' },
    ]} />
    {tab === 'overview' && <Overview d={d} />}
    {tab === 'setup' && <Setup d={d} load={load} toast={toast} />}
    {tab === 'cards' && <Cards d={d} load={load} toast={toast} />}
    {tab === 'pledges' && <Pledges d={d} load={load} toast={toast} />}
    {tab === 'email' && <Invite d={d} apiPost={apiPost} toast={toast} />}
  </>);
}

function Stat({ label, value, sub, color }) {
  return <div className="adm-card adm-pad" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span className="adm-muted" style={{ fontSize: 'var(--fs-2xs)' }}>{label}</span>
    <b style={{ fontSize: 'var(--fs-lg)', color: color || 'var(--text-strong)' }}>{value}</b>
    {sub && <span className="adm-muted" style={{ fontSize: 'var(--fs-2xs)' }}>{sub}</span>}
  </div>;
}

function Overview({ d }) {
  const { campaign: c, progress: pr, finance: f } = d;
  const st = STATUS.find(s => s.key === c.status) || STATUS[0];
  return (<>
    <div className="adm-card adm-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{c.title}</b><Badge color={st.color}>{st.label}</Badge></div>
      <div className="adm-progress" style={{ '--c': pr.goalReached ? 'var(--ok)' : 'var(--gp)' }}><i className="is-on" style={{ flex: `0 0 ${pr.goalPct}%` }} /></div>
      <div className="adm-muted">{pr.paid}/{pr.goal} pacotes pagos para a meta · {pr.taken - pr.paid} reservado(s) · {pr.capacity - pr.taken} livre(s) de {pr.capacity}</div>
      {c.deadline && <div className="adm-muted">Prazo: {new Date(c.deadline).toLocaleString('pt-BR')}</div>}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <Stat label="Arrecadado (pago)" value={BRL(pr.paidRevenue)} sub={`${pr.backers} apoiador(es) · líquido ${BRL(f.paidNet)}`} />
      <Stat label="Falta para pagar o lote" value={BRL(f.toCoverLot)} color={f.paidCoversLot ? 'var(--ok)' : undefined} sub={f.paidCoversLot ? 'Lote pago! Pode encomendar.' : `Custo do lote ${BRL(f.lotCost)}`} />
      <Stat label="Custo por carta" value={BRL(f.costPerCard)} sub={`${BRL(f.costPerPack)} o pacote · dólar ${f.fxEffective.toFixed(2).replace('.', ',')}`} />
      <Stat label="Lucro se esgotar" value={BRL(f.fullProfit)} color="var(--ok)" sub={`Receita ${BRL(f.fullRevenue)} − taxa MP − lote`} />
    </div>
    <div className={'adm-info' + (f.goalCoversLot ? '' : ' is-bad')}>
      {f.goalCoversLot
        ? <>A meta ({c.goal_packs} pacotes) rende {BRL(f.goalNet)} líquidos e paga o lote de {BRL(f.lotCost)}. Tudo que vender depois é lucro.</>
        : <><b>A meta não paga o lote.</b> {c.goal_packs} pacotes rendem {BRL(f.goalNet)} líquidos, mas o lote custa {BRL(f.lotCost)}. Suba a meta ou o preço da primeira faixa.</>}
    </div>
    <SectionTitle>Faixas</SectionTitle>
    <div className="adm-card adm-list">
      {pr.tiers.map(t => <div key={t.label} className="adm-item" style={{ cursor: 'default' }}>
        <span className="adm-item-main"><span className="adm-item-title"><span>{t.label}</span>{t.state === 'current' && <Badge color="var(--gp)">agora</Badge>}</span>
          <span className="adm-item-sub">Pacotes {t.from}–{t.upto} · {t.sold}/{t.size} vendidos · {BRL(t.per_card_brl)}/carta · {BRL(t.per_card_brl * c.cards_per_pack)}/pacote</span></span>
      </div>)}
    </div>
  </>);
}

function Setup({ d, load, toast }) {
  const c = d.campaign;
  const [f, setF] = useState(() => ({
    title: c.title, subtitle: c.subtitle || '', description: c.description || '', status: c.status, finish: c.finish,
    cards_per_pack: c.cards_per_pack, box_packs: c.box_packs, goal_packs: c.goal_packs,
    deadline: c.deadline ? new Date(c.deadline).toISOString().slice(0, 16) : '',
    supplier_lot_usd: c.supplier_lot_usd, extra_costs_brl: c.extra_costs_brl, fx_markup_pct: c.fx_markup_pct, max_votes_per_user: c.max_votes_per_user,
    tiers: (c.tiers || []).map(t => ({ ...t })),
  }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const preview = useMemo(() => financeSummary({
    tiers: f.tiers, cardsPerPack: Number(f.cards_per_pack), goalPacks: Number(f.goal_packs), supplierLotUsd: Number(f.supplier_lot_usd),
    fxRate: d.finance.fx?.rate || 5.5, fxMarkupPct: Number(f.fx_markup_pct), extraCostsBrl: Number(f.extra_costs_brl),
  }), [f, d.finance.fx]);

  async function save() {
    setSaving(true);
    try {
      await load({ action: 'save', patch: { ...f, deadline: f.deadline ? new Date(f.deadline).toISOString() : null } });
      SFX.success(); toast('Campanha salva', 'success');
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  }
  const num = (k, label, step = '1') => <div><label className="adm-label">{label}</label><input className="adm-input" type="number" inputMode="decimal" step={step} value={f[k] ?? ''} onChange={e => set(k, e.target.value === '' ? '' : Number(e.target.value))} /></div>;

  return (<>
    <div className="adm-card adm-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="adm-label">Status</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STATUS.map(s => <button key={s.key} className={'adm-chip' + (f.status === s.key ? ' is-active' : '')} style={{ '--c': s.color }} onClick={() => set('status', s.key)} title={s.hint}>{s.label}</button>)}
      </div>
      <div><label className="adm-label">Título</label><input className="adm-input" value={f.title} onChange={e => set('title', e.target.value)} /></div>
      <div><label className="adm-label">Subtítulo</label><input className="adm-input" value={f.subtitle} onChange={e => set('subtitle', e.target.value)} /></div>
      <div><label className="adm-label">Prazo</label><input className="adm-input" type="datetime-local" value={f.deadline} onChange={e => set('deadline', e.target.value)} /></div>
    </div>

    <div className="adm-card adm-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="adm-label">Acabamento do lote (o fornecedor cobra pelo lote inteiro)</label>
      <div style={{ display: 'flex', gap: 6 }}>
        {Object.entries(SUPPLIER_LOT_USD).map(([k, usd]) => <button key={k} className={'adm-chip' + (f.finish === k ? ' is-active' : '')} onClick={() => setF(x => ({ ...x, finish: k, supplier_lot_usd: usd }))}>{k} · US$ {usd}</button>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {num('cards_per_pack', 'Cartas por pacote')}
        {num('box_packs', 'Pacotes na caixa')}
        {num('goal_packs', 'Meta (pacotes pagos)')}
        {num('max_votes_per_user', 'Votos por pessoa')}
        {num('supplier_lot_usd', 'Lote do fornecedor (US$)', '50')}
        {num('extra_costs_brl', 'Frete + AliExpress (R$)', '10')}
        {num('fx_markup_pct', 'Spread PayPal sobre o dólar (%)', '0.1')}
      </div>
    </div>

    <div className="adm-card adm-pad" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <b style={{ fontSize: 'var(--fs-xs)' }}>Faixas (até o pacote nº · R$ por carta)</b>
      {f.tiers.map((t, i) => <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input className="adm-input" style={{ flex: 2, minWidth: 0 }} value={t.label} placeholder="Nome" onChange={e => set('tiers', f.tiers.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
        <input className="adm-input" style={{ flex: 1, minWidth: 0 }} type="number" value={t.upto} onChange={e => set('tiers', f.tiers.map((x, j) => j === i ? { ...x, upto: Number(e.target.value) } : x))} />
        <input className="adm-input" style={{ flex: 1, minWidth: 0 }} type="number" step="0.5" value={t.per_card_brl} onChange={e => set('tiers', f.tiers.map((x, j) => j === i ? { ...x, per_card_brl: Number(e.target.value) } : x))} />
        <button className="adm-btn is-sm is-danger" style={{ width: 38, height: 38, padding: 0 }} onClick={() => set('tiers', f.tiers.filter((_, j) => j !== i))} aria-label="Remover faixa"><Trash2 size={14} /></button>
      </div>)}
      <button className="adm-btn is-ghost" onClick={() => set('tiers', [...f.tiers, { label: '', upto: (f.tiers.at(-1)?.upto || 0) + 30, per_card_brl: 16 }])}><Plus size={14} /> Adicionar faixa</button>
    </div>

    <div className={'adm-info' + (preview.goalCoversLot ? '' : ' is-bad')}>
      Simulação: lote {BRL(preview.lotCost)} ({BRL(preview.costPerCard)}/carta) · meta rende {BRL(preview.goalNet)} {preview.goalCoversLot ? '✓ paga o lote' : '✗ NÃO paga o lote'} · esgotando, lucro de {BRL(preview.fullProfit)}.
    </div>
    <button className="adm-btn is-block is-primary" disabled={saving} onClick={save}>{saving ? <Spin size={15} /> : <><Check size={16} /> Salvar campanha</>}</button>
  </>);
}

function Cards({ d, load, toast }) {
  const c = d.campaign;
  const finalIds = (c.final_cards || []).map(x => x.oracle_id);
  const [sel, setSel] = useState(() => new Set(finalIds.length ? finalIds : d.ranking.slice(0, c.cards_per_pack).map(r => r.oracle_id)));
  const [saving, setSaving] = useState(false);
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function saveFinal(ids) {
    setSaving(true);
    try { await load({ action: 'final', cards: ids }); SFX.success(); toast(ids.length ? `Lista final com ${ids.length} cartas publicada` : 'Lista final removida: a votação volta a aparecer', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  }
  const listText = d.ranking.filter(r => sel.has(r.oracle_id)).map((r, i) => `${i + 1}. ${r.card_name}${r.pt_name ? ` (${r.pt_name})` : ''}${r.set_code ? ` [${r.set_code.toUpperCase()}]` : ''}`).join('\n');
  if (!d.ranking.length) return <Empty title="Nenhum voto ainda" sub="Abra a campanha e mande o convite." />;
  return (<>
    <div className="adm-info">{d.voters} pessoa(s) votaram em {d.ranking.length} cartas. Marcadas: <b>{sel.size}/{c.cards_per_pack}</b>. Ao publicar a lista final, a votação some da página e aparecem as cartas escolhidas.</div>
    <div className="adm-row-actions">
      <button className="adm-btn is-primary" style={{ flex: 1 }} disabled={saving || !sel.size} onClick={() => saveFinal(d.ranking.filter(r => sel.has(r.oracle_id)).map(r => r.oracle_id))}>{saving ? <Spin size={14} /> : <><Check size={14} /> Publicar lista final</>}</button>
      <button className="adm-btn" onClick={() => copy(listText, toast)} title="Copiar lista para mandar ao fornecedor"><Copy size={14} /></button>
      {finalIds.length > 0 && <button className="adm-btn is-ghost" disabled={saving} onClick={() => saveFinal([])} title="Voltar para a votação"><Undo2 size={14} /></button>}
    </div>
    <div className="adm-card adm-list">
      {d.ranking.map((r, i) => <label key={r.oracle_id} className="adm-item" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={sel.has(r.oracle_id)} onChange={() => toggle(r.oracle_id)} />
        <span className="adm-item-main"><span className="adm-item-title"><span>{i + 1}. {r.card_name}</span><Badge color="var(--gp)">{r.votes}</Badge></span>
          <span className="adm-item-sub">{r.pt_name || 'sem nome em PT no Scryfall'}{r.set_code ? ` · ${r.set_code.toUpperCase()}` : ''}{r.usd_price ? ` · US$ ${r.usd_price}` : ''}</span></span>
      </label>)}
    </div>
  </>);
}

function Pledges({ d, load, toast }) {
  const [filter, setFilter] = useState('PAID');
  const [busy, setBusy] = useState(false);
  const list = d.pledges.filter(p => filter === 'ALL' || p.status === filter);
  const csv = ['nº,nome,email,whatsapp,pacotes,total,status,pago em',
    ...d.pledges.filter(p => p.status === 'PAID').map(p => [p.first_pack, p.profiles?.name, p.profiles?.email, p.profiles?.whatsapp, p.packs, p.total_brl, p.status, p.paid_at].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  async function refundAll() {
    if (!window.confirm('Reembolsar TODOS os apoios pagos pelo Mercado Pago e cancelar a campanha? Não dá para desfazer.')) return;
    setBusy(true);
    try {
      let left = 1, total = 0;
      while (left > 0) {
        const r = await load({ action: 'refund_all' });
        total += r.result.refunded; left = r.result.left;
        if (r.result.failed) { toast(`Parou com erro: ${r.result.firstError}`, 'error'); break; }
      }
      await load(); toast(`${total} apoio(s) reembolsado(s)`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  }
  return (<>
    <div className="adm-chips">
      {['PAID', 'PENDING', 'REFUNDED', 'ALL'].map(k => <button key={k} className={'adm-chip' + (filter === k ? ' is-active' : '')} onClick={() => setFilter(k)}>{k === 'ALL' ? 'Todos' : PLEDGE_LABELS[k]}<small>{k === 'ALL' ? d.pledges.length : d.pledges.filter(p => p.status === k).length}</small></button>)}
    </div>
    {list.length ? <div className="adm-card adm-list">
      {list.map(p => <div key={p.id} className="adm-item" style={{ cursor: 'default', '--c': PLEDGE_COLORS[p.status] }}>
        <span className="adm-item-main">
          <span className="adm-item-title"><span>{p.profiles?.name || p.profiles?.email || 'Cliente'}</span><Badge color={PLEDGE_COLORS[p.status]}>{PLEDGE_LABELS[p.status]}</Badge></span>
          <span className="adm-item-sub">nº {p.first_pack}{p.packs > 1 ? `–${p.first_pack + p.packs - 1}` : ''} · {p.packs} pacote(s) · {BRL(p.total_brl)} · {timeAgo(p.paid_at || p.created_at)}</span>
        </span>
      </div>)}
    </div> : <Empty title="Nada aqui" />}
    <div className="adm-row-actions">
      <button className="adm-btn" style={{ flex: 1 }} onClick={() => copy(csv, toast)}><Copy size={14} /> Copiar planilha dos pagos (CSV)</button>
      <button className="adm-btn" onClick={() => load()}><RefreshCw size={14} /></button>
    </div>
    <div className="adm-card adm-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <b>Meta não bateu?</b>
      <div className="adm-muted">Devolve o dinheiro de todos os apoios pagos pelo Mercado Pago e marca a campanha como cancelada.</div>
      <button className="adm-btn is-danger" disabled={busy || !d.pledges.some(p => p.status === 'PAID')} onClick={refundAll}>{busy ? <Spin size={14} /> : <><Undo2 size={14} /> Reembolsar todos</>}</button>
    </div>
  </>);
}

function Invite({ d, apiPost, toast }) {
  const e = d.email;
  const [subject, setSubject] = useState(e.defaults.subject);
  const [message, setMessage] = useState(e.defaults.message);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  async function send() {
    if (!window.confirm(`Mandar o convite para ${e.audience} pessoa(s) da base do portal?`)) return;
    setBusy(true);
    try { const r = await apiPost('/api/admin-crowdfund', { action: 'invite', subject, message }); setResult(r.result); SFX.success(); toast(`Enviado para ${r.result.sent} pessoa(s)`, 'success'); }
    catch (err) { toast(err.message, 'error'); }
    setBusy(false);
  }
  return (<>
    {d.campaign.status === 'DRAFT' && <div className="adm-info is-warn">A campanha está em <b>rascunho</b>: quem clicar no link não vai ver nada. Abra a campanha em "Campanha" antes de mandar.</div>}
    <div className="adm-card adm-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <b><Mail size={14} style={{ verticalAlign: -2 }} /> Base do portal</b>
      <div className="adm-muted">{e.audience ?? '—'} cliente(s) com e-mail e sem descadastro. Use {'{nome}'} para o primeiro nome.</div>
      <input className="adm-input" value={subject} onChange={x => setSubject(x.target.value)} />
      <textarea className="adm-input" rows={8} value={message} onChange={x => setMessage(x.target.value)} style={{ resize: 'vertical', fontFamily: 'inherit' }} />
      <button className="adm-btn is-primary" disabled={busy || !e.configured || !e.ctaUrl} onClick={send}>{busy ? <Spin size={14} /> : <><Send size={14} /> Enviar para {e.audience ?? 0}</>}</button>
      {!e.configured && <div className="adm-info is-warn">Configure RESEND_API_KEY no Cloudflare Pages.</div>}
      {result && <div className="adm-muted">{result.sent} enviado(s){result.failed ? ` · ${result.failed} falha(s): ${result.firstError}` : ''}</div>}
    </div>
    <div className="adm-card adm-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <b>Wix (base de fora)</b>
      <div className="adm-muted">Link da campanha para o botão do e-mail no Wix. O <span className="adm-mono">origem=wix</span> deixa claro de onde a pessoa veio.</div>
      <div className="adm-info adm-mono" style={{ wordBreak: 'break-all' }}>{e.ctaUrl ? `${e.ctaUrl}&origem=wix` : 'Registre o domínio em Mais → Automações'}</div>
      <div className="adm-row-actions">
        <button className="adm-btn" style={{ flex: 1 }} disabled={!e.ctaUrl} onClick={() => copy(`${e.ctaUrl}&origem=wix`, toast)}><Copy size={14} /> Copiar link</button>
        <button className="adm-btn" style={{ flex: 1 }} disabled={!e.wix} onClick={() => copy(e.wix.text, toast)}><Copy size={14} /> Copiar texto</button>
        <button className="adm-btn" style={{ flex: 1 }} disabled={!e.wix} onClick={() => copy(e.wix.html, toast)}><Copy size={14} /> Copiar HTML</button>
      </div>
    </div>
  </>);
}
