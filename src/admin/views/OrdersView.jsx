// Aba "Pedidos": lista com filtros, compras no fornecedor e a folha de detalhe.
import { Fragment, useMemo } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle, ClipboardList, Copy, MessageCircle, Package, RefreshCw, ShoppingCart, Truck, X } from 'lucide-react';
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

  return(<>
    <Segmented value={orderMode} onChange={setOrderMode} options={[{key:'list',label:'Todos os pedidos',icon:ClipboardList},{key:'supplier',label:'Fornecedor',icon:ShoppingCart,count:queue.toBuy}]}/>
    {orderMode==='list'?<>
      <SearchBox value={searchOrders} onChange={setSearchOrders} placeholder="Cliente, #pedido ou código MP"/>
      <Chips value={orderFilter} onChange={setOrderFilter} options={ORDER_FILTERS.map(f=>({...f,count:f.test?orders.filter(f.test).length:orders.length}))}/>
      <div className="adm-card">
        {loading&&!filtered.length?<Loading/>:!filtered.length?<Empty icon={Package} title="Nenhum pedido" sub={searchOrders||orderFilter!=='ALL'?'Tente outro filtro':'Ainda não há pedidos'}/>:
          <div className="adm-list">{filtered.map(o=><OrderRow key={o.orderId} o={o} onOpen={openOrder}/>)}</div>}
      </div>
    </>:<SupplierView ctx={ctx}/>}

    <Sheet open={!!open} onClose={()=>setOpenOrderId(null)} title={open?.clientName} sub={open?`Pedido #${open.shortId} · ${new Date(open.createdAt).toLocaleDateString('pt-BR')}`:''}>
      <OrderSheet ctx={ctx} order={open}/>
    </Sheet>
  </>);
}
