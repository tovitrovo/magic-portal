import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Home, ScrollText, ShoppingCart, User, Shield, Plus, Minus, Trash2, ChevronRight, ChevronLeft, Sparkles, LogOut, Check, Search, BookOpen, Eye, EyeOff, Mail, Lock, ArrowRight, ArrowLeft, X, Gift, Truck, CreditCard, Circle, CheckCircle, ArrowDown, Upload, Copy, Calendar, DollarSign, Settings, Camera, Phone, MessageCircle, Bell, Package, MapPin, Edit3, RefreshCw, Volume2, VolumeX, HelpCircle, Loader, AlertTriangle, Wifi, WifiOff, Archive } from 'lucide-react';

// ══════════════════════════════════════════════════════
// SUPABASE REST CLIENT
// ══════════════════════════════════════════════════════

const SB_URL = 'https://kjyqnlpiohoewmqmsuxp.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXFubHBpb2hvZXdtcW1zdXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNTA5NDAsImV4cCI6MjA4NzgyNjk0MH0.1BjTAFgv7yfJ00uY6WNlwUOYd4c4YOqFTV78CLvLBk0';


const CAMPAIGN_LABELS = {
  ACTIVE: 'Encomenda ativa',
  LOCKED: 'Encomenda trancada',
  ORDERING: 'Negociação com o vendedor',
  ORDERED: 'Pedido feito',
  RECEIVED: 'Pedido recebido no Brasil',
  PACKING: 'Empacotando',
  SHIPPING: 'Enviando',
  DONE: 'Encomenda finalizada',
};

function campaignLabel(status){
  return CAMPAIGN_LABELS[String(status || 'ACTIVE').toUpperCase()] || 'Encomenda ativa';
}

function campaignCanOrder(status){
  if (!status) return false;
  return String(status).toUpperCase() === 'ACTIVE';
}

// Sync Mercado Pago status for a batch (server-side)
async function mpSync(batchId){
  const r = await fetch('/api/mp-sync', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ batchId: String(batchId) })
  });
  const txt = await r.text();
  let j = {};
  try{ j = JSON.parse(txt); } catch { j = { raw: txt }; }
  if(!r.ok || !j.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`);
  return j;
}


function sbH(token) {
  return { 'apikey': SB_KEY, 'Authorization': `Bearer ${token || SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
}

async function sbGet(table, query = '', token) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers: sbH(token) });
  if (!r.ok) { const t = await r.text(); throw new Error(`GET ${table}: ${t}`); }
  return r.json();
}


async function loadOrderCards(orderLike, token){
  const candidates = [
    orderLike?.batch_id,
    orderLike?.order_batch_id,
    orderLike?.batch?.id,
    orderLike?.order_batches?.id,
    orderLike?.id,
  ].map(v => String(v || '').trim()).filter(Boolean);

  for (const id of candidates) {
    try {
      const rows = await sbGet(
        'order_items',
        `batch_id=eq.${id}&select=id,quantity,cards(name,type)`,
        token
      );

      if (Array.isArray(rows) && rows.length > 0) {
        return rows.map(r => ({
          name: r.cards?.name || 'Carta',
          type: r.cards?.type || '',
          qty: Number(r.quantity || 1),
        }));
      }
    } catch (e) {
      console.error('loadOrderCards by batch_id', id, e);
    }
  }

  return [];
}

async function sbPost(table, data, token) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: 'POST', headers: sbH(token), body: JSON.stringify(data) });
  if (!r.ok) { const t = await r.text(); throw new Error(`POST ${table}: ${t}`); }
  return r.json();
}

async function sbUpsert(table, data, token) {
  const h = { ...sbH(token), 'Prefer': 'return=representation,resolution=merge-duplicates' };
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: 'POST', headers: h, body: JSON.stringify(data) });
  if (!r.ok) { const t = await r.text(); throw new Error(`Erro ao criar conta: ${t}`); }
  return r.json();
}

async function sbPatch(table, query, data, token) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { method: 'PATCH', headers: sbH(token), body: JSON.stringify(data) });
  if (!r.ok) { const t = await r.text(); throw new Error(`PATCH ${table}: ${t}`); }
  return r.json();
}

async function sbDelete(table, query, token) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { method: 'DELETE', headers: sbH(token) });
  if (!r.ok) { const t = await r.text(); throw new Error(`DEL ${table}: ${t}`); }
  return r.status === 204 ? [] : r.json();
}

async function sbAuthSignUp(email, password) {
  const r = await fetch(`${SB_URL}/auth/v1/signup`, { method: 'POST', headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) { const t = await r.text(); if (t.includes('already registered') || t.includes('already been registered')) throw new Error('Este usuário já está cadastrado'); throw new Error(`Erro ao criar conta: ${t}`); }
  const d = await r.json();
  if (d.error || d.msg) { const m = d.error?.message || d.msg || ''; if (m.includes('already registered') || m.includes('already been registered')) throw new Error('Este usuário já está cadastrado'); throw new Error(`Erro ao criar conta: ${m}`); }
  // Supabase returns identities=[] for existing users (when confirm email is off)
  if (d.user && d.user.identities && d.user.identities.length === 0) throw new Error('Este usuário já está cadastrado');
  if (!d.user?.id) throw new Error('Erro ao criar conta. Tente novamente.');
  return d;
}

async function sbAuthSignIn(email, password) {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const msg = d.error_description || d.msg || '';
    if (msg.includes('Invalid login')) throw new Error('Usuário ou senha incorretos');
    if (msg.includes('Email not confirmed')) throw new Error('Email não confirmado. Verifique sua caixa de entrada.');
    throw new Error('Usuário ou senha incorretos');
  }
  const d = await r.json();
  if (!d.access_token) throw new Error('Login falhou — sem token');
  return d;
}

async function sbAuthResetPassword(email) {
  const r = await fetch(`${SB_URL}/auth/v1/recover`, {
    method: 'POST', headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  if (!r.ok) throw new Error('Erro ao enviar email de recuperação');
  return true;
}

async function sbAuthUpdatePassword(newPassword, token) {
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    method: 'PUT', headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: newPassword })
  });
  if (!r.ok) { const t = await r.text(); throw new Error('Erro ao alterar senha'); }
  return true;
}

async function sbUpload(bucket, path, file, token) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST', headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${token}` }, body: file
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Upload: ${t}`); }
  return r.json();
}

// ══════════════════════════════════════════════════════
// SOUND ENGINE
// ══════════════════════════════════════════════════════

const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
let _actx = null;
function getCtx() { if (!_actx && AudioCtx) _actx = new AudioCtx(); return _actx; }

function playTone(freq, dur, type = 'square', vol = 0.08) {
  try {
    const ctx = getCtx(); if (!ctx) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  } catch(e) {}
}

const SFX = {
  click: () => playTone(800, 0.06, 'sine', 0.04),
  nav: () => playTone(600, 0.08, 'sine', 0.03),
  addCard: () => { playTone(523, 0.08, 'square', 0.06); setTimeout(() => playTone(659, 0.08, 'square', 0.06), 80); setTimeout(() => playTone(784, 0.1, 'square', 0.06), 160); },
  confirm: () => { playTone(523, 0.1, 'square', 0.07); setTimeout(() => playTone(659, 0.1, 'square', 0.07), 120); setTimeout(() => playTone(784, 0.1, 'square', 0.07), 240); setTimeout(() => playTone(1047, 0.15, 'square', 0.07), 360); },
  bonus: () => { [523,659,784,1047,1319].forEach((f,i) => setTimeout(() => playTone(f, 0.12, 'square', 0.05), i * 70)); },
  tierUp: () => { [261,329,392,523,659,784].forEach((f,i) => setTimeout(() => playTone(f, 0.15, 'square', 0.06), i * 100)); },
  error: () => playTone(200, 0.15, 'sawtooth', 0.05),
  toggle: () => playTone(1000, 0.04, 'sine', 0.03),
  success: () => { playTone(784, 0.12, 'square', 0.06); setTimeout(() => playTone(1047, 0.2, 'square', 0.06), 150); },
};

// ══════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════

const MANA_COLORS=[{key:'W',emoji:'☀️',color:'#f0e6b2'},{key:'U',emoji:'💧',color:'#4a90d9'},{key:'B',emoji:'💀',color:'#9b8ec0'},{key:'R',emoji:'🔥',color:'#d94452'},{key:'G',emoji:'🌿',color:'#2d8f4e'}];
const GUILD_MAP={'WU':'Azorius','UW':'Azorius','UB':'Dimir','BU':'Dimir','BR':'Rakdos','RB':'Rakdos','RG':'Gruul','GR':'Gruul','GW':'Selesnya','WG':'Selesnya','WB':'Orzhov','BW':'Orzhov','UR':'Izzet','RU':'Izzet','BG':'Golgari','GB':'Golgari','RW':'Boros','WR':'Boros','GU':'Simic','UG':'Simic'};
const GT={Azorius:{primary:'#4a90d9',secondary:'#f0e6b2',glow:'rgba(74,144,217,0.25)'},Dimir:{primary:'#5b6abf',secondary:'#9b8ec0',glow:'rgba(91,106,191,0.25)'},Rakdos:{primary:'#d94452',secondary:'#9b8ec0',glow:'rgba(217,68,82,0.25)'},Gruul:{primary:'#d94452',secondary:'#2d8f4e',glow:'rgba(45,143,78,0.25)'},Selesnya:{primary:'#2d8f4e',secondary:'#f0e6b2',glow:'rgba(45,143,78,0.25)'},Orzhov:{primary:'#f0e6b2',secondary:'#9b8ec0',glow:'rgba(201,169,110,0.25)'},Izzet:{primary:'#4a90d9',secondary:'#d94452',glow:'rgba(74,144,217,0.25)'},Golgari:{primary:'#2d8f4e',secondary:'#9b8ec0',glow:'rgba(45,143,78,0.25)'},Boros:{primary:'#d94452',secondary:'#f0e6b2',glow:'rgba(217,68,82,0.25)'},Simic:{primary:'#2d8f4e',secondary:'#4a90d9',glow:'rgba(45,143,78,0.25)'}};
function getGuild(a,b){return a&&b&&a!==b?(GUILD_MAP[a+b]||null):null;}
const TC={Normal:'rgba(255,255,255,0.4)',Holo:'#c9a96e',Foil:'#d94452',English:'#3b82f6',Chinese:'#ef4444',Japanese:'#f59e0b',Promo:'#f472b6','Showcase Foil':'#a78bfa',Regular:'rgba(255,255,255,0.4)','Enchanted Foil':'#c084fc','Cold Foil':'#38bdf8'};
const TCG_LIST=[
  {key:'Magic',color:'#a78bfa',types:['Todos','Normal','Holo','Foil']},
  {key:'Pokemon',color:'#facc15',types:['Todos','English','Chinese','Japanese']},
  {key:'One Piece',color:'#ef4444',types:[]},
  {key:'Star Wars',color:'#38bdf8',types:['Todos','Promo','Showcase Foil','Regular']},
  {key:'YuGiOh',color:'#c084fc',types:['Todos','Foil']},
  {key:'Lorcana',color:'#2dd4bf',types:['Todos','Regular','Enchanted Foil','Cold Foil']},
  {key:'FAB',color:'#fb923c',types:['Todos','Regular','Japanese','Foil','Cold Foil']},
];
const RPG_TIER_NAMES=['Aprendiz','Iniciado','Escudeiro','Guerreiro','Veterano','Campeão','Herói','Mestre','Grão-Mestre','Lenda','Mítico'];
const DEFAULT_TIERS=[
  {label:'Aprendiz',   usd:2.00,min:1,   max:100,     quest:''},
  {label:'Iniciado',   usd:1.90,min:101,  max:200,     quest:''},
  {label:'Escudeiro',  usd:1.80,min:201,  max:300,     quest:''},
  {label:'Guerreiro',  usd:1.70,min:301,  max:400,     quest:''},
  {label:'Veterano',   usd:1.66,min:401,  max:500,     quest:''},
  {label:'Campeão',    usd:1.63,min:501,  max:600,     quest:''},
  {label:'Herói',      usd:1.52,min:601,  max:700,     quest:''},
  {label:'Mestre',     usd:1.41,min:701,  max:800,     quest:''},
  {label:'Grão-Mestre',usd:1.30,min:801,  max:900,     quest:''},
  {label:'Lenda',      usd:1.19,min:901,  max:1000,    quest:''},
  {label:'Mítico',     usd:1.08,min:1001, max:99999999,quest:''},
];

function getTier(q,tiers){return tiers.find(t=>q>=t.min&&q<=t.max)||tiers[0];}
function getNextTier(q,tiers){const c=getTier(q,tiers);const i=tiers.indexOf(c);return i<tiers.length-1?tiers[i+1]:null;}

function calcBrlPrice(usdPerCard, pricing) {
  if (!pricing) return 0;
  const base = usdPerCard * (1 + (pricing.card_fee_percent || 0) / 100);
  const taxed = base * (1 + (pricing.tax_percent || 0) / 100);
  const brl = taxed * (pricing.usd_brl_rate || 5.68);
  const marked = brl * (1 + (pricing.markup_percent || 0) / 100);
  return Math.ceil(marked + (pricing.profit_fixed_brl || 0));
}

function calcUsdFromBrl(brlTarget, pricing) {
  if (!pricing || !brlTarget) return 0;
  const marked = brlTarget - (pricing.profit_fixed_brl || 0);
  const brl = marked / (1 + (pricing.markup_percent || 0) / 100);
  const taxed = brl / (pricing.usd_brl_rate || 5.68);
  const base = taxed / (1 + (pricing.tax_percent || 0) / 100);
  return parseFloat((base / (1 + (pricing.card_fee_percent || 0) / 100)).toFixed(4));
}

// Retorna o preço BRL de uma carta baseado no tipo (nova lógica simplificada)
// Foil → foil_price_brl | Holo/Ouro → ouro_price_brl | demais → normal_price_brl
function getCardPrice(cardType, pricing) {
  if (!pricing) return 16;
  const type = String(cardType || 'Normal').toLowerCase();
  if (type === 'foil') return Number(pricing.foil_price_brl) || 18;
  if (type === 'holo') return Number(pricing.ouro_price_brl) || 16;
  return Number(pricing.normal_price_brl) || 16;
}

// ══════════════════════════════════════════════════════
// FLOATING MANA BACKGROUND
// ══════════════════════════════════════════════════════

function FloatingMana({theme}){
  const symbols=['☀️','💧','💀','🔥','🌿','⚔️','🛡️','🔮','✨','💎'];
  const items=useMemo(()=>symbols.map((s,i)=>({
    emoji:s,
    left:Math.random()*100,
    delay:Math.random()*20,
    dur:18+Math.random()*22,
    size:14+Math.random()*16,
    drift:-30+Math.random()*60,
  })),[]);
  return <div style={{position:'fixed',inset:0,pointerEvents:'none',zIndex:0,overflow:'hidden'}}>
    {items.map((m,i)=><div key={i} style={{
      position:'absolute',bottom:'-40px',left:m.left+'%',fontSize:m.size,opacity:0.04,
      animation:`manaFloat ${m.dur}s ${m.delay}s linear infinite`,
      filter:'blur(1px)',
    }}>{m.emoji}</div>)}
    <div style={{position:'absolute',top:0,left:'20%',width:'60%',height:'40%',background:`radial-gradient(ellipse,${theme.primary}08 0%,transparent 70%)`,pointerEvents:'none'}}/>
    <div style={{position:'absolute',bottom:0,right:0,width:'40%',height:'30%',background:`radial-gradient(ellipse,${theme.secondary}06 0%,transparent 70%)`,pointerEvents:'none'}}/>
  </div>;
}

// ══════════════════════════════════════════════════════
// UI PRIMITIVES
// ══════════════════════════════════════════════════════

const Card=({children,style,glow,onClick,id})=><div id={id} onClick={onClick} style={{background:'linear-gradient(180deg,rgba(255,255,255,0.055)0%,rgba(255,255,255,0.018)100%)',border:'1px solid '+(glow||'rgba(255,255,255,0.06)'),borderRadius:16,padding:16,...(glow?{boxShadow:'0 0 20px '+glow}:{}),...(onClick?{cursor:'pointer'}:{}),...style}}>{children}</div>;
const Btn=({children,variant='primary',disabled,onClick,style,full,sfx='click',id})=>{const v={primary:{background:'var(--gp)',color:'#fff',boxShadow:'0 4px 18px var(--gg)'},secondary:{background:'rgba(255,255,255,0.06)',color:'#fff',border:'1px solid rgba(255,255,255,0.08)'},ghost:{background:'transparent',color:'var(--gp)',padding:'12px'},danger:{background:'rgba(217,68,82,0.1)',color:'#ff6b7a',border:'1px solid rgba(217,68,82,0.15)'},success:{background:'rgba(46,229,157,0.1)',color:'#2ee59d',border:'1px solid rgba(46,229,157,0.15)'},pix:{background:'rgba(0,190,164,0.12)',color:'#00bea4',border:'1px solid rgba(0,190,164,0.2)'},warn:{background:'rgba(201,169,110,0.1)',color:'#c9a96e',border:'1px solid rgba(201,169,110,0.15)'}};return <button id={id} onClick={e=>{if(!disabled&&sfx&&SFX[sfx])SFX[sfx]();if(onClick)onClick(e);}} disabled={disabled} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:8,border:'none',borderRadius:14,padding:'13px 20px',fontWeight:700,fontSize:14,cursor:disabled?'not-allowed':'pointer',opacity:disabled?.4:1,transition:'all .15s',fontFamily:"'Outfit',sans-serif",...(full?{width:'100%'}:{}),...v[variant],...style}}>{children}</button>;};
const Input=({icon:Icon,...p})=><div style={{position:'relative'}}>{Icon&&<Icon size={18} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'rgba(255,255,255,0.22)',pointerEvents:'none'}}/>}<input {...p} style={{width:'100%',padding:Icon?'13px 14px 13px 42px':'13px 14px',borderRadius:14,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(0,0,0,0.3)',color:'#e9edf7',fontSize:15,fontFamily:"'Outfit',sans-serif",outline:'none',boxSizing:'border-box',...p.style}}/></div>;
const Tag=({children,color,style})=><span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'5px 11px',borderRadius:99,background:color?color+'14':'rgba(255,255,255,0.04)',border:'1px solid '+(color?color+'22':'rgba(255,255,255,0.06)'),fontSize:12,color:color||'rgba(255,255,255,0.55)',fontWeight:600,whiteSpace:'nowrap',...style}}>{children}</span>;
const SectionTitle=({children,sub})=><div style={{marginBottom:12}}><h2 style={{margin:0,fontSize:17,fontFamily:"'Cinzel',serif",color:'#fff',letterSpacing:.3}}>{children}</h2>{sub&&<p style={{margin:'3px 0 0',fontSize:12,color:'rgba(255,255,255,0.33)'}}>{sub}</p>}</div>;
const EmptyState=({icon:Icon,title,sub})=><div style={{textAlign:'center',padding:'32px 20px',opacity:.5}}><Icon size={34} style={{marginBottom:8,color:'var(--gp)'}}/><div style={{fontSize:15,fontWeight:700,marginBottom:4}}>{title}</div><div style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>{sub}</div></div>;
const ManaOrb=({mana,selected,onClick,size=44})=>{const m=MANA_COLORS.find(c=>c.key===mana);return <button onClick={()=>{SFX.toggle();onClick&&onClick();}} style={{width:size,height:size,borderRadius:size,background:selected?m.color+'28':'rgba(255,255,255,0.03)',border:'2.5px solid '+(selected?m.color:'rgba(255,255,255,0.08)'),display:'grid',placeItems:'center',cursor:'pointer',fontSize:size*.4,transition:'all .2s',boxShadow:selected?'0 0 14px '+m.color+'35':'none'}}>{m.emoji}</button>;};
const GuildBadge=({guild,size=22})=>{const t=GT[guild];if(!t)return null;return <div style={{width:size,height:size,borderRadius:size,background:'linear-gradient(135deg,'+t.primary+','+t.secondary+')',boxShadow:'0 0 '+size*.5+'px '+t.glow,flexShrink:0}}/>;};
const Spin=({size=18,color})=><Loader size={size} style={{color:color||'var(--gp)',animation:'spin 1s linear infinite'}}/>;
const Toast=({msg,type='info',onClose})=>{const bg=type==='error'?'rgba(217,68,82,0.15)':type==='success'?'rgba(46,229,157,0.15)':'rgba(74,144,217,0.15)';const c=type==='error'?'#ff6b7a':type==='success'?'#2ee59d':'#4a90d9';return <div style={{position:'fixed',top:16,left:'50%',transform:'translateX(-50%)',zIndex:200,padding:'10px 18px',borderRadius:14,background:bg,border:'1px solid '+c+'30',color:c,fontSize:13,fontWeight:600,display:'flex',alignItems:'center',gap:8,backdropFilter:'blur(12px)',maxWidth:'90%'}}>{type==='error'?<AlertTriangle size={15}/>:<Check size={15}/>}{msg}<button onClick={onClose} style={{background:'none',border:'none',color:c,cursor:'pointer',padding:2}}><X size={14}/></button></div>;};

const AddressForm=({address,setAddress})=>{
  const [cepLoading,setCepLoading]=useState(false);
  const lastCepRef=useRef('');
  const u=(k,v)=>setAddress(prev=>({...prev,[k]:v}));

  function handleCepChange(raw){
    const cep=raw.replace(/\D/g,'').slice(0,8);
    u('cep',cep);
    if(cep.length===8&&cep!==lastCepRef.current){
      lastCepRef.current=cep;
      setCepLoading(true);
      fetch(`https://viacep.com.br/ws/${cep}/json/`)
        .then(r=>r.json())
        .then(d=>{
          if(!d.erro){
            setAddress(prev=>({...prev,rua:d.logradouro||prev.rua,bairro:d.bairro||prev.bairro,cidade:d.localidade||prev.cidade,uf:d.uf||prev.uf,complemento:d.complemento||prev.complemento}));
          }
        })
        .catch(()=>{})
        .finally(()=>setCepLoading(false));
    }
  }

  return(<div style={{display:'flex',flexDirection:'column',gap:8}}>
    <div style={{position:'relative'}}>
      <Input icon={MapPin} placeholder="CEP" value={address.cep||''} onChange={e=>handleCepChange(e.target.value)} inputMode="numeric"/>
      {cepLoading&&<div style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50)'}}><Spin size={14}/></div>}
    </div>
    <Input icon={MapPin} placeholder="Rua" value={address.rua||''} onChange={e=>u('rua',e.target.value)}/>
    <div style={{display:'flex',gap:8}}>
      <div style={{flex:'0 0 90px'}}><Input placeholder="Nº" value={address.numero||''} onChange={e=>u('numero',e.target.value)}/></div>
      <div style={{flex:1}}><Input placeholder="Complemento" value={address.complemento||''} onChange={e=>u('complemento',e.target.value)}/></div>
    </div>
    <Input placeholder="Bairro" value={address.bairro||''} onChange={e=>u('bairro',e.target.value)}/>
    <div style={{display:'flex',gap:8}}>
      <div style={{flex:1}}><Input placeholder="Cidade" value={address.cidade||''} onChange={e=>u('cidade',e.target.value)}/></div>
      <div style={{flex:'0 0 72px'}}><Input placeholder="UF" value={address.uf||''} onChange={e=>u('uf',e.target.value.toUpperCase().slice(0,2))}/></div>
    </div>
  </div>);
};

const AddressDisplay=({address,onEdit})=>{
  const has=address&&(address.rua||address.cep);
  return(<div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
    <div style={{fontSize:13,color:'rgba(255,255,255,0.55)',lineHeight:1.6}}>
      {has?<>
        {address.rua&&<div>{address.rua}{address.numero?', '+address.numero:''}{address.complemento?' · '+address.complemento:''}</div>}
        {(address.bairro||address.cidade)&&<div>{[address.bairro,address.cidade,address.uf].filter(Boolean).join(' — ')}</div>}
        {address.cep&&<div style={{fontSize:11,color:'rgba(255,255,255,0.3)'}}>CEP {address.cep}</div>}
      </>:<span style={{color:'rgba(255,255,255,0.25)'}}>Nenhum endereço cadastrado</span>}
    </div>
    <button onClick={onEdit} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:10,padding:'6px 10px',cursor:'pointer',color:'rgba(255,255,255,0.5)',display:'flex',alignItems:'center',gap:4,fontSize:11,flexShrink:0}}><Edit3 size={12}/> Editar</button>
  </div>);
};

function FlyingCard({show,onDone}){
  useEffect(()=>{if(show){const t=setTimeout(()=>onDone&&onDone(),600);return()=>clearTimeout(t);}},[show]);
  if(!show)return null;
  return <div style={{position:'fixed',zIndex:999,pointerEvents:'none',top:'50%',left:'50%',animation:'flyToWants 0.6s ease-in forwards'}}>
    <div style={{width:32,height:44,borderRadius:4,background:'linear-gradient(135deg,var(--gp),var(--gs))',boxShadow:'0 0 16px var(--gg)',border:'1px solid rgba(255,255,255,0.2)'}}/>
  </div>;
}

function SwipeableCard({children,onSwipeLeft,onSwipeRight,leftLabel='Excluir',rightLabel='Carrinho',leftColor='#ff6b7a',rightColor}){
  const ref=useRef(null);const startX=useRef(0);const [dx,setDx]=useState(0);const [swiping,setSwiping]=useState(false);
  const threshold=80;
  function onTouchStart(e){startX.current=e.touches[0].clientX;setSwiping(true);}
  function onTouchMove(e){if(!swiping)return;const d=e.touches[0].clientX-startX.current;setDx(Math.max(-150,Math.min(150,d)));}
  function onTouchEnd(){
    if(dx<-threshold&&onSwipeLeft)onSwipeLeft();
    else if(dx>threshold&&onSwipeRight)onSwipeRight();
    setDx(0);setSwiping(false);
  }
  const bgColor=dx<-30?leftColor+'20':dx>30?(rightColor||'var(--gp)')+'20':'transparent';
  return(<div style={{position:'relative',overflow:'hidden',borderRadius:16,background:bgColor,transition:swiping?'none':'background .3s'}}>
    {dx<-20&&<div style={{position:'absolute',right:16,top:'50%',transform:'translateY(-50%)',color:leftColor,fontSize:11,fontWeight:700,display:'flex',alignItems:'center',gap:4}}><Trash2 size={14}/>{leftLabel}</div>}
    {dx>20&&<div style={{position:'absolute',left:16,top:'50%',transform:'translateY(-50%)',color:rightColor||'var(--gp)',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',gap:4}}><ShoppingCart size={14}/>{rightLabel}</div>}
    <div ref={ref} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} style={{transform:`translateX(${dx}px)`,transition:swiping?'none':'transform .3s',position:'relative',zIndex:1}}>{children}</div>
  </div>);
}

function VirtualKeyboard({onKey,onBackspace,onDone,maxLen=6,currentLen=0,doneLabel='OK'}){
  const rows=[['1','2','3'],['4','5','6'],['7','8','9'],['⌫','0',doneLabel]];
  return(<div style={{background:'rgba(0,0,0,0.6)',backdropFilter:'blur(10px)',borderRadius:16,padding:10,border:'1px solid rgba(255,255,255,0.06)',maxWidth:220,margin:'0 auto'}}>
    {rows.map((row,ri)=>(<div key={ri} style={{display:'flex',justifyContent:'center',gap:4,marginBottom:4}}>
      {row.map(k=>{
        const isBack=k==='⌫';const isOk=k===doneLabel;const isNum=!isBack&&!isOk;
        const disabled=isNum&&currentLen>=maxLen;
        return <button key={k} onClick={()=>{if(isBack){SFX.click();onBackspace();}else if(isOk){SFX.confirm();onDone();}else if(!disabled){SFX.click();onKey(k);}}} disabled={disabled} style={{width:60,height:48,borderRadius:12,border:isOk?'none':'1px solid rgba(255,255,255,0.08)',background:isOk?'var(--gp)':isBack?'rgba(255,70,70,0.1)':'rgba(255,255,255,0.05)',color:isOk?'#fff':isBack?'#ff6b7a':'#e9edf7',fontSize:isNum?20:isOk?13:18,fontWeight:700,cursor:disabled?'not-allowed':'pointer',fontFamily:"'Outfit',sans-serif",display:'grid',placeItems:'center',opacity:disabled?.3:1}}>{k}</button>;})}
    </div>))}
  </div>);
}

// ══════════════════════════════════════════════════════
// TUTORIAL
// ══════════════════════════════════════════════════════

function TutorialOverlay({step,steps,onNext,onSkip,theme,onNavTo,isFirstTime}){
  if(step<0||step>=steps.length)return null;
  const s=steps[step];const isLast=step===steps.length-1;const [rect,setRect]=useState(null);
  useEffect(()=>{if(s.navTo&&onNavTo)onNavTo(s.navTo);},[step]);
  useEffect(()=>{const findEl=()=>{if(!s.spotlightId){setRect(null);return;}const el=document.getElementById(s.spotlightId);if(el){if(s.scrollTo)el.scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>{const r=el.getBoundingClientRect();setRect({top:r.top-6,left:r.left-6,width:r.width+12,height:r.height+12});},s.scrollTo?600:0);}else{setRect(null);}};const t=setTimeout(findEl,200);return()=>clearTimeout(t);},[step,s.spotlightId]);
  const cardAbove=rect&&rect.top>window.innerHeight/2;
  const msgTop=rect?(cardAbove?Math.max(60,rect.top-220):rect.top+rect.height+20):null;
  return(<div style={{position:'fixed',inset:0,zIndex:100,pointerEvents:s.interactive?'none':'auto'}}>
    <div style={{position:'absolute',inset:0,pointerEvents:s.interactive?'none':'auto'}} onClick={isFirstTime||s.interactive?undefined:onSkip}/>
    {rect&&<div style={{position:'absolute',top:rect.top,left:rect.left,width:rect.width,height:rect.height,borderRadius:14,border:'2.5px solid '+theme.primary,boxShadow:'0 0 30px '+theme.glow+', inset 0 0 20px '+theme.glow,background:'transparent',zIndex:101,pointerEvents:'none',animation:'tutPulse 1.5s ease-in-out infinite'}}/>}
    <div style={{position:'fixed',bottom:70,left:'50%',transform:'translateX(-50%)',width:'calc(100% - 40px)',maxWidth:420,zIndex:102}}>
      <Card glow={theme.glow} style={{padding:18,background:'rgba(12,12,20,0.97)',border:'1px solid '+theme.primary+'30'}}>
        <div style={{fontSize:15,fontWeight:700,color:theme.primary,marginBottom:6}}>{s.title}</div>
        <div style={{fontSize:13,lineHeight:1.7,color:'rgba(255,255,255,0.6)',marginBottom:8}}>{s.body}</div>
        {s.gesture==='swipe'&&<div style={{display:'flex',justifyContent:'center',gap:20,padding:'10px 0',marginBottom:6}}>
          <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:10,background:'rgba(217,68,82,0.08)',border:'1px solid rgba(217,68,82,0.15)'}}>
            <span style={{fontSize:14}}>👈</span><span style={{fontSize:11,color:'#ff6b7a',fontWeight:600}}>Excluir</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:10,background:'rgba(46,229,157,0.08)',border:'1px solid rgba(46,229,157,0.15)'}}>
            <span style={{fontSize:11,color:'#2ee59d',fontWeight:600}}>Carrinho</span><span style={{fontSize:14}}>👉</span>
          </div>
        </div>}
        {s.tip&&<div style={{display:'flex',alignItems:'center',gap:6,padding:'7px 10px',borderRadius:10,background:theme.primary+'0a',border:'1px solid '+theme.primary+'15',marginBottom:10}}>
          <HelpCircle size={13} style={{color:theme.primary,flexShrink:0}}/>
          <span style={{fontSize:11,color:theme.primary,fontWeight:600}}>{s.tip}</span>
        </div>}
        <div style={{display:'flex',gap:5,justifyContent:'center',marginBottom:12}}>{steps.map((_,i)=><div key={i} style={{width:i===step?18:6,height:5,borderRadius:3,background:i===step?theme.primary:'rgba(255,255,255,0.08)',transition:'all .3s'}}/>)}</div>
        <div style={{display:'flex',gap:8}}>
          {!isFirstTime&&<Btn variant="ghost" onClick={onSkip} style={{width:'100%',fontSize:11,whiteSpace:'nowrap',justifyContent:'center'}} sfx="nav">Pular</Btn>}
          {s.interactive?<div style={{flex:2,textAlign:'center',fontSize:11,color:'rgba(255,255,255,0.35)',fontStyle:'italic',padding:'10px 0'}}>Toque no + para continuar</div>:isLast?<Btn onClick={onNext} style={{flex:2,fontSize:13}} sfx="confirm"><BookOpen size={15}/> Ver cartas!</Btn>:
          <Btn onClick={onNext} style={{flex:isFirstTime?1:2,fontSize:13}} sfx="click">Entendi <ArrowRight size={14}/></Btn>}
        </div>
      </Card>
    </div>
  </div>);
}

const TUTORIAL_STEPS=[
  {title:'Catálogo',body:'Aqui ficam todas as cartas. Busque pelo nome e filtre por tipo.',navTo:'catalog',tabIndex:1,spotlightId:null,icon:'📖'},
  {title:'Busca e filtros',body:'Use a barra de busca, selecione o TCG e filtre por tipo de carta.',navTo:'catalog',tabIndex:1,spotlightId:'tut-search-area',scrollTo:true,icon:'🔍'},
  {title:'Adicionar à lista',body:'Toque no + de qualquer carta para adicioná-la à sua lista de wants.',navTo:'catalog',tabIndex:1,spotlightId:null,icon:'➕',interactive:true},
  {title:'Lista de Wants',body:'Suas cartas escolhidas ficam aqui. Toque no 🛒 para mover a carta pro carrinho, ou na 🗑️ para excluir.',navTo:'wants',tabIndex:2,spotlightId:null,icon:'📋'},
  {title:'Bônus',body:'Se o grupo crescer e o preço cair, você ganha cartas extras de graça! Elas aparecem aqui quando disponíveis.',navTo:'wants',tabIndex:2,spotlightId:null,icon:'🎁'},
  {title:'Carrinho',body:'Edite quantidades, mova cartas de volta para wants e avance para o checkout.',navTo:'cart',tabIndex:3,spotlightId:null,icon:'🛒'},
  {title:'Checkout',body:'Revise o pedido, preencha o endereço e calcule o frete antes de finalizar.',navTo:'checkout',tabIndex:3,spotlightId:'tut-checkout-summary',icon:'📦'},
  {title:'Pagamento',body:'Pague com segurança via Mercado Pago — cartão, boleto ou saldo.',navTo:'checkout',tabIndex:3,spotlightId:'tut-payment',icon:'💳'},
  {title:'Perfil',body:'Veja seus pedidos, altere endereço, mude a senha e reabra este tutorial quando quiser.',navTo:'profile',tabIndex:4,spotlightId:null,icon:'👤'},
];

// ══════════════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════════════

function HomePage({pool,minCards,pricing,closeDate,theme,nav,wantsCount,cartCount,bonusAvail,campaign_status}){
  const goalCards=minCards||150;
  const isViable=pool>=goalCards;
  const progress=Math.min(100,goalCards>0?Math.round((pool/goalCards)*100):0);
  const missingForMeta=Math.max(0,goalCards-pool);
  const now=new Date();
  const closeD=closeDate?new Date(closeDate):null;
  const daysLeft=closeD?Math.max(0,Math.ceil((closeD-now)/864e5)):null;
  const closeDateText=closeD?closeD.toLocaleDateString('pt-BR'):'';
  const datePassed=closeD?closeD<now:false;
  const normalPrice=Number(pricing?.normal_price_brl)||16;
  const outerPrice=Number(pricing?.ouro_price_brl)||16;
  const foilPrice=Number(pricing?.foil_price_brl)||18;
  return(<div style={{display:'flex',flexDirection:'column',gap:14}}>
    <div style={{textAlign:'center',padding:'6px 0 0'}}>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.28)',letterSpacing:2.5,textTransform:'uppercase',fontFamily:"'Cinzel',serif"}}>Encomenda em Grupo</div>
      <h1 style={{margin:'5px 0 0',fontSize:26,fontFamily:"'Cinzel',serif",background:'linear-gradient(135deg,'+theme.primary+','+theme.secondary+')',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Cartas para Jogar</h1>
    </div>

    {/* Status da campanha se não estiver ativa */}
    {campaign_status&&campaign_status!=='ACTIVE'&&<Card style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:8,background:'rgba(217,68,82,0.06)',borderColor:'rgba(217,68,82,0.15)'}}>
      <AlertTriangle size={16} style={{color:'#d94452'}}/><div><div style={{fontSize:13,fontWeight:700,color:'#ff6b7a'}}>{campaignLabel(campaign_status)}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.3)'}}>Novos pedidos disponíveis apenas quando a encomenda estiver ativa.</div></div>
    </Card>}

    {/* Progresso da meta mínima */}
    <Card style={{padding:18,borderColor:isViable?'rgba(46,229,157,0.2)':undefined,background:isViable?'rgba(46,229,157,0.04)':undefined}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
        <div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',textTransform:'uppercase',letterSpacing:1,marginBottom:3,fontWeight:600}}>Progresso da encomenda</div>
          <div style={{fontSize:22,fontWeight:800,color:isViable?'#2ee59d':theme.primary}}>{pool} <span style={{fontSize:14,color:'rgba(255,255,255,0.3)',fontWeight:400}}>/ {goalCards} cartas</span></div>
        </div>
        {isViable?<div style={{display:'flex',alignItems:'center',gap:5,padding:'5px 10px',borderRadius:99,background:'rgba(46,229,157,0.12)',border:'1px solid rgba(46,229,157,0.25)'}}><Check size={12} style={{color:'#2ee59d'}}/><span style={{fontSize:11,fontWeight:700,color:'#2ee59d'}}>Meta atingida</span></div>:<div style={{display:'flex',alignItems:'center',gap:5,padding:'5px 10px',borderRadius:99,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)'}}><span style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.4)'}}>Meta: {goalCards} cartas</span></div>}
      </div>
      <div style={{background:'rgba(0,0,0,0.35)',borderRadius:99,height:8,overflow:'hidden',marginBottom:10}}>
        <div style={{width:progress+'%',height:'100%',borderRadius:99,background:isViable?'linear-gradient(90deg,#2ee59d,#00d4a0)':'linear-gradient(90deg,'+theme.primary+','+theme.secondary+')',transition:'width .5s',boxShadow:'0 0 10px '+(isViable?'rgba(46,229,157,0.3)':theme.glow)}}/>
      </div>
      <div style={{fontSize:12,color:'rgba(255,255,255,0.35)',lineHeight:1.5}}>
        {isViable
          ?<>✅ Encomenda confirmada! Continuaremos recebendo pedidos até a data prevista de fechamento.</>
          :<>⏳ Faltam <b style={{color:theme.primary}}>{missingForMeta} carta{missingForMeta!==1?'s':''}</b> para a encomenda ser confirmada. A encomenda permanece aberta até atingir a meta mínima.</>
        }
      </div>
    </Card>

    {/* Data prevista de fechamento */}
    {closeD&&<Card style={{padding:'12px 16px',display:'flex',alignItems:'flex-start',gap:10}}>
      <Calendar size={16} style={{color:theme.primary,flexShrink:0,marginTop:1}}/>
      <div>
        <div style={{fontSize:13,fontWeight:700,marginBottom:2}}>
          {datePassed?'Data prevista já passou':'Data prevista de fechamento: '+closeDateText}
          {!datePassed&&daysLeft!==null&&<span style={{fontSize:11,fontWeight:400,color:'rgba(255,255,255,0.3)',marginLeft:6}}>({daysLeft} dia{daysLeft!==1?'s':''})</span>}
        </div>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',lineHeight:1.5}}>
          {isViable
            ?datePassed?'A meta mínima foi atingida. O admin pode fechar a encomenda a qualquer momento.':'Quando a data chegar e a meta estiver atingida, o admin encerrará a encomenda.'
            :'Se a data chegar antes de atingirmos a meta, a encomenda continuará aberta até as '+goalCards+' cartas serem alcançadas.'
          }
        </div>
      </div>
    </Card>}

    {/* Resumo stats */}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
      {[{icon:ScrollText,val:wantsCount,lbl:'Wants',c:theme.primary},{icon:ShoppingCart,val:cartCount,lbl:'Carrinho',c:'#c9a96e'},{icon:Gift,val:bonusAvail,lbl:'Bônus',c:'#2ee59d'}].map(s=>(<Card key={s.lbl} style={{textAlign:'center',padding:12}}><s.icon size={16} style={{color:s.c,marginBottom:3}}/><div style={{fontSize:18,fontWeight:800}}>{s.val}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{s.lbl}</div></Card>))}
    </div>

    {/* Bônus disponíveis */}
    {bonusAvail>0&&<Card style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:10,background:'rgba(46,229,157,0.06)',borderColor:'rgba(46,229,157,0.18)'}}>
      <Gift size={18} style={{color:'#2ee59d',flexShrink:0}}/><div><div style={{fontSize:13,fontWeight:700,color:'#2ee59d'}}>Você tem {bonusAvail} carta{bonusAvail!==1?'s':''} bônus! 🎉</div><div style={{fontSize:11,color:'rgba(255,255,255,0.35)'}}>Serão incluídas automaticamente no seu próximo checkout.</div></div>
    </Card>}

    {/* Tabela de preços por tipo */}
    <Card style={{padding:16}}>
      <SectionTitle sub="Preços fixos por tipo de carta">Preços</SectionTitle>
      {[{label:'Carta Normal',price:normalPrice,color:'rgba(255,255,255,0.6)',desc:'Cartas comuns e não-foil'},{label:'Carta Holo',price:outerPrice,color:'#c9a96e',desc:'Cartas Holo / especiais'},{label:'Carta Foil',price:foilPrice,color:'#d94452',desc:'Cartas foil de qualquer tipo'}].map(t=>(
        <div key={t.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 12px',borderRadius:10,marginBottom:3,background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.05)'}}>
          <div><div style={{fontSize:13,fontWeight:600,color:t.color}}>{t.label}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>{t.desc}</div></div>
          <span style={{fontSize:16,fontWeight:800,color:t.color}}>R$ {t.price.toFixed(2)}</span>
        </div>
      ))}
      <div style={{fontSize:11,color:'rgba(255,255,255,0.2)',marginTop:8,textAlign:'center'}}>Mínimo de 15 cartas pagas por pedido</div>
    </Card>

    <Btn full onClick={()=>{SFX.nav();nav('catalog');}} sfx="nav"><BookOpen size={18}/> Ver catálogo</Btn>
    {cartCount>0&&<Btn full variant="secondary" onClick={()=>nav('cart')} sfx="nav"><ShoppingCart size={18}/> Carrinho ({cartCount})</Btn>}
  </div>);
}

// ══════════════════════════════════════════════════════
// CATALOG — Supabase powered, server-side search/filter
// ══════════════════════════════════════════════════════

function CatalogPage({token,wants,onAddWant,priceBRL,theme,campaignStatus,tutStep,onTutNext}){
  const [search,setSearch]=useState('');const [typeF,setTypeF]=useState('Todos');const [tcgFilter,setTcgFilter]=useState('Magic');const [cards,setCards]=useState([]);const [total,setTotal]=useState(0);
  const [page,setPage]=useState(0);const [loading,setLoading]=useState(false);const [addQty,setAddQty]=useState({});
  const [flyAnim,setFlyAnim]=useState(false);const PAGE_SIZE=20;
  const currentTcg=TCG_LIST.find(t=>t.key===tcgFilter)||TCG_LIST[0];
  const firstAddBtnRef=useRef(null);const [handPos,setHandPos]=useState(null);
  useEffect(()=>{
    if(tutStep!==2){setHandPos(null);return;}
    const update=()=>{if(firstAddBtnRef.current){const r=firstAddBtnRef.current.getBoundingClientRect();setHandPos({top:r.top-26,left:r.left+r.width/2});}};
    update();const t=setInterval(update,300);return()=>clearInterval(t);
  },[tutStep,cards]);
  
  const campaignOpen = campaignCanOrder(campaignStatus);
  const campaignStatusText = campaignLabel(campaignStatus);

  const fetchCards = useCallback(async()=>{
    setLoading(true);
    try {
      let q = `select=id,name,type,image_url&is_active=eq.true&order=name&tcg=eq.${encodeURIComponent(tcgFilter)}`;
      if (search) q += `&name=ilike.*${encodeURIComponent(search)}*`;
      if (typeF !== 'Todos') q += `&type=eq.${encodeURIComponent(typeF)}`;
      q += `&limit=${PAGE_SIZE}&offset=${page*PAGE_SIZE}`;
      const data = await sbGet('cards', q, token);
      setCards(data);
      // Get count
      const countQ = `select=id&is_active=eq.true&tcg=eq.${encodeURIComponent(tcgFilter)}${search?'&name=ilike.*'+encodeURIComponent(search)+'*':''}${typeF!=='Todos'?'&type=eq.'+encodeURIComponent(typeF):''}`;
      const countData = await sbGet('cards', countQ, token);
      setTotal(countData.length);
    } catch(e) { console.error(e); }
    setLoading(false);
  },[search,typeF,tcgFilter,page,token]);

  useEffect(()=>{setPage(0);},[search,typeF,tcgFilter]);
  useEffect(()=>{const t=setTimeout(fetchCards,300);return()=>clearTimeout(t);},[fetchCards,page]);

  const getQ=id=>addQty[id]||1;const setQ=(id,v)=>setAddQty(q=>({...q,[id]:Math.max(1,v)}));
  function add(card,qty){SFX.addCard();setFlyAnim(true);onAddWant(card,qty);setQ(card.id,1);if(tutStep===2&&onTutNext)onTutNext();}

  return(<div style={{display:'flex',flexDirection:'column',gap:12}}>
    {!campaignOpen&&<Card style={{padding:14,borderColor:'rgba(201,169,110,0.25)',background:'rgba(201,169,110,0.08)'}}><div style={{fontSize:13,fontWeight:700,color:'#c9a96e'}}>Encomenda fechada no momento</div><div style={{fontSize:12,color:'rgba(255,255,255,0.55)',marginTop:4}}>{campaignStatusText}</div></Card>}
    <FlyingCard show={flyAnim} onDone={()=>setFlyAnim(false)}/>
    <div style={{display:'flex',gap:5,overflowX:'auto',WebkitOverflowScrolling:'touch',paddingBottom:2}}>
      {TCG_LIST.map(t=>(<button key={t.key} onClick={()=>{SFX.toggle();setTcgFilter(t.key);setTypeF('Todos');}} style={{padding:'7px 12px',borderRadius:10,border:'none',background:tcgFilter===t.key?t.color+'22':'rgba(255,255,255,0.04)',color:tcgFilter===t.key?t.color:'rgba(255,255,255,0.3)',fontWeight:700,fontSize:11,cursor:'pointer',fontFamily:"'Outfit',sans-serif",whiteSpace:'nowrap',flexShrink:0,boxShadow:tcgFilter===t.key?`0 0 0 1.5px ${t.color}60`:'none'}}>{t.key}</button>))}
    </div>
    <div id="tut-search-area" style={{display:'flex',flexDirection:'column',gap:8}}>
      <Input icon={Search} placeholder="Buscar carta..." value={search} onChange={e=>setSearch(e.target.value)}/>
      {currentTcg.types.length>0&&<div style={{display:'flex',gap:5}}>
        {currentTcg.types.map(t=>(<button key={t} onClick={()=>{SFX.toggle();setTypeF(t);}} style={{flex:1,padding:'7px 0',borderRadius:10,border:'none',background:typeF===t?currentTcg.color:'rgba(255,255,255,0.04)',color:typeF===t?'#fff':'rgba(255,255,255,0.3)',fontWeight:600,fontSize:11,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>{t}</button>))}
      </div>}
    </div>
    {loading?<div style={{textAlign:'center',padding:40}}><Spin size={28}/></div>:(
      <div style={{display:'flex',flexDirection:'column',gap:5}}>
        {cards.map((c,i)=>{
          const existsInWants=wants.find(w=>w.card_id===c.id);
          return(<Card key={c.id} style={{padding:'10px 12px'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</div>
                <div style={{display:'flex',gap:6,alignItems:'center',marginTop:2}}>
                  <span style={{fontSize:10,color:TC[c.type],fontWeight:700}}>{c.type}</span>
                  {existsInWants&&<Tag color="#2ee59d" style={{fontSize:9,padding:'1px 6px'}}>{existsInWants.quantity} na wants</Tag>}
                </div>
              </div>
              <button ref={i===0?firstAddBtnRef:null} id={i===0?'tut-add-btn':undefined} onClick={()=>add(c,1)} style={{background:existsInWants?'rgba(46,229,157,0.15)':'var(--gp)',border:'none',borderRadius:10,padding:'8px 14px',cursor:'pointer',color:existsInWants?'#2ee59d':'#fff',display:'flex',alignItems:'center',gap:4,fontSize:12,fontWeight:600,fontFamily:"'Outfit',sans-serif"}}><Plus size={14}/></button>
            </div>
          </Card>);
        })}
        {cards.length===0&&!loading&&<EmptyState icon={Search} title="Nenhuma carta encontrada" sub="Tente outro termo"/>}
      </div>
    )}
    {total>PAGE_SIZE&&<div style={{display:'flex',justifyContent:'center',gap:8,padding:'8px 0'}}>
      <Btn variant="secondary" disabled={page===0} onClick={()=>setPage(p=>p-1)} style={{padding:'8px 14px',fontSize:12}} sfx="nav"><ChevronLeft size={14}/></Btn>
      <Tag>{page+1}/{Math.ceil(total/PAGE_SIZE)}</Tag>
      <Btn variant="secondary" disabled={(page+1)*PAGE_SIZE>=total} onClick={()=>setPage(p=>p+1)} style={{padding:'8px 14px',fontSize:12}} sfx="nav"><ChevronRight size={14}/></Btn>
    </div>}
    {tutStep===2&&handPos&&<div style={{position:'fixed',top:handPos.top,left:handPos.left,zIndex:200,pointerEvents:'none',fontSize:22,animation:'tutHandBounce 0.8s ease-in-out infinite',transform:'translateX(-50%)'}}>👆</div>}
  </div>);
}

// ══════════════════════════════════════════════════════
// WANTS — reads order_items, cart is local toggle
// ══════════════════════════════════════════════════════

function WantsPage({wants,onMoveToCart,onMoveAllToCart,onRemoveWant,onUpdateWantQty,cartCount,bonusAvail,theme}){
  const [searchW,setSearchW]=useState('');
  const bonus=bonusAvail||0;
  const wantsUnits=wants.reduce((s,w)=>s+w.quantity,0);
  const fW=searchW?wants.filter(w=>w.card_name.toLowerCase().includes(searchW.toLowerCase())):wants;

  return(<div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div id="tut-wants-tags" style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
      <Tag color={theme.primary}><ScrollText size={11}/> {wantsUnits} na wants</Tag>
      <Tag color="#c9a96e"><ShoppingCart size={11}/> {cartCount} no carrinho</Tag>
      {bonus>0&&<Tag color="#2ee59d"><Gift size={11}/> {bonus} bônus</Tag>}
      {wants.length>0&&<button onClick={onMoveAllToCart} style={{background:theme.primary+'15',border:'1px solid '+theme.primary+'30',borderRadius:99,padding:'4px 10px',color:theme.primary,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:"'Outfit',sans-serif",display:'flex',alignItems:'center',gap:4}}><CheckCircle size={11}/> Tudo pro carrinho</button>}
    </div>
    {bonus>0&&<Card id="tut-bonus-card" glow="rgba(46,229,157,0.12)" style={{padding:12,background:'rgba(46,229,157,0.03)'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}><Gift size={16} style={{color:'#2ee59d'}}/><div style={{fontSize:13}}><span style={{fontWeight:700,color:'#2ee59d'}}>{bonus} carta(s) bônus</span><div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:2}}>Primeiras do carrinho saem grátis!</div></div></div>
    </Card>}
    {wants.length>0&&<>
      {wants.length>3&&<Input icon={Search} placeholder="Buscar..." value={searchW} onChange={e=>setSearchW(e.target.value)}/>}
      <div style={{display:'flex',flexDirection:'column',gap:5}}>
        {fW.map((w)=>(
          <Card key={w.id} style={{padding:'10px 12px'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{w.card_name}</div>
                <div style={{display:'flex',gap:6,alignItems:'center',marginTop:1}}>
                  <span style={{fontSize:10,color:TC[w.card_type],fontWeight:700}}>{w.card_type}</span>
                  <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{w.quantity}x</span>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',background:'rgba(0,0,0,0.3)',borderRadius:10,border:'1px solid rgba(255,255,255,0.05)'}}>
                <button onClick={()=>onUpdateWantQty(w.id,w.quantity-1)} style={{background:'none',border:'none',color:'#fff',padding:'6px 9px',cursor:'pointer'}}><Minus size={12}/></button>
                <span style={{minWidth:20,textAlign:'center',fontSize:13,fontWeight:700}}>{w.quantity}</span>
                <button onClick={()=>onUpdateWantQty(w.id,w.quantity+1)} style={{background:'none',border:'none',color:'#fff',padding:'6px 9px',cursor:'pointer'}}><Plus size={12}/></button>
              </div>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <button onClick={()=>onMoveToCart(w)} style={{background:theme.primary+'18',border:'1px solid '+theme.primary+'30',borderRadius:10,padding:'8px 10px',cursor:'pointer',color:theme.primary,display:'flex',alignItems:'center'}}><ShoppingCart size={14}/></button>
                <button onClick={()=>onRemoveWant(w.id)} style={{background:'rgba(217,68,82,0.08)',border:'1px solid rgba(217,68,82,0.15)',borderRadius:10,padding:'8px 10px',cursor:'pointer',color:'#ff6b7a',display:'flex',alignItems:'center'}}><Trash2 size={14}/></button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>}
    {wants.length===0&&<EmptyState icon={ScrollText} title="Wants vazia" sub="Adicione cartas pelo catálogo"/>}
  </div>);
}

const MIN_ORDER_CARDS = 15;

function CartPage({cartItems,pricing,bonusAvail,campaignStatus,theme,nav,onMoveToWants,onRemoveFromCart,onUpdateCartQty,token,orderId,campaignId,onOrderDone,toast,profile,previousPaidBatches}){
  const bonus=bonusAvail||0;
  let bL=bonus;
  const bd=cartItems.map(c=>{const bq=Math.min(c.quantity,bL);bL-=bq;return{...c,bonusQty:bq,paidQty:c.quantity-bq};});
  const totalBonus=bd.reduce((s,c)=>s+c.bonusQty,0);
  const totalPaid=bd.reduce((s,c)=>s+c.paidQty,0);
  const totalQty=cartItems.reduce((s,c)=>s+c.quantity,0);
  const totalBRL=bd.reduce((s,c)=>s+c.paidQty*getCardPrice(c.card_type,pricing),0);
  const campaignOpen=campaignCanOrder(campaignStatus);
  const isFullBonus=totalPaid===0&&totalBonus>0;
  const previousPaidCards=(previousPaidBatches||[]).reduce((s,b)=>s+(b.qty_in_batch||0),0);
  const hasMetMinimumBefore=previousPaidCards>=MIN_ORDER_CARDS;
  const canCheckout=isFullBonus||totalPaid>=MIN_ORDER_CARDS||hasMetMinimumBefore;
  const missingCards=hasMetMinimumBefore?0:Math.max(0,MIN_ORDER_CARDS-totalPaid);

  return(<div style={{display:'flex',flexDirection:'column',gap:12}}>
    {!campaignOpen&&<Card style={{padding:12,borderColor:'rgba(201,169,110,0.25)',background:'rgba(201,169,110,0.06)'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}><AlertTriangle size={14} style={{color:'#c9a96e'}}/><div style={{fontSize:12,color:'#c9a96e',fontWeight:600}}>{campaignStatus?campaignLabel(campaignStatus):'Nenhuma encomenda ativa'}<div style={{fontSize:11,color:'rgba(255,255,255,0.35)',fontWeight:400,marginTop:2}}>Continue montando seu carrinho. O checkout estará disponível quando a encomenda abrir.</div></div></div>
    </Card>}
    {cartItems.length>0&&<>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{totalQty} carta{totalQty!==1?'s':''}</span>
        <span style={{fontSize:14,fontWeight:800,color:theme.primary}}>≈ R$ {totalBRL.toFixed(2)}{totalBonus>0&&<span style={{fontSize:11,color:'#2ee59d',fontWeight:600,marginLeft:6}}>({totalBonus} bônus)</span>}</span>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:5}}>
        {bd.map((c)=>{const itemPrice=getCardPrice(c.card_type,pricing);return(
          <Card key={c.id} style={{padding:'10px 12px'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.card_name}</div>
                <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginTop:1}}>
                  <span style={{fontSize:10,color:TC[c.card_type],fontWeight:700}}>{c.card_type}</span>
                  {c.bonusQty>0&&<Tag color="#2ee59d" style={{fontSize:9,padding:'1px 5px'}}>🎁 {c.bonusQty} grátis</Tag>}
                  {c.paidQty>0&&<span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>R$ {(c.paidQty*itemPrice).toFixed(2)}</span>}
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',background:'rgba(0,0,0,0.3)',borderRadius:10,border:'1px solid rgba(255,255,255,0.05)'}}>
                <button onClick={()=>onUpdateCartQty(c.id,c.quantity-1)} style={{background:'none',border:'none',color:'#fff',padding:'6px 9px',cursor:'pointer'}}><Minus size={12}/></button>
                <span style={{minWidth:20,textAlign:'center',fontSize:13,fontWeight:700}}>{c.quantity}</span>
                <button onClick={()=>onUpdateCartQty(c.id,c.quantity+1)} style={{background:'none',border:'none',color:'#fff',padding:'6px 9px',cursor:'pointer'}}><Plus size={12}/></button>
              </div>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>onMoveToWants(c)} title="Voltar para wants" style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:10,padding:'8px 10px',cursor:'pointer',color:'rgba(255,255,255,0.5)',display:'flex',alignItems:'center'}}><ArrowLeft size={14}/></button>
                <button onClick={()=>onRemoveFromCart(c.id)} style={{background:'rgba(217,68,82,0.08)',border:'1px solid rgba(217,68,82,0.15)',borderRadius:10,padding:'8px 10px',cursor:'pointer',color:'#ff6b7a',display:'flex',alignItems:'center'}}><Trash2 size={14}/></button>
              </div>
            </div>
          </Card>
        );})}
      </div>
      {/* Aviso de mínimo de cartas */}
      {campaignOpen&&!canCheckout&&!isFullBonus&&<Card style={{padding:'10px 14px',borderColor:'rgba(201,169,110,0.3)',background:'rgba(201,169,110,0.06)'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}><AlertTriangle size={14} style={{color:'#c9a96e',flexShrink:0}}/><div style={{fontSize:12,color:'#c9a96e',fontWeight:600}}>Mínimo de {MIN_ORDER_CARDS} cartas pagas por pedido<div style={{fontSize:11,fontWeight:400,color:'rgba(255,255,255,0.35)',marginTop:2}}>Adicione mais {missingCards} carta{missingCards!==1?'s':''} ao carrinho para continuar.</div></div></div>
      </Card>}
      {campaignOpen&&<Btn full onClick={()=>nav('checkout')} disabled={!canCheckout} sfx="nav" style={{marginTop:4}}><CreditCard size={15}/> {canCheckout?'Ir para checkout':'Mínimo: '+MIN_ORDER_CARDS+' cartas (faltam '+missingCards+')'}</Btn>}
    </>}
    {cartItems.length===0&&<><EmptyState icon={ShoppingCart} title="Carrinho vazio" sub="Mova cartas da sua lista de wants"/><div style={{textAlign:'center',marginTop:8}}><Btn variant="secondary" onClick={()=>nav('wants')} sfx="nav"><ScrollText size={15}/> Ir para Wants</Btn></div></>}
    {cartItems.length>0&&<Btn full variant="ghost" onClick={()=>nav('wants')} sfx="nav" style={{marginTop:4}}><ArrowLeft size={14}/> Voltar para Wants</Btn>}
  </div>);
}
function CheckoutPage({cartItems=[],wants,cartQtyByItem,pricing,bonusAvail,theme,nav,profile,token,orderId,campaignId,campaignStatus,onOrderDone,toast,previousPaidBatches=[],onMoveToWants,onRemoveFromCart,onUpdateCartQty}){
  const [freteOptions,setFreteOptions]=useState([]);const [selectedFrete,setSelectedFrete]=useState(null);
  const [lF,setLF]=useState(false);const [submitting,setSubmitting]=useState(false);
  const [step,setStep]=useState('review');
  const [saveAddressChoice,setSaveAddressChoice]=useState(null);
  // Frete conjunto: true = enviar junto com pedidos anteriores desta encomenda (sem novo frete)
  const [useJointShipping,setUseJointShipping]=useState(false);
  const hasPreviousOrders=previousPaidBatches.length>0;
  const [addr,setAddr]=useState({cep:profile?.cep||'',rua:profile?.rua||'',numero:profile?.numero||'',complemento:profile?.complemento||'',bairro:profile?.bairro||'',cidade:profile?.cidade||'',uf:profile?.uf||''});
  const profileHasSavedAddress=Boolean(profile?.cep&&(profile.cep||'').replace(/\D/g,'').length===8&&profile?.rua);
  const [editingAddr,setEditingAddr]=useState(!profileHasSavedAddress);
  const cart=cartItems.length>0?cartItems:wants.map(w=>{const q=Math.min(w.quantity,Math.max(0,cartQtyByItem[w.id]||0));return q>0?{...w,quantity:q,fullQty:w.quantity}:null;}).filter(Boolean);
  const bonus=bonusAvail||0;
  let bL=bonus;
  const bd=cart.map(c=>{const bq=Math.min(c.quantity,bL);bL-=bq;return{...c,bonusQty:bq,paidQty:c.quantity-bq};});
  const totalQty=cart.reduce((s,c)=>s+c.quantity,0);
  const totalBonus=bd.reduce((s,c)=>s+c.bonusQty,0);const totalPaid=bd.reduce((s,c)=>s+c.paidQty,0);
  const campaignOpen = campaignCanOrder(campaignStatus);
  const campaignStatusText = campaignLabel(campaignStatus);
  const isFullBonus=totalPaid===0&&totalBonus>0;
  const previousPaidCards=(previousPaidBatches||[]).reduce((s,b)=>s+(b.qty_in_batch||0),0);
  const hasMetMinimumBefore=previousPaidCards>=MIN_ORDER_CARDS;
  const canCheckout=isFullBonus||totalPaid>=MIN_ORDER_CARDS||hasMetMinimumBefore;
  const missingCards=hasMetMinimumBefore?0:Math.max(0,MIN_ORDER_CARDS-totalPaid);
  // Subtotal com preço por tipo de carta
  const sub=bd.reduce((s,c)=>s+c.paidQty*getCardPrice(c.card_type,pricing),0);
  const fV=selectedFrete?selectedFrete.price:0;const total=sub+fV;
  const cepClean=(addr.cep||'').replace(/\D/g,'');
  const addressUnchanged=addr.cep===(profile?.cep||'')&&addr.rua===(profile?.rua||'')&&addr.numero===(profile?.numero||'')&&addr.complemento===(profile?.complemento||'')&&addr.bairro===(profile?.bairro||'')&&addr.cidade===(profile?.cidade||'')&&addr.uf===(profile?.uf||'');

  useEffect(()=>{if(useJointShipping){setSelectedFrete({carrier:'Envio conjunto',price:0,deadline_days:0});setFreteOptions([]);}else{setSelectedFrete(null);setFreteOptions([]);}},[useJointShipping]);
  useEffect(()=>{if(step==='address'&&profileHasSavedAddress&&!editingAddr&&cepClean.length===8&&freteOptions.length===0&&!lF&&!useJointShipping)calcFrete();},[step]);

  async function calcFrete(){
    if(useJointShipping) return; // frete conjunto não precisa calcular
    if(cepClean.length<8){toast('CEP inválido','error');return;}
    setLF(true);setFreteOptions([]);setSelectedFrete(null);
    try{
      const r=await fetch(`/api/frete`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({cepDestino:cepClean,quantidade:totalQty})
      });
      const text=await r.text();
      let d;
      try{d=JSON.parse(text);}catch(pe){toast('Frete retornou resposta inválida','error');setLF(false);return;}
      if(d.error){toast('Erro frete: '+d.error,'error');}
      else if(d.opcoes&&d.opcoes.length>0){
        const opts=d.opcoes.map(o=>({carrier:o.nome,price:o.preco,deadline_days:o.prazo}));
        setFreteOptions(opts);setSelectedFrete(opts[0]);SFX.success();
      } else {
        toast('O MandaBem não retornou opções para este CEP. Tente outro ou entre em contato.','error');
      }
    }catch(e){console.warn('frete',e);toast('Erro ao conectar com frete','error');}
    setLF(false);
  }

  async function finalize(){
    if(!campaignOpen){toast('Encomenda fechada no momento','error');return;}
    if(!canCheckout){toast(`Mínimo de ${MIN_ORDER_CARDS} cartas pagas por pedido. Adicione mais ${missingCards} carta${missingCards!==1?'s':''}.`,'error');return;}
    if(!isFullBonus&&!selectedFrete){toast('Selecione uma opção de frete para continuar','error');return;}
    setSubmitting(true);
    try {
      const batchData = {order_id:orderId,status:'DRAFT',brl_unit_price_locked:null,qty_in_batch:totalQty,subtotal_locked:sub,shipping_locked:fV,total_locked:isFullBonus?0:total,payment_method:isFullBonus?'BONUS':'MERCADO_PAGO'};
      const [batch] = await sbPost('order_batches', batchData, token);
      await sbPatch('orders','id=eq.'+(orderId),{qty_paid:totalPaid,qty_bonus:totalBonus,shipping_price_brl_locked:fV},token);
      for (const item of bd) {
        const itemPrice = getCardPrice(item.card_type, pricing);
        const fullQty = Number(item.fullQty || item.quantity);
        if (item.quantity >= fullQty) {
          if (item.bonusQty > 0 && item.paidQty > 0) {
            await sbPatch('order_items','id=eq.'+item.id,{quantity:item.bonusQty,batch_id:batch.id,is_bonus:true,unit_price_brl:0},token);
            await sbPost('order_items',{order_id:orderId,card_id:item.card_id,quantity:item.paidQty,is_bonus:false,unit_price_brl:itemPrice,batch_id:batch.id},token);
          } else if (item.bonusQty > 0) {
            await sbPatch('order_items','id=eq.'+item.id,{batch_id:batch.id,is_bonus:true,unit_price_brl:0},token);
          } else {
            await sbPatch('order_items','id=eq.'+item.id,{batch_id:batch.id,unit_price_brl:itemPrice},token);
          }
        } else {
          await sbPatch('order_items','id=eq.'+item.id,{quantity:fullQty-item.quantity},token);
          if (item.bonusQty > 0) await sbPost('order_items',{order_id:orderId,card_id:item.card_id,quantity:item.bonusQty,is_bonus:true,unit_price_brl:0,batch_id:batch.id},token);
          if (item.paidQty > 0) await sbPost('order_items',{order_id:orderId,card_id:item.card_id,quantity:item.paidQty,is_bonus:false,unit_price_brl:itemPrice,batch_id:batch.id},token);
        }
      }

      if(saveAddressChoice===true&&addr.rua)await sbPatch('profiles','id=eq.'+(profile.id),{cep:addr.cep,rua:addr.rua,numero:addr.numero,complemento:addr.complemento,bairro:addr.bairro,cidade:addr.cidade,uf:addr.uf},token);

      const shortId=String(batch.id).slice(0,8).toUpperCase();
      SFX.confirm();
      onOrderDone({method:isFullBonus?'bonus':'mp',totalPaid,totalBonus,pricing,isFullBonus,batchId:batch.id,shortId,cards:cart.map(c=>({name:c.card_name,type:c.card_type,qty:c.quantity}))});

      if(!isFullBonus){
        toast('Gerando link de pagamento...','info');
        const mpRes=await fetch(`/api/mp-create`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:String(batch.id),total:Number(total.toFixed(2)),descricao:`Pedido #${shortId} - ${totalPaid} cartas`})});
        const mpData=await mpRes.json();
        const mpLink=mpData?.mpLink||mpData?.init_point||mpData?.sandbox_init_point; if(mpLink){window.location.href=mpLink;return;}
        else if(mpData.error){console.error('MP:',mpData.error);toast('Erro MP: '+mpData.error,'error');}
        nav('success');
      } else {
        try{const cbRes=await fetch('/api/confirm-bonus-batch',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({batchId:batch.id})});if(!cbRes.ok)console.warn('confirm-bonus-batch status:',cbRes.status);}catch(e){console.warn('confirm-bonus-batch:',e);}
        nav('success');
      }
    }catch(e){console.error(e);toast('Erro ao finalizar: '+e.message,'error');}
    setSubmitting(false);
  }

  if(!campaignOpen)return(<div style={{paddingTop:40}}>
    <Card style={{padding:20,textAlign:'center',borderColor:'rgba(201,169,110,0.25)',background:'rgba(201,169,110,0.08)'}}>
      <AlertTriangle size={32} style={{color:'#c9a96e',marginBottom:8}}/>
      <div style={{fontWeight:700,fontSize:16,color:'#c9a96e',marginBottom:6}}>Encomenda fechada</div>
      <div style={{fontSize:13,color:'rgba(255,255,255,0.4)'}}>{campaignStatusText}</div>
      <div style={{fontSize:12,color:'rgba(255,255,255,0.3)',marginTop:8}}>Você pode navegar o catálogo e adicionar cartas à lista de wants. O carrinho será liberado quando a encomenda estiver ativa.</div>
    </Card>
    <div style={{textAlign:'center',marginTop:16}}><Btn onClick={()=>nav('catalog')} sfx="nav"><BookOpen size={16}/> Ver catálogo</Btn></div>
  </div>);
  if(totalQty===0)return(<div style={{paddingTop:40}}><EmptyState icon={ShoppingCart} title="Carrinho vazio" sub="Selecione cartas nos wants"/><div style={{display:'flex',flexDirection:'column',gap:8,alignItems:'center',marginTop:16}}><Btn onClick={()=>nav('wants')} sfx="nav"><ScrollText size={14}/> Ir para Wants</Btn></div></div>);

  // Bloquear checkout se mínimo não atingido
  if(!canCheckout&&!isFullBonus)return(<div style={{paddingTop:20}}>
    <Card style={{padding:20,textAlign:'center',borderColor:'rgba(201,169,110,0.3)',background:'rgba(201,169,110,0.06)'}}>
      <AlertTriangle size={32} style={{color:'#c9a96e',marginBottom:8}}/>
      <div style={{fontWeight:700,fontSize:16,color:'#c9a96e',marginBottom:6}}>Mínimo não atingido</div>
      <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',lineHeight:1.5}}>Cada pedido precisa ter pelo menos <b style={{color:'#c9a96e'}}>{MIN_ORDER_CARDS} cartas pagas</b>.<br/>Seu carrinho tem {totalPaid} carta{totalPaid!==1?'s':''} paga{totalPaid!==1?'s':''}. Adicione mais <b style={{color:'#c9a96e'}}>{missingCards}</b>.</div>
      {totalBonus>0&&<div style={{fontSize:12,color:'rgba(255,255,255,0.3)',marginTop:6}}>Cartas bônus não contam para o mínimo.</div>}
    </Card>
    <div style={{textAlign:'center',marginTop:16}}><Btn onClick={()=>nav('cart')} sfx="nav"><ShoppingCart size={16}/> Voltar ao carrinho</Btn></div>
  </div>);

  return(<div style={{display:'flex',flexDirection:'column',gap:14}}>
    <Card id="tut-checkout-summary" style={{padding:18}}>
      <SectionTitle sub={totalQty+' cartas ('+totalBonus+' bônus + '+totalPaid+' pagas)'}>Resumo do pedido</SectionTitle>
      {totalBonus>0&&<><div style={{fontSize:11,fontWeight:700,color:'#2ee59d',marginBottom:6,display:'flex',alignItems:'center',gap:5}}><Gift size={12}/> Bônus (grátis)</div>
        {bd.filter(c=>c.bonusQty>0).map((c,i)=>(<div key={'b'+i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',fontSize:13,borderBottom:'1px solid rgba(46,229,157,0.08)'}}><span style={{color:'rgba(255,255,255,0.6)'}}>{c.card_name} <span style={{color:TC[c.card_type],fontSize:10,fontWeight:700}}>{c.card_type}</span> x{c.bonusQty}</span><span style={{fontWeight:700,color:'#2ee59d'}}>R$ 0,00</span></div>))}</>}
      {totalPaid>0&&<><div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',marginTop:totalBonus>0?12:0,marginBottom:6,display:'flex',alignItems:'center',gap:5}}><CreditCard size={12}/> Pagas</div>
        {bd.filter(c=>c.paidQty>0).map((c,i)=>{const ip=getCardPrice(c.card_type,pricing);return(<div key={'p'+i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',fontSize:13,borderBottom:'1px solid rgba(255,255,255,0.03)'}}><span style={{color:'rgba(255,255,255,0.6)'}}>{c.card_name} <span style={{color:TC[c.card_type],fontSize:10,fontWeight:700}}>{c.card_type}</span> x{c.paidQty}</span><span style={{fontWeight:700}}>R$ {(c.paidQty*ip).toFixed(2)}</span></div>);})}</>}
      <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:5}}>
        {totalPaid>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'rgba(255,255,255,0.4)'}}><span>Subtotal</span><span style={{color:'#fff',fontWeight:600}}>R$ {sub.toFixed(2)}</span></div>}
        {!isFullBonus&&<div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'rgba(255,255,255,0.4)'}}><span>Frete</span><span style={{color:'#fff',fontWeight:600}}>{useJointShipping?'Envio conjunto (R$ 0,00)':selectedFrete?'R$ '+fV.toFixed(2):lF?'Calculando...':'—'}</span></div>}
        <div style={{height:1,background:'rgba(255,255,255,0.06)',margin:'3px 0'}}/>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:18,fontWeight:800}}><span>Total</span><span style={{color:isFullBonus?'#2ee59d':theme.primary}}>{isFullBonus?'R$ 0,00 (bônus!)':'R$ '+total.toFixed(2)}</span></div>
      </div>
      {step==='review'&&<Btn full onClick={()=>setStep('address')} style={{marginTop:12}} sfx="nav"><ArrowRight size={16}/> Avançar para endereço e frete</Btn>}
    </Card>

    {!isFullBonus&&step==='address'&&<Card style={{padding:16}}>
      <SectionTitle>Endereço de entrega</SectionTitle>

      {/* Frete conjunto — aparece automaticamente se houver pedidos anteriores nesta encomenda */}
      {hasPreviousOrders&&<div style={{marginBottom:14,padding:'12px 14px',borderRadius:12,background:useJointShipping?'rgba(46,229,157,0.06)':'rgba(255,255,255,0.03)',border:'1px solid '+(useJointShipping?'rgba(46,229,157,0.2)':'rgba(255,255,255,0.08)')}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:useJointShipping?'#2ee59d':'#fff',marginBottom:2,display:'flex',alignItems:'center',gap:6}}><Truck size={14} style={{flexShrink:0}}/> Envio conjunto</div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',lineHeight:1.4}}>Você já tem pedidos nesta encomenda. Envie tudo junto sem custo de frete adicional.</div>
          </div>
          <button onClick={()=>{SFX.toggle();setUseJointShipping(v=>!v);}} style={{flexShrink:0,width:44,height:26,borderRadius:13,border:'none',background:useJointShipping?'#2ee59d':'rgba(255,255,255,0.1)',cursor:'pointer',position:'relative',transition:'background .2s'}}>
            <div style={{position:'absolute',top:3,left:useJointShipping?22:4,width:20,height:20,borderRadius:10,background:'#fff',transition:'left .2s',boxShadow:'0 1px 4px rgba(0,0,0,0.3)'}}/>
          </button>
        </div>
      </div>}

      {!useJointShipping&&(profileHasSavedAddress&&!editingAddr?<AddressDisplay address={addr} onEdit={()=>{setEditingAddr(true);setFreteOptions([]);setSelectedFrete(null);}}/>:<AddressForm address={addr} setAddress={(a)=>setAddr(a)}/>)}
      {!useJointShipping&&(editingAddr||!profileHasSavedAddress)&&<Btn full variant="secondary" onClick={calcFrete} disabled={cepClean.length<8||lF} style={{marginTop:10}} sfx="click">{lF?<Spin size={14}/>:<><Truck size={15}/> Calcular frete</>}</Btn>}
      {!useJointShipping&&profileHasSavedAddress&&!editingAddr&&lF&&<div style={{marginTop:10,textAlign:'center',color:'rgba(255,255,255,0.4)',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><Spin size={14}/> Calculando frete...</div>}
      {!useJointShipping&&freteOptions.length>0&&<div style={{marginTop:12}}>
        <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',marginBottom:8}}>Opções de envio</div>
        {freteOptions.map((opt,i)=>(<button key={i} onClick={()=>{SFX.toggle();setSelectedFrete(opt);}} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',borderRadius:12,border:'1px solid '+(selectedFrete===opt?theme.primary+'30':'rgba(255,255,255,0.06)'),background:selectedFrete===opt?theme.primary+'10':'rgba(255,255,255,0.02)',cursor:'pointer',marginBottom:4,fontFamily:"'Outfit',sans-serif"}}>
          <div style={{textAlign:'left'}}><div style={{fontSize:13,fontWeight:600,color:selectedFrete===opt?'#fff':'rgba(255,255,255,0.5)'}}>{opt.carrier}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.25)'}}>{opt.deadline_days} dias úteis</div></div>
          <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:14,fontWeight:800,color:selectedFrete===opt?theme.primary:'rgba(255,255,255,0.5)'}}>R$ {Number(opt.price).toFixed(2)}</span>{selectedFrete===opt&&<CheckCircle size={16} style={{color:theme.primary}}/>}</div>
        </button>))}
      </div>}
      {selectedFrete&&!useJointShipping&&!addressUnchanged&&<div style={{marginTop:10,padding:'10px 12px',borderRadius:10,background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Quer salvar esse endereço?</div>
        <div style={{display:'flex',gap:8}}>
          <Btn variant={saveAddressChoice===true?'success':'ghost'} onClick={()=>setSaveAddressChoice(true)} style={{flex:1,padding:'8px 10px',fontSize:12}} sfx="">Sim</Btn>
          <Btn variant={saveAddressChoice===false?'secondary':'ghost'} onClick={()=>setSaveAddressChoice(false)} style={{flex:1,padding:'8px 10px',fontSize:12}} sfx="">Não</Btn>
        </div>
      </div>}
      <Btn full variant="ghost" onClick={()=>setStep('review')} style={{marginTop:10}} sfx="nav"><ChevronLeft size={14}/> Voltar para revisão</Btn>
    </Card>}

    <Card id="tut-payment" style={{padding:16}}>
      {isFullBonus?<Btn full variant="success" onClick={finalize} disabled={submitting || !campaignOpen} sfx="">{submitting?<Spin size={16}/>:<><Gift size={18}/> Finalizar pedido bônus</>}</Btn>:
      <><SectionTitle sub="Pagamento seguro via Mercado Pago">Pagamento</SectionTitle>
      <Btn full onClick={finalize} disabled={submitting||!campaignOpen||(!isFullBonus&&!selectedFrete)} sfx="">{submitting?<Spin size={16}/>:<><CreditCard size={18}/> Pagar R$ {total.toFixed(2)}</>}</Btn></>}
    </Card>
  </div>);
}

async function pagarAgoraPedido(p, toastFn) {
  const t = typeof toastFn === 'function' ? toastFn : (msg)=>{ try{ console.log(msg); } catch {} };
  try {
    t('Gerando link de pagamento...','info');

    const link = p?.mp_link || p?.mpLink || p?.payment_link || p?.payment_url || p?.mp_init_point;
    if (link) { window.location.href = link; return true; }

    const orderId = String(
      p?.batch_id ?? p?.batch?.id ?? p?.batchId ?? p?.id ?? p?.order_id ?? p?.orderId ?? ''
    ).trim();

    const total = Number(
      p?.total_locked ?? p?.total_brl ?? p?.total ?? p?.total_locked_brl ?? p?.amount ?? p?.total_locked_value ?? 0
    );

    if (!orderId || !Number.isFinite(total) || total <= 0) {
      t('Pedido sem ID/valor para pagamento', 'error');
      console.log('Pedido inválido para pagar:', p);
      return false;
    }

    const mpRes = await fetch('/api/mp-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, total: Number(total.toFixed(2)), descricao: `Pedido #${orderId}` })
    });

    const mpText = await mpRes.text();
    const mpData = (()=>{ try { return JSON.parse(mpText); } catch { return { raw: mpText }; } })();

    if (!mpRes.ok) {
      const msg = mpData?.error || mpData?.message || `HTTP ${mpRes.status}`;
      t(`Erro Mercado Pago: ${msg}`, 'error');
      console.log('mp-create fail', mpRes.status, mpData);
      return false;
    }

    const mpLink = mpData?.mpLink || mpData?.init_point || mpData?.sandbox_init_point;
    if (mpLink) { window.location.href = mpLink; return true; }

    t('mp-create não retornou link (mpLink/init_point)', 'error');
    console.log('mp-create ok sem link', mpData);
    return false;
  } catch (e) {
    t(`Falha ao pagar: ${String(e?.message || e)}`, 'error');
    console.error(e);
    return false;
  }
}


// ══════════════════════════════════════════════════════
// SUCCESS
// ══════════════════════════════════════════════════════

function SuccessPage({lastOrder,theme,nav}){
  if(!lastOrder)return <EmptyState icon={Check} title="Sem pedido" sub=""/>;
  const isBonus=lastOrder.isFullBonus;
  return(<div style={{display:'flex',flexDirection:'column',gap:16,alignItems:'center',textAlign:'center',paddingTop:20}}>
    <div style={{width:72,height:72,borderRadius:36,background:isBonus?'linear-gradient(135deg,#2ee59d,#00bea4)':'linear-gradient(135deg,'+theme.primary+','+theme.secondary+')',display:'grid',placeItems:'center',boxShadow:'0 0 36px '+(isBonus?'rgba(46,229,157,0.3)':theme.glow)}}>{isBonus?<Gift size={32} color="#fff"/>:<Check size={32} color="#fff"/>}</div>
    <div><h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:22}}>{isBonus?'Pedido Bônus!':'Pedido Registrado!'}</h1><p style={{color:'rgba(255,255,255,0.35)',fontSize:13,margin:'6px 0 0'}}>{isBonus?'Bônus escolhidos':lastOrder.totalPaid+' cartas a R$ '+lastOrder.priceBRL.toFixed(2)}</p></div>
    <div style={{fontSize:12,color:'rgba(255,255,255,0.25)'}}>Pedido salvo no banco de dados.</div>
    <Btn full onClick={()=>nav('home')} sfx="nav"><Home size={16}/> Voltar</Btn>
  </div>);
}

// ══════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════

function ProfileSection({title,icon:Icon,color,children,defaultOpen=false}){
  const [open,setOpen]=useState(defaultOpen);
  return(<div style={{borderRadius:16,border:'1px solid rgba(255,255,255,0.06)',overflow:'hidden',background:'rgba(255,255,255,0.02)'}}>
    <button onClick={()=>setOpen(o=>!o)} style={{width:'100%',background:'none',border:'none',padding:'14px 16px',display:'flex',alignItems:'center',gap:10,cursor:'pointer',color:'#e9edf7'}}>
      <div style={{width:32,height:32,borderRadius:10,background:color+'18',border:'1px solid '+color+'30',display:'grid',placeItems:'center',flexShrink:0}}><Icon size={15} style={{color}}/></div>
      <span style={{flex:1,textAlign:'left',fontWeight:700,fontSize:14,fontFamily:"'Outfit',sans-serif"}}>{title}</span>
      <ChevronRight size={15} style={{color:'rgba(255,255,255,0.25)',transform:open?'rotate(90deg)':'none',transition:'transform .2s'}}/>
    </button>
    {open&&<div style={{padding:'0 16px 16px',borderTop:'1px solid rgba(255,255,255,0.04)'}}>{children}</div>}
  </div>);
}

function ProfileView({profile,token,theme,nav,isAdmin,setShowTutorial,onSaveProfile,onLogout,myOrders=[],onReloadOrders,toast:toastFn,campaign}){
  const [colors,setColors]=useState(profile?.mana_color_1&&profile?.mana_color_2?[profile.mana_color_1,profile.mana_color_2]:['U','R']);
  const [editAddr,setEditAddr]=useState(false);
  const [addr,setAddr]=useState({cep:profile?.cep||'',rua:profile?.rua||'',numero:profile?.numero||'',complemento:profile?.complemento||'',bairro:profile?.bairro||'',cidade:profile?.cidade||'',uf:profile?.uf||''});
  const [saving,setSaving]=useState(false);
  const [editName,setEditName]=useState(false);
  const [nameVal,setNameVal]=useState(profile?.name||'');
  const [wppVal,setWppVal]=useState(profile?.whatsapp||'');
  const [expandedOrder,setExpandedOrder]=useState(null);
  const [orderCardsCache,setOrderCardsCache]=useState({});
  const [showChangePw,setShowChangePw]=useState(false);
  const [newPw,setNewPw]=useState('');const [newPw2,setNewPw2]=useState('');
  const [pwVK,setPwVK]=useState(false);const [pwVKTarget,setPwVKTarget]=useState('pw1');
  const [pwLoading,setPwLoading]=useState(false);const [pwMsg,setPwMsg]=useState(null);

  function toggleC(k){setColors(p=>{if(p.includes(k))return p.filter(c=>c!==k);if(p.length>=2)return[p[1],k];return[...p,k];});}
  const guild=colors.length===2?getGuild(colors[0],colors[1]):null;const gT=guild?GT[guild]:null;
  const origColors=[profile?.mana_color_1,profile?.mana_color_2].filter(Boolean);
  const changed=JSON.stringify(colors)!==JSON.stringify(origColors);

  function pwVKKey(k){if(pwVKTarget==='pw1')setNewPw(p=>p.length<6?p+k:p);else setNewPw2(p=>p.length<6?p+k:p);}
  function pwVKBack(){if(pwVKTarget==='pw1')setNewPw(p=>p.slice(0,-1));else setNewPw2(p=>p.slice(0,-1));}
  async function changePassword(){
    if(!/^[0-9]{6}$/.test(newPw)){setPwMsg({t:'error',m:'A senha deve conter 6 números'});return;}
    if(newPw!==newPw2){setPwMsg({t:'error',m:'As senhas não coincidem'});return;}
    setPwLoading(true);
    try{await sbAuthUpdatePassword(newPw,token);SFX.success();setPwMsg({t:'success',m:'Senha alterada!'});setNewPw('');setNewPw2('');setPwVK(false);setTimeout(()=>setShowChangePw(false),1500);}
    catch(e){setPwMsg({t:'error',m:e.message});}
    setPwLoading(false);
  }
  async function saveGuild(){setSaving(true);await onSaveProfile({mana_color_1:colors[0],mana_color_2:colors[1],guild:guild||''});setSaving(false);}
  async function saveAddr(){setSaving(true);await onSaveProfile(addr);setEditAddr(false);setSaving(false);}
  async function savePessoal(){setSaving(true);await onSaveProfile({name:nameVal,whatsapp:wppVal});setEditName(false);setSaving(false);}

  const campOpen=campaignCanOrder(campaign?.status);
  const campColor=campOpen?'#2ee59d':campaign?.status?'#c9a96e':'rgba(255,255,255,0.2)';
  const campLabel=campaign?.status?campaignLabel(campaign.status):'Sem encomenda ativa';

  return(<div style={{display:'flex',flexDirection:'column',gap:10}}>

    {/* Hero card */}
    <div style={{borderRadius:20,padding:20,background:`linear-gradient(135deg,${gT?gT.primary+'22':'rgba(255,255,255,0.04)'} 0%,rgba(0,0,0,0) 100%)`,border:`1px solid ${gT?gT.primary+'30':'rgba(255,255,255,0.07)'}`,position:'relative',overflow:'hidden'}}>
      {gT&&<div style={{position:'absolute',inset:0,background:`radial-gradient(ellipse at 80% 50%,${gT.glow||gT.primary}18 0%,transparent 70%)`,pointerEvents:'none'}}/>}
      <div style={{display:'flex',alignItems:'center',gap:14}}>
        <div style={{width:56,height:56,borderRadius:18,background:gT?`linear-gradient(135deg,${gT.primary},${gT.secondary})`:'rgba(255,255,255,0.07)',display:'grid',placeItems:'center',fontSize:24,flexShrink:0,boxShadow:gT?`0 0 20px ${gT.glow||gT.primary}40`:'none'}}>
          {guild?'⚔️':'👤'}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:800,fontSize:18,fontFamily:"'Cinzel',serif",overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{profile?.name||'Aventureiro'}</div>
          <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:2}}>{guild||'Escolha sua guilda'}</div>
        </div>
        <div style={{textAlign:'right',flexShrink:0}}>
          <div style={{fontSize:10,color:campColor,fontWeight:700,textTransform:'uppercase',letterSpacing:1}}>{campLabel}</div>
          <div style={{width:8,height:8,borderRadius:4,background:campColor,margin:'4px auto 0',boxShadow:`0 0 6px ${campColor}`}}/>
        </div>
      </div>
    </div>

    {/* Dados pessoais */}
    <ProfileSection title="Dados Pessoais" icon={User} color={theme.primary} defaultOpen={true}>
      <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:12}}>
        {editName?<>
          <Input icon={User} placeholder="Seu nome" value={nameVal} onChange={e=>setNameVal(e.target.value)}/>
          <Input icon={Phone} placeholder="WhatsApp" value={wppVal} onChange={e=>setWppVal(e.target.value.replace(/\D/g,'').slice(0,11))}/>
          <div style={{display:'flex',gap:8}}>
            <Btn variant="success" onClick={savePessoal} disabled={saving} style={{flex:1}} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar</>}</Btn>
            <Btn variant="ghost" onClick={()=>setEditName(false)} style={{flex:1}} sfx="click">Cancelar</Btn>
          </div>
        </>:<>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:2}}>Nome</div>
              <div style={{fontSize:14,fontWeight:600}}>{profile?.name||'—'}</div>
            </div>
            <div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:2}}>WhatsApp</div>
              <div style={{fontSize:14,fontWeight:600}}>{profile?.whatsapp||'—'}</div>
            </div>
            <button onClick={()=>setEditName(true)} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:10,padding:'6px 10px',cursor:'pointer',color:'rgba(255,255,255,0.5)',display:'flex',alignItems:'center',gap:4,fontSize:11}}><Edit3 size={12}/> Editar</button>
          </div>
        </>}
      </div>
    </ProfileSection>

    {/* Endereço */}
    <ProfileSection title="Endereço de Entrega" icon={MapPin} color="#c9a96e">
      <div style={{marginTop:12}}>
        {editAddr?<>
          <AddressForm address={addr} setAddress={setAddr} onCalcFrete={()=>{}} frete={null} loadingFrete={false}/>
          <div style={{display:'flex',gap:8,marginTop:10}}>
            <Btn variant="success" onClick={saveAddr} disabled={saving} style={{flex:1}} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar</>}</Btn>
            <Btn variant="ghost" onClick={()=>setEditAddr(false)} style={{flex:1}} sfx="click">Cancelar</Btn>
          </div>
        </>:<AddressDisplay address={addr} onEdit={()=>setEditAddr(true)}/>}
      </div>
    </ProfileSection>

    {/* Guilda */}
    <ProfileSection title="Guilda & Mana" icon={Sparkles} color="#a78bfa">
      <div style={{marginTop:12}}>
        <div style={{display:'flex',justifyContent:'center',gap:12,margin:'10px 0'}}>{MANA_COLORS.map(m=><ManaOrb key={m.key} mana={m.key} selected={colors.includes(m.key)} onClick={()=>toggleC(m.key)} size={44}/>)}</div>
        {guild&&<div style={{textAlign:'center',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}><GuildBadge guild={guild} size={16}/><span style={{fontWeight:700,fontSize:14,color:gT?gT.primary:'#fff'}}>{guild}</span></div>}
        {changed&&guild&&<Btn full variant="success" onClick={saveGuild} disabled={saving} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar guilda</>}</Btn>}
      </div>
    </ProfileSection>

    {/* Pedidos */}
    {(()=>{
      const archivedStatuses=['DONE','CANCELLED'];
      const activeOrders=myOrders.filter(o=>!archivedStatuses.includes(o.campaignStatus));
      const archivedOrders=myOrders.filter(o=>archivedStatuses.includes(o.campaignStatus));
      function renderOrder(o,showActions){
        const isExp=expandedOrder===o.id;
        const st=String(o.status||'').toUpperCase();
        const paySt=String(o.payment_status||'').toLowerCase();
        const isPaid=(st==='PAID'||st==='CONFIRMED'||st==='APPROVED')||paySt==='approved';
        const isPending=!isPaid&&(st===''||st==='DRAFT'||st==='AWAITING_PAYMENT'||st==='IN_PROCESS'||paySt==='pending'||paySt==='in_process');
        return(<div key={o.id} style={{borderRadius:12,border:`1px solid ${isPending?'rgba(201,169,110,0.2)':isPaid?'rgba(46,229,157,0.12)':'rgba(255,255,255,0.05)'}`,overflow:'hidden',background:'rgba(0,0,0,0.2)',cursor:'pointer'}} onClick={async()=>{const next=isExp?null:o.id;setExpandedOrder(next);if(next!==null&&!o.cards&&!orderCardsCache[String(o.id)]){const cards=await loadOrderCards(o,token);setOrderCardsCache(prev=>({...prev,[String(o.id)]:cards}));}}}>
          <div style={{padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{width:36,height:36,borderRadius:10,background:isPaid?'rgba(46,229,157,0.1)':isPending?'rgba(201,169,110,0.1)':'rgba(255,255,255,0.04)',display:'grid',placeItems:'center'}}>
                <Package size={15} style={{color:isPaid?'#2ee59d':isPending?'#c9a96e':'rgba(255,255,255,0.3)'}}/>
              </div>
              <div>
                <div style={{fontSize:12,fontWeight:700}}>{Number(o.total_locked)>0?'R$ '+Number(o.total_locked).toFixed(2):'Bônus'}</div>
                <div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{o.qty_in_batch} cartas · {new Date(o.created_at).toLocaleDateString('pt-BR')}</div>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <Tag color={isPending?'#c9a96e':isPaid?'#2ee59d':'#4a90d9'} style={{fontSize:9}}>{isPending?'Pendente':isPaid?'Pago':o.status}</Tag>
              <ChevronRight size={13} style={{color:'rgba(255,255,255,0.2)',transform:isExp?'rotate(90deg)':'none',transition:'transform .2s'}}/>
            </div>
          </div>
          {isExp&&<div style={{padding:'0 14px 12px',borderTop:'1px solid rgba(255,255,255,0.04)'}}>
            {((o.cards&&o.cards.length>0)?o.cards:(orderCardsCache[String(o.id)]||[])).length>0?
              <div style={{marginTop:8}}>{((o.cards&&o.cards.length>0)?o.cards:(orderCardsCache[String(o.id)]||[])).map((c,ci,arr)=>(
                <div key={ci} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:12,borderBottom:ci<arr.length-1?'1px solid rgba(255,255,255,0.03)':'none'}}>
                  <span style={{color:'rgba(255,255,255,0.5)'}}>{c.name} <span style={{color:TC[c.type]||'rgba(255,255,255,0.3)',fontSize:10,fontWeight:700}}>{c.type||''}</span></span>
                  <span style={{fontWeight:700}}>x{c.qty}</span>
                </div>
              ))}</div>
              :<div style={{fontSize:11,color:'rgba(255,255,255,0.2)',marginTop:8}}>Detalhes não disponíveis</div>}
            {showActions&&isPending&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:10}}>
              <Btn variant="warn" onClick={(e)=>{e.stopPropagation();pagarAgoraPedido(o,toastFn);}} style={{width:'100%',fontSize:11,whiteSpace:'nowrap',justifyContent:'center'}} sfx="nav"><CreditCard size={12}/> Pagar</Btn>
              <Btn variant="ghost" onClick={async(e)=>{e.stopPropagation();try{await mpSync(o.id);onReloadOrders();}catch(err){toastFn('Erro: '+(err.message||String(err)),'error');}}} style={{width:'100%',fontSize:11,justifyContent:'center'}} sfx=""><RefreshCw size={12}/></Btn>
              <Btn variant="danger" onClick={async(e)=>{e.stopPropagation();if(!confirm('Cancelar este pedido?'))return;try{const res=await fetch('/api/cancel-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({batchId:String(o.id),orderId:String(o.order_id||'')})});const j=await res.json().catch(()=>({}));if(!res.ok||!j.ok)throw new Error(j.error||'Falha');toastFn('Pedido cancelado','success');onReloadOrders();}catch(err){toastFn('Erro: '+(err.message||String(err)),'error');}}} style={{width:'100%',fontSize:11,justifyContent:'center'}} sfx=""><X size={12}/> Cancelar</Btn>
            </div>}
          </div>}
        </div>);
      }
      return(<>
        <ProfileSection title={`Meus Pedidos${activeOrders.length>0?' ('+activeOrders.length+')':''}`} icon={Package} color="#4a90d9">
          <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:6}}>
            {activeOrders.length===0?<div style={{fontSize:13,color:'rgba(255,255,255,0.25)',textAlign:'center',padding:12}}>Nenhum pedido ativo</div>:
            activeOrders.map(o=>renderOrder(o,true))}
          </div>
        </ProfileSection>
        {archivedOrders.length>0&&<ProfileSection title={`Arquivados (${archivedOrders.length})`} icon={Archive} color="rgba(255,255,255,0.25)">
          <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:6}}>
            {archivedOrders.map(o=>renderOrder(o,false))}
          </div>
        </ProfileSection>}
      </>);
    })()}

    {/* Senha */}
    <ProfileSection title="Alterar Senha" icon={Lock} color="#f87171">
      <div style={{marginTop:12}}>
        {!showChangePw?<Btn full variant="ghost" onClick={()=>setShowChangePw(true)} sfx="click"><Lock size={14}/> Alterar senha</Btn>:<>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <div onClick={()=>{setPwVKTarget('pw1');setPwVK(true);}} style={{padding:'12px 14px 12px 42px',borderRadius:12,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(0,0,0,0.3)',cursor:'pointer',position:'relative',minHeight:44}}>
              <Lock size={16} style={{position:'absolute',left:13,top:'50%',transform:'translateY(-50%)',color:'rgba(255,255,255,0.2)'}}/>
              {newPw?<span style={{letterSpacing:6}}>{'●'.repeat(newPw.length)}</span>:<span style={{color:'rgba(255,255,255,0.3)',fontSize:13}}>Nova senha (6 dígitos)</span>}
            </div>
            <div onClick={()=>{setPwVKTarget('pw2');setPwVK(true);}} style={{padding:'12px 14px 12px 42px',borderRadius:12,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(0,0,0,0.3)',cursor:'pointer',position:'relative',minHeight:44}}>
              <Lock size={16} style={{position:'absolute',left:13,top:'50%',transform:'translateY(-50%)',color:'rgba(255,255,255,0.2)'}}/>
              {newPw2?<span style={{letterSpacing:6}}>{'●'.repeat(newPw2.length)}</span>:<span style={{color:'rgba(255,255,255,0.3)',fontSize:13}}>Confirmar senha</span>}
            </div>
            {pwVK&&<VirtualKeyboard onKey={pwVKKey} onBackspace={pwVKBack} onDone={()=>setPwVK(false)} maxLen={6} currentLen={pwVKTarget==='pw1'?newPw.length:newPw2.length} doneLabel="Fechar"/>}
            {pwMsg&&<div style={{fontSize:12,color:pwMsg.t==='error'?'#ff6b7a':'#2ee59d',textAlign:'center'}}>{pwMsg.m}</div>}
            <div style={{display:'flex',gap:8}}>
              <Btn variant="success" onClick={changePassword} disabled={pwLoading} style={{flex:1}} sfx="success">{pwLoading?<Spin size={14}/>:<><Check size={14}/> Confirmar</>}</Btn>
              <Btn variant="ghost" onClick={()=>{setShowChangePw(false);setNewPw('');setNewPw2('');setPwMsg(null);}} style={{flex:1}} sfx="click">Cancelar</Btn>
            </div>
          </div>
        </>}
      </div>
    </ProfileSection>

    {/* Ações */}
    <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:4}}>
      <Btn full variant="secondary" onClick={()=>{SFX.nav();setShowTutorial(true);}} sfx=""><HelpCircle size={15}/> Ver tutorial</Btn>
      {isAdmin&&<Btn full variant="warn" onClick={()=>nav('admin')} sfx="nav"><Shield size={15}/> Painel Admin</Btn>}
      <Btn full variant="danger" onClick={onLogout} sfx="click"><LogOut size={14}/> Sair</Btn>
    </div>

  </div>);
}

// ══════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════

function AuthPage({onLogin,theme}){
  const [mode,setMode]=useState('login');const [email,setEmail]=useState('');const [senha,setSenha]=useState('');const [senha2,setSenha2]=useState('');
  const [name,setName]=useState('');const [whatsapp,setWhatsapp]=useState('');
  const [showVK,setShowVK]=useState(false);const [vkTarget,setVkTarget]=useState('senha');
  const [loading,setLoading]=useState(false);const [err,setErr]=useState('');
  const [forgotMode,setForgotMode]=useState(false);const [resetSent,setResetSent]=useState(false);

  function openVK(target){setVkTarget(target);setShowVK(true);}
  function vkKey(k){if(vkTarget==='senha')setSenha(p=>p.length<6?p+k:p);else setSenha2(p=>p.length<6?p+k:p);}
  function vkBack(){if(vkTarget==='senha')setSenha(p=>p.slice(0,-1));else setSenha2(p=>p.slice(0,-1));}
  const currentVKLen=vkTarget==='senha'?senha.length:senha2.length;

  const senhaOk=/^[0-9]{6}$/.test(senha);
  const canSubmit=email.includes('@')&&senhaOk&&!loading&&(mode==='login'||senha===senha2);

  async function submit(){
    setErr('');
    if(!senhaOk){setErr('A senha deve conter 6 números');return;}
    if(mode==='signup'&&senha!==senha2){setErr('As senhas não coincidem');return;}
    setLoading(true);
    try {
      if(mode==='signup'){
        if(!name){setErr('Preencha o nome');setLoading(false);return;}
        if(!whatsapp||whatsapp.length<10){setErr('WhatsApp inválido');setLoading(false);return;}
        const res=await sbAuthSignUp(email,senha);
        let session;
        if (res.access_token) session = res;
        else if (res.session?.access_token) session = res.session;
        else session = await sbAuthSignIn(email, senha);
        const userId = session.user?.id || res.user?.id;
        const token = session.access_token;
        await sbUpsert('profiles', { id: userId, name, whatsapp, email, is_admin: false }, token);
        SFX.confirm();
        onLogin(session, 'signup');
      } else {
        const res=await sbAuthSignIn(email,senha);
        SFX.success();
        onLogin(res,'login');
      }
    } catch(e) {
      SFX.error();
      setErr(e.message||'Erro desconhecido');
    }
    setLoading(false);
  }

  async function handleForgot(){
    if(!email.includes('@')){setErr('Digite seu email primeiro');return;}
    setErr('');setLoading(true);
    try{
      await sbAuthResetPassword(email);
      setResetSent(true);SFX.success();
    }catch(e){setErr(e.message);}
    setLoading(false);
  }

  if(forgotMode)return(<div style={{display:'flex',flexDirection:'column',gap:14,paddingTop:16}}>
    <div style={{textAlign:'center'}}><div style={{fontSize:34,marginBottom:4}}>🔑</div><h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:22}}>Recuperar Senha</h1></div>
    {resetSent?<Card glow="rgba(46,229,157,0.15)" style={{padding:20,textAlign:'center'}}>
      <Check size={32} style={{color:'#2ee59d',marginBottom:8}}/>
      <div style={{fontWeight:700,color:'#2ee59d',fontSize:15}}>Email enviado!</div>
      <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:6}}>Verifique sua caixa de entrada e spam. Clique no link para redefinir sua senha.</div>
      <Btn full variant="secondary" onClick={()=>{setForgotMode(false);setResetSent(false);}} style={{marginTop:16}} sfx="nav">Voltar ao login</Btn>
    </Card>:<>
      <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',textAlign:'center'}}>Digite seu email e enviaremos um link para redefinir sua senha.</div>
      <Input icon={Mail} placeholder="seu@email.com" value={email} onChange={e=>setEmail(e.target.value)}/>
      {err&&<div style={{fontSize:12,color:'#ff6b7a',textAlign:'center',padding:4}}><AlertTriangle size={12}/> {err}</div>}
      <Btn full onClick={handleForgot} disabled={!email.includes('@')||loading} sfx="">{loading?<Spin size={16}/>:<><Mail size={16}/> Enviar link de recuperação</>}</Btn>
      <button onClick={()=>{setForgotMode(false);setErr('');}} style={{background:'none',border:'none',color:'var(--gp)',fontSize:13,cursor:'pointer',fontFamily:"'Outfit',sans-serif",padding:8,textAlign:'center'}}>Voltar ao login</button>
    </>}
  </div>);

  return(<div style={{display:'flex',flexDirection:'column',gap:14,paddingTop:16}}>
    <div style={{textAlign:'center'}}><div style={{fontSize:34,marginBottom:4}}>⚔️</div><h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:22}}>{mode==='login'?'Bem-vindo':'Junte-se'}</h1></div>
    <div style={{display:'flex',borderRadius:12,background:'rgba(255,255,255,0.025)',padding:3,gap:3}}>{['login','signup'].map(m=>(<button key={m} onClick={()=>{SFX.toggle();setMode(m);setErr('');setSenha('');setSenha2('');setShowVK(false);}} style={{flex:1,padding:'9px 0',borderRadius:10,border:'none',background:mode===m?'rgba(255,255,255,0.07)':'transparent',color:mode===m?'#fff':'rgba(255,255,255,0.3)',fontWeight:700,fontSize:13,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>{m==='login'?'Entrar':'Criar conta'}</button>))}</div>
    {mode==='signup'&&<Input icon={User} placeholder="Seu nome" value={name} onChange={e=>setName(e.target.value)}/>}
    <Input icon={Mail} placeholder="seu@email.com" value={email} onChange={e=>setEmail(e.target.value)}/>
    {mode==='signup'&&<Input icon={Phone} placeholder="WhatsApp (11999999999)" value={whatsapp} onChange={e=>setWhatsapp(e.target.value.replace(/\D/g,'').slice(0,11))}/>}
    <div>
      <div onClick={()=>openVK('senha')} style={{width:'100%',padding:'13px 14px 13px 42px',borderRadius:14,border:'1px solid '+(showVK&&vkTarget==='senha'?'var(--gp)':'rgba(255,255,255,0.08)'),background:'rgba(0,0,0,0.3)',color:senha?'#e9edf7':'rgba(255,255,255,0.3)',fontSize:15,fontFamily:"'Outfit',sans-serif",cursor:'pointer',position:'relative',boxSizing:'border-box',minHeight:46}}>
        <Lock size={18} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'rgba(255,255,255,0.22)'}}/>
        {senha?<span style={{letterSpacing:6}}>{'●'.repeat(senha.length)}<span style={{color:'rgba(255,255,255,0.15)',letterSpacing:4}}>{'○'.repeat(6-senha.length)}</span></span>:'Senha (6 dígitos)'}
      </div>
    </div>
    {mode==='signup'&&<div>
      <div onClick={()=>openVK('senha2')} style={{width:'100%',padding:'13px 14px 13px 42px',borderRadius:14,border:'1px solid '+(showVK&&vkTarget==='senha2'?'var(--gp)':'rgba(255,255,255,0.08)'),background:'rgba(0,0,0,0.3)',color:senha2?'#e9edf7':'rgba(255,255,255,0.3)',fontSize:15,fontFamily:"'Outfit',sans-serif",cursor:'pointer',position:'relative',boxSizing:'border-box',minHeight:46}}>
        <Lock size={18} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'rgba(255,255,255,0.22)'}}/>
        {senha2?<span style={{letterSpacing:6}}>{'●'.repeat(senha2.length)}<span style={{color:'rgba(255,255,255,0.15)',letterSpacing:4}}>{'○'.repeat(6-senha2.length)}</span></span>:'Confirmar senha'}
      </div>
      {senha2.length===6&&senha!==senha2&&<div style={{fontSize:11,color:'#ff6b7a',marginTop:4,textAlign:'center'}}>As senhas não coincidem</div>}
    </div>}
    {showVK&&<div style={{marginTop:4}}><VirtualKeyboard onKey={vkKey} onBackspace={vkBack} onDone={()=>setShowVK(false)} maxLen={6} currentLen={currentVKLen} doneLabel="Fechar"/></div>}
    {err&&<div style={{fontSize:12,color:'#ff6b7a',textAlign:'center',padding:4}}><AlertTriangle size={12}/> {err}</div>}
    <Btn full onClick={submit} disabled={!canSubmit} sfx="">{loading?<Spin size={16}/>:<>{mode==='login'?'Entrar':'Criar conta'} <ArrowRight size={16}/></>}</Btn>
    {mode==='login'&&<button onClick={()=>{setForgotMode(true);setErr('');}} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',fontSize:12,cursor:'pointer',fontFamily:"'Outfit',sans-serif",padding:4,textAlign:'center'}}>Esqueci minha senha</button>}
  </div>);
}

// ══════════════════════════════════════════════════════
// PASSWORD RECOVERY PAGE
// ══════════════════════════════════════════════════════

function RecoveryPage({token,onDone,theme}){
  const [pw,setPw]=useState('');const [pw2,setPw2]=useState('');
  const [showVK,setShowVK]=useState(false);const [vkTarget,setVkTarget]=useState('pw');
  const [loading,setLoading]=useState(false);const [err,setErr]=useState('');
  function vkKey(k){if(vkTarget==='pw')setPw(p=>p.length<6?p+k:p);else setPw2(p=>p.length<6?p+k:p);}
  function vkBack(){if(vkTarget==='pw')setPw(p=>p.slice(0,-1));else setPw2(p=>p.slice(0,-1));}
  async function save(){
    if(!/^[0-9]{6}$/.test(pw)){setErr('A senha deve conter 6 números');return;}
    if(pw!==pw2){setErr('As senhas não coincidem');return;}
    setLoading(true);setErr('');
    try{await sbAuthUpdatePassword(pw,token);onDone();}
    catch(e){setErr(e.message);}
    setLoading(false);
  }
  return(<div style={{display:'flex',flexDirection:'column',gap:14,paddingTop:16}}>
    <div style={{textAlign:'center'}}><div style={{fontSize:34,marginBottom:4}}>🔑</div><h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:22}}>Nova Senha</h1><p style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:6}}>Digite sua nova senha de 6 dígitos</p></div>
    <div onClick={()=>{setVkTarget('pw');setShowVK(true);}} style={{width:'100%',padding:'13px 14px 13px 42px',borderRadius:14,border:'1px solid '+(showVK&&vkTarget==='pw'?'var(--gp)':'rgba(255,255,255,0.08)'),background:'rgba(0,0,0,0.3)',color:pw?'#e9edf7':'rgba(255,255,255,0.3)',fontSize:15,fontFamily:"'Outfit',sans-serif",cursor:'pointer',position:'relative',boxSizing:'border-box',minHeight:46}}>
      <Lock size={18} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'rgba(255,255,255,0.22)'}}/>
      {pw?<span style={{letterSpacing:6}}>{'●'.repeat(pw.length)}<span style={{color:'rgba(255,255,255,0.15)',letterSpacing:4}}>{'○'.repeat(6-pw.length)}</span></span>:'Nova senha'}
    </div>
    <div onClick={()=>{setVkTarget('pw2');setShowVK(true);}} style={{width:'100%',padding:'13px 14px 13px 42px',borderRadius:14,border:'1px solid '+(showVK&&vkTarget==='pw2'?'var(--gp)':'rgba(255,255,255,0.08)'),background:'rgba(0,0,0,0.3)',color:pw2?'#e9edf7':'rgba(255,255,255,0.3)',fontSize:15,fontFamily:"'Outfit',sans-serif",cursor:'pointer',position:'relative',boxSizing:'border-box',minHeight:46}}>
      <Lock size={18} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'rgba(255,255,255,0.22)'}}/>
      {pw2?<span style={{letterSpacing:6}}>{'●'.repeat(pw2.length)}<span style={{color:'rgba(255,255,255,0.15)',letterSpacing:4}}>{'○'.repeat(6-pw2.length)}</span></span>:'Confirmar senha'}
    </div>
    {pw2.length===6&&pw!==pw2&&<div style={{fontSize:11,color:'#ff6b7a',marginTop:4,textAlign:'center'}}>As senhas não coincidem</div>}
    {showVK&&<div style={{marginTop:4}}><VirtualKeyboard onKey={vkKey} onBackspace={vkBack} onDone={()=>setShowVK(false)} maxLen={6} currentLen={currentVKLen}/></div>}
    {err&&<div style={{fontSize:12,color:'#ff6b7a',textAlign:'center'}}><AlertTriangle size={12}/> {err}</div>}
    <Btn full onClick={save} disabled={pw.length<6||pw!==pw2||loading} sfx="">{loading?<Spin size={14}/>:<><Check size={16}/> Salvar nova senha</>}</Btn>
  </div>);
}

// ══════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════

function OnboardingPage({onComplete,theme}){
  const [step,setStep]=useState(0);const [colors,setColors]=useState([]);const [askTutorial,setAskTutorial]=useState(false);
  function toggleC(k){setColors(p=>{if(p.includes(k))return p.filter(c=>c!==k);if(p.length>=2)return[p[1],k];return[...p,k];});}
  const guild=colors.length===2?getGuild(colors[0],colors[1]):null;const gT=guild?GT[guild]:theme;
  const steps=[
    {mood:'🔮',title:'Escolha sua Guilda',body:'"Duas cores de mana definem sua essência. Cada combinação invoca uma guilda diferente."',hasColors:true},
  ];
  const s=steps[step];

  if(askTutorial)return(<div style={{display:'flex',flexDirection:'column',gap:16,paddingTop:40,alignItems:'center',textAlign:'center'}}>
    <div style={{width:56,height:56,borderRadius:14,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',display:'grid',placeItems:'center',fontSize:28}}>🧙</div>
    <h2 style={{fontFamily:"'Cinzel',serif",fontSize:20}}>"Agora vou guiar seus primeiros passos!"</h2>
    <p style={{fontSize:13,color:'rgba(255,255,255,0.4)',maxWidth:300,fontStyle:'italic'}}>Um guia rápido sobre o ritual da encomenda</p>
    <div style={{display:'flex',gap:10,width:'100%',maxWidth:300}}>
      <Btn onClick={()=>onComplete(colors,guild,true)} style={{flex:1}} sfx="confirm">Vamos lá! 🔮</Btn>
    </div>
  </div>);

  return(<div style={{display:'flex',flexDirection:'column',gap:16,paddingTop:16,minHeight:'70vh',justifyContent:'space-between'}}>
    <div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18}}><div style={{width:44,height:44,borderRadius:12,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',display:'grid',placeItems:'center',fontSize:22}}>{s.mood}</div><div><div style={{fontWeight:800,fontSize:14}}>Goblin Guia</div><div style={{fontSize:11,color:'rgba(255,255,255,0.28)'}}>Guardião do Portal</div></div></div>
      <h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:23}}>{s.title}</h1>
      <p style={{fontSize:14,lineHeight:1.7,color:'rgba(255,255,255,0.55)',marginTop:10,fontStyle:'italic'}}>{s.body}</p>
      {s.illus&&s.illus()}
      {s.hasColors&&<div style={{marginTop:18}}><div style={{display:'flex',justifyContent:'center',gap:14,marginBottom:14}}>{MANA_COLORS.map(m=><ManaOrb key={m.key} mana={m.key} selected={colors.includes(m.key)} onClick={()=>toggleC(m.key)} size={50}/>)}</div>{guild&&<div style={{textAlign:'center'}}><GuildBadge guild={guild} size={24}/><span style={{fontFamily:"'Cinzel',serif",fontSize:18,fontWeight:700,color:gT.primary,marginLeft:8}}>{guild}</span></div>}</div>}
    </div>
    <div>
      <div style={{display:'flex',gap:5,justifyContent:'center',marginBottom:12}}>{steps.map((_,i)=><div key={i} style={{width:i===step?20:6,height:6,borderRadius:3,background:i===step?gT.primary:'rgba(255,255,255,0.1)'}}/>)}</div>
      <div style={{display:'flex',gap:10}}>{step>0&&<Btn variant="secondary" onClick={()=>setStep(s=>s-1)} style={{flex:1}} sfx="nav"><ChevronLeft size={15}/></Btn>}{step<steps.length-1?<Btn onClick={()=>setStep(s=>s+1)} style={{flex:1}} sfx="click">Próximo <ChevronRight size={15}/></Btn>:<Btn onClick={()=>{if(!guild)return;SFX.confirm();setAskTutorial(true);}} disabled={!guild} style={{flex:1}} sfx=""><Sparkles size={15}/> Continuar</Btn>}</div>
    </div>
  </div>);
}

// ══════════════════════════════════════════════════════
// ADMIN — full management panel
const CAMPAIGN_STATUSES=['DRAFT','ACTIVE','LOCKED','ORDERING','ORDERED','RECEIVED','PACKING','SHIPPING','DONE','CANCELLED'];

function AdminPage({pool,pricing:pricingProp,campaign:campProp,theme,token,nav,onReload,toast:toastFn}){
  const [campaigns,setCampaigns]=useState([]);
  const [selectedCampaign,setSelectedCampaign]=useState(campProp||null);
  const [tab,setTab]=useState('orders');
  const [orders,setOrders]=useState([]);
  const [allProfiles,setAllProfiles]=useState([]);
  const [loading,setLoading]=useState(true);
  const [ordersLoading,setOrdersLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [archiving,setArchiving]=useState(false);
  const [showArchiveConfirm,setShowArchiveConfirm]=useState(false);
  const [showCreateForm,setShowCreateForm]=useState(false);
  const [newCamp,setNewCamp]=useState({name:'',status:'DRAFT',close_at:'',max_cards:null,min_cards:150});
  const [creating,setCreating]=useState(false);

  const [editPricing,setEditPricing]=useState(pricingProp?{...pricingProp}:{});
  const [editCamp,setEditCamp]=useState(campProp?{...campProp}:{});

  // Sync editPricing when parent data reloads
  useEffect(()=>{if(pricingProp)setEditPricing({...pricingProp});},[pricingProp]);

  const [expandedClient,setExpandedClient]=useState(null);
  const [expandedBatch,setExpandedBatch]=useState(null);
  const [batchCards,setBatchCards]=useState({});
  const [searchOrd,setSearchOrd]=useState('');
  const [ordStatusFilter,setOrdStatusFilter]=useState('ALL');
  const [ordSort,setOrdSort]=useState('date_desc');
  const [expandedOrdBatch,setExpandedOrdBatch]=useState(null);
  const [searchOrders,setSearchOrders]=useState('');

  const [finalList,setFinalList]=useState([]);
  const [listLoading,setListLoading]=useState(false);
  const [copied,setCopied]=useState(false);

  const [adminBonusGrants,setAdminBonusGrants]=useState([]);
  const [bonusLoading,setBonusLoading]=useState(false);
  const [bonusForm,setBonusForm]=useState({userId:null,qty:1});
  const [clientActiveFilter,setClientActiveFilter]=useState(false);

  async function loadBonusGrants(){
    if(!selectedCampaign)return;
    setBonusLoading(true);
    try{
      const r=await fetch('/api/admin-bonus',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({action:'list',campaignId:selectedCampaign.id})});
      const json=await r.json().catch(()=>({}));
      if(!r.ok||!json.ok)throw new Error(json.error||`HTTP ${r.status}`);
      setAdminBonusGrants(json.grants||[]);
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao carregar bônus: '+(e.message||String(e)),'error');}
    setBonusLoading(false);
  }

  async function grantBonus(userId,qty){
    if(!selectedCampaign||!userId||!qty||qty<1)return;
    try{
      const r=await fetch('/api/admin-bonus',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({action:'grant',userId,campaignId:selectedCampaign.id,bonusQty:qty})});
      const json=await r.json().catch(()=>({}));
      if(!r.ok||!json.ok)throw new Error(json.error||`HTTP ${r.status}`);
      SFX.success();if(toastFn)toastFn(`Bônus de ${qty} carta(s) concedido!`,'success');
      loadBonusGrants();
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao conceder bônus: '+(e.message||String(e)),'error');}
    setBonusForm({userId:null,qty:1});
  }

  async function revokeBonus(grantId){
    if(!confirm('Revogar este bônus?'))return;
    try{
      const r=await fetch('/api/admin-bonus',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({action:'revoke',grantId})});
      const json=await r.json().catch(()=>({}));
      if(!r.ok||!json.ok)throw new Error(json.error||`HTTP ${r.status}`);
      SFX.success();if(toastFn)toastFn('Bônus revogado','success');
      loadBonusGrants();
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao revogar: '+(e.message||String(e)),'error');}
  }

  useEffect(()=>{
    loadCampaigns();
    fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL').then(r=>r.json()).then(d=>{if(d.USDBRL)setLiveUsd(parseFloat(d.USDBRL.bid));}).catch(()=>{});
  },[]);

  async function loadCampaigns(){
    try{const r=await fetch('/api/campaigns',{method:'GET'});const data=await r.json();setCampaigns(Array.isArray(data)?data:[]);}catch(e){console.error(e);}finally{setLoading(false);}
  }

  useEffect(()=>{if(campProp&&!selectedCampaign)setSelectedCampaign(campProp);},[campProp]);

  useEffect(()=>{
    if(selectedCampaign){loadOrders();loadBonusGrants();loadAllProfiles();setEditCamp({...selectedCampaign});}else{setOrders([]);setOrdersLoading(false);setAdminBonusGrants([]);}
  },[selectedCampaign?.id]);

  async function loadOrders(){
    if(!selectedCampaign)return;
    setOrdersLoading(true);
    try{
      const r=await fetch('/api/admin-orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campaignId:selectedCampaign.id})});
      const json=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(json.error||`HTTP ${r.status}`);
      setOrders(json.orders||[]);
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao carregar pedidos: '+(e.message||String(e)),'error');}
    setOrdersLoading(false);
  }

  async function loadAllProfiles(){
    try{
      const r=await fetch('/api/admin-profiles',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`}});
      const json=await r.json().catch(()=>({}));
      if(!r.ok||!json.ok)throw new Error(json.error||`HTTP ${r.status}`);
      setAllProfiles(json.profiles||[]);
    }catch(e){console.warn('loadAllProfiles error:',e);}
  }

  const clientGroups=useMemo(()=>{
    const groups={};
    orders.forEach(o=>{
      const allBatches=(o.order_batches||[]);
      if(allBatches.length===0)return;
      const key=o.user_id;
      if(!groups[key]){groups[key]={userId:o.user_id,name:o.profiles?.name||'—',whatsapp:o.profiles?.whatsapp||'',email:o.profiles?.email||'',orders:[],totalCards:0,hasOrder:true,hasActiveOrder:false};}
      groups[key].orders.push({...o,order_batches:allBatches});
      groups[key].totalCards+=allBatches.reduce((s,b)=>s+(b.qty_in_batch||0),0);
      if(allBatches.some(b=>b.status&&b.status!=='CANCELLED'))groups[key].hasActiveOrder=true;
    });
    // Adiciona profiles sem pedido
    allProfiles.forEach(p=>{
      if(!groups[p.id]&&!p.is_admin){
        groups[p.id]={userId:p.id,name:p.name||'—',whatsapp:p.whatsapp||'',email:p.email||'',orders:[],totalCards:0,hasOrder:false,hasActiveOrder:false};
      }
    });
    return Object.values(groups).sort((a,b)=>b.hasActiveOrder-a.hasActiveOrder||b.hasOrder-a.hasOrder||a.name.localeCompare(b.name));
  },[orders,allProfiles]);

  const filteredClients=useMemo(()=>{
    let list=clientGroups;
    if(clientActiveFilter)list=list.filter(c=>c.hasActiveOrder);
    if(searchOrd){const q=searchOrd.toLowerCase();list=list.filter(c=>c.name.toLowerCase().includes(q)||c.whatsapp.toLowerCase().includes(q)||c.orders.some(o=>String(o.id).toLowerCase().includes(q)||o.order_batches?.some(b=>String(b.id).slice(0,8).toUpperCase().includes(q.toUpperCase()))));}
    return list;
  },[clientGroups,clientActiveFilter,searchOrd]);

  async function loadBatchCards(batchId){
    if(batchCards[batchId])return;
    try{
      const r=await fetch('/api/admin-batch-items',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({batchIds:[batchId]})});
      const json=await r.json().catch(()=>({}));
      if(!r.ok||!json.ok)throw new Error(json.error||`HTTP ${r.status}`);
      setBatchCards(prev=>({...prev,[batchId]:(json.items||[]).map(i=>({name:i.cards?.name||'Carta',type:i.cards?.type||'',qty:Number(i.quantity||1)}))}));
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao carregar itens: '+(e.message||String(e)),'error');}
  }

  async function cancelBatch(batchId,isPaid){
    const msg=isPaid?'Cancelar pedido pago? O reembolso deve ser feito manualmente no Mercado Pago.':'Cancelar este pedido pendente?';
    if(!confirm(msg))return;
    try{
      const r=await fetch('/api/admin-cancel-batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({batchId})});
      const json=await r.json().catch(()=>({}));
      if(!r.ok||!json.ok)throw new Error(json.error||`HTTP ${r.status}`);
      SFX.success();loadOrders();if(onReload)onReload();
    }catch(e){console.error(e);}
  }

  async function markBatchPaid(batchId){
    if(!confirm('Marcar este pedido como PAGO manualmente?'))return;
    try{
      const r=await fetch('/api/admin-mark-paid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({batchId})});
      const json=await r.json().catch(()=>({}));
      if(!r.ok||!json.ok)throw new Error(json.error||`HTTP ${r.status}`);
      SFX.success();loadOrders();if(onReload)onReload();
    }catch(e){console.error(e);}
  }

  async function syncBatchMP(batchId){
    try{
      await mpSync(batchId);
      SFX.success();loadOrders();
    }catch(e){console.error('Sync error:',e);}
  }

  // Flat batch list for Orders tab
  const allBatches=useMemo(()=>{
    const list=[];
    orders.forEach(o=>{(o.order_batches||[]).forEach(b=>{
      list.push({...b,orderId:o.id,userId:o.user_id,clientName:o.profiles?.name||'—',clientWhatsapp:o.profiles?.whatsapp||'',qtyPaid:o.qty_paid||0,qtyBonus:o.qty_bonus||0,orderCreatedAt:o.created_at,shippingPriceLocked:o.shipping_price_brl_locked});
    });});
    return list;
  },[orders]);

  const ordStats=useMemo(()=>{
    const paid=allBatches.filter(b=>b.status==='PAID'||b.status==='PAID_CONFIRMED');
    const pending=allBatches.filter(b=>b.status==='DRAFT'||b.status==='AWAITING_PAYMENT'||b.status==='AWAITING_PAYMENT');
    const cancelled=allBatches.filter(b=>b.status==='CANCELLED');
    const totalRevenue=paid.reduce((s,b)=>s+Number(b.total_locked||0),0);
    const totalCards=paid.reduce((s,b)=>s+(b.qty_in_batch||0),0);
    const pendingRevenue=pending.reduce((s,b)=>s+Number(b.total_locked||0),0);
    return {total:allBatches.length,paidCount:paid.length,pendingCount:pending.length,cancelledCount:cancelled.length,totalRevenue,totalCards,pendingRevenue};
  },[allBatches]);

  const filteredBatches=useMemo(()=>{
    let list=allBatches;
    if(ordStatusFilter==='PAID')list=list.filter(b=>b.status==='PAID'||b.status==='PAID_CONFIRMED');
    else if(ordStatusFilter==='AWAITING_PAYMENT')list=list.filter(b=>b.status==='DRAFT'||b.status==='AWAITING_PAYMENT'||b.status==='AWAITING_PAYMENT');
    else if(ordStatusFilter==='CANCELLED')list=list.filter(b=>b.status==='CANCELLED');
    if(searchOrders){
      const q=searchOrders.toLowerCase();
      list=list.filter(b=>b.clientName.toLowerCase().includes(q)||b.clientEmail.toLowerCase().includes(q)||String(b.id).slice(0,8).toUpperCase().includes(q.toUpperCase())||String(b.mp_payment_id||'').includes(q));
    }
    if(ordSort==='date_desc')list=[...list].sort((a,b)=>new Date(b.confirmed_at||b.created_at||b.orderCreatedAt)-new Date(a.confirmed_at||a.created_at||a.orderCreatedAt));
    else if(ordSort==='date_asc')list=[...list].sort((a,b)=>new Date(a.confirmed_at||a.created_at||a.orderCreatedAt)-new Date(b.confirmed_at||b.created_at||b.orderCreatedAt));
    else if(ordSort==='value_desc')list=[...list].sort((a,b)=>Number(b.total_locked||0)-Number(a.total_locked||0));
    else if(ordSort==='value_asc')list=[...list].sort((a,b)=>Number(a.total_locked||0)-Number(b.total_locked||0));
    return list;
  },[allBatches,ordStatusFilter,searchOrders,ordSort]);

  async function loadFinalList(){
    setListLoading(true);
    try{
      const paidBatchIds=[];const batchMeta={};
      orders.forEach(o=>{(o.order_batches||[]).forEach(b=>{
        if(b.status==='PAID'||b.status==='PAID_CONFIRMED'){paidBatchIds.push(b.id);batchMeta[b.id]={userName:o.profiles?.name||'—',date:b.confirmed_at||b.created_at||o.created_at};}
      });});
      if(paidBatchIds.length===0){setFinalList([]);setListLoading(false);return;}
      const r=await fetch('/api/admin-batch-items',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({batchIds:paidBatchIds})});
      const json=await r.json().catch(()=>({}));
      if(!r.ok||!json.ok)throw new Error(json.error||`HTTP ${r.status}`);
      const list=(json.items||[]).map(i=>{const m=batchMeta[i.batch_id]||{};return{name:i.cards?.name||'Carta',type:i.cards?.type||'',qty:Number(i.quantity||1),userName:m.userName||'—',date:m.date||''};});
      list.sort((a,b)=>new Date(a.date)-new Date(b.date));
      setFinalList(list);
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao gerar lista: '+(e.message||String(e)),'error');}
    setListLoading(false);
  }

  function copyFinalList(){
    const text=finalList.map(c=>`${c.qty}x ${c.name}${c.type?' ('+c.type+')':''}`).join('\n');
    navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),2000);SFX.success();
  }

  async function saveTiers(){
    setSaving(true);
    try{
      const campId=selectedCampaign?.id||campProp?.id;
      if(!campId){if(toastFn)toastFn('Nenhuma campanha selecionada','error');setSaving(false);return;}
      const payload=editTiers.map((t,i)=>{
        const add=tierAdditional[t.id]||0;
        const finalBrl=calcBrlPrice(t.usd,editPricing)+add;
        const newUsd=add?calcUsdFromBrl(finalBrl,editPricing):t.usd;
        const tier={usd_per_card:newUsd,label:t.label,min_qty:t.min,max_qty:t.max>999999?null:t.max,quest_text:t.quest,rank:i+1};
        if(t._isNew)tier.campaign_id=campId; else tier.id=t.id;
        return tier;
      });
      // IDs originais que foram removidos
      const originalIds=(tiersProp||[]).map(t=>t.id).filter(Boolean);
      const currentIds=editTiers.filter(t=>!t._isNew).map(t=>t.id).filter(Boolean);
      const deletedIds=originalIds.filter(id=>!currentIds.includes(id));
      const r=await fetch('/api/admin-save-tiers',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({tiers:payload,deletedIds,campaign_id:campId})});
      const json=await r.json().catch(()=>({}));
      if(!r.ok||!json.ok)throw new Error(json.error||`HTTP ${r.status}`);
      setTierAdditional({});SFX.success();if(onReload)onReload();
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao salvar tiers: '+(e.message||String(e)),'error');}
    setSaving(false);
  }

  async function savePricing(){
    setSaving(true);
    try{
      const{id,...rest}=editPricing;delete rest.is_active;delete rest.created_at;delete rest.updated_at;
      const r=await fetch('/api/admin-save-pricing',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({id,...rest})});
      const json=await r.json().catch(()=>({}));
      if(!r.ok||!json.ok)throw new Error(json.error||`HTTP ${r.status}`);
      SFX.success();if(onReload)onReload();
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao salvar taxas: '+(e.message||String(e)),'error');}
    setSaving(false);
  }

  async function archiveCampaign(){
    setArchiving(true);
    try{
      const r=await fetch('/api/archive-campaign',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({campaignId:selectedCampaign.id})});
      const d=await r.json().catch(()=>({}));
      if(!d.ok)throw new Error(d.error||`HTTP ${r.status}`);
      SFX.success();setSelectedCampaign(null);setShowArchiveConfirm(false);loadCampaigns();if(onReload)onReload();
    }catch(e){if(toastFn)toastFn('Erro ao arquivar: '+(e.message||String(e)),'error');}
    setArchiving(false);
  }

  async function createCampaign(){
    if(!newCamp.name.trim()){if(toastFn)toastFn('Nome obrigatório','error');return;}
    setCreating(true);
    try{
      const r=await fetch('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:newCamp.name,status:newCamp.status,close_at:newCamp.close_at||null,max_cards:newCamp.max_cards||null,min_cards:newCamp.min_cards||150})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
      SFX.success();setShowCreateForm(false);setNewCamp({name:'',status:'DRAFT',close_at:'',max_cards:1000});if(Array.isArray(d)&&d[0])setSelectedCampaign(d[0]);loadCampaigns();if(onReload)onReload();
    }catch(e){if(toastFn)toastFn('Erro ao criar: '+(e.message||String(e)),'error');}
    setCreating(false);
  }

  async function saveCampaign(){
    setSaving(true);
    try{
      const r=await fetch('/api/campaigns',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:editCamp.id,name:editCamp.name,status:editCamp.status,close_at:editCamp.close_at||null,max_cards:editCamp.max_cards||null,min_cards:editCamp.min_cards||150})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
      SFX.success();setSelectedCampaign(prev=>({...prev,...editCamp}));if(onReload)onReload();loadCampaigns();
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao salvar campanha: '+(e.message||String(e)),'error');}
    setSaving(false);
  }

  async function deleteCampaign(){
    if(!confirm('Excluir esta encomenda finalizada? Todos os dados serão perdidos.'))return;
    try{
      const r=await fetch('/api/campaigns',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:selectedCampaign.id})});
      const data=await r.json();
      if(data.success){SFX.success();setSelectedCampaign(null);loadCampaigns();if(onReload)onReload();}
    }catch(e){console.error(e);}
  }

  const minCards=selectedCampaign?.min_cards||150;
  const isViableAdmin=pool>=minCards;
  const isFinalized=selectedCampaign?.status==='DONE'||selectedCampaign?.status==='CANCELLED';
  const activeCampaigns=campaigns.filter(c=>c.status!=='DONE'&&c.status!=='CANCELLED');
  const finalizedCampaigns=campaigns.filter(c=>c.status==='DONE'||c.status==='CANCELLED');
  const adminTabs=[{key:'orders',icon:Package,label:'Pedidos'},{key:'clients',icon:User,label:'Clientes'},{key:'list',icon:ScrollText,label:'Lista Final'},{key:'config',icon:Settings,label:'Configurações'}];

  if(!selectedCampaign)return(<div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}><Shield size={18} style={{color:theme.primary}}/><span style={{fontFamily:"'Cinzel',serif",fontSize:18,fontWeight:700}}>Admin</span></div>
      <Btn variant="ghost" onClick={()=>nav('profile')} style={{padding:'6px 10px',fontSize:12}} sfx="nav"><ChevronLeft size={14}/></Btn>
    </div>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
      <SectionTitle sub="Selecione uma encomenda para gerenciar">Encomendas</SectionTitle>
      <button onClick={()=>setShowCreateForm(v=>!v)} style={{width:32,height:32,borderRadius:10,border:'1px solid '+theme.primary+'30',background:theme.primary+'15',color:theme.primary,fontSize:20,display:'grid',placeItems:'center',cursor:'pointer'}}>{showCreateForm?'×':'+'}</button>
    </div>
    {showCreateForm&&<Card style={{padding:16}}>
      <SectionTitle sub="Preencha os dados da nova encomenda">Nova Encomenda</SectionTitle>
      <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:8}}>
        <div><label style={{fontSize:11,color:'rgba(255,255,255,0.3)',display:'block',marginBottom:3}}>Nome</label><input value={newCamp.name} onChange={e=>setNewCamp(c=>({...c,name:e.target.value}))} placeholder="Ex: Encomenda Abril 26" style={{width:'100%',padding:'10px 12px',borderRadius:12,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(0,0,0,0.3)',color:'#fff',fontSize:14,fontFamily:"'Outfit',sans-serif",outline:'none',boxSizing:'border-box'}}/></div>
        <div><label style={{fontSize:11,color:'rgba(255,255,255,0.3)',display:'block',marginBottom:3}}>Status inicial</label><div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{CAMPAIGN_STATUSES.map(s=>(<button key={s} onClick={()=>setNewCamp(c=>({...c,status:s}))} style={{padding:'5px 10px',borderRadius:8,border:'1px solid '+(newCamp.status===s?theme.primary+'30':'rgba(255,255,255,0.06)'),background:newCamp.status===s?theme.primary+'15':'rgba(255,255,255,0.02)',color:newCamp.status===s?theme.primary:'rgba(255,255,255,0.3)',fontSize:10,fontWeight:600,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>{s}</button>))}</div></div>
        <div><label style={{fontSize:11,color:'rgba(255,255,255,0.3)',display:'block',marginBottom:3}}>Data prevista de fechamento</label><input type="date" value={newCamp.close_at} onChange={e=>setNewCamp(c=>({...c,close_at:e.target.value}))} style={{width:'100%',padding:'10px 12px',borderRadius:12,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(0,0,0,0.3)',color:'#fff',fontSize:14,fontFamily:"'Outfit',sans-serif",outline:'none',boxSizing:'border-box'}}/><div style={{fontSize:10,color:'rgba(255,255,255,0.2)',marginTop:2}}>Não é encerramento automático. A encomenda só fecha quando a meta mínima for atingida.</div></div>
        <div><label style={{fontSize:11,color:'rgba(255,255,255,0.3)',display:'block',marginBottom:3}}>Meta mínima de cartas pagas</label><input type="number" value={newCamp.min_cards} onChange={e=>setNewCamp(c=>({...c,min_cards:parseInt(e.target.value)||150}))} style={{width:'100%',padding:'10px 12px',borderRadius:12,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(0,0,0,0.3)',color:'#fff',fontSize:14,fontFamily:"'Outfit',sans-serif",outline:'none',boxSizing:'border-box'}}/><div style={{fontSize:10,color:'rgba(255,255,255,0.2)',marginTop:2}}>Mínimo de cartas para a encomenda ser confirmada (padrão: 150).</div></div>
        <Btn full variant="success" onClick={createCampaign} disabled={creating} sfx="">{creating?<Spin size={14}/>:<><Check size={14}/> Criar encomenda</>}</Btn>
      </div>
    </Card>}
    {loading&&<div style={{textAlign:'center',padding:30}}><Spin size={24}/></div>}
    {activeCampaigns.length>0&&<><div style={{fontSize:12,fontWeight:700,color:theme.primary,marginBottom:4}}>Ativas</div>
      {activeCampaigns.map(c=>(<Card key={c.id} onClick={()=>setSelectedCampaign(c)} style={{padding:'12px 16px',cursor:'pointer',marginBottom:4}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div><div style={{fontWeight:700,fontSize:14}}>{c.name}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.3)'}}>{new Date(c.created_at).toLocaleDateString('pt-BR')}</div></div>
          <Tag color="#2ee59d" style={{fontSize:10}}>{c.status}</Tag>
        </div>
      </Card>))}</>}
    {finalizedCampaigns.length>0&&<><div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.3)',marginTop:8,marginBottom:4}}>Finalizadas</div>
      {finalizedCampaigns.map(c=>(<Card key={c.id} onClick={()=>setSelectedCampaign(c)} style={{padding:'12px 16px',cursor:'pointer',marginBottom:4,opacity:0.6}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div><div style={{fontWeight:700,fontSize:14}}>{c.name}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.3)'}}>{new Date(c.created_at).toLocaleDateString('pt-BR')}</div></div>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <Tag color="rgba(255,255,255,0.3)" style={{fontSize:10}}>{c.status}</Tag>
            <button onClick={async(e)=>{e.stopPropagation();if(!confirm(`Excluir "${c.name}"? Todos os dados serão perdidos.`))return;try{const r=await fetch('/api/campaigns',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:c.id})});const d=await r.json();if(d.success){SFX.success();loadCampaigns();if(onReload)onReload();}}catch(err){console.error(err);}}} style={{background:'rgba(217,68,82,0.1)',border:'1px solid rgba(217,68,82,0.15)',borderRadius:8,padding:'5px 7px',cursor:'pointer',color:'#ff6b7a',display:'grid',placeItems:'center',flexShrink:0}}><Trash2 size={13}/></button>
          </div>
        </div>
      </Card>))}</>}
    {campaigns.length===0&&!loading&&<EmptyState icon={Calendar} title="Nenhuma encomenda" sub=""/>}
  </div>);

  return(<div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <button onClick={()=>setSelectedCampaign(null)} style={{background:'none',border:'none',color:'#fff',cursor:'pointer',padding:2}}><ChevronLeft size={18}/></button>
        <Shield size={18} style={{color:theme.primary}}/>
        <span style={{fontFamily:"'Cinzel',serif",fontSize:16,fontWeight:700}}>{selectedCampaign.name}</span>
      </div>
      <Tag color={isFinalized?'rgba(255,255,255,0.3)':'#2ee59d'} style={{fontSize:10}}>{selectedCampaign.status}</Tag>
    </div>
    <Card style={{padding:12}}>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:8}}>
        <div><span style={{color:'rgba(255,255,255,0.3)'}}>Cartas pagas</span> <b style={{color:isViableAdmin?'#2ee59d':theme.primary}}>{pool||0}</b><span style={{color:'rgba(255,255,255,0.2)',fontSize:10}}> / {minCards}</span></div>
        <div><span style={{color:'rgba(255,255,255,0.3)'}}>Clientes</span> <b style={{color:theme.primary}}>{clientGroups.length}</b></div>
        <div>{isViableAdmin?<Tag color="#2ee59d" style={{fontSize:9}}>Meta atingida</Tag>:<Tag color="#c9a96e" style={{fontSize:9}}>Faltam {minCards-(pool||0)}</Tag>}</div>
      </div>
      <div style={{background:'rgba(0,0,0,0.3)',borderRadius:99,height:4,overflow:'hidden'}}>
        <div style={{width:Math.min(100,(pool||0)/minCards*100)+'%',height:'100%',borderRadius:99,background:isViableAdmin?'linear-gradient(90deg,#2ee59d,#00d4a0)':'linear-gradient(90deg,'+theme.primary+','+theme.secondary+')',transition:'width .5s'}}/>
      </div>
    </Card>

    <div style={{display:'flex',gap:3}}>{adminTabs.map(t=>(<button key={t.key} onClick={()=>{SFX.toggle();setTab(t.key);}} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:3,padding:'7px 0',borderRadius:10,border:'none',background:tab===t.key?theme.primary+'15':'rgba(255,255,255,0.025)',color:tab===t.key?theme.primary:'rgba(255,255,255,0.3)',fontWeight:600,fontSize:11,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}><t.icon size={13}/>{t.label}</button>))}</div>

    {tab==='orders'&&<>
      {/* Stats Dashboard */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
        <Card style={{padding:'10px 14px'}}><div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>Pedidos Pagos</div><div style={{fontSize:20,fontWeight:800,color:'#2ee59d'}}>{ordStats.paidCount}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>{ordStats.totalCards} cartas</div></Card>
        <Card style={{padding:'10px 14px'}}><div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>Receita</div><div style={{fontSize:20,fontWeight:800,color:theme.primary}}>R$ {ordStats.totalRevenue.toFixed(0)}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>confirmado</div></Card>
        <Card style={{padding:'10px 14px'}}><div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>Pendentes</div><div style={{fontSize:20,fontWeight:800,color:'#c9a96e'}}>{ordStats.pendingCount}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>R$ {ordStats.pendingRevenue.toFixed(0)}</div></Card>
        <Card style={{padding:'10px 14px'}}><div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>Total / Cancelados</div><div style={{fontSize:20,fontWeight:800,color:'rgba(255,255,255,0.5)'}}>{ordStats.total}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>{ordStats.cancelledCount} cancelados</div></Card>
      </div>

      {/* Status Filter Pills */}
      <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
        {[{key:'ALL',label:'Todos',color:'rgba(255,255,255,0.4)',count:ordStats.total},{key:'PAID',label:'Pagos',color:'#2ee59d',count:ordStats.paidCount},{key:'AWAITING_PAYMENT',label:'Pendentes',color:'#c9a96e',count:ordStats.pendingCount},{key:'CANCELLED',label:'Cancelados',color:'#ff6b7a',count:ordStats.cancelledCount}].map(f=>(
          <button key={f.key} onClick={()=>{SFX.toggle();setOrdStatusFilter(f.key);}} style={{display:'flex',alignItems:'center',gap:4,padding:'5px 10px',borderRadius:99,border:'1px solid '+(ordStatusFilter===f.key?f.color+'40':'rgba(255,255,255,0.06)'),background:ordStatusFilter===f.key?f.color+'15':'rgba(255,255,255,0.02)',color:ordStatusFilter===f.key?f.color:'rgba(255,255,255,0.3)',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>{f.label} <span style={{fontSize:9,opacity:.7}}>({f.count})</span></button>
        ))}
      </div>

      {/* Search & Sort */}
      <div style={{display:'flex',gap:6,alignItems:'center'}}>
        <div style={{flex:1}}><Input icon={Search} placeholder="Buscar pedido, cliente, código MP..." value={searchOrders} onChange={e=>setSearchOrders(e.target.value)}/></div>
        <select value={ordSort} onChange={e=>{setOrdSort(e.target.value);}} style={{padding:'10px 8px',borderRadius:12,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(0,0,0,0.3)',color:'#fff',fontSize:11,fontFamily:"'Outfit',sans-serif",outline:'none',cursor:'pointer'}}>
          <option value="date_desc">Mais recente</option>
          <option value="date_asc">Mais antigo</option>
          <option value="value_desc">Maior valor</option>
          <option value="value_asc">Menor valor</option>
        </select>
      </div>

      {/* Orders List */}
      {ordersLoading?<div style={{textAlign:'center',padding:30}}><Spin size={24}/></div>:
      filteredBatches.length===0?<EmptyState icon={Package} title="Nenhum pedido" sub={searchOrders||ordStatusFilter!=='ALL'?'Tente outro filtro':'Nenhum pedido nesta campanha'}/>:
      filteredBatches.map(b=>{
        const isExp=expandedOrdBatch===b.id;
        const isPaid=b.status==='PAID'||b.status==='PAID_CONFIRMED';
        const isCancelled=b.status==='CANCELLED';
        const isDraft=b.status==='DRAFT'||b.status==='AWAITING_PAYMENT'||b.status==='AWAITING_PAYMENT';
        const sid=String(b.id).slice(0,8).toUpperCase();
        const ship=Number(b.shipping_locked||0);
        const valNoShip=b.subtotal_locked?Number(b.subtotal_locked):Number(b.total_locked||0)-ship;
        const total=Number(b.total_locked||0);
        const batchDate=b.confirmed_at||b.created_at||b.orderCreatedAt;
        const statusColor=isPaid?'#2ee59d':isCancelled?'#ff6b7a':'#c9a96e';
        const statusLabel=isPaid?'Pago':isCancelled?'Cancelado':'Pendente';
        const mpCode=b.mp_payment_id||b.mp_preference_id||'';

        return(<Card key={b.id} style={{padding:0,marginBottom:4,borderLeft:'3px solid '+statusColor+'40'}}>
          <div onClick={async()=>{const next=isExp?null:b.id;setExpandedOrdBatch(next);if(next)await loadBatchCards(b.id);}} style={{padding:'10px 14px',cursor:'pointer'}}>
            {/* Row 1: ID + Client + Status */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12,fontWeight:800,fontFamily:'monospace',color:'rgba(255,255,255,0.6)'}}>#{sid}</span>
                <span style={{fontSize:13,fontWeight:700}}>{b.clientName}</span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <Tag color={statusColor} style={{fontSize:9,padding:'3px 8px'}}>{statusLabel}</Tag>
                <ChevronRight size={12} style={{color:'rgba(255,255,255,0.15)',transform:isExp?'rotate(90deg)':'none',transition:'transform .2s'}}/>
              </div>
            </div>
            {/* Row 2: Details */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,fontSize:11,color:'rgba(255,255,255,0.3)'}}>
                <span>{b.qty_in_batch} cartas</span>
                <span>•</span>
                <span>{new Date(batchDate).toLocaleDateString('pt-BR')}</span>
                {b.payment_method&&<><span>•</span><span>{b.payment_method==='MERCADO_PAGO'?'MP':'Outro'}</span></>}
              </div>
              <span style={{fontSize:13,fontWeight:800,color:isPaid?'#2ee59d':'rgba(255,255,255,0.6)'}}>R$ {total.toFixed(2)}</span>
            </div>
          </div>

          {/* Expanded Detail */}
          {isExp&&<div style={{borderTop:'1px solid rgba(255,255,255,0.04)',padding:'12px 14px'}}>
            {/* Payment Info */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
              <div style={{padding:'8px 10px',borderRadius:10,background:'rgba(0,0,0,0.2)'}}><div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:2}}>Subtotal</div><div style={{fontSize:13,fontWeight:700}}>R$ {valNoShip.toFixed(2)}</div></div>
              <div style={{padding:'8px 10px',borderRadius:10,background:'rgba(0,0,0,0.2)'}}><div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:2}}>Frete</div><div style={{fontSize:13,fontWeight:700}}>R$ {ship.toFixed(2)}</div></div>
              <div style={{padding:'8px 10px',borderRadius:10,background:'rgba(0,0,0,0.2)'}}><div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:2}}>Total</div><div style={{fontSize:13,fontWeight:800,color:theme.primary}}>R$ {total.toFixed(2)}</div></div>
              <div style={{padding:'8px 10px',borderRadius:10,background:'rgba(0,0,0,0.2)'}}><div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:2}}>Método</div><div style={{fontSize:13,fontWeight:700}}>{b.payment_method==='MERCADO_PAGO'?'Mercado Pago':b.payment_method||'—'}</div></div>
            </div>

            {/* MP Code */}
            {mpCode&&<div style={{padding:'6px 10px',borderRadius:8,background:'rgba(0,0,0,0.15)',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontSize:9,color:'rgba(255,255,255,0.25)'}}>Código MP</div><div style={{fontSize:11,fontFamily:'monospace',color:'rgba(255,255,255,0.5)'}}>{mpCode}</div></div>
              <button onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(mpCode);SFX.success();}} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:6,padding:'3px 6px',color:'rgba(255,255,255,0.4)',fontSize:10,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}><Copy size={10}/></button>
            </div>}

            {/* Client Contact */}
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10,flexWrap:'wrap'}}>
              {b.clientEmail&&<span style={{fontSize:11,color:'rgba(255,255,255,0.3)',display:'flex',alignItems:'center',gap:3}}><Mail size={10}/>{b.clientEmail}</span>}
              {b.clientWhatsapp&&<a href={'https://wa.me/55'+b.clientWhatsapp} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:'#25d366',textDecoration:'none',display:'flex',alignItems:'center',gap:3}}><MessageCircle size={10}/> WhatsApp</a>}
            </div>

            {/* Card Items */}
            <div style={{marginBottom:10}}>
              <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.3)',marginBottom:4}}>Itens do pedido</div>
              {(batchCards[b.id]||[]).length>0?batchCards[b.id].map((c,ci)=>(
                <div key={ci} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:12,borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                  <span style={{color:'rgba(255,255,255,0.5)'}}>{c.name} <span style={{color:TC[c.type]||'rgba(255,255,255,0.3)',fontSize:10,fontWeight:700}}>{c.type||''}</span></span>
                  <span style={{fontWeight:700}}>x{c.qty}</span>
                </div>
              )):<div style={{fontSize:11,color:'rgba(255,255,255,0.2)'}}>Carregando itens...</div>}
            </div>

            {/* Actions */}
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {isDraft&&<Btn variant="success" onClick={e=>{e.stopPropagation();markBatchPaid(b.id);}} style={{padding:'6px 12px',fontSize:11}} sfx=""><CheckCircle size={12}/> Marcar Pago</Btn>}
              {b.payment_method==='MERCADO_PAGO'&&!isCancelled&&<Btn variant="secondary" onClick={e=>{e.stopPropagation();syncBatchMP(b.id);}} style={{padding:'6px 12px',fontSize:11}} sfx=""><RefreshCw size={12}/> Sync MP</Btn>}
              {!isCancelled&&<Btn variant="danger" onClick={e=>{e.stopPropagation();cancelBatch(b.id,isPaid);}} style={{padding:'6px 12px',fontSize:11}} sfx=""><X size={12}/> {isPaid?'Cancelar (reembolso manual)':'Cancelar'}</Btn>}
            </div>
          </div>}
        </Card>);
      })}
    </>}

    {tab==='clients'&&<>
      <Input icon={Search} placeholder="Buscar por nome, email ou pedido..." value={searchOrd} onChange={e=>setSearchOrd(e.target.value)}/>
      <div style={{display:'flex',gap:6,marginBottom:4}}>
        <button onClick={()=>setClientActiveFilter(false)} style={{padding:'5px 12px',borderRadius:8,border:'none',background:!clientActiveFilter?theme.primary+'20':'rgba(255,255,255,0.04)',color:!clientActiveFilter?theme.primary:'rgba(255,255,255,0.35)',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>Todos ({clientGroups.length})</button>
        <button onClick={()=>setClientActiveFilter(true)} style={{padding:'5px 12px',borderRadius:8,border:'none',background:clientActiveFilter?'rgba(46,229,157,0.15)':'rgba(255,255,255,0.04)',color:clientActiveFilter?'#2ee59d':'rgba(255,255,255,0.35)',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>Ativos ({clientGroups.filter(c=>c.hasActiveOrder).length})</button>
      </div>
      {ordersLoading?<div style={{textAlign:'center',padding:30}}><Spin size={24}/></div>:
      filteredClients.length===0?<EmptyState icon={User} title="Nenhum cliente" sub={searchOrd||clientActiveFilter?'Tente outro filtro':''}/>:
      filteredClients.map(client=>{const isClientExp=expandedClient===client.userId;const clientBonus=adminBonusGrants.filter(g=>g.user_id===client.userId&&g.status==='AVAILABLE').reduce((s,g)=>s+g.bonus_qty,0);return(
        <Card key={client.userId} style={{padding:0,marginBottom:4}}>
          <div onClick={()=>{setExpandedClient(isClientExp?null:client.userId);if(!isClientExp&&adminBonusGrants.length===0)loadBonusGrants();}} style={{padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              {client.hasActiveOrder&&<span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:'#2ee59d',boxShadow:'0 0 6px #2ee59d80',flexShrink:0}}/>}
              <div><div style={{fontSize:13,fontWeight:700}}>{client.name}</div>{client.whatsapp&&<div style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>{client.whatsapp}</div>}</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              {clientBonus>0&&<Tag color="#2ee59d" style={{fontSize:9}}><Gift size={9}/> {clientBonus}</Tag>}
              {client.hasOrder?<Tag style={{fontSize:9}}>{client.totalCards} cartas</Tag>:<Tag color="rgba(255,255,255,0.15)" style={{fontSize:9,color:'rgba(255,255,255,0.3)'}}>sem pedido</Tag>}
              <ChevronRight size={12} style={{color:'rgba(255,255,255,0.15)',transform:isClientExp?'rotate(90deg)':'none',transition:'transform .2s'}}/>
            </div>
          </div>
          {isClientExp&&<div style={{borderTop:'1px solid rgba(255,255,255,0.04)'}}>
            {client.email&&<div style={{padding:'6px 14px 0',fontSize:11,color:'rgba(255,255,255,0.3)'}}>{client.email}</div>}
            {client.orders.map(o=>(o.order_batches||[]).map(b=>{
              const batchExp=expandedBatch===b.id;const isPaid=b.status==='PAID'||b.status==='PAID_CONFIRMED';
              const sid=String(b.id).slice(0,8).toUpperCase();
              const mpCode=b.mp_payment_id||b.mp_preference_id||'—';
              const ship=Number(b.shipping_locked||0);
              const valNoShip=b.subtotal_locked?Number(b.subtotal_locked):Number(b.total_locked||0)-ship;
              return(<div key={b.id} style={{padding:'8px 14px',borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                <div onClick={async()=>{const next=batchExp?null:b.id;setExpandedBatch(next);if(next)await loadBatchCards(b.id);}} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
                  <div><span style={{fontSize:12,fontWeight:700,fontFamily:'monospace'}}>#{sid}</span><span style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginLeft:6}}>{b.qty_in_batch} cartas | {new Date(b.confirmed_at||b.created_at||o.created_at).toLocaleDateString('pt-BR')}</span></div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:12,fontWeight:700}}>R$ {valNoShip.toFixed(2)}</span>
                    <Tag color={isPaid?'#2ee59d':'#c9a96e'} style={{fontSize:9}}>{isPaid?'Pago':'Pendente'}</Tag>
                  </div>
                </div>
                {batchExp&&<div style={{marginTop:8,padding:'8px 0'}}>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginBottom:4}}>Código MP: <span style={{fontFamily:'monospace',color:'rgba(255,255,255,0.5)'}}>{mpCode}</span></div>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:8}}>Valor (sem frete): R$ {valNoShip.toFixed(2)}{ship>0&&<span> | Frete: R$ {ship.toFixed(2)}</span>}</div>
                  <div style={{marginBottom:8}}>{(batchCards[b.id]||[]).length>0?batchCards[b.id].map((c,ci)=>(
                    <div key={ci} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:12,borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                      <span style={{color:'rgba(255,255,255,0.5)'}}>{c.name} <span style={{color:TC[c.type]||'rgba(255,255,255,0.3)',fontSize:10,fontWeight:700}}>{c.type||''}</span></span>
                      <span style={{fontWeight:700}}>x{c.qty}</span>
                    </div>
                  )):<div style={{fontSize:11,color:'rgba(255,255,255,0.2)'}}>Carregando itens...</div>}</div>
                  <Btn variant="danger" onClick={e=>{e.stopPropagation();cancelBatch(b.id,isPaid);}} style={{padding:'5px 10px',fontSize:10}} sfx=""><X size={11}/> {isPaid?'Cancelar (reembolso manual MP)':'Cancelar pedido'}</Btn>
                </div>}
              </div>);
            }))}
            {client.whatsapp&&<a href={'https://wa.me/55'+client.whatsapp} target="_blank" rel="noopener noreferrer" style={{display:'inline-flex',alignItems:'center',gap:4,margin:'6px 14px 10px',fontSize:11,color:'#25d366',textDecoration:'none'}}><MessageCircle size={12}/> WhatsApp</a>}
            <div style={{padding:'8px 14px',borderTop:'1px solid rgba(255,255,255,0.04)'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                <span style={{fontSize:11,fontWeight:700,color:'#2ee59d'}}><Gift size={11}/> Bônus</span>
                {clientBonus>0&&<Tag color="#2ee59d" style={{fontSize:9}}>{clientBonus} disponível</Tag>}
              </div>
              {adminBonusGrants.filter(g=>g.user_id===client.userId).map(g=>(
                <div key={g.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'3px 0',fontSize:11,borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                  <span style={{color:g.status==='AVAILABLE'?'#2ee59d':g.status==='CONSUMED'?'rgba(255,255,255,0.3)':'rgba(255,255,255,0.15)'}}>{g.bonus_qty} carta(s) — {g.status==='AVAILABLE'?'Disponível':g.status==='CONSUMED'?'Usado':'Expirado'}</span>
                  {g.status==='AVAILABLE'&&<button onClick={()=>revokeBonus(g.id)} style={{background:'none',border:'none',color:'#ff6b6b',fontSize:10,cursor:'pointer',padding:'2px 4px'}}>Revogar</button>}
                </div>
              ))}
              {bonusForm.userId===client.userId?<div style={{display:'flex',gap:4,marginTop:6}}>
                <input type="number" min="1" value={bonusForm.qty} onChange={e=>setBonusForm(f=>({...f,qty:Math.max(1,parseInt(e.target.value)||1)}))} style={{width:50,padding:'4px 6px',borderRadius:6,border:'1px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'#fff',fontSize:11,textAlign:'center'}}/>
                <Btn variant="success" onClick={()=>grantBonus(client.userId,bonusForm.qty)} style={{padding:'4px 10px',fontSize:10}} sfx=""><Gift size={10}/> Conceder</Btn>
                <button onClick={()=>setBonusForm({userId:null,qty:1})} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',fontSize:10,cursor:'pointer'}}>Cancelar</button>
              </div>:<Btn variant="secondary" onClick={()=>{setBonusForm({userId:client.userId,qty:1});if(adminBonusGrants.length===0)loadBonusGrants();}} style={{padding:'4px 10px',fontSize:10,marginTop:4}} sfx=""><Gift size={10}/> Dar bônus</Btn>}
            </div>
          </div>}
        </Card>);})}
    </>}

    {tab==='list'&&<Card style={{padding:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
        <SectionTitle sub="Todas as cartas dos pedidos pagos em sequência">Lista Final</SectionTitle>
        <Btn variant="secondary" onClick={loadFinalList} disabled={listLoading} style={{padding:'6px 12px',fontSize:11,flexShrink:0}} sfx="click">{listLoading?<Spin size={12}/>:<><RefreshCw size={12}/> Atualizar</>}</Btn>
      </div>
      {finalList.length>0?<>
        <div style={{fontSize:14,fontWeight:800,color:theme.primary,marginBottom:8}}>{finalList.reduce((s,c)=>s+c.qty,0)} cartas no total</div>
        <div style={{maxHeight:400,overflowY:'auto',marginBottom:10}}>{finalList.map((c,i)=>(
          <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:12,borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
            <span style={{color:'rgba(255,255,255,0.5)'}}>{c.qty}x {c.name} <span style={{color:TC[c.type]||'rgba(255,255,255,0.3)',fontSize:10,fontWeight:700}}>{c.type||''}</span></span>
            <span style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>{c.userName}</span>
          </div>
        ))}</div>
        <Btn full variant="success" onClick={copyFinalList} sfx="">{copied?<><Check size={14}/> Copiado!</>:<><Copy size={14}/> Copiar lista</>}</Btn>
      </>:<div style={{fontSize:12,color:'rgba(255,255,255,0.2)',textAlign:'center',padding:20}}>{listLoading?<Spin size={20}/>:'Clique em "Atualizar" para gerar a lista'}</div>}
    </Card>}

    {tab==='config'&&<>
      {/* Preços por Tipo de Carta — nova lógica simplificada */}
      <Card style={{padding:16}}>
        <SectionTitle sub="Preço fixo em R$ por tipo de carta">Preços por Tipo de Carta</SectionTitle>
        <div style={{fontSize:12,color:'rgba(255,255,255,0.3)',marginBottom:12,lineHeight:1.5}}>Estes são os preços que o cliente paga por carta, dependendo do tipo. Mínimo de {MIN_ORDER_CARDS} cartas por pedido.</div>
        {[
          {k:'normal_price_brl',l:'Carta Normal',desc:'Cartas comuns, não-foil',color:'rgba(255,255,255,0.6)',def:16},
          {k:'ouro_price_brl',l:'Carta Ouro / Holo',desc:'Cartas especiais (Holo)',color:'#c9a96e',def:16},
          {k:'foil_price_brl',l:'Carta Foil',desc:'Cartas foil de qualquer tipo',color:'#d94452',def:18},
        ].map(({k,l,desc,color,def})=>(<div key={k} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
          <div><div style={{fontSize:13,fontWeight:600,color}}>{l}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>{desc}</div></div>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:11,color:'rgba(255,255,255,0.3)'}}>R$</span>
            <input type="number" step="0.50" min="0" value={editPricing[k]??def} onChange={e=>setEditPricing(p=>({...p,[k]:parseFloat(e.target.value)||0}))} style={{width:70,padding:'7px 8px',borderRadius:8,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(0,0,0,0.3)',color:'#fff',fontSize:14,fontWeight:800,fontFamily:"'Outfit',sans-serif",textAlign:'right',outline:'none'}}/>
          </div>
        </div>))}
        <Btn full variant="success" onClick={savePricing} disabled={saving} style={{marginTop:12}} sfx="">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar preços</>}</Btn>
      </Card>

      {/* Configuração da encomenda ativa */}
      {selectedCampaign&&!isFinalized&&<Card style={{padding:16}}>
        <SectionTitle sub="Parâmetros da encomenda selecionada">Configuração da Encomenda</SectionTitle>
        {[
          {k:'name',l:'Nome',t:'text'},
          {k:'close_at',l:'Data prevista de fechamento',t:'date'},
          {k:'min_cards',l:'Meta mínima (cartas pagas)',t:'number'},
          {k:'max_cards',l:'Limite máximo (cartas)',t:'number'},
        ].map(({k,l,t})=>(<div key={k} style={{marginBottom:10}}>
          <label style={{fontSize:11,color:'rgba(255,255,255,0.3)',display:'block',marginBottom:3}}>{l}</label>
          <input type={t} value={k==='close_at'?(editCamp[k]?String(editCamp[k]).slice(0,10):''):(editCamp[k]||'')} onChange={e=>setEditCamp(c=>({...c,[k]:t==='number'?parseInt(e.target.value)||0:e.target.value}))} style={{width:'100%',padding:'9px 12px',borderRadius:10,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(0,0,0,0.3)',color:'#fff',fontSize:13,fontFamily:"'Outfit',sans-serif",outline:'none',boxSizing:'border-box'}}/>
          {k==='close_at'&&<div style={{fontSize:10,color:'rgba(255,255,255,0.2)',marginTop:3}}>Data prevista de fechamento. Não é encerramento automático — a encomenda só fecha quando a meta for atingida.</div>}
          {k==='min_cards'&&<div style={{fontSize:10,color:'rgba(255,255,255,0.2)',marginTop:3}}>Mínimo de cartas pagas para a encomenda ser confirmada.</div>}
        </div>))}
        <div style={{marginBottom:10}}>
          <label style={{fontSize:11,color:'rgba(255,255,255,0.3)',display:'block',marginBottom:3}}>Status</label>
          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{CAMPAIGN_STATUSES.map(s=>(<button key={s} onClick={()=>setEditCamp(c=>({...c,status:s}))} style={{padding:'5px 10px',borderRadius:8,border:'1px solid '+(editCamp.status===s?theme.primary+'30':'rgba(255,255,255,0.06)'),background:editCamp.status===s?theme.primary+'15':'rgba(255,255,255,0.02)',color:editCamp.status===s?theme.primary:'rgba(255,255,255,0.3)',fontSize:10,fontWeight:600,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>{s}</button>))}</div>
        </div>
        <Btn full variant="success" onClick={saveCampaign} disabled={saving} sfx="">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar encomenda</>}</Btn>
      </Card>}

      {/* Arquivar / excluir */}
      {selectedCampaign&&<>
        {!isFinalized&&<Card style={{padding:16,marginTop:4}}>
          <SectionTitle sub="Finaliza a encomenda e arquiva">Finalizar Encomenda</SectionTitle>
          {!showArchiveConfirm?<Btn full variant="danger" onClick={()=>setShowArchiveConfirm(true)} sfx=""><Archive size={14}/> Arquivar encomenda</Btn>:<>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.55)',marginBottom:12,lineHeight:1.5}}>Isso marcará a campanha como DONE e excluirá todos os dados de pedidos e bônus. <b style={{color:'#ff6b7a'}}>Não pode ser desfeito.</b></div>
            <div style={{display:'flex',gap:8}}>
              <Btn variant="secondary" onClick={()=>setShowArchiveConfirm(false)} style={{flex:1}} sfx="">Cancelar</Btn>
              <Btn variant="danger" onClick={archiveCampaign} disabled={archiving} style={{flex:1}} sfx="">{archiving?<Spin size={14}/>:'Sim, finalizar'}</Btn>
            </div>
          </>}
        </Card>}
        {isFinalized&&<Btn full variant="danger" onClick={deleteCampaign} style={{marginTop:4}} sfx=""><Trash2 size={14}/> Excluir encomenda permanentemente</Btn>}
      </>}
    </>}
  </div>);
}

// ══════════════════════════════════════════════════════
// MAIN — Supabase state management
// ══════════════════════════════════════════════════════

export default function MagicPortal(){
  // Auth state — persist in localStorage
  const [session,setSession]=useState(()=>{try{const s=localStorage.getItem('cpj_session');return s?JSON.parse(s):null;}catch(e){return null;}});
  const [profile,setProfile]=useState(null);
  const [isNew,setIsNew]=useState(false);

  // Persist session
  useEffect(()=>{if(session)localStorage.setItem('cpj_session',JSON.stringify(session));else localStorage.removeItem('cpj_session');},[session]);

  // Auto-load on mount if session exists
  const didAutoLoad=useRef(false);
  useEffect(()=>{
    if(session&&!profile&&!didAutoLoad.current){
      didAutoLoad.current=true;
      const uid=session.user?.id||session.user_id;
      const userMeta=session.user?.user_metadata||{};
      // Seta perfil mínimo imediatamente para o UI aparecer
      setProfile({id:uid,name:userMeta.name||'',is_admin:false,whatsapp:userMeta.whatsapp||''});
      // Depois enriquece com dados do banco
      loadAppData(session.access_token,uid).catch(e=>console.warn('loadAppData error:',e));
    }
  },[session,profile]);

  // Data state
  const [campaign,setCampaign]=useState(null);
  const [pricing,setPricing]=useState(null);
  const [orderId,setOrderId]=useState(null);
  const [wants,setWants]=useState([]); // order_items with card info
  const [cartItems,setCartItems]=useState([]); // order_items with in_cart=true
  const [cartQtyByItem,setCartQtyByItem]=useState({});
  const [bonusGrants,setBonusGrants]=useState([]);
  const [lastOrder,setLastOrder]=useState(null);
  const [myOrders,setMyOrders]=useState([]);
  const [statusOverrides,setStatusOverrides]=useState({});

  // UI state
  const [page,setPage]=useState('home');
  const [showTutorial,setShowTutorial]=useState(false);
  const [tutStep,setTutStep]=useState(0);
  const [isFirstTimeTut,setIsFirstTimeTut]=useState(false);
  const [soundOn,setSoundOn]=useState(true);
  const [appLoading,setAppLoading]=useState(false);
  const [toastMsg,setToastMsg]=useState(null);
  const [recoveryToken,setRecoveryToken]=useState(null);

  // Detect password recovery token in URL hash
  useEffect(()=>{
    const hash=window.location.hash;
    if(hash&&hash.includes('type=recovery')){
      const params=new URLSearchParams(hash.replace('#',''));
      const at=params.get('access_token');
      if(at){
        setRecoveryToken(at);
        window.history.replaceState(null,'',window.location.pathname);
      }
    }
  },[]);

  // Re-load data when page is restored from back-forward cache (e.g. returning from Mercado Pago)
  useEffect(()=>{
    function onPageShow(e){
      if(e.persisted&&session?.access_token&&session?.user?.id){
        loadAppData(session.access_token,session.user.id).catch(err=>console.warn('pageshow reload:',err));
      }
    }
    window.addEventListener('pageshow',onPageShow);
    return ()=>window.removeEventListener('pageshow',onPageShow);
  },[session?.access_token,session?.user?.id]);

  const token = session?.access_token;
  const guild = profile?.guild || 'Izzet';
  const theme = GT[guild] || GT.Izzet;
  const isAdmin = profile?.is_admin || false;
  const nav = useCallback(p=>{SFX.nav();setPage(p);if(p==='profile'&&!profile&&token&&session?.user?.id){loadAppData(token,session.user.id);};},[profile,token,session]);

  // Recarrega bônus disponíveis ao entrar na home
  useEffect(()=>{
    if(page!=='home'||!token||!campaign?.id||!session?.user?.id)return;
    sbGet('bonus_grants',`user_id=eq.${session.user.id}&campaign_id=eq.${campaign.id}&status=eq.AVAILABLE`,token)
      .then(bg=>setBonusGrants(bg))
      .catch(e=>console.warn('bonus_grants refresh:',e));
  },[page]);

  function toast(msg,type='info'){setToastMsg({msg,type});setTimeout(()=>setToastMsg(null),4000);}

  const pool = Number(campaign?.pool_qty_confirmed ?? campaign?.pool_qty ?? 0);
  // Preço de carta normal (usado como referência quando não há tipo específico)
  const priceBRL = Number(pricing?.normal_price_brl) || 16;
  const bonusAvail = bonusGrants.filter(b=>b.status==='AVAILABLE').reduce((s,b)=>s+b.bonus_qty,0);

  // ─── Load data after login ─────────────────────────
  async function loadAppData(tkn, userId) {
    console.log('[loadAppData] start, tkn:', tkn?'ok':'NULL', 'userId:', userId);
    setAppLoading(true);
    try {
      // Profile
      try {
        let [prof] = await sbGet('profiles', 'id=eq.'+(userId)+'&select=id,name,is_admin,guild,whatsapp,cep,rua,numero,complemento,bairro,cidade,uf,mana_color_1,mana_color_2', tkn);
        if (!prof) {
          try {
            const created = await sbPost('profiles', { id: userId, name: '', is_admin: false }, tkn);
            prof = created[0];
          } catch(e) { /* already exists */ }
        }
        // Fallback mínimo para o UI sempre renderizar
        setProfile(prof || { id: userId, name: '', is_admin: false });
      } catch(eProf) { 
        console.warn('Profile load failed:', eProf);
        setProfile({ id: userId, name: '', is_admin: false });
      }

      // Campaign
      let camp = null;
      try {
        const camps = await sbGet('campaigns', `status=not.in.(CANCELLED,DONE)&limit=1&order=created_at.desc`, tkn);
        camp = camps[0] || null;
        setCampaign(camp);
      } catch(eCamp) { console.warn('Campaign load failed:', eCamp); }

      // Tiers: removidos do novo modelo — preços são diretos por tipo de carta

      // Pricing
      try {
        const [pc] = await sbGet('pricing_config', `is_active=eq.true&limit=1`, tkn);
        setPricing(pc);
      } catch(ePrice) { console.warn('Pricing load failed:', ePrice); }

      // Order (get or create DRAFT) — works with or without active campaign
      try {
        // Find order: prefer campaign order, fallback to null-campaign order
        let ord = null;
        if (camp) {
          const ords = await sbGet('orders', `campaign_id=eq.${camp.id}&user_id=eq.${userId}&status=eq.DRAFT`, tkn);
          ord = ords[0] || null;
        }
        // No campaign order — look for null-campaign order (wishlist)
        if (!ord) {
          const nullOrds = await sbGet('orders', `campaign_id=is.null&user_id=eq.${userId}&status=eq.DRAFT&select=id,created_at&order=created_at.desc&limit=1`, tkn);
          ord = nullOrds[0] || null;
        }
        if (!ord) {
          try {
            const payload = camp ? { campaign_id: camp.id, user_id: userId, status: 'DRAFT' } : { user_id: userId, status: 'DRAFT' };
            const [newOrd] = await sbPost('orders', payload, tkn);
            ord = newOrd;
            // Copiar wants do pedido mais recente de qualquer campanha
            try {
              const prevOrds = await sbGet('orders', `user_id=eq.${userId}&id=neq.${ord.id}&select=id,created_at&order=created_at.desc&limit=1`, tkn);
              if (prevOrds && prevOrds.length > 0) {
                const prevItems = await sbGet('order_items', `order_id=eq.${prevOrds[0].id}&batch_id=is.null&is_bonus=eq.false&select=card_id,quantity,in_cart`, tkn);
                for (const item of (prevItems || [])) {
                  await sbPost('order_items', { order_id: ord.id, card_id: item.card_id, quantity: item.quantity, is_bonus: false, in_cart: item.in_cart || false }, tkn).catch(()=>{});
                }
              }
            } catch(e) { console.warn('Failed to copy wants:', e); }
          } catch(e) {
            // Race condition fallback
            const fallback = camp
              ? await sbGet('orders', `campaign_id=eq.${camp.id}&user_id=eq.${userId}&status=eq.DRAFT`, tkn)
              : await sbGet('orders', `campaign_id=is.null&user_id=eq.${userId}&status=eq.DRAFT&order=created_at.desc&limit=1`, tkn);
            if (fallback[0]) ord = fallback[0]; else throw e;
          }
        } else if (camp && !ord.campaign_id) {
          // Migrate null-campaign order to this campaign
          await sbPatch('orders', `id=eq.${ord.id}`, { campaign_id: camp.id }, tkn).catch(()=>{});
        }
        setOrderId(ord.id);

        // Wants (in_cart=false) and Cart (in_cart=true)
        try {
          let items;
          const itemsFilter = `order_id=eq.${ord.id}&batch_id=is.null&is_bonus=eq.false`;
          try {
            items = await sbGet('order_items', `${itemsFilter}&select=id,card_id,quantity,in_cart,cards(name,type)`, tkn);
          } catch(eCart) {
            // Fallback if in_cart column does not exist
            console.warn('order_items query with in_cart failed, retrying without:', eCart);
            items = (await sbGet('order_items', `${itemsFilter}&select=id,card_id,quantity,cards(name,type)`, tkn)).map(i=>({...i,in_cart:false}));
          }
          const mapped = items.map(i=>({...i,card_name:i.cards?.name||'?',card_type:i.cards?.type||'Normal'}));
          setWants(mapped.filter(i=>!i.in_cart));
          setCartItems(mapped.filter(i=>i.in_cart));
        } catch(e) { console.warn('Failed to load order items:', e); }
        setCartQtyByItem({});
      } catch(eOrder) { console.warn('Order block error:', eOrder); }

        // Order history — all paid batches across all campaigns
        try {
          const allOrds = await sbGet('orders', `user_id=eq.${userId}&select=id,campaign_id,campaigns(status)`, tkn);
          if (allOrds && allOrds.length > 0) {
            const ordCampStatus = {};
            allOrds.forEach(o => { ordCampStatus[o.id] = o.campaigns?.status || null; });
            const ordIds = allOrds.map(o=>o.id).join(',');
            const batches = await sbGet('order_batches', `order_id=in.(${ordIds})&select=id,status,total_locked,payment_method,created_at,qty_in_batch,mp_link,brl_unit_price_locked,subtotal_locked,order_id,order_items(quantity,cards(name,type))`, tkn);
            setMyOrders((batches||[]).map(b=>({ ...b, campaignStatus: ordCampStatus[b.order_id] || null, cards: Array.isArray(b.order_items) ? b.order_items.map(i=>({ name:i.cards?.name||'Carta', type:i.cards?.type||'', qty:Number(i.quantity||1) })) : undefined })));
          }
        } catch(e) { console.warn('Failed to load order batches:', e); }

        // Bonus grants (only if active campaign) — tier-bonus API removido, só bônus manuais
        if (camp) {
          try {
            const bg = await sbGet('bonus_grants', `user_id=eq.${userId}&campaign_id=eq.${camp.id}&status=eq.AVAILABLE`, tkn);
            setBonusGrants(bg);
          } catch(e) { console.warn('Failed to load bonus grants:', e); }
        }
    } catch(e) {
      console.error('loadAppData', e);
      if (e.message && (e.message.includes('JWT') || e.message.includes('401') || e.message.includes('token'))) {
        toast('Sessão expirada. Faça login novamente.', 'error');
        setAppLoading(false);
        handleLogout();
        return;
      }
      toast('Erro ao carregar dados: '+e.message, 'error');
    } finally {
      setAppLoading(false);
    }
  }

  // ─── Auth handler ──────────────────────────────────
  async function handleLogin(res, type) {
    didAutoLoad.current = true; // prevent useEffect from firing a second loadAppData
    setSession(res);
    if (type === 'signup') {
      setIsNew(true);
      setPage('onboarding');
      await loadAppData(res.access_token, res.user.id);
    } else {
      await loadAppData(res.access_token, res.user.id);
      setPage('home');
    }
  }

  function handleLogout(){
    localStorage.removeItem('cpj_session');
    setSession(null);setProfile(null);setCampaign(null);setPricing(null);
    setOrderId(null);setWants([]);setCartItems([]);setCartQtyByItem({});setBonusGrants([]);setMyOrders([]);
    setPage('home');setIsNew(false);didAutoLoad.current=false;
  }

  // ─── Onboarding complete ──────────────────────────
  async function handleOnboardingComplete(colors, guild, showTut) {
    if (token && profile) {
      await sbPatch('profiles', 'id=eq.'+(profile.id), { mana_color_1: colors[0], mana_color_2: colors[1], guild: guild || '' }, token);
      setProfile(p => ({ ...p, mana_color_1: colors[0], mana_color_2: colors[1], guild }));
    }
    setIsNew(false);
    if (showTut) { setIsFirstTimeTut(true); setShowTutorial(true); }
    setPage('home');
  }

  // ─── Save profile ─────────────────────────────────
  async function handleSaveProfile(data) {
    if (!token || !profile) return;
    await sbPatch('profiles', 'id=eq.'+(profile.id), data, token);
    setProfile(p => ({ ...p, ...data }));
    SFX.success();
    toast('Perfil salvo!', 'success');
  }

  // ─── Add want ─────────────────────────────────────
  async function handleAddWant(card, qty) {
    if (!token) { toast('Faça login primeiro','error'); return; }
    if (!orderId) { toast('Erro ao carregar seu pedido. Recarregue a página.','error'); return; }
    try {
      const existing = wants.find(w => w.card_id === card.id);
      if (existing) {
        const newQty = existing.quantity + qty;
        await sbPatch('order_items', 'id=eq.'+(existing.id), { quantity: newQty }, token);
        setWants(prev => prev.map(w => w.id === existing.id ? { ...w, quantity: newQty } : w));
      } else {
        const [item] = await sbPost('order_items', { order_id: orderId, card_id: card.id, quantity: qty, is_bonus: false, unit_price_brl: 0 }, token);
        setWants(prev => [{ ...item, card_name: card.name, card_type: card.type }, ...prev]);
      }
      toast(qty+'x '+card.name+' adicionada!','success');
    } catch(e) {
      console.error('addWant',e);
      toast('Erro ao adicionar: '+e.message,'error');
    }
  }

  // ─── Move want → cart ─────────────────────────────
  async function handleMoveToCart(item) {
    if (!token) return;
    await sbPatch('order_items', 'id=eq.'+(item.id), { in_cart: true }, token);
    setWants(prev => prev.filter(w => w.id !== item.id));
    setCartItems(prev => [...prev, { ...item, in_cart: true }]);
    SFX.addCard();
  }

  // ─── Move cart → wants ────────────────────────────
  async function handleMoveToWants(item) {
    if (!token) return;
    await sbPatch('order_items', 'id=eq.'+(item.id), { in_cart: false }, token);
    setCartItems(prev => prev.filter(c => c.id !== item.id));
    setWants(prev => [...prev, { ...item, in_cart: false }]);
    SFX.toggle();
  }

  // ─── Remove from cart ─────────────────────────────
  async function handleRemoveFromCart(itemId) {
    if (!token) return;
    await sbDelete('order_items', 'id=eq.'+(itemId), token);
    setCartItems(prev => prev.filter(c => c.id !== itemId));
    SFX.click();
  }

  // ─── Update cart qty ──────────────────────────────
  async function handleUpdateCartQty(itemId, newQty) {
    if (!token) return;
    if (newQty <= 0) { handleRemoveFromCart(itemId); return; }
    await sbPatch('order_items', 'id=eq.'+(itemId), { quantity: newQty }, token);
    setCartItems(prev => prev.map(c => c.id === itemId ? { ...c, quantity: newQty } : c));
  }

  // ─── Move all wants → cart ────────────────────────
  async function handleMoveAllToCart() {
    if (!token || wants.length === 0) return;
    await Promise.all(wants.map(w => sbPatch('order_items', 'id=eq.'+(w.id), { in_cart: true }, token)));
    setCartItems(prev => [...prev, ...wants.map(w => ({ ...w, in_cart: true }))]);
    setWants([]);
    SFX.confirm();
  }

  // ─── Remove want ──────────────────────────────────
  async function handleRemoveWant(itemId) {
    if (!token) return;
    await sbDelete('order_items', 'id=eq.'+(itemId), token);
    setWants(prev => prev.filter(w => w.id !== itemId));
    setCartQtyByItem(prev => { const cp = { ...prev }; delete cp[itemId]; return cp; });
    SFX.click();
  }

  // ─── Update want qty ─────────────────────────────
  async function handleUpdateWantQty(itemId, newQty) {
    if (!token) return;
    if (newQty <= 0) { handleRemoveWant(itemId); return; }
    await sbPatch('order_items', 'id=eq.'+(itemId), { quantity: newQty }, token);
    setWants(prev => prev.map(w => w.id === itemId ? { ...w, quantity: newQty } : w));
    setCartQtyByItem(prev => {
      const selected = prev[itemId] || 0;
      if (selected <= newQty) return prev;
      return { ...prev, [itemId]: newQty };
    });
  }

  // ─── Order done ───────────────────────────────────
  async function handleOrderDone(order) {
    setLastOrder(order);
    setWants(prev => prev.flatMap(w => {
      const selected = Math.min(w.quantity, Math.max(0, cartQtyByItem[w.id] || 0));
      if (selected <= 0) return [w];
      const remaining = w.quantity - selected;
      return remaining > 0 ? [{ ...w, quantity: remaining }] : [];
    }));
    setCartQtyByItem({});
    setCartItems([]);
    setMyOrders(prev => [{ id: order.batchId, status: 'DRAFT', total_locked: order.isFullBonus ? 0 : order.totalPaid * order.priceBRL, payment_method: order.method === 'bonus' ? 'BONUS' : 'MERCADO_PAGO', qty_in_batch: order.totalPaid + order.totalBonus, created_at: new Date().toISOString(), cards: order.cards, order_id: orderId, campaignStatus: campaign?.status || null }, ...prev]);

    if (order.totalBonus > 0) {
      let remaining = order.totalBonus;
      const avail = bonusGrants.filter(b => b.status === 'AVAILABLE').sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      for (const g of avail) {
        if (remaining <= 0) break;
        if (remaining >= g.bonus_qty) {
          await sbPatch('bonus_grants', 'id=eq.' + g.id, { status: 'CONSUMED' }, token).catch(e => console.warn('bonus_grants update', e));
          remaining -= g.bonus_qty;
        } else {
          await sbPatch('bonus_grants', 'id=eq.' + g.id, { bonus_qty: g.bonus_qty - remaining }, token).catch(e => console.warn('bonus_grants update', e));
          remaining = 0;
        }
      }
      setBonusGrants(prev => {
        let rem = order.totalBonus;
        return prev.map(g => {
          if (g.status !== 'AVAILABLE' || rem <= 0) return g;
          if (rem >= g.bonus_qty) { rem -= g.bonus_qty; return { ...g, status: 'CONSUMED' }; }
          const newQty = g.bonus_qty - rem; rem = 0; return { ...g, bonus_qty: newQty };
        });
      });
    }

    toast('Pedido registrado!', 'success');
  }

  useEffect(() => {
    setCartQtyByItem(prev => {
      const next = {};
      wants.forEach(w => {
        const q = Math.min(w.quantity, Math.max(0, prev[w.id] || 0));
        if (q > 0) next[w.id] = q;
      });
      return next;
    });
  }, [wants]);

  // Sound toggle
  const origSfx = useRef(null);
  useEffect(() => {
    if (!origSfx.current) origSfx.current = { ...SFX };
    if (!soundOn) { Object.keys(origSfx.current).forEach(k => { SFX[k] = () => {}; }); }
    else { Object.keys(origSfx.current).forEach(k => { SFX[k] = origSfx.current[k]; }); }
  }, [soundOn]);

  // Tutorial
  useEffect(() => { if (showTutorial) setTutStep(0); }, [showTutorial]);
  function tutNext() { if (tutStep < TUTORIAL_STEPS.length - 1) setTutStep(s => s + 1); else { setShowTutorial(false); setTutStep(0); setIsFirstTimeTut(false); setPage('catalog'); } }
  function tutSkip() { setShowTutorial(false); setTutStep(0); setIsFirstTimeTut(false); }

  const wantsCount = wants.reduce((s, w) => s + w.quantity, 0);
  const cartCount = cartItems.reduce((s, c) => s + c.quantity, 0);
  // Pedidos pagos APENAS da encomenda ativa atual (mesmo order_id = mesma campanha)
  // Usado para detectar se o cliente já tem pedidos e oferecer frete conjunto
  const previousPaidBatches = (myOrders || []).filter(o => {
    const st = String(o.status || '').toUpperCase();
    const paySt = String(o.payment_status || '').toLowerCase();
    const isPaid = st === 'PAID' || st === 'CONFIRMED' || st === 'APPROVED' || paySt === 'approved';
    // Só considera batches do pedido atual (= encomenda ativa)
    return isPaid && o.order_id === orderId;
  });
  const bottomTabs = [{ key: 'home', icon: Home, label: 'Início' }, { key: 'catalog', icon: BookOpen, label: 'Catálogo' }, { key: 'wants', icon: ScrollText, label: 'Wants' }, { key: 'cart', icon: ShoppingCart, label: 'Carrinho' }, { key: 'profile', icon: User, label: 'Perfil' }];

  return (<div style={{ '--gp': theme.primary, '--gs': theme.secondary, '--gg': theme.glow, minHeight: '100vh', background: `radial-gradient(ellipse at 50% -20%,${theme.primary}12 0%,transparent 50%),radial-gradient(ellipse at 80% 100%,${theme.secondary}08 0%,transparent 40%),#08080f`, color: '#e9edf7', fontFamily: "'Outfit',sans-serif", maxWidth: 480, margin: '0 auto', position: 'relative', paddingBottom: 78 }}>
    <FloatingMana theme={theme}/>
    <style>{"@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Outfit:wght@300;400;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:#08080f;margin:0}input:focus{border-color:var(--gp)!important;outline:none}button:active:not(:disabled){transform:scale(.97)}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.07);border-radius:3px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes tutPulse{0%,100%{opacity:1;box-shadow:0 0 0 9999px rgba(0,0,0,0.78),0 0 30px var(--gg)}50%{opacity:.85;box-shadow:0 0 0 9999px rgba(0,0,0,0.78),0 0 50px var(--gg)}}@keyframes tutArrowBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(6px)}}@keyframes tutHandBounce{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-6px) scale(1.15)}}@keyframes manaFloat{0%{transform:translateY(0) translateX(0) rotate(0deg);opacity:0}10%{opacity:0.06}90%{opacity:0.03}100%{transform:translateY(-110vh) translateX(var(--drift,20px)) rotate(360deg);opacity:0}}@keyframes flyToWants{0%{transform:translate(-50%,-50%) scale(1);opacity:1}50%{transform:translate(calc(-50vw + 160px),-60vh) scale(0.6);opacity:0.8}100%{transform:translate(calc(-50vw + 160px),-80vh) scale(0.2);opacity:0}}"}</style>

    {toastMsg && <Toast msg={toastMsg.msg} type={toastMsg.type} onClose={() => setToastMsg(null)} />}
    {showTutorial && <TutorialOverlay step={tutStep} steps={TUTORIAL_STEPS} onNext={tutNext} onSkip={tutSkip} theme={theme} onNavTo={p => setPage(p)} isFirstTime={isFirstTimeTut} />}

    {/* Password recovery mode */}
    {recoveryToken && <div style={{ padding: '14px 20px' }}>
      <RecoveryPage token={recoveryToken} onDone={()=>{setRecoveryToken(null);toast('Senha alterada! Faça login.','success');}} theme={theme}/>
    </div>}

    {/* Not logged in */}
    {!session && !recoveryToken && <div style={{ padding: '14px 20px' }}><AuthPage onLogin={handleLogin} theme={theme} /></div>}

    {/* Session exists but still loading */}
    {session && !recoveryToken && !profile && !appLoading && <div style={{ padding: '60px 20px', textAlign: 'center' }}><div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div><div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 16 }}>Erro ao carregar perfil</div><Btn onClick={() => loadAppData(token, session?.user?.id)} sfx="click"><RefreshCw size={16}/> Tentar novamente</Btn></div>}

    {/* Logged in */}
    {session && !recoveryToken && <>
      {/* Loading indicator - non-blocking */}
      {appLoading && <div style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 50, background: 'rgba(8,8,15,0.85)', borderRadius: 20, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Spin size={14}/><span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Carregando...</span>
      </div>}

      {/* Header */}
      {page !== 'onboarding' && <div style={{ padding: '13px 20px 11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.035)', position: 'sticky', top: 0, zIndex: 10, background: 'rgba(8,8,15,0.88)', backdropFilter: 'blur(20px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(page === 'success' || page === 'admin' || page === 'checkout') && <button onClick={() => nav(page === 'admin' ? 'profile' : page === 'checkout' ? 'cart' : 'home')} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 2 }}><ChevronLeft size={20} /></button>}
          <span style={{ fontFamily: "'Cinzel',serif", fontSize: 15, fontWeight: 700, letterSpacing: .3 }}>{({ home: 'Cartas para Jogar', catalog: 'Catálogo', wants: 'Wants', cart: 'Carrinho', checkout: 'Checkout', success: '', profile: 'Perfil', admin: 'Admin', onboarding: '' })[page] || ''}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setSoundOn(s => !s)} style={{ background: 'none', border: 'none', color: soundOn ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)', cursor: 'pointer', padding: 2 }}>{soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
        </div>
      </div>}

      {/* Bottom tabs */}
      {page !== 'onboarding' && page !== 'success' && page !== 'admin' && page !== 'checkout' && <div id="tut-bottom-tabs" style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 480, background: 'rgba(8,8,15,0.94)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-around', padding: '5px 0 10px', zIndex: 20 }}>
        {bottomTabs.map((t, ti) => {
          const active = page === t.key; const badge = t.key === 'cart' && cartCount > 0;
          return (<button key={t.key} id={'tut-tab-' + ti} onClick={() => nav(t.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '4px 10px', borderRadius: 10, position: 'relative', color: active ? theme.primary : 'rgba(255,255,255,0.22)', transition: 'all .2s' }}>
            <t.icon size={20} />{badge && <div style={{ position: 'absolute', top: 0, right: 3, width: 15, height: 15, borderRadius: 8, background: theme.primary, fontSize: 9, fontWeight: 800, color: '#fff', display: 'grid', placeItems: 'center' }}>{cartCount}</div>}
            <span style={{ fontSize: 9, fontWeight: active ? 700 : 400 }}>{t.label}</span>{active && <div style={{ width: 4, height: 4, borderRadius: 2, background: theme.primary }} />}
          </button>);
        })}
      </div>}

      {/* Pages */}
      <div style={{ padding: page === 'onboarding' ? '0 20px' : '14px 20px' }}>
        {page === 'home' && (campaign ? <HomePage pool={pool} minCards={campaign?.min_cards||150} pricing={pricing} closeDate={campaign?.close_at} theme={theme} nav={nav} wantsCount={wantsCount} cartCount={cartCount} bonusAvail={bonusAvail} campaign_status={campaign?.status} /> : <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div style={{textAlign:'center',padding:'6px 0 0'}}>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.28)',letterSpacing:2.5,textTransform:'uppercase',fontFamily:"'Cinzel',serif"}}>Encomenda em Grupo</div>
            <h1 style={{margin:'5px 0 0',fontSize:26,fontFamily:"'Cinzel',serif",background:'linear-gradient(135deg,'+theme.primary+','+theme.secondary+')',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Cartas para Jogar</h1>
          </div>
          {appLoading
            ? <Card style={{padding:20,textAlign:'center'}}><Spin size={24}/><div style={{marginTop:8,fontSize:13,color:'rgba(255,255,255,0.35)'}}>Carregando campanha...</div></Card>
            : <Card style={{padding:20,textAlign:'center'}}><div style={{fontSize:32,marginBottom:8}}>🔮</div><div style={{fontSize:14,fontWeight:700,marginBottom:4}}>Nenhuma encomenda ativa</div><div style={{fontSize:12,color:'rgba(255,255,255,0.35)'}}>Aguarde a próxima encomenda ser aberta.</div></Card>
          }
          <Btn full variant="secondary" onClick={()=>{loadAppData(token,session?.user?.id);}} sfx="click"><RefreshCw size={16}/> Recarregar</Btn>
        </div>)}
        {page === 'catalog' && <CatalogPage token={token} wants={wants} onAddWant={handleAddWant} priceBRL={priceBRL} theme={theme} campaignStatus={campaign?.status} tutStep={showTutorial?tutStep:-1} onTutNext={tutNext} />}
        {page === 'wants' && <WantsPage wants={wants} onMoveToCart={handleMoveToCart} onMoveAllToCart={handleMoveAllToCart} onRemoveWant={handleRemoveWant} onUpdateWantQty={handleUpdateWantQty} cartCount={cartCount} bonusAvail={bonusAvail} theme={theme} />}
        {page === 'cart' && <CartPage cartItems={cartItems} pricing={pricing} bonusAvail={bonusAvail} campaignStatus={campaign?.status} theme={theme} nav={nav} onMoveToWants={handleMoveToWants} onRemoveFromCart={handleRemoveFromCart} onUpdateCartQty={handleUpdateCartQty} token={token} orderId={orderId} campaignId={campaign?.id} onOrderDone={handleOrderDone} toast={toast} profile={profile} previousPaidBatches={previousPaidBatches} />}
        {page === 'checkout' && campaignCanOrder(campaign?.status) && <CheckoutPage cartItems={cartItems} wants={wants} cartQtyByItem={cartQtyByItem} pricing={pricing} bonusAvail={bonusAvail} theme={theme} nav={nav} profile={profile} token={token} orderId={orderId} campaignId={campaign?.id} campaignStatus={campaign?.status} onOrderDone={handleOrderDone} toast={toast} previousPaidBatches={previousPaidBatches} onMoveToWants={handleMoveToWants} onRemoveFromCart={handleRemoveFromCart} onUpdateCartQty={handleUpdateCartQty} />}
        {page === 'checkout' && !campaignCanOrder(campaign?.status) && <CartPage cartItems={cartItems} pricing={pricing} bonusAvail={bonusAvail} campaignStatus={campaign?.status} theme={theme} nav={nav} onMoveToWants={handleMoveToWants} onRemoveFromCart={handleRemoveFromCart} onUpdateCartQty={handleUpdateCartQty} token={token} orderId={orderId} campaignId={campaign?.id} onOrderDone={handleOrderDone} toast={toast} profile={profile} previousPaidBatches={previousPaidBatches} />}
        {page === 'success' && <SuccessPage lastOrder={lastOrder} theme={theme} nav={nav} />}
        {page === 'profile' && !profile && <div style={{padding:20,color:'#ff6b7a',fontSize:12}}><div>profile: null</div><div>token: {token?'ok':'null'}</div><div>appLoading: {String(appLoading)}</div><Btn onClick={()=>loadAppData(token,session?.user?.id)} sfx="click"><RefreshCw size={14}/> Recarregar</Btn></div>}
        {page === 'profile' && profile && (() => { try { return <ProfileView profile={profile} token={token} theme={theme} nav={nav} isAdmin={isAdmin} setShowTutorial={setShowTutorial} onSaveProfile={handleSaveProfile} onLogout={handleLogout} myOrders={myOrders} onReloadOrders={()=>loadAppData(token,session?.user?.id)} toast={toast} campaign={campaign} />; } catch(e) { return <div style={{padding:20,color:'#ff6b7a',fontSize:12}}>Crash: {e.message}</div>; } })()}
        {page === 'admin' && <AdminPage pool={pool} pricing={pricing} campaign={campaign} theme={theme} token={token} nav={nav} onReload={()=>loadAppData(token,session?.user?.id)} toast={toast} />}
        {page === 'onboarding' && <OnboardingPage onComplete={handleOnboardingComplete} theme={theme} />}
      </div>
    </>}
  </div>);
}
