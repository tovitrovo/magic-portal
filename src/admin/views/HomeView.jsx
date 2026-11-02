// Aba "Hoje": a fila de trabalho na frente, números depois.
import { AlertTriangle, BellRing, DollarSign, ChevronLeft, ChevronRight, Clock, Package, Plane, ScrollText, ShoppingBasket, ShoppingCart, Sparkles, Tag as TagIcon, Truck } from 'lucide-react';
import { monthLabel } from '../../../shared/adminInsights';
import { greeting, brlCompact, brl, timeAgo, SectionTitle } from '../ui';
import { FeedList } from './NotificationsSheet';
import { automationHealth } from './MoreView';

function Task({icon:Icon,color,count,label,sub,onClick,wide}){
  return(<button className={'adm-task'+(wide?' is-wide':'')} style={{'--c':color}} onClick={onClick}>
    <span className="adm-task-icon"><Icon size={16}/></span>
    <span className="adm-task-text">
      <span className="adm-task-count">{count}</span>
      <span className="adm-task-label" style={{display:'block'}}>{label}</span>
      {sub&&<span className="adm-task-sub" style={{display:'block'}}>{sub}</span>}
    </span>
  </button>);
}

export default function HomeView({ctx}){
  const {queue,stats,go,setOrderFilter,setOrderMode,setShipTab,notifications,automation,pushState,carts=[],wishDemand=[],profit,profitMonth,setProfitMonth,custStats,fxRate,fxCost,fxBroken,pricingInfo,setClientsTab}=ctx;
  const toClients=tab=>()=>{setClientsTab&&setClientsTab(tab);go('clients');};
  const readyCarts=carts.filter(c=>c.missing<=5);
  const newWishes=wishDemand.filter(c=>c.isNew&&c.isActive);
  const shiftMonth=d=>{const [y,m]=profitMonth.split('-').map(Number);const dt=new Date(y,m-1+d,1);setProfitMonth(`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`);};
  const isCurrentMonth=profitMonth===`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  const pct=v=>Math.round((v||0)*100)+'%';
  const toOrders=(filter,mode='list')=>()=>{setOrderMode(mode);setOrderFilter(filter);go('orders');};
  const toShipping=tab=>()=>{setShipTab(tab);go('shipping');};

  const tasks=[
    fxBroken&&{key:'fx',icon:DollarSign,color:'var(--danger)',count:'US$',label:'Dólar parado',sub:`Preços usando R$ ${fxRate.toFixed(2).replace('.',',')} desde ${pricingInfo?.fx?.fetched_at?new Date(pricingInfo.fx.fetched_at).toLocaleDateString('pt-BR'):'—'}`,onClick:()=>go('more','prices'),wide:true},
    queue.problems>0&&{key:'problem',icon:AlertTriangle,color:'var(--danger)',count:queue.problems,label:'Problema na entrega',sub:'Devolvido, extraviado ou aguardando retirada',onClick:toShipping('problem'),wide:true},
    queue.toBuy>0&&{key:'buy',icon:ShoppingCart,color:'var(--indiv)',count:queue.toBuy,label:'Comprar no fornecedor',sub:'Pagos, ainda não encomendados',onClick:toOrders('ALL','supplier')},
    queue.toLabel>0&&{key:'label',icon:TagIcon,color:'var(--info)',count:queue.toLabel,label:'Gerar etiqueta',sub:'Prontos para o correio',onClick:toShipping('label')},
    queue.awaitingPayment>0&&{key:'pay',icon:Clock,color:'var(--gold)',count:queue.awaitingPayment,label:'Aguardando pagamento',sub:brl(stats.pendingRevenue),onClick:toOrders('AWAITING_PAYMENT')},
    queue.inbound>0&&{key:'inbound',icon:Plane,color:'var(--indiv)',count:queue.inbound,label:'Vindo do fornecedor',sub:'Encomendados ou a caminho',onClick:toOrders('IN_PROGRESS')},
    readyCarts.length>0&&{key:'carts',icon:ShoppingBasket,color:'var(--wa)',count:readyCarts.length,label:'Carrinhos quase fechando',sub:`${readyCarts.reduce((s,c)=>s+c.qty,0)} cartas paradas · lembrar pelo WhatsApp`,onClick:toClients('carts')},
    newWishes.length>0&&{key:'wishes',icon:ScrollText,color:'var(--ok)',count:newWishes.length,label:'Cartas novas desejadas',sub:'Avisar quem estava esperando',onClick:toClients('wishes')},
    queue.inTransit>0&&{key:'transit',icon:Truck,color:'var(--ok)',count:queue.inTransit,label:'Em trânsito',sub:'Rastreio automático',onClick:toShipping('transit')},
  ].filter(Boolean);

  const health=automationHealth(automation);
  const pushOff=pushState&&pushState.supported!==false&&!pushState.subscribed;

  return(<>
    <div className="adm-card adm-pad" style={{display:'flex',alignItems:'center',gap:12}}>
      <Sparkles size={20} style={{color:'var(--gp)',flexShrink:0}}/>
      <div style={{minWidth:0}}>
        <div style={{fontWeight:800,color:'var(--text-strong)'}}>{greeting()}!</div>
        <div className="adm-muted">
          {tasks.length===0?'Nada pendente agora.':`${tasks.reduce((s,t)=>s+(Number(t.count)||1),0)} item(ns) esperando por você.`}
          {stats.todayCount>0&&<> Hoje já entraram <b style={{color:'var(--ok)'}}>{brl(stats.todayRevenue)}</b>.</>}
        </div>
      </div>
    </div>

    {pushOff&&<button className="adm-card adm-auto" onClick={()=>go('more','push')} style={{cursor:'pointer',textAlign:'left',border:'1px solid color-mix(in srgb,var(--gold) 35%,var(--card-border))',fontFamily:'inherit',color:'inherit'}}>
      <BellRing size={18} style={{color:'var(--gold)',flexShrink:0}}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:'var(--text-strong)'}}>Receber tudo no celular</div>
        <div className="adm-muted">Ative as notificações neste aparelho</div>
      </div>
      <span className="adm-btn is-sm is-primary">Ativar</span>
    </button>}

    <SectionTitle>Fila de trabalho</SectionTitle>
    {tasks.length>0
      ? <div className="adm-queue">{tasks.map(({key,...t})=><Task key={key} {...t}/>)}</div>
      : <div className="adm-card adm-allclear"><Package size={22} style={{color:'var(--ok)'}}/><div><b>Tudo em dia</b><span className="adm-muted">Nenhum pedido esperando ação sua.</span></div></div>}

    <SectionTitle>Vendas</SectionTitle>
    <div className="adm-kpis">
      <div className="adm-card adm-kpi"><span>Hoje</span><strong style={{color:'var(--ok)'}}>{brlCompact(stats.todayRevenue)}</strong><small>{stats.todayCount} pagamento(s)</small></div>
      <div className="adm-card adm-kpi"><span>7 dias</span><strong>{brlCompact(stats.weekRevenue)}</strong><small>{stats.weekCount} pagamento(s)</small></div>
      <div className="adm-card adm-kpi"><span>Total</span><strong>{brlCompact(stats.revenue)}</strong><small>{stats.orders} pedido(s)</small></div>
      <div className="adm-card adm-kpi"><span>Cartas vendidas</span><strong>{stats.cards}</strong><small>pagas</small></div>
    </div>

    {profit&&<>
      <div className="adm-section-title"><h2>Resultado de {monthLabel(profitMonth)}</h2>
        <span style={{display:'flex',gap:2}}>
          <button onClick={()=>shiftMonth(-1)} aria-label="Mês anterior"><ChevronLeft size={16}/></button>
          <button onClick={()=>shiftMonth(1)} disabled={isCurrentMonth} aria-label="Próximo mês" style={{opacity:isCurrentMonth?.3:1}}><ChevronRight size={16}/></button>
        </span>
      </div>
      <div className="adm-kpis">
        <div className="adm-card adm-kpi"><span>Faturamento</span><strong>{brlCompact(profit.total)}</strong><small>{profit.orders} pedido(s) · {profit.qty} cartas</small></div>
        <div className="adm-card adm-kpi"><span>Lucro estimado</span><strong style={{color:profit.profit>=0?'var(--ok)':'var(--danger)'}}>{brlCompact(profit.profit)}</strong><small>margem {pct(profit.margin)} nas cartas</small></div>
        <div className="adm-card adm-kpi"><span>Ticket médio</span><strong>{brlCompact(profit.avgTicket)}</strong><small>por pedido, com frete</small></div>
        <div className="adm-card adm-kpi"><span>Recompra</span><strong>{pct(custStats?.repeatRate)}</strong><small>{custStats?.repeatBuyers||0} de {custStats?.buyers||0} compradores · conversão {pct(custStats?.conversion)}</small></div>
      </div>
      <div className="adm-muted" style={{padding:'0 2px'}}>Lucro = cartas ({brl(profit.revenueCards)}) − custo estimado ({brl(profit.cost)}, sendo {brl(profit.freight)} de frete do AliExpress, um por pedido). As cartas usam a faixa do fornecedor pelo volume de cada pedido e o dólar do Inter de hoje{fxRate?` (R$ ${fxCost.toFixed(2).replace('.',',')} = oficial R$ ${fxRate.toFixed(2).replace('.',',')} + 5,6% de IOF e spread do Inter)`:''}. Não desconta a taxa do Mercado Pago; o frete ({brl(profit.shipping)}) é repasse.</div>
    </>}

    <button className="adm-card adm-auto" onClick={()=>go('more','automation')} style={{cursor:'pointer',textAlign:'left',fontFamily:'inherit',color:'inherit'}}>
      <span className={'adm-pulse'+(health.level==='ok'?'':health.level==='bad'?' is-bad':' is-off')}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:'var(--fs-xs)',fontWeight:700,color:'var(--text-strong)'}}>Rastreio automático MandaBem</div>
        <div className="adm-muted">{health.text}</div>
      </div>
    </button>

    <SectionTitle action="Ver tudo" onAction={ctx.openNotifications}>Atividade</SectionTitle>
    <div className="adm-card">
      <FeedList notifications={notifications.slice(0,6)} loading={ctx.notifLoading} onOpen={ctx.openNotification}/>
    </div>
    {notifications[0]&&<div className="adm-muted" style={{textAlign:'center'}}>Último evento {timeAgo(notifications[0].created_at)}</div>}
  </>);
}
