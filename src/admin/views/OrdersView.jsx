// Aba "Pedidos": lista com filtros, compras no fornecedor e a folha de detalhe.
import { Fragment, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle, ClipboardList, Copy, Download, MessageCircle, Package, RefreshCw, ShoppingCart, Truck, X } from 'lucide-react';
import { ordersCsv } from '../../../shared/adminInsights';
import { isPaid, nextFulfillmentStage, prevFulfillmentStage, resolveOrderStage } from '../../../shared/orderStatus';
import { CardThumb, Spin, TC } from '../../kit';
import { Badge, Chips, Empty, Loading, SearchBox, Segmented, Sheet, StageBar, StageSteps, brl, initials, shortBatchId } from '../ui';

export const ORDER_FILTERS=[
  {key:'ALL',label:'Todos'},
  {key:'AWAITING_PAYMENT',label:'Aguardando pgto',color:'var(--gold)',test:o=>o.stage.key==='AWAITING_PAYMENT'},
  {key:'TO_BUY',label:'Comprar',color:'var(--indiv)',test:o=>o.stage.key==='PAID'},
  {key:'IN_PROGRESS',label:'Em andamento',color:'var(--indiv)',test:o=>!o.stage.terminal&&o.stage.index>=2&&o.stage.index<6},
  {key:'SHIPPED',label:'Enviados',color:'var(--ok)',test:o=>!o.stage.terminal&&o.stage.index>=6},
  {key:'CLOSED',label:'Cancelados',color:'var(--danger)',test:o=>o.stage.terminal},
];

export function OrderRow({o,onOpen}){
  return(<button className="adm-item" style={{'--c':o.stage.color}} onClick={()=>onOpen(o)}>
    <span className="adm-avatar">{initials(o.clientName)}</span>
    <span className="adm-item-main">
      <span className="adm-item-title"><span>{o.clientName}</span>{o.batches.length>1&&<Badge color="var(--info)">+{o.batches.length-1}</Badge>}</span>
      <span className="adm-item-sub" style={{display:'block'}}>#{o.shortId} · {o.qty} cartas · {new Date(o.createdAt).toLocaleDateString('pt-BR')}</span>
      {!o.stage.terminal&&<StageBar stage={o.stage}/>}
    </span>
    <span className="adm-item-side">
      <strong style={{color:o.paidBatches.length?'var(--ok)':undefined}}>{brl(o.total)}</strong>
      <Badge color={o.stage.color}>{o.stage.short}</Badge>
    </span>
  </button>);
}

function OrderSheet({ctx,order}){
  const {busy,batchCards,setZoomSrc,moveStage,copyOrderCards,copiedOrder,markBatchPaid,syncBatchMP,cancelBatch,generateLabel,shipments,sendTrackingWhatsApp,copyText}=ctx;
  if(!order)return null;
  const sample=order.paidBatches[0]||{};
  const next=order.paidBatches.length?nextFulfillmentStage(sample):null;
  const prev=order.paidBatches.length?prevFulfillmentStage(sample):null;
  const group=shipments.find(g=>g.batches.some(b=>String(b.orderId)===String(order.orderId)));
  const isBusy=busy===order.orderId;
  const canLabel=group&&['PREPARING','LABEL_GENERATED','DELIVERED'].includes(order.stage.key);
  const tracking=group?.trackingCode;

  // A ação principal muda conforme o estágio: um botão grande, sem pensar.
  let primary=null;
  if(order.pendingBatches.length)primary=<button className="adm-btn is-block is-ok" onClick={()=>markBatchPaid(order.pendingBatches[0].id)}><CheckCircle size={16}/> Marcar como pago</button>;
  else if(canLabel&&!order.hasLabel)primary=<button className="adm-btn is-block is-primary" disabled={busy==='label:'+group.key||!group.ready} onClick={()=>generateLabel(group)}>{busy==='label:'+group.key?<Spin size={15}/>:<><Truck size={16}/> Gerar etiqueta MandaBem</>}</button>;
  else if(next&&next.key!=='LABEL_GENERATED')primary=<button className="adm-btn is-block is-primary" disabled={isBusy} onClick={()=>moveStage([order],next,order.orderId)}>{isBusy?<Spin size={15}/>:<><ArrowRight size={16}/> Avançar para "{next.label}"</>}</button>;

  return(<>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <Badge color={order.stage.color}>{order.stage.label}</Badge>
      <Badge>{order.qty} cartas</Badge>
      <Badge color="var(--ok)">{brl(order.total)}</Badge>
    </div>

    {primary}

    {tracking&&<div className="adm-info is-ok">
      <div className="adm-tracking"><div><code>{tracking}</code><div className="adm-muted">{group.trackingStatus||'Etiqueta gerada'}</div></div>
        <div className="adm-row-actions">
          <button className="adm-btn is-sm" onClick={()=>copyText(tracking,'Rastreio copiado')} aria-label="Copiar rastreio"><Copy size={13}/></button>
          {order.clientWhatsapp&&<button className="adm-btn is-sm is-wa" onClick={()=>sendTrackingWhatsApp({...group,trackingCode:tracking})}><MessageCircle size={13}/> Enviar</button>}
        </div>
      </div>
    </div>}

    <div className="adm-card adm-pad"><StageSteps stage={order.stage}/></div>

    <div className="adm-info">
      <b style={{color:'var(--text-strong)'}}>{order.clientName}</b><br/>
      {order.clientEmail||'sem e-mail'}{order.clientWhatsapp?` · ${order.clientWhatsapp}`:''}
    </div>

    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <b style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)'}}>Cartas do pedido</b>
        <button className="adm-btn is-sm" onClick={()=>copyOrderCards(order)} disabled={busy==='copy:'+order.orderId}>
          {busy==='copy:'+order.orderId?<Spin size={12}/>:copiedOrder===order.orderId?<><Check size={13}/> Copiado</>:<><Copy size={13}/> Copiar lista p/ fornecedor</>}
        </button>
      </div>
      <div className="adm-cards">
        {order.batches.map(b=>(<Fragment key={b.id}>
          {order.batches.length>1&&<div className="adm-muted adm-mono" style={{marginTop:6}}>lote #{shortBatchId(b.id)} · {resolveOrderStage(b).label}</div>}
          {!batchCards[b.id]?<div className="adm-muted">Carregando…</div>:
            batchCards[b.id].length===0?<div className="adm-muted">Sem cartas (ajuste de frete)</div>:
            batchCards[b.id].map((c,i)=>(
              <div key={i} className="adm-cardline">
                <div className="adm-thumb" onClick={()=>c.image_url&&setZoomSrc(c.image_url)}><CardThumb card={c} radius={5}/></div>
                <span>{c.name} <b style={{color:TC[c.type]||'var(--text-faint)',fontSize:'var(--fs-2xs)'}}>{c.type}</b></span>
                <b>×{c.qty}</b>
              </div>))}
        </Fragment>))}
      </div>
    </div>

    <div>
      <b style={{display:'block',fontSize:'var(--fs-xs)',color:'var(--text-dim)',marginBottom:8}}>Outras ações</b>
      <div className="adm-row-actions">
        {prev&&<button className="adm-btn is-sm" disabled={isBusy} onClick={()=>moveStage([order],prev,order.orderId,{back:true})}><ArrowLeft size={13}/> Voltar p/ {prev.short||prev.label}</button>}
        {canLabel&&order.hasLabel&&<button className="adm-btn is-sm" disabled={busy==='label:'+group.key} onClick={()=>generateLabel(group)}><RefreshCw size={13}/> Atualizar rastreio</button>}
        {order.pendingBatches.map(b=><button key={'mp'+b.id} className="adm-btn is-sm" disabled={busy==='mp:'+b.id} onClick={()=>syncBatchMP(b.id)}><RefreshCw size={13}/> Conferir no MP{order.batches.length>1?` #${shortBatchId(b.id)}`:''}</button>)}
        {order.pendingBatches.slice(1).map(b=><button key={'pd'+b.id} className="adm-btn is-sm is-ok" onClick={()=>markBatchPaid(b.id)}><CheckCircle size={13}/> Pago #{shortBatchId(b.id)}</button>)}
        {!order.stage.terminal&&order.batches.map(b=><button key={'c'+b.id} className="adm-btn is-sm is-danger" onClick={()=>cancelBatch(b.id,isPaid(b))}><X size={13}/> Cancelar{order.batches.length>1?` #${shortBatchId(b.id)}`:''}</button>)}
      </div>
    </div>
  </>);
}

function SupplierView({ctx}){
  const {orders,moveStage,busy,copyOrderCards,copiedOrder,openOrder}=ctx;
  // Pedidos pagos ainda não enviados, agrupados por dia de pagamento: o admin
  // compra tudo do dia de uma vez e avança o grupo inteiro.
  const groups=useMemo(()=>{
    const map=new Map();
    orders.filter(o=>o.paidBatches.length&&!o.stage.terminal&&o.stage.index<5).forEach(o=>{
      const ts=o.paidAt;const day=ts?new Date(ts).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}):'—';
      if(!map.has(day))map.set(day,{day,ts:ts?new Date(ts).getTime():0,orders:[]});
      map.get(day).orders.push(o);
    });
    return [...map.values()].sort((a,b)=>b.ts-a.ts);
  },[orders]);
  if(!groups.length)return <div className="adm-card"><Empty icon={ShoppingCart} title="Nada para comprar" sub="Nenhum pedido pago esperando o fornecedor"/></div>;
  return groups.map(g=>{
    const minIdx=Math.min(...g.orders.map(o=>o.stage.index));
    const laggards=g.orders.filter(o=>o.stage.index===minIdx);
    const next=nextFulfillmentStage(laggards[0].paidBatches[0]);
    return(<div key={g.day} className="adm-card">
      <div className="adm-pad" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,paddingBottom:8}}>
        <div><b style={{textTransform:'capitalize'}}>{g.day}</b><div className="adm-muted">{g.orders.length} pedido(s) · {g.orders.reduce((s,o)=>s+o.paidQty,0)} cartas</div></div>
        {next&&next.key!=='LABEL_GENERATED'&&<button className="adm-btn is-sm is-primary" disabled={busy===g.day} onClick={()=>moveStage(laggards,next,g.day)}>{busy===g.day?<Spin size={12}/>:<><ArrowRight size={13}/> {laggards.length>1?`${laggards.length} → `:''}{next.short||next.label}</>}</button>}
      </div>
      <div className="adm-list" style={{borderTop:'1px solid var(--line-soft)'}}>
        {g.orders.map(o=>(<div key={o.orderId} className="adm-item" style={{'--c':o.stage.color,cursor:'default'}}>
          <button onClick={()=>openOrder(o)} style={{all:'unset',flex:1,minWidth:0,cursor:'pointer'}}>
            <span className="adm-item-title"><span>{o.clientName}</span></span>
            <span className="adm-item-sub" style={{display:'block'}}>#{o.shortId} · {o.paidQty} cartas · {o.stage.short}</span>
          </button>
          <button className="adm-btn is-sm" onClick={()=>copyOrderCards(o)} aria-label="Copiar lista de cartas">{copiedOrder===o.orderId?<Check size={13}/>:busy==='copy:'+o.orderId?<Spin size={12}/>:<Copy size={13}/>}</button>
        </div>))}
      </div>
    </div>);
  });
}

// ── Exportar ──────────────────────────────────────────────────────────────
// Planilha para contador, imposto e conferência: uma linha por lote (é como
// o dinheiro entrou), abre direto no Excel em português.
function periodRange(key){
  const now=new Date();
  const start=(y,m)=>new Date(y,m,1,0,0,0,0);
  const end=(y,m)=>new Date(y,m+1,0,23,59,59,999);
  if(key==='this')return {from:start(now.getFullYear(),now.getMonth()),to:end(now.getFullYear(),now.getMonth())};
  if(key==='last')return {from:start(now.getFullYear(),now.getMonth()-1),to:end(now.getFullYear(),now.getMonth()-1)};
  if(key==='year')return {from:start(now.getFullYear(),0),to:end(now.getFullYear(),11)};
  return {from:null,to:null};
}

export function downloadCsv(filename,text){
  const blob=new Blob([text],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function ExportSheet({ctx,orders,onClose}){
  const [period,setPeriod]=useState('this');
  const [from,setFrom]=useState('');const [to,setTo]=useState('');
  const range=period==='custom'?{from:from?new Date(from+'T00:00:00'):null,to:to?new Date(to+'T23:59:59'):null}:periodRange(period);
  const csv=useMemo(()=>ordersCsv(orders,{stageOf:b=>resolveOrderStage(b).label,from:range.from,to:range.to}),[orders,period,from,to]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows=csv.split('\r\n').length-1;
  const tag=period==='custom'?`${from||'inicio'}_${to||'hoje'}`:period==='this'||period==='last'?(range.from?`${range.from.getFullYear()}-${String(range.from.getMonth()+1).padStart(2,'0')}`:''):period==='year'?String(new Date().getFullYear()):'tudo';
  return(<>
    <Segmented value={period} onChange={setPeriod} options={[{key:'this',label:'Este mês'},{key:'last',label:'Mês passado'},{key:'year',label:'Ano'},{key:'all',label:'Tudo'},{key:'custom',label:'Datas'}]}/>
    {period==='custom'&&<div className="adm-row-actions">
      <label className="adm-muted" style={{flex:1}}>De<input type="date" className="adm-input" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label className="adm-muted" style={{flex:1}}>Até<input type="date" className="adm-input" value={to} onChange={e=>setTo(e.target.value)}/></label>
    </div>}
    <div className="adm-info"><b>{rows}</b> linha(s) — uma por pagamento, com cliente, status, cartas, frete e rastreio. Abre direto no Excel.</div>
    <button className="adm-btn is-primary" disabled={!rows} onClick={()=>{downloadCsv(`pedidos-${tag}.csv`,csv);ctx.toast&&ctx.toast('Planilha baixada','success');onClose();}}><Download size={15}/> Baixar planilha</button>
  </>);
}

// ── Tabela (desktop) ──────────────────────────────────────────────────────
// No computador, comprar e etiquetar rende mais com colunas, ordenação e
// seleção múltipla. No celular continua a lista de sempre.
const SORTS={
  date:o=>Date.parse(o.createdAt)||0,
  client:o=>o.clientName.toLowerCase(),
  qty:o=>o.qty,
  total:o=>o.total,
  stage:o=>o.stage.terminal?99:o.stage.index,
};

function OrdersTable({ctx,list}){
  const {openOrder,moveStage,busy}=ctx;
  const [sort,setSort]=useState({key:'date',dir:-1});
  const [selected,setSelected]=useState(()=>new Set());
  const sorted=useMemo(()=>{const f=SORTS[sort.key];return [...list].sort((a,b)=>{const x=f(a),y=f(b);return (x>y?1:x<y?-1:0)*sort.dir;});},[list,sort]);
  const chosen=sorted.filter(o=>selected.has(o.orderId));
  // Avançar em lote só quando todos os escolhidos estão na mesma etapa.
  const nexts=[...new Set(chosen.map(o=>o.paidBatches.length?nextFulfillmentStage(o.paidBatches[0])?.key:null))];
  const nextStage=nexts.length===1&&nexts[0]?nextFulfillmentStage(chosen[0].paidBatches[0]):null;
  const allOn=sorted.length>0&&sorted.every(o=>selected.has(o.orderId));
  const toggle=id=>setSelected(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;});
  const head=(key,label,align)=>(<th aria-sort={sort.key===key?(sort.dir>0?'ascending':'descending'):'none'} style={{textAlign:align||'left'}}>
    <button onClick={()=>setSort(s=>({key,dir:s.key===key?-s.dir:(key==='client'?1:-1)}))}>{label}{sort.key===key?(sort.dir>0?' ↑':' ↓'):''}</button>
  </th>);
  return(<div className="adm-orders-table">
    {chosen.length>0&&<div className="adm-bulkbar" role="region" aria-label="Ações em lote">
      <b>{chosen.length} selecionado(s)</b>
      {nextStage?<button className="adm-btn is-sm is-primary" disabled={busy==='bulk'} onClick={async()=>{await moveStage(chosen,nextStage,'bulk');setSelected(new Set());}}>{busy==='bulk'?<Spin size={13}/>:<><ArrowRight size={13}/> Avançar para "{nextStage.label}"</>}</button>
        :<span className="adm-muted">Para avançar em lote, escolha pedidos da mesma etapa.</span>}
      <button className="adm-btn is-sm" onClick={()=>{downloadCsv('pedidos-selecionados.csv',ordersCsv(chosen,{stageOf:b=>resolveOrderStage(b).label}));}}><Download size={13}/> Exportar</button>
      <button className="adm-btn is-sm is-ghost" onClick={()=>setSelected(new Set())}>Limpar</button>
    </div>}
    <div className="adm-table-scroll"><table>
      <thead><tr>
        <th style={{width:36}}><input type="checkbox" aria-label="Selecionar todos" checked={allOn} onChange={()=>setSelected(allOn?new Set():new Set(sorted.map(o=>o.orderId)))}/></th>
        {head('date','Data')}{head('client','Cliente')}<th>Pedido</th>{head('qty','Cartas','right')}{head('total','Total','right')}{head('stage','Etapa')}
      </tr></thead>
      <tbody>{sorted.map(o=>(
        <tr key={o.orderId} className={selected.has(o.orderId)?'is-selected':''}>
          <td><input type="checkbox" aria-label={`Selecionar pedido ${o.shortId}`} checked={selected.has(o.orderId)} onChange={()=>toggle(o.orderId)}/></td>
          <td>{new Date(o.createdAt).toLocaleDateString('pt-BR')}</td>
          <td><button className="adm-link" onClick={()=>openOrder(o)}>{o.clientName}</button></td>
          <td className="adm-mono">#{o.shortId}{o.batches.length>1?<span className="adm-muted"> +{o.batches.length-1}</span>:null}</td>
          <td style={{textAlign:'right'}}>{o.qty}</td>
          <td style={{textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{brl(o.total)}</td>
          <td><Badge color={o.stage.color}>{o.stage.short}</Badge></td>
        </tr>))}
      </tbody>
    </table></div>
  </div>);
}

export default function OrdersView({ctx}){
  const {orders,loading,orderFilter,setOrderFilter,orderMode,setOrderMode,searchOrders,setSearchOrders,openOrder,openOrderId,setOpenOrderId,queue}=ctx;
  const filtered=useMemo(()=>{
    const f=ORDER_FILTERS.find(x=>x.key===orderFilter);
    let list=f?.test?orders.filter(f.test):orders;
    if(searchOrders){
      const q=searchOrders.toLowerCase();
      list=list.filter(o=>o.clientName.toLowerCase().includes(q)||String(o.clientEmail||'').toLowerCase().includes(q)||o.shortId.includes(q.toUpperCase())||o.batches.some(b=>String(b.mp_payment_id||'').includes(q)));
    }
    return [...list].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  },[orders,orderFilter,searchOrders]);
  const open=orders.find(o=>o.orderId===openOrderId);
  const [exporting,setExporting]=useState(false);

  return(<>
    <Segmented value={orderMode} onChange={setOrderMode} options={[{key:'list',label:'Todos os pedidos',icon:ClipboardList},{key:'supplier',label:'Fornecedor',icon:ShoppingCart,count:queue.toBuy}]}/>
    {orderMode==='list'?<>
      <div className="adm-row-actions" style={{alignItems:'stretch'}}>
        <div style={{flex:1,minWidth:0}}><SearchBox value={searchOrders} onChange={setSearchOrders} placeholder="Cliente, #pedido ou código MP"/></div>
        <button className="adm-btn" onClick={()=>setExporting(true)} aria-label="Exportar pedidos em planilha"><Download size={15}/> Exportar</button>
      </div>
      <Chips value={orderFilter} onChange={setOrderFilter} options={ORDER_FILTERS.map(f=>({...f,count:f.test?orders.filter(f.test).length:orders.length}))}/>
      <div className="adm-card">
        {loading&&!filtered.length?<Loading/>:!filtered.length?<Empty icon={Package} title="Nenhum pedido" sub={searchOrders||orderFilter!=='ALL'?'Tente outro filtro':'Ainda não há pedidos'}/>:
          <>
            <div className="adm-list adm-orders-list">{filtered.map(o=><OrderRow key={o.orderId} o={o} onOpen={openOrder}/>)}</div>
            <OrdersTable ctx={ctx} list={filtered}/>
          </>}
      </div>
    </>:<SupplierView ctx={ctx}/>}

    <Sheet open={!!open} onClose={()=>setOpenOrderId(null)} title={open?.clientName} sub={open?`Pedido #${open.shortId} · ${new Date(open.createdAt).toLocaleDateString('pt-BR')}`:''}>
      <OrderSheet ctx={ctx} order={open}/>
    </Sheet>
    <Sheet open={exporting} onClose={()=>setExporting(false)} title="Exportar pedidos" sub="Planilha CSV para Excel ou Google Planilhas">
      <ExportSheet ctx={ctx} orders={orders} onClose={()=>setExporting(false)}/>
    </Sheet>
  </>);
}
