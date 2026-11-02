// Vendas que já estão no banco e ninguém via: carrinhos parados e a demanda
// da lista de desejos. Tudo vira uma conversa de WhatsApp já escrita — o
// portal não manda nada sozinho; o admin revisa e envia.
import { useMemo, useState } from 'react';
import { MessageCircle, ScrollText, ShoppingCart, Sparkles } from 'lucide-react';
import { normalizeWhatsAppNumber } from '../../whatsappCommunication';
import { cartReminderMessage, wishAvailableMessage } from '../../../shared/adminInsights';
import { Badge, Chips, Empty, Loading, SearchBox, Sheet, initials, timeAgo } from '../ui';

const waUrl=(whatsapp,text)=>{const phone=normalizeWhatsAppNumber(whatsapp);return phone?`https://wa.me/${phone}?text=${encodeURIComponent(text)}`:'';};

export function CartsPanel({ctx}){
  const {carts,cartsLoading}=ctx;
  const [filter,setFilter]=useState('all');
  const [openId,setOpenId]=useState(null);
  const [sent,setSent]=useState(()=>new Set());
  const list=useMemo(()=>{
    if(filter==='close')return carts.filter(c=>c.missing>0&&c.missing<=5);
    if(filter==='ready')return carts.filter(c=>c.missing===0);
    if(filter==='stale')return carts.filter(c=>(c.idleDays??0)>=3);
    return carts;
  },[carts,filter]);
  const open=carts.find(c=>c.orderId===openId);
  const totalCards=carts.reduce((s,c)=>s+c.qty,0);

  function remind(cart){
    const url=waUrl(cart.whatsapp,cartReminderMessage(cart));
    if(!url){ctx.toast&&ctx.toast('Cliente sem WhatsApp válido','error');return;}
    window.open(url,'_blank','noopener,noreferrer');
    setSent(prev=>new Set(prev).add(cart.orderId));
  }

  return(<>
    <div className="adm-info"><b>{carts.length}</b> carrinho(s) com <b>{totalCards}</b> cartas esperando. Quem está mais perto do mínimo aparece primeiro — é a venda mais fácil.</div>
    <Chips value={filter} onChange={setFilter} options={[
      {key:'all',label:'Todos',count:carts.length},
      {key:'ready',label:'Já podem fechar',color:'var(--ok)',count:carts.filter(c=>c.missing===0).length},
      {key:'close',label:'Faltam até 5',color:'var(--gold)',count:carts.filter(c=>c.missing>0&&c.missing<=5).length},
      {key:'stale',label:'Parados 3+ dias',color:'var(--text-dim)',count:carts.filter(c=>(c.idleDays??0)>=3).length},
    ]}/>
    <div className="adm-card">
      {cartsLoading?<Loading/>:!list.length?<Empty icon={ShoppingCart} title="Nenhum carrinho parado" sub={filter!=='all'?'Tente outro filtro':'Quando alguém deixar cartas no carrinho, aparece aqui'}/>:
        <div className="adm-list">{list.map(c=>(
          <button key={c.orderId} className="adm-item" style={{'--c':c.missing===0?'var(--ok)':c.missing<=5?'var(--gold)':'var(--text-dim)'}} onClick={()=>setOpenId(c.orderId)}>
            <span className="adm-avatar">{initials(c.name)}</span>
            <span className="adm-item-main">
              <span className="adm-item-title"><span>{c.name}</span>{sent.has(c.orderId)&&<Badge color="var(--wa)">lembrado</Badge>}</span>
              <span className="adm-item-sub" style={{display:'block'}}>{c.qty} carta{c.qty!==1?'s':''} · {c.missing===0?'pode fechar':`faltam ${c.missing}`}{c.lastAddedAt?` · mexeu ${timeAgo(c.lastAddedAt)}`:''}</span>
            </span>
            <span className="adm-item-side"><strong>{c.qty}</strong><span className="adm-muted">cartas</span></span>
          </button>))}
        </div>}
    </div>

    <Sheet open={!!open} onClose={()=>setOpenId(null)} title={open?.name} sub={open?`${open.qty} cartas no carrinho · ${open.missing===0?'já pode fechar':`faltam ${open.missing} para o mínimo`}`:''}>
      {open&&<>
        <div className="adm-card"><div className="adm-list">{open.lines.map((l,i)=>(
          <div key={i} className="adm-item" style={{cursor:'default'}}>
            <span className="adm-item-main"><span className="adm-item-title"><span>{l.name}</span></span><span className="adm-item-sub" style={{display:'block'}}>{l.type}</span></span>
            <span className="adm-item-side"><strong>×{l.qty}</strong></span>
          </div>))}
        </div></div>
        <div className="adm-info" style={{whiteSpace:'pre-wrap'}}>{cartReminderMessage(open)}</div>
        <div className="adm-row-actions">
          <button className="adm-btn" onClick={()=>ctx.copyText(cartReminderMessage(open),'Mensagem copiada')}>Copiar</button>
          <button className="adm-btn is-wa" style={{flex:1}} disabled={!normalizeWhatsAppNumber(open.whatsapp)} onClick={()=>remind(open)}><MessageCircle size={15}/> {normalizeWhatsAppNumber(open.whatsapp)?'Lembrar pelo WhatsApp':'Sem WhatsApp'}</button>
        </div>
      </>}
    </Sheet>
  </>);
}

export function WishPanel({ctx}){
  const {wishDemand,wishLoading}=ctx;
  const [filter,setFilter]=useState('all');
  const [search,setSearch]=useState('');
  const [openId,setOpenId]=useState(null);
  const [sent,setSent]=useState(()=>new Set());
  const list=useMemo(()=>{
    let l=wishDemand;
    if(filter==='new')l=l.filter(c=>c.isNew);
    if(filter==='off')l=l.filter(c=>!c.isActive);
    if(search){const q=search.toLowerCase();l=l.filter(c=>c.name.toLowerCase().includes(q));}
    return l;
  },[wishDemand,filter,search]);
  const open=wishDemand.find(c=>c.cardId===openId);

  function notify(person,card){
    const url=waUrl(person.whatsapp,wishAvailableMessage(person,card));
    if(!url){ctx.toast&&ctx.toast('Cliente sem WhatsApp válido','error');return;}
    window.open(url,'_blank','noopener,noreferrer');
    setSent(prev=>new Set(prev).add(`${card.cardId}:${person.userId}`));
  }

  return(<>
    <div className="adm-info">O que o pessoal quer e ainda não comprou. Carta <b>nova</b> (entrou no catálogo nos últimos 7 dias) e desejada é aviso pronto para mandar.</div>
    <SearchBox value={search} onChange={setSearch} placeholder="Buscar carta"/>
    <Chips value={filter} onChange={setFilter} options={[
      {key:'all',label:'Mais desejadas',count:wishDemand.length},
      {key:'new',label:'Novas e desejadas',color:'var(--ok)',count:wishDemand.filter(c=>c.isNew).length},
      {key:'off',label:'Fora do catálogo',color:'var(--danger)',count:wishDemand.filter(c=>!c.isActive).length},
    ]}/>
    <div className="adm-card">
      {wishLoading?<Loading/>:!list.length?<Empty icon={ScrollText} title="Nenhum desejo aqui" sub={filter!=='all'||search?'Tente outro filtro':'Quando clientes guardarem cartas nos desejos, aparece aqui'}/>:
        <div className="adm-list">{list.map((c,i)=>(
          <button key={c.cardId} className="adm-item" style={{'--c':c.isNew?'var(--ok)':!c.isActive?'var(--danger)':'var(--text-dim)'}} onClick={()=>setOpenId(c.cardId)}>
            <span className="adm-avatar" style={{fontVariantNumeric:'tabular-nums'}}>{i+1}</span>
            <span className="adm-item-main">
              <span className="adm-item-title"><span>{c.name}</span>{c.isNew&&<Badge color="var(--ok)"><Sparkles size={10}/> nova</Badge>}{!c.isActive&&<Badge color="var(--danger)">fora</Badge>}</span>
              <span className="adm-item-sub" style={{display:'block'}}>{c.type} · {c.peopleCount} pessoa{c.peopleCount!==1?'s':''}</span>
            </span>
            <span className="adm-item-side"><strong>{c.wanted}</strong><span className="adm-muted">unid.</span></span>
          </button>))}
        </div>}
    </div>

    <Sheet open={!!open} onClose={()=>setOpenId(null)} title={open?.name} sub={open?`${open.wanted} unidade(s) desejada(s) por ${open.peopleCount} pessoa(s)`:''}>
      {open&&<>
        {!open.isActive&&<div className="adm-info" style={{color:'var(--danger)'}}>Esta carta está fora do catálogo: avisar agora geraria frustração. Reative em Mais → Catálogo → Editar cartas.</div>}
        <div className="adm-card"><div className="adm-list">{open.people.map(p=>{const k=`${open.cardId}:${p.userId}`;const has=!!normalizeWhatsAppNumber(p.whatsapp);return(
          <div key={k} className="adm-item" style={{cursor:'default'}}>
            <span className="adm-avatar">{initials(p.name)}</span>
            <span className="adm-item-main"><span className="adm-item-title"><span>{p.name}</span>{sent.has(k)&&<Badge color="var(--wa)">avisado</Badge>}</span><span className="adm-item-sub" style={{display:'block'}}>quer {p.missing}</span></span>
            <button className="adm-btn is-sm is-wa" disabled={!has||!open.isActive} onClick={()=>notify(p,open)} aria-label={`Avisar ${p.name} pelo WhatsApp`}><MessageCircle size={14}/> {has?'Avisar':'sem WhatsApp'}</button>
          </div>);})}
        </div></div>
      </>}
    </Sheet>
  </>);
}
