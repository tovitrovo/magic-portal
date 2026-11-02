// Editar o catálogo sem mexer no banco: achar a carta, tirar da venda ou
// voltar com ela, corrigir nome, tipo e imagem.
import { useEffect, useRef, useState } from 'react';
import { Check, EyeOff, Pencil } from 'lucide-react';
import { CATALOG_TYPES, CardThumb, Spin } from '../../kit';
import { Badge, Chips, Empty, Loading, SearchBox, Sheet, Toggle } from '../ui';

export default function CardEditor({ctx}){
  const {apiPost,toast}=ctx;
  const say=(m,t='success')=>toast&&toast(m,t);
  const [q,setQ]=useState('');
  const [status,setStatus]=useState('all');
  const [cards,setCards]=useState([]);
  const [total,setTotal]=useState(0);
  const [loading,setLoading]=useState(false);
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState(null);
  const [saving,setSaving]=useState(false);
  const reqRef=useRef(0);

  async function search(offset=0){
    const id=++reqRef.current;
    setLoading(true);
    try{
      const json=await apiPost('/api/admin-cards',{action:'search',q,status,offset});
      if(id!==reqRef.current)return;
      setCards(prev=>offset?[...prev,...json.cards]:json.cards);setTotal(json.total||0);
    }catch(e){if(id===reqRef.current)say('Erro ao buscar cartas: '+(e.message||String(e)),'error');}
    finally{if(id===reqRef.current)setLoading(false);}
  }
  useEffect(()=>{const t=setTimeout(()=>search(0),300);return()=>clearTimeout(t);},[q,status]); // eslint-disable-line react-hooks/exhaustive-deps

  function open(card){setEditing(card);setForm({name:card.name||'',type:card.type||'Normal',image_url:card.image_url||'',is_active:card.is_active!==false});}
  async function save(patch,card=editing){
    setSaving(true);
    try{
      const {card:saved}=await apiPost('/api/admin-cards',{action:'update',id:card.id,patch});
      setCards(prev=>prev.map(c=>c.id===saved.id?saved:c));
      if(editing&&editing.id===saved.id){setEditing(null);setForm(null);}
      say(patch.is_active===false?'Carta fora do catálogo':patch.is_active===true&&Object.keys(patch).length===1?'Carta de volta ao catálogo':'Carta salva');
    }catch(e){say('Erro ao salvar: '+(e.message||String(e)),'error');}
    setSaving(false);
  }
  const types=[...new Set([...CATALOG_TYPES,editing?.type].filter(Boolean))];

  return(<>
    <SearchBox value={q} onChange={setQ} placeholder="Buscar carta pelo nome"/>
    <Chips value={status} onChange={setStatus} options={[
      {key:'all',label:'Todas'},
      {key:'active',label:'À venda',color:'var(--ok)'},
      {key:'inactive',label:'Fora do catálogo',color:'var(--danger)'},
    ]}/>
    <div className="adm-card">
      {loading&&!cards.length?<Loading/>:!cards.length?<Empty title="Nenhuma carta" sub={q?'Tente outro nome':''}/>:
        <div className="adm-list">{cards.map(c=>(
          <div key={c.id} className="adm-item" style={{'--c':c.is_active===false?'var(--danger)':'var(--ok)'}}>
            <span style={{width:34,flexShrink:0}}><CardThumb card={c} radius={4} style={{aspectRatio:'63 / 88',border:'none'}}/></span>
            <span className="adm-item-main">
              <span className="adm-item-title"><span>{c.name}</span>{c.is_active===false&&<Badge color="var(--danger)">fora</Badge>}</span>
              <span className="adm-item-sub" style={{display:'block'}}>{c.type||'Normal'}</span>
            </span>
            <button className="adm-btn is-sm" disabled={saving} onClick={()=>save({is_active:c.is_active===false},c)} aria-label={c.is_active===false?`Voltar ${c.name} ao catálogo`:`Tirar ${c.name} do catálogo`}>{c.is_active===false?<><Check size={13}/> Ativar</>:<><EyeOff size={13}/> Tirar</>}</button>
            <button className="adm-btn is-sm" onClick={()=>open(c)} aria-label={`Editar ${c.name}`}><Pencil size={13}/></button>
          </div>))}
        </div>}
    </div>
    {cards.length>0&&<div className="adm-muted" style={{textAlign:'center'}}>{cards.length} de {total}</div>}
    {cards.length<total&&<button className="adm-btn" disabled={loading} onClick={()=>search(cards.length)}>{loading?<Spin size={14}/>:'Carregar mais'}</button>}

    <Sheet open={!!editing} onClose={()=>{setEditing(null);setForm(null);}} title="Editar carta" sub={editing?.name}>
      {form&&<>
        <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
          <span style={{width:90,flexShrink:0}}><CardThumb card={{...editing,name:form.name,image_url:form.image_url}} radius={6} style={{aspectRatio:'63 / 88',border:'none'}}/></span>
          <div style={{flex:1,display:'flex',flexDirection:'column',gap:8}}>
            <label className="adm-muted">Nome<input className="adm-input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></label>
            <label className="adm-muted">Tipo<select className="adm-select" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>{types.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
          </div>
        </div>
        <label className="adm-muted">Imagem (link https)<input className="adm-input" value={form.image_url} placeholder="https://…" onChange={e=>setForm(f=>({...f,image_url:e.target.value}))}/></label>
        <Toggle on={form.is_active} onChange={v=>setForm(f=>({...f,is_active:v}))} title="À venda no catálogo" hint="Desligado, a carta some do catálogo, mas continua nos pedidos e desejos de quem já tem"/>
        <div className="adm-info">O tipo muda o preço (Normal, Holo e Foil têm pisos diferentes). O custo continua vindo da planilha do fornecedor.</div>
        <button className="adm-btn is-primary" disabled={saving||!form.name.trim()} onClick={()=>save({name:form.name,type:form.type,image_url:form.image_url,is_active:form.is_active})}>{saving?<Spin size={14}/>:<><Check size={14}/> Salvar</>}</button>
      </>}
    </Sheet>
  </>);
}
