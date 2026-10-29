// Aba "Envios": etiquetar, acompanhar o rastreio automático e resolver problemas.
import { AlertTriangle, Check, Copy, MessageCircle, RefreshCw, Truck } from 'lucide-react';
import { Spin } from '../../kit';
import { Badge, Empty, Loading, Segmented, timeAgo } from '../ui';
import { automationHealth } from './MoreView';

const PHASE_BADGE={
  PENDING:{label:'Aguardando postagem',color:'var(--gold)'},
  POSTED:{label:'Em trânsito',color:'var(--indiv)'},
  DELIVERED:{label:'Entregue',color:'var(--ok)'},
  PROBLEM:{label:'Problema',color:'var(--danger)'},
  UNKNOWN:{label:'Etiqueta gerada',color:'var(--info)'},
};

function ShipmentCard({g,ctx}){
  const {busy,generateLabel,markDelivered,sendTrackingWhatsApp,copyText}=ctx;
  const root=g.rootBatch||g.batches[0]||{};
  const addr=root.shipping_address||{};
  const phase=g.stage.key==='DELIVERED'?PHASE_BADGE.DELIVERED:g.hasLabel?PHASE_BADGE[g.phase]||PHASE_BADGE.UNKNOWN:null;
  const labelBusy=busy==='label:'+g.key;
  return(<div className="adm-card adm-pad" style={{display:'flex',flexDirection:'column',gap:10,borderLeft:'3px solid '+(phase?phase.color:'var(--gold)')}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
      <div style={{minWidth:0}}>
        <div style={{fontWeight:800,color:'var(--text-strong)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{g.clientName}</div>
        <div className="adm-muted">#{String(g.rootId).slice(0,8).toUpperCase()} · {g.totalQuantity} cartas · {g.shippingService||root.shipping_service||'serviço?'}{g.batches.length>1?` · ${g.batches.length} lotes`:''}</div>
      </div>
      {phase?<Badge color={phase.color}>{phase.label}</Badge>:<Badge color="var(--gold)">Sem etiqueta</Badge>}
    </div>

    {(addr.rua||addr.cep)&&<div className="adm-info">
      {addr.rua}{addr.numero?`, ${addr.numero}`:''}{addr.complemento?` — ${addr.complemento}`:''}<br/>
      {addr.bairro?`${addr.bairro} · `:''}{addr.cidade}{addr.uf?`/${addr.uf}`:''} · CEP {addr.cep||'—'}
    </div>}

    {g.trackingCode&&<div className={'adm-info '+(g.phase==='PROBLEM'?'is-bad':'is-ok')}>
      <div className="adm-tracking">
        <div style={{minWidth:0}}>
          <code>{g.trackingCode}</code>
          <div className="adm-muted">{g.trackingStatus||'—'}{g.trackingUpdatedAt?` · consultado ${timeAgo(g.trackingUpdatedAt)}`:''}</div>
        </div>
        <div className="adm-row-actions" style={{flexShrink:0}}>
          <button className="adm-btn is-sm" onClick={()=>copyText(g.trackingCode,'Rastreio copiado')} aria-label="Copiar rastreio"><Copy size={13}/></button>
          {g.clientWhatsapp&&<button className="adm-btn is-sm is-wa" onClick={()=>sendTrackingWhatsApp(g)}><MessageCircle size={13}/> Cliente</button>}
        </div>
      </div>
    </div>}

    {!g.ready&&!g.hasLabel&&<div className="adm-info is-warn"><AlertTriangle size={12} style={{verticalAlign:'-2px'}}/> Há cartas deste pedido que ainda não chegaram em "Em preparação".</div>}

    <div className="adm-row-actions">
      {!g.hasLabel
        ? <button className="adm-btn is-primary" style={{flex:1}} disabled={labelBusy||!g.ready} onClick={()=>generateLabel(g)}>{labelBusy?<Spin size={14}/>:<><Truck size={15}/> Gerar etiqueta</>}</button>
        : <button className="adm-btn" style={{flex:1}} disabled={labelBusy} onClick={()=>generateLabel(g)}>{labelBusy?<Spin size={14}/>:<><RefreshCw size={14}/> Consultar agora</>}</button>}
      {g.hasLabel&&g.stage.key!=='DELIVERED'&&<button className="adm-btn is-ok" disabled={busy==='deliver:'+g.key} onClick={()=>markDelivered(g)}><Check size={14}/> Entregue</button>}
    </div>
  </div>);
}

export default function ShippingView({ctx}){
  const {shipBuckets,shipTab,setShipTab,loading,automation,runAutomation,automationBusy}=ctx;
  const list=shipBuckets[shipTab]||[];
  const health=automationHealth(automation);
  const empty={
    label:['Nada para etiquetar','Pedidos aparecem aqui ao entrar em "Em preparação"'],
    transit:['Nada em trânsito','Remessas com etiqueta aparecem aqui'],
    problem:['Nenhum problema','Devoluções e extravios aparecem aqui'],
    delivered:['Nenhuma entrega ainda',''],
  }[shipTab];
  return(<>
    <div className="adm-card adm-auto">
      <span className={'adm-pulse'+(health.level==='ok'?'':health.level==='bad'?' is-bad':' is-off')}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:'var(--fs-xs)',fontWeight:700,color:'var(--text-strong)'}}>Rastreio automático</div>
        <div className="adm-muted">{health.text}</div>
      </div>
      <button className="adm-btn is-sm" disabled={automationBusy==='tracking'} onClick={()=>runAutomation('tracking')}>{automationBusy==='tracking'?<Spin size={12}/>:<><RefreshCw size={13}/> Agora</>}</button>
    </div>

    <Segmented value={shipTab} onChange={setShipTab} options={[
      {key:'label',label:'Etiquetar',count:shipBuckets.label.length},
      {key:'transit',label:'Trânsito',count:shipBuckets.transit.length},
      {key:'problem',label:'Problema',count:shipBuckets.problem.length},
      {key:'delivered',label:'Entregues'},
    ]}/>

    {loading&&!list.length?<Loading/>:!list.length?<div className="adm-card"><Empty icon={Truck} title={empty[0]} sub={empty[1]}/></div>:
      list.slice(0,shipTab==='delivered'?30:undefined).map(g=><ShipmentCard key={g.key} g={g} ctx={ctx}/>)}
  </>);
}
