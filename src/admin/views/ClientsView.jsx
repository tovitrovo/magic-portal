// Aba "Clientes": busca, histórico e WhatsApp (individual ou em sequência).
import { useMemo, useState } from 'react';
import { Copy, Mail, Megaphone, MessageCircle, Package, Users, Wallet } from 'lucide-react';
import { DEFAULT_WHATSAPP_MESSAGES, WHATSAPP_AUDIENCES, buildWhatsAppUrl, getWhatsAppRecipients, normalizeWhatsAppNumber } from '../../whatsappCommunication';
import { Badge, Chips, Empty, Loading, SearchBox, Segmented, Sheet, brl, initials, timeAgo } from '../ui';
import { OrderRow } from './OrdersView';

function Broadcast({ctx,clients}){
  const [audience,setAudience]=useState(WHATSAPP_AUDIENCES.BUYERS);
  const [messages,setMessages]=useState(DEFAULT_WHATSAPP_MESSAGES);
  const [contacted,setContacted]=useState(()=>new Set());
  const recipients=useMemo(()=>getWhatsAppRecipients(clients,audience),[clients,audience]);
  const key=c=>`${audience}:${c.userId}`;
  const next=recipients.find(c=>!contacted.has(key(c)));
  const done=recipients.length-recipients.filter(c=>!contacted.has(key(c))).length;
  function openNext(){
    const url=buildWhatsAppUrl(next,messages[audience]);
    if(!url)return;
    window.open(url,'_blank','noopener,noreferrer');
    setContacted(prev=>new Set(prev).add(key(next)));
  }
  return(<>
    <Segmented value={audience} onChange={setAudience} options={[{key:WHATSAPP_AUDIENCES.BUYERS,label:'Compradores'},{key:WHATSAPP_AUDIENCES.ALL,label:'Todos'}]}/>
    <textarea className="adm-textarea" rows={6} value={messages[audience]} onChange={e=>setMessages(m=>({...m,[audience]:e.target.value}))}/>
    <div className="adm-muted">Use <b>{'{nome}'}</b> para o primeiro nome. Cada conversa abre para você revisar e enviar — o portal não manda nada sozinho.</div>
    <div className="adm-info"><b style={{color:'var(--wa)'}}>{done}/{recipients.length}</b> contatos abertos{next?<> · próximo: <b>{next.name}</b></>:null}</div>
    <div className="adm-row-actions">
      <button className="adm-btn" onClick={()=>ctx.copyText(messages[audience],'Mensagem copiada')}><Copy size={14}/> Copiar</button>
      <button className="adm-btn is-wa" style={{flex:1}} disabled={!next||!messages[audience].trim()} onClick={openNext}><MessageCircle size={15}/> {next?'Abrir próximo':'Concluído'}</button>
    </div>
  </>);
}

export default function ClientsView({ctx}){
  const {clients,loading,searchClients,setSearchClients,openOrder,go,setSearchOrders,setOrderFilter,setOrderMode}=ctx;
  const [filter,setFilter]=useState('all');
  const [openId,setOpenId]=useState(null);
  const [broadcast,setBroadcast]=useState(false);
  const list=useMemo(()=>{
    let l=clients;
    if(filter==='active')l=l.filter(c=>c.hasActiveOrder);
    if(filter==='buyers')l=l.filter(c=>c.hasPaidOrder);
    if(filter==='none')l=l.filter(c=>!c.hasOrder);
    if(searchClients){const q=searchClients.toLowerCase();l=l.filter(c=>c.name.toLowerCase().includes(q)||c.whatsapp.toLowerCase().includes(q)||c.email.toLowerCase().includes(q)||c.orders.some(o=>o.shortId.includes(q.toUpperCase())));}
    return l;
  },[clients,filter,searchClients]);
  const open=clients.find(c=>c.userId===openId);

  return(<>
    <button className="adm-card adm-auto" onClick={()=>setBroadcast(true)} style={{cursor:'pointer',textAlign:'left',fontFamily:'inherit',color:'inherit'}}>
      <Megaphone size={18} style={{color:'var(--wa)',flexShrink:0}}/>
      <div style={{flex:1}}><div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:'var(--text-strong)'}}>Mensagem para vários clientes</div><div className="adm-muted">WhatsApp em sequência, com o nome de cada um</div></div>
    </button>
    <SearchBox value={searchClients} onChange={setSearchClients} placeholder="Nome, e-mail, WhatsApp ou #pedido"/>
    <Chips value={filter} onChange={setFilter} options={[
      {key:'all',label:'Todos',count:clients.length},
      {key:'active',label:'Com pedido aberto',color:'var(--ok)',count:clients.filter(c=>c.hasActiveOrder).length},
      {key:'buyers',label:'Já compraram',color:'var(--indiv)',count:clients.filter(c=>c.hasPaidOrder).length},
      {key:'none',label:'Sem pedido',color:'var(--text-dim)',count:clients.filter(c=>!c.hasOrder).length},
    ]}/>
    <div className="adm-card">
      {loading&&!list.length?<Loading/>:!list.length?<Empty icon={Users} title="Nenhum cliente" sub={searchClients||filter!=='all'?'Tente outro filtro':''}/>:
        <div className="adm-list">{list.map(c=>(
          <button key={c.userId} className="adm-item" style={{'--c':c.hasActiveOrder?'var(--ok)':'var(--text-dim)'}} onClick={()=>setOpenId(c.userId)}>
            <span className="adm-avatar">{initials(c.name)}</span>
            <span className="adm-item-main">
              <span className="adm-item-title"><span>{c.name}</span></span>
              <span className="adm-item-sub" style={{display:'block'}}>{c.whatsapp||c.email||'sem contato'}{c.lastOrderAt?` · último pedido ${timeAgo(c.lastOrderAt)}`:''}</span>
            </span>
            <span className="adm-item-side">
              {c.hasOrder?<strong>{brl(c.totalSpent)}</strong>:<Badge>sem pedido</Badge>}
              {c.hasOrder&&<span className="adm-muted">{c.totalCards} cartas</span>}
            </span>
          </button>))}
        </div>}
    </div>

    <Sheet open={!!open} onClose={()=>setOpenId(null)} title={open?.name} sub={open?(open.hasOrder?`${open.orders.length} pedido(s) · ${brl(open.totalSpent)}`:'Ainda não comprou'):''}>
      {open&&<>
        <div className="adm-info">
          {open.email&&<div><Mail size={12} style={{verticalAlign:'-2px'}}/> {open.email}</div>}
          {open.whatsapp&&<div><MessageCircle size={12} style={{verticalAlign:'-2px'}}/> {open.whatsapp}</div>}
          <div><Wallet size={12} style={{verticalAlign:'-2px'}}/> {brl(open.totalSpent)} em compras · {open.totalCards} cartas</div>
        </div>
        <div className="adm-row-actions">
          {normalizeWhatsAppNumber(open.whatsapp)&&<a className="adm-btn is-wa" style={{flex:1,textDecoration:'none'}} href={`https://wa.me/${normalizeWhatsAppNumber(open.whatsapp)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={15}/> WhatsApp</a>}
          {open.hasOrder&&<button className="adm-btn" onClick={()=>{setOpenId(null);setOrderMode('list');setOrderFilter('ALL');setSearchOrders(open.name);go('orders');}}><Package size={14}/> Ver pedidos</button>}
        </div>
        {open.orders.length>0&&<div className="adm-card"><div className="adm-list">{open.orders.map(o=><OrderRow key={o.orderId} o={o} onOpen={o2=>{setOpenId(null);go('orders');openOrder(o2);}}/>)}</div></div>}
      </>}
    </Sheet>

    <Sheet open={broadcast} onClose={()=>setBroadcast(false)} title="Mensagem em sequência" sub="Abre uma conversa por vez, já preenchida">
      <Broadcast ctx={ctx} clients={clients}/>
    </Sheet>
  </>);
}
