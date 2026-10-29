// Aba "Hoje": a fila de trabalho na frente, números depois.
import { AlertTriangle, BellRing, Clock, Package, Plane, ShoppingCart, Sparkles, Tag as TagIcon, Truck } from 'lucide-react';
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
  const {queue,stats,go,setOrderFilter,setOrderMode,setShipTab,notifications,automation,pushState}=ctx;
  const toOrders=(filter,mode='list')=>()=>{setOrderMode(mode);setOrderFilter(filter);go('orders');};
  const toShipping=tab=>()=>{setShipTab(tab);go('shipping');};

  const tasks=[
    queue.problems>0&&{key:'problem',icon:AlertTriangle,color:'var(--danger)',count:queue.problems,label:'Problema na entrega',sub:'Devolvido, extraviado ou aguardando retirada',onClick:toShipping('problem'),wide:true},
    queue.toBuy>0&&{key:'buy',icon:ShoppingCart,color:'var(--indiv)',count:queue.toBuy,label:'Comprar no fornecedor',sub:'Pagos, ainda não encomendados',onClick:toOrders('ALL','supplier')},
    queue.toLabel>0&&{key:'label',icon:TagIcon,color:'var(--info)',count:queue.toLabel,label:'Gerar etiqueta',sub:'Prontos para o correio',onClick:toShipping('label')},
    queue.awaitingPayment>0&&{key:'pay',icon:Clock,color:'var(--gold)',count:queue.awaitingPayment,label:'Aguardando pagamento',sub:brl(stats.pendingRevenue),onClick:toOrders('AWAITING_PAYMENT')},
    queue.inbound>0&&{key:'inbound',icon:Plane,color:'var(--indiv)',count:queue.inbound,label:'Vindo do fornecedor',sub:'Encomendados ou a caminho',onClick:toOrders('IN_PROGRESS')},
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
          {tasks.length===0?'Nada pendente agora.':`${tasks.reduce((s,t)=>s+t.count,0)} item(ns) esperando por você.`}
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
      : <div className="adm-card adm-allclear"><Package size={22} style={{color:'var(--ok)'}}/><div><b>Tudo em dia ✨</b><span className="adm-muted">Nenhum pedido esperando ação sua.</span></div></div>}

    <SectionTitle>Vendas</SectionTitle>
    <div className="adm-kpis">
      <div className="adm-card adm-kpi"><span>Hoje</span><strong style={{color:'var(--ok)'}}>{brlCompact(stats.todayRevenue)}</strong><small>{stats.todayCount} pagamento(s)</small></div>
      <div className="adm-card adm-kpi"><span>7 dias</span><strong>{brlCompact(stats.weekRevenue)}</strong><small>{stats.weekCount} pagamento(s)</small></div>
      <div className="adm-card adm-kpi"><span>Total</span><strong>{brlCompact(stats.revenue)}</strong><small>{stats.orders} pedido(s)</small></div>
      <div className="adm-card adm-kpi"><span>Cartas vendidas</span><strong>{stats.cards}</strong><small>pagas</small></div>
    </div>

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
