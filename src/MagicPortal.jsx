import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { ScrollText, ShoppingCart, User, Shield, Plus, Minus, Trash2, ChevronRight, ChevronLeft, Sparkles, LogOut, Check, Search, BookOpen, Eye, EyeOff, Mail, Lock, ArrowRight, ArrowLeft, X, Gift, Truck, CreditCard, Circle, CheckCircle, ArrowDown, Upload, Copy, Calendar, DollarSign, Settings, Camera, Phone, MessageCircle, Bell, Package, MapPin, Edit3, RefreshCw, Volume2, VolumeX, HelpCircle, Loader, AlertTriangle, Wifi, WifiOff, Archive, Sun, Moon, LayoutDashboard, Users, TrendingUp, BellRing, BellOff, Clock, Layers, ShoppingBag, ClipboardList, Zap, Store, Wallet, Activity, Inbox, LogIn, UserPlus } from 'lucide-react';
import { buildCatalogQueries, buildLatestCardQuery, RECENT_CARDS_FILTER, VARIANTS_FILTER } from './catalogQuery';
import { VARIANTS } from '../shared/supplierSheet';
import { buildShippingGroups, SHIPPING_SERVICE_UNKNOWN } from '../shared/shipping-groups';
import { buildCardsFromCsv, parseCardLinkList, chunkCardItems, mergeAddCardsResults, LINK_BATCH_SIZE } from '../shared/cardImport';
import { pricePerCard as indivPricePerCard } from '../shared/individualPricing';
import { canAddCardsToOrder, paidQtyOf, shippingAnchorOf } from '../shared/individualAddCards';
import { canChangeShipmentAddress, isShippingAdjustment, pendingAdjustmentOf, shipmentOf } from '../shared/shippingAddressChange';
import { aggregateOrderCards, formatSupplierCardList, totalCardQty } from '../shared/supplierCardList';
import { ORDER_STAGES, groupBatchesIntoOrders, isPaid as isPaidBatchStatus, nextFulfillmentStage, prevFulfillmentStage, resolveOrderStage, resolveOrderStageFromBatches } from '../shared/orderStatus';
import { boughtByCard, buildCollection, collectionStats, extrasByCard } from '../shared/collection';
import { DEFAULT_WHATSAPP_MESSAGES, WHATSAPP_AUDIENCES, buildShipmentWhatsAppUrl, buildWhatsAppUrl, getWhatsAppRecipients } from './whatsappCommunication';
import { PUSH_NEEDS_INSTALL, disablePush, enablePush, getPushState, reportAccess, sendTestPush, updatePushPrefs } from './push';
import { GT, GT_LIGHT, inkOn } from './guildTheme';
import { SFX, wa, useDialogA11y, TC, Card, Btn, Input, Tag, EmptyState, Spin, CardThumb, ImageLightbox, CATALOG_TCG, CATALOG_TYPES } from './kit';
import { SB_URL, SB_KEY, mpSync } from './config';
import AdminConsole from './admin/AdminConsole';
import './theme.css';
import './responsive.css';
import './ui.css';

// ══════════════════════════════════════════════════════
// SUPABASE REST CLIENT
// ══════════════════════════════════════════════════════



// O portal vende encomendas individuais e só. Cada pedido anda sozinho pela
// trilha de status de shared/orderStatus.js — não existe mais campanha
// coletiva segurando todo mundo no mesmo ritmo.



function sbH(token) {
  return { 'apikey': SB_KEY, 'Authorization': `Bearer ${token || SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
}

function isAuthErrorMessage(msg = '') {
  const lower = String(msg || '').toLowerCase();
  return lower.includes('jwt') || lower.includes('token') || lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid claim');
}

async function sbReadError(response) {
  const raw = await response.text();
  const error = new Error(raw || `HTTP ${response.status}`);
  error.status = response.status;
  error.isAuth = response.status === 401 || response.status === 403 || isAuthErrorMessage(raw);
  return error;
}

async function sbGet(table, query = '', token) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers: sbH(token) });
  if (!r.ok) {
    const err = await sbReadError(r);
    err.message = `GET ${table}: ${err.message}`;
    throw err;
  }
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
  if (!r.ok) {
    const err = await sbReadError(r);
    err.message = `POST ${table}: ${err.message}`;
    throw err;
  }
  return r.json();
}

// Upsert via PostgREST. `onConflict` é opcional: sem ele o conflito resolve
// pela chave primária (caso do perfil no cadastro); com ele, aponta um índice
// unique composto — é o que a lista de desejos usa em (user_id, card_id) para
// não precisar de um GET antes de cada adição.
async function sbUpsert(table, data, token, onConflict) {
  const headers = { ...sbH(token), 'Prefer': 'resolution=merge-duplicates,return=representation' };
  const qs = onConflict ? `?on_conflict=${onConflict}` : '';
  const r = await fetch(`${SB_URL}/rest/v1/${table}${qs}`, { method: 'POST', headers, body: JSON.stringify(data) });
  if (!r.ok) {
    const err = await sbReadError(r);
    err.message = `UPSERT ${table}: ${err.message}`;
    throw err;
  }
  return r.json();
}

async function sbPatch(table, query, data, token) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { method: 'PATCH', headers: sbH(token), body: JSON.stringify(data) });
  if (!r.ok) {
    const err = await sbReadError(r);
    err.message = `PATCH ${table}: ${err.message}`;
    throw err;
  }
  return r.json();
}

async function sbDelete(table, query, token) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { method: 'DELETE', headers: sbH(token) });
  if (!r.ok) {
    const err = await sbReadError(r);
    err.message = `DEL ${table}: ${err.message}`;
    throw err;
  }
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
// CONFIG
// ══════════════════════════════════════════════════════

const MANA_COLORS=[{key:'W',emoji:'☀️',color:'#f0e6b2'},{key:'U',emoji:'💧',color:'var(--info)'},{key:'B',emoji:'💀',color:'#9b8ec0'},{key:'R',emoji:'🔥',color:'#d94452'},{key:'G',emoji:'🌿',color:'#2d8f4e'}];
const GUILD_MAP={'WU':'Azorius','UW':'Azorius','UB':'Dimir','BU':'Dimir','BR':'Rakdos','RB':'Rakdos','RG':'Gruul','GR':'Gruul','GW':'Selesnya','WG':'Selesnya','WB':'Orzhov','BW':'Orzhov','UR':'Izzet','RU':'Izzet','BG':'Golgari','GB':'Golgari','RW':'Boros','WR':'Boros','GU':'Simic','UG':'Simic'};
// A paleta por guilda mora em ./guildTheme.js junto com inkOn(), que resolve
// a tinta legível sobre cada cor. `theme.primary` continua sendo hex porque é
// concatenado com opacidade em vários lugares.

// Modo em vigor. É lido por componentes que não recebem `theme` via prop
// (GuildBadge, por exemplo) e atualizado no render do MagicPortal.
let LIGHT_MODE=false;
function setLightMode(on){LIGHT_MODE=!!on;}

// Modo claro/escuro: preferência salva do usuário e, na primeira visita, o
// que o sistema operacional já pede.
const COLOR_MODE_KEY='cpj_color_mode';
const MODE_BG={dark:'#08080f',light:'#f6f1e6'};
function readColorMode(){
  try{const saved=localStorage.getItem(COLOR_MODE_KEY);if(saved==='light'||saved==='dark')return saved;}catch(e){}
  try{if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)return 'light';}catch(e){}
  return 'dark';
}
function applyColorMode(mode){
  if(typeof document==='undefined')return;
  document.documentElement.setAttribute('data-theme',mode);
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',MODE_BG[mode]||MODE_BG.dark);
}
function guildTheme(guild){const map=LIGHT_MODE?GT_LIGHT:GT;return map[guild]||map.Izzet;}


function getGuild(a,b){return a&&b&&a!==b?(GUILD_MAP[a+b]||null):null;}
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

// Retorna o preço BRL de uma carta baseado no tipo (nova lógica simplificada)
// Foil → foil_price_brl | Holo/Ouro → ouro_price_brl | demais → normal_price_brl
function getCardPrice(cardType, pricing) {
  if (!pricing) return 16;
  const type = String(cardType || 'Normal').toLowerCase();
  if (type === 'foil') return Number(pricing.foil_price_brl) || 18;
  if (type === 'holo') return Number(pricing.ouro_price_brl) || 16;
  return Number(pricing.normal_price_brl) || 16;
}

// Preço unitário: faixa por volume (depende da qtd total do pedido) com piso
// por tipo. Sem as faixas carregadas, cai no preço fixo por tipo.
function unitPriceFor(cardType, totalQty, pricing, indiv) {
  if (indiv && Array.isArray(indiv.tiers) && indiv.tiers.length) {
    return indivPricePerCard({ qty: totalQty, type: cardType, tiers: indiv.tiers, pricing: indiv.pricing, fxRate: indiv.fx && indiv.fx.rate });
  }
  return getCardPrice(cardType, pricing);
}

// Preço unitário "cheio" (faixa mais cara / menor volume), sem o desconto por
// volume. Serve de referência para mostrar a economia ao cliente.
function baseUnitPriceFor(cardType, pricing, indiv) {
  if (indiv && Array.isArray(indiv.tiers) && indiv.tiers.length) {
    return Math.max(...indiv.tiers.map(t => indivPricePerCard({ qty: Number(t.min_qty) || 0, type: cardType, tiers: indiv.tiers, pricing: indiv.pricing, fxRate: indiv.fx && indiv.fx.rate })));
  }
  return getCardPrice(cardType, pricing);
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

const SectionTitle=({children,sub})=><div style={{marginBottom:12}}><h2 style={{margin:0,fontSize:'var(--fs-lg)',fontFamily:"'Cinzel',serif",color:'var(--text-strong)',letterSpacing:.3}}>{children}</h2>{sub&&<p style={{margin:'3px 0 0',fontSize:'var(--fs-xs)',color:'var(--text-faint)'}}>{sub}</p>}</div>;
const ManaOrb=({mana,selected,onClick,size=44})=>{const m=MANA_COLORS.find(c=>c.key===mana);return <button onClick={()=>{SFX.toggle();onClick&&onClick();}} style={{width:size,height:size,borderRadius:size,background:selected?wa(m.color,'28'):'var(--fill-soft)',border:'2.5px solid '+(selected?m.color:'var(--text-faint)'),display:'grid',placeItems:'center',cursor:'pointer',fontSize:size*.4,transition:'all .2s',boxShadow:selected?'0 0 14px '+wa(m.color,'35'):'none'}}>{m.emoji}</button>;};
const GuildBadge=({guild,size=22})=>{if(!guild||!GT[guild])return null;const t=guildTheme(guild);return <div style={{width:size,height:size,borderRadius:size,background:'linear-gradient(135deg,'+t.primary+','+t.secondary+')',boxShadow:'0 0 '+size*.5+'px '+t.glow,flexShrink:0}}/>;};

const Toast=({msg,type='info',onClose})=>{const bg=type==='error'?'rgba(var(--danger-rgb),0.15)':type==='success'?'rgba(var(--ok-rgb),0.15)':'rgba(var(--info-rgb),0.15)';const c=type==='error'?'var(--danger)':type==='success'?'var(--ok)':'var(--info)';return <div style={{position:'fixed',top:16,left:'50%',transform:'translateX(-50%)',zIndex:200,padding:'10px 18px',borderRadius:'var(--r-card)',background:bg,border:'1px solid '+wa(c,'30'),color:c,fontSize:'var(--fs-sm)',fontWeight:600,display:'flex',alignItems:'center',gap:'var(--sp-2)',backdropFilter:'blur(12px)',maxWidth:'90%'}}>{type==='error'?<AlertTriangle size={15}/>:<Check size={15}/>}{msg}<button onClick={onClose} style={{background:'none',border:'none',color:c,cursor:'pointer',padding:'var(--sp-1)'}}><X size={14}/></button></div>;};

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

  return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>
    <div style={{position:'relative'}}>
      <Input icon={MapPin} placeholder="CEP" value={address.cep||''} onChange={e=>handleCepChange(e.target.value)} inputMode="numeric"/>
      {cepLoading&&<div style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50)'}}><Spin size={14}/></div>}
    </div>
    <Input icon={MapPin} placeholder="Rua" value={address.rua||''} onChange={e=>u('rua',e.target.value)}/>
    <div style={{display:'flex',gap:'var(--sp-2)'}}>
      <div style={{flex:'0 0 90px'}}><Input placeholder="Nº" value={address.numero||''} onChange={e=>u('numero',e.target.value)}/></div>
      <div style={{flex:1}}><Input placeholder="Complemento" value={address.complemento||''} onChange={e=>u('complemento',e.target.value)}/></div>
    </div>
    <Input placeholder="Bairro" value={address.bairro||''} onChange={e=>u('bairro',e.target.value)}/>
    <div style={{display:'flex',gap:'var(--sp-2)'}}>
      <div style={{flex:1}}><Input placeholder="Cidade" value={address.cidade||''} onChange={e=>u('cidade',e.target.value)}/></div>
      <div style={{flex:'0 0 72px'}}><Input placeholder="UF" value={address.uf||''} onChange={e=>u('uf',e.target.value.toUpperCase().slice(0,2))}/></div>
    </div>
  </div>);
};

const AddressDisplay=({address,onEdit})=>{
  const has=address&&(address.rua||address.cep);
  return(<div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'var(--sp-2)'}}>
    <div style={{fontSize:'var(--fs-sm)',color:'var(--text-muted)',lineHeight:1.6}}>
      {has?<>
        {address.rua&&<div>{address.rua}{address.numero?', '+address.numero:''}{address.complemento?' · '+address.complemento:''}</div>}
        {(address.bairro||address.cidade)&&<div>{[address.bairro,address.cidade,address.uf].filter(Boolean).join(' — ')}</div>}
        {address.cep&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>CEP {address.cep}</div>}
      </>:<span style={{color:'var(--text-faint)'}}>Nenhum endereço cadastrado</span>}
    </div>
    {onEdit&&<button onClick={onEdit} style={{background:'var(--fill)',border:'1px solid var(--line)',borderRadius:'var(--r-control)',padding:'6px 10px',cursor:'pointer',color:'var(--text-dim)',display:'flex',alignItems:'center',gap:'var(--sp-1)',fontSize:'var(--fs-2xs)',flexShrink:0}}><Edit3 size={12}/> Editar</button>}
  </div>);
};

function FlyingCard({show,onDone}){
  useEffect(()=>{if(show){const t=setTimeout(()=>onDone&&onDone(),600);return()=>clearTimeout(t);}},[show]);
  if(!show)return null;
  return <div style={{position:'fixed',zIndex:999,pointerEvents:'none',top:'50%',left:'50%',animation:'flyToWants 0.6s ease-in forwards'}}>
    <div style={{width:32,height:44,borderRadius:4,background:'linear-gradient(135deg,var(--gp),var(--gs))',boxShadow:'0 0 16px var(--gg)',border:'1px solid var(--line)'}}/>
  </div>;
}

function VirtualKeyboard({onKey,onBackspace,onDone,maxLen=6,currentLen=0,doneLabel='OK'}){
  const rows=[['1','2','3'],['4','5','6'],['7','8','9'],['⌫','0',doneLabel]];
  return(<div style={{background:'rgba(var(--sunk),calc(0.6*var(--sunk-a)))',backdropFilter:'blur(10px)',borderRadius:'var(--r-card)',padding:'var(--sp-2)',border:'1px solid var(--line-soft)',maxWidth:220,margin:'0 auto'}}>
    {rows.map((row,ri)=>(<div key={ri} style={{display:'flex',justifyContent:'center',gap:'var(--sp-1)',marginBottom:4}}>
      {row.map(k=>{
        const isBack=k==='⌫';const isOk=k===doneLabel;const isNum=!isBack&&!isOk;
        const disabled=isNum&&currentLen>=maxLen;
        return <button key={k} onClick={()=>{if(isBack){SFX.click();onBackspace();}else if(isOk){SFX.confirm();onDone();}else if(!disabled){SFX.click();onKey(k);}}} disabled={disabled} style={{width:60,height:48,borderRadius:'var(--r-control)',border:isOk?'none':'1px solid rgba(var(--ink),calc(0.08*var(--ink-a)))',background:isOk?'var(--gp)':isBack?'rgba(var(--danger-rgb),0.1)':'var(--text-faint)',color:isOk?'#fff':isBack?'var(--danger)':'var(--text)',fontSize:isNum?20:isOk?13:18,fontWeight:700,cursor:disabled?'not-allowed':'pointer',fontFamily:"'Outfit',sans-serif",display:'grid',placeItems:'center',opacity:disabled?.3:1}}>{k}</button>;})}
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
    {rect&&<div style={{position:'absolute',top:rect.top,left:rect.left,width:rect.width,height:rect.height,borderRadius:'var(--r-card)',border:'2.5px solid '+theme.primary,boxShadow:'0 0 30px '+theme.glow+', inset 0 0 20px '+theme.glow,background:'transparent',zIndex:101,pointerEvents:'none',animation:'tutPulse 1.5s ease-in-out infinite'}}/>}
    <div style={{position:'fixed',bottom:70,left:'50%',transform:'translateX(-50%)',width:'calc(100% - 40px)',maxWidth:420,zIndex:102}}>
      <Card glow={theme.glow} style={{padding:'var(--sp-4)',background:'var(--sheet-bg)',border:'1px solid '+wa(theme.primary,'30')}}>
        <div style={{fontSize:'var(--fs-md)',fontWeight:700,color:theme.primary,marginBottom:6}}>{s.title}</div>
        <div style={{fontSize:'var(--fs-sm)',lineHeight:1.7,color:'var(--text-muted)',marginBottom:8}}>{s.body}</div>
        {s.gesture==='swipe'&&<div style={{display:'flex',justifyContent:'center',gap:'var(--sp-4)',padding:'10px 0',marginBottom:6}}>
          <div style={{display:'flex',alignItems:'center',gap:'var(--sp-1)',padding:'6px 12px',borderRadius:'var(--r-control)',background:'rgba(var(--danger-rgb),0.08)',border:'1px solid rgba(var(--danger-rgb),0.15)'}}>
            <span style={{fontSize:14}}>👈</span><span style={{fontSize:'var(--fs-2xs)',color:'var(--danger)',fontWeight:600}}>Excluir</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'var(--sp-1)',padding:'6px 12px',borderRadius:'var(--r-control)',background:'rgba(var(--ok-rgb),0.08)',border:'1px solid rgba(var(--ok-rgb),0.15)'}}>
            <span style={{fontSize:'var(--fs-2xs)',color:'var(--ok)',fontWeight:600}}>Carrinho</span><span style={{fontSize:14}}>👉</span>
          </div>
        </div>}
        {s.tip&&<div style={{display:'flex',alignItems:'center',gap:'var(--sp-1)',padding:'7px 10px',borderRadius:'var(--r-control)',background:wa(theme.primary,'0a'),border:'1px solid '+wa(theme.primary,'15'),marginBottom:10}}>
          <HelpCircle size={13} style={{color:theme.primary,flexShrink:0}}/>
          <span style={{fontSize:'var(--fs-2xs)',color:theme.primary,fontWeight:600}}>{s.tip}</span>
        </div>}
        <div style={{display:'flex',gap:'var(--sp-1)',justifyContent:'center',marginBottom:12}}>{steps.map((_,i)=><div key={i} style={{width:i===step?18:6,height:5,borderRadius:3,background:i===step?theme.primary:'var(--fill)',transition:'all .3s'}}/>)}</div>
        <div style={{display:'flex',gap:'var(--sp-2)'}}>
          {!isFirstTime&&<Btn variant="ghost" onClick={onSkip} style={{width:'100%',fontSize:'var(--fs-2xs)',whiteSpace:'nowrap',justifyContent:'center'}} sfx="nav">Pular</Btn>}
          {s.interactive?<div style={{flex:2,textAlign:'center',fontSize:'var(--fs-2xs)',color:'var(--text-faint)',fontStyle:'italic',padding:'10px 0'}}>Toque no + para continuar</div>:isLast?<Btn onClick={onNext} style={{flex:2,fontSize:'var(--fs-sm)'}} sfx="confirm"><BookOpen size={15}/> Ver cartas!</Btn>:
          <Btn onClick={onNext} style={{flex:isFirstTime?1:2,fontSize:'var(--fs-sm)'}} sfx="click">Entendi <ArrowRight size={14}/></Btn>}
        </div>
      </Card>
    </div>
  </div>);
}

const TUTORIAL_STEPS=[
  {title:'Catálogo',body:'Aqui ficam todas as cartas de Magic à venda. Busque pelo nome e filtre por tipo.',navTo:'catalog',tabIndex:0,spotlightId:null,icon:'📖'},
  {title:'Busca e filtros',body:'Use a barra de busca e os filtros por tipo de carta.',navTo:'catalog',tabIndex:0,spotlightId:'tut-search-area',scrollTo:true,icon:'🔍'},
  {title:'Comprar ou desejar',body:'O 🛒 põe a carta no carrinho agora. O 📜 guarda ela na lista de desejos, para quando você quiser.',navTo:'catalog',tabIndex:0,spotlightId:null,icon:'➕',interactive:true},
  {title:'Lista de desejos',body:'Só desejo: aqui você anota quais cartas quer e quantas ainda faltam. Nada vai para o carrinho sozinho.',navTo:'wants',tabIndex:1,spotlightId:null,icon:'📋'},
  {title:'Carrinho',body:'Edite quantidades, tire o que não quer agora e avance para o checkout. Quanto mais cartas, menor o preço de cada uma.',navTo:'cart',tabIndex:2,spotlightId:null,icon:'🛒'},
  {title:'Checkout',body:'Revise o pedido, preencha o endereço e calcule o frete antes de finalizar.',navTo:'checkout',tabIndex:2,spotlightId:'tut-checkout-summary',icon:'📦'},
  {title:'Pagamento',body:'Pague com segurança via Mercado Pago — cartão, boleto ou saldo.',navTo:'checkout',tabIndex:2,spotlightId:'tut-payment',icon:'💳'},
  {title:'Minha conta',body:'Acompanhe o status de cada pedido, veja seu álbum de coleção e ajuste seus dados.',navTo:'profile',tabIndex:3,spotlightId:null,icon:'👤'},
];

// ══════════════════════════════════════════════════════
// CATALOG — Supabase powered, server-side search/filter
// ══════════════════════════════════════════════════════


function CatalogPage({token,wishlist,cartItems=[],collectionByCard,onAddToWishlist,onAddToCart,priceBRL,theme,tutStep,onTutNext}){
  const [search,setSearch]=useState('');const [typeF,setTypeF]=useState('Todos');const [variantF,setVariantF]=useState('');const [cards,setCards]=useState([]);const [total,setTotal]=useState(0);
  const [page,setPage]=useState(0);const [loading,setLoading]=useState(false);
  const [detail,setDetail]=useState(null);
  const [flyAnim,setFlyAnim]=useState(false);const PAGE_SIZE=20;
  const catalogFilters=['Todos',RECENT_CARDS_FILTER,...CATALOG_TYPES,VARIANTS_FILTER];
  const firstAddBtnRef=useRef(null);const latestFetchRef=useRef(0);const [handPos,setHandPos]=useState(null);
  useEffect(()=>{
    if(tutStep!==2){setHandPos(null);return;}
    const update=()=>{if(firstAddBtnRef.current){const r=firstAddBtnRef.current.getBoundingClientRect();setHandPos({top:r.top-26,left:r.left+r.width/2});}};
    update();const t=setInterval(update,300);return()=>clearInterval(t);
  },[tutStep,cards]);

  const fetchCards = useCallback(async()=>{
    const fetchId=++latestFetchRef.current;
    setLoading(true);
    try {
      let latestCreatedAt;
      if(typeF===RECENT_CARDS_FILTER){
        const latestCards=await sbGet('cards',buildLatestCardQuery(CATALOG_TCG),token);
        if(fetchId!==latestFetchRef.current)return;
        latestCreatedAt=latestCards[0]?.created_at;
        if(!latestCreatedAt){setCards([]);setTotal(0);return;}
      }

      const {cardsQuery,countQuery}=buildCatalogQueries({tcg:CATALOG_TCG,filter:typeF,variant:variantF,search,page,pageSize:PAGE_SIZE,latestCreatedAt});
      const [data,countData]=await Promise.all([
        sbGet('cards',cardsQuery,token),
        sbGet('cards',countQuery,token),
      ]);
      if(fetchId!==latestFetchRef.current)return;
      // page 0 é busca/filtro novo (substitui); page > 0 é "carregar mais" (soma).
      setCards(prev=>page===0?data:[...prev,...data.filter(d=>!prev.some(p=>p.id===d.id))]);
      setTotal(countData.length);
    } catch(e) { if(fetchId===latestFetchRef.current)console.error(e); }
    finally { if(fetchId===latestFetchRef.current)setLoading(false); }
  },[search,typeF,variantF,page,token]);

  useEffect(()=>{setPage(0);setCards([]);},[search,typeF,variantF]);
  useEffect(()=>{const t=setTimeout(fetchCards,300);return()=>{clearTimeout(t);latestFetchRef.current++;};},[fetchCards,page]);

  function wish(card,qty){SFX.addCard();setFlyAnim(true);onAddToWishlist(card,qty);if(tutStep===2&&onTutNext)onTutNext();}
  function buy(card,qty){onAddToCart(card,qty);}

  return(<div className="portal-page portal-catalog" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)'}}>
    <FlyingCard show={flyAnim} onDone={()=>setFlyAnim(false)}/>
    <div id="tut-search-area" style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>
      <Input icon={Search} placeholder="Buscar carta..." value={search} onChange={e=>setSearch(e.target.value)}/>
      <div style={{display:'flex',gap:'var(--sp-1)',flexWrap:'wrap'}}>
        {catalogFilters.map(t=>(<button key={t} onClick={()=>{SFX.toggle();setTypeF(t);}} style={{flex:'1 1 64px',minWidth:t===RECENT_CARDS_FILTER?96:64,padding:'7px 6px',borderRadius:'var(--r-control)',border:'none',background:typeF===t?theme.primary:'var(--text-faint)',color:typeF===t?'var(--gp-ink)':'var(--text-faint)',fontWeight:600,fontSize:'var(--fs-2xs)',cursor:'pointer',fontFamily:"'Outfit',sans-serif",whiteSpace:'nowrap'}}>{t}</button>))}
      </div>
      {typeF===VARIANTS_FILTER&&<div style={{display:'flex',gap:'var(--sp-1)',flexWrap:'wrap'}}>
        {['',...VARIANTS].map(v=>(<button key={v||'all'} onClick={()=>{SFX.toggle();setVariantF(v);}} style={{padding:'5px 10px',borderRadius:'var(--r-pill)',border:'1px solid '+(variantF===v?theme.primary:'var(--line)'),background:variantF===v?wa(theme.primary,'22'):'transparent',color:variantF===v?theme.primary:'var(--text-dim)',fontWeight:600,fontSize:'var(--fs-2xs)',cursor:'pointer',fontFamily:"'Outfit',sans-serif",whiteSpace:'nowrap'}}>{v||'Todas'}</button>))}
      </div>}
    </div>
    {loading&&cards.length===0?(
      // Skeleton em vez de spinner: antes a grade inteira era substituída a cada
      // tecla digitada e a página saltava. Mantendo a altura, nada pula.
      <div className="portal-card-grid portal-catalog-grid" aria-hidden="true">
        {Array.from({length:6}).map((_,i)=>(
          <Card key={'sk'+i} style={{padding:'var(--sp-2)'}}>
            <div style={{width:'100%',aspectRatio:'0.72',borderRadius:'var(--r-control)',background:'var(--fill)',animation:'skPulse 1.2s ease-in-out infinite'}}/>
            <div style={{padding:'9px 3px 2px'}}>
              <div style={{height:11,width:'78%',borderRadius:4,background:'var(--fill)',animation:'skPulse 1.2s ease-in-out infinite'}}/>
              <div style={{height:9,width:'42%',borderRadius:4,background:'var(--fill)',marginTop:6,animation:'skPulse 1.2s ease-in-out infinite'}}/>
            </div>
          </Card>
        ))}
      </div>
    ):(
      <div className="portal-card-grid portal-catalog-grid" style={{opacity:loading?0.55:1,transition:'opacity .15s'}}>
        {cards.map((c,i)=>{
          // Precedência: já tenho > está no carrinho > está na lista de desejos.
          const wishRow=wishlist.find(w=>w.card_id===c.id);
          const inCart=cartItems.find(ci=>ci.card_id===c.id);
          const ownedQty=collectionByCard?.get?.(c.id)||0;
          const badge=ownedQty>0
            ?{color:'var(--ok)',icon:Check,text:ownedQty>1?`tenho ${ownedQty}`:'tenho'}
            :inCart?{color:'var(--gold)',icon:ShoppingCart,text:String(inCart.quantity)}
            :wishRow?{color:theme.primary,icon:ScrollText,text:String(wishRow.quantity)}
            :null;
          return(<Card key={c.id} onClick={()=>{SFX.nav();setDetail(c);}} style={{padding:'var(--sp-2)'}}>
            <div style={{position:'relative'}}>
              <CardThumb card={c}/>
              {badge&&<div style={{position:'absolute',top:7,left:7}}><Tag color={badge.color} style={{fontSize:'var(--fs-2xs)',padding:'2px 7px'}}><badge.icon size={10}/> {badge.text}</Tag></div>}
              {/* Duas ações separadas: desejar não é comprar. */}
              <div style={{position:'absolute',right:7,bottom:7,display:'flex',gap:5}}>
                <button title="Guardar na lista de desejos" aria-label={`Guardar ${c.name} na lista de desejos`} onClick={e=>{e.stopPropagation();wish(c,1);}} style={{width:36,height:36,border:'1px solid '+wa(theme.primary,'55'),borderRadius:'var(--r-control)',background:wishRow?wa(theme.primary,'cc'):'var(--overlay-bg)',backdropFilter:'blur(6px)',color:wishRow?'var(--gp-ink)':theme.primary,display:'grid',placeItems:'center',cursor:'pointer'}}><ScrollText size={15}/></button>
                <button ref={i===0?firstAddBtnRef:null} id={i===0?'tut-add-btn':undefined} title="Adicionar ao carrinho" aria-label={`Adicionar ${c.name} ao carrinho`} onClick={e=>{e.stopPropagation();buy(c,1);}} style={{width:40,height:40,border:'none',borderRadius:'var(--r-control)',background:'var(--gp)',color:'var(--gp-ink)',display:'grid',placeItems:'center',cursor:'pointer',boxShadow:'0 6px 16px var(--gg)'}}><ShoppingCart size={17}/></button>
              </div>
            </div>
            <div style={{padding:'9px 3px 2px'}}>
              <div style={{fontWeight:700,fontSize:'var(--fs-sm)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</div>
              <div style={{display:'flex',alignItems:'center',marginTop:5}}>
                <span style={{fontSize:'var(--fs-2xs)',color:TC[c.type],fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.variant||c.type}</span>
              </div>
            </div>
          </Card>);
        })}
        {cards.length===0&&!loading&&<div style={{gridColumn:'1 / -1'}}><EmptyState icon={Search} title="Nenhuma carta encontrada" sub="Tente outro termo"/></div>}
      </div>
    )}
    {cards.length>0&&<div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'var(--sp-2)',padding:'4px 0 8px'}}>
      <div aria-live="polite" style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)'}}>
        {cards.length} de {total} carta{total!==1?'s':''}
      </div>
      {cards.length<total&&<Btn variant="secondary" disabled={loading} onClick={()=>setPage(p=>p+1)} sfx="nav" style={{minWidth:200}}>
        {loading?<><Spin size={14}/> Carregando…</>:<>Carregar mais {Math.min(PAGE_SIZE,total-cards.length)}</>}
      </Btn>}
    </div>}
    {tutStep===2&&handPos&&<div style={{position:'fixed',top:handPos.top,left:handPos.left,zIndex:200,pointerEvents:'none',fontSize:'var(--fs-xl)',animation:'tutHandBounce 0.8s ease-in-out infinite',transform:'translateX(-50%)'}}>👆</div>}
    {detail&&<CardDetailModal card={detail} priceBRL={priceBRL} existing={wishlist.find(w=>w.card_id===detail.id)} ownedQty={collectionByCard?.get?.(detail.id)||0} onClose={()=>setDetail(null)} onWish={(c,q)=>{wish(c,q);}} onBuy={(c,q)=>{buy(c,q);}}/>}
  </div>);
}

// In-app card detail sheet — replaces opening the image in a new browser tab.
function CardDetailModal({card,priceBRL,existing,ownedQty=0,onClose,onWish,onBuy}){
  const [qty,setQty]=useState(1);
  const [zoom,setZoom]=useState(false);
  const tc=TC[card.type]||'var(--text-dim)';
  const dialogRef=useDialogA11y(onClose);
  return(<div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="card-detail-title" style={{position:'fixed',inset:0,zIndex:120,display:'flex',alignItems:'flex-end',justifyContent:'center',animation:'fadeIn .15s ease'}}>
    <div onClick={onClose} aria-hidden="true" style={{position:'absolute',inset:0,background:'rgba(var(--sunk),calc(0.72*var(--sunk-a)))',backdropFilter:'blur(6px)'}}/>
    <div className="portal-modal" style={{position:'relative',width:'100%',maxWidth:480,maxHeight:'92vh',overflowY:'auto',background:'var(--sheet-bg)',borderRadius:'24px 24px 0 0',border:'1px solid var(--line)',padding:'12px 18px 24px',animation:'sheetUp .22s ease'}}>
      <div style={{display:'flex',justifyContent:'center',marginBottom:6}}><div style={{width:40,height:5,borderRadius:'var(--r-pill)',background:'var(--fill)'}}/></div>
      <button onClick={onClose} title="Fechar" aria-label="Fechar detalhe da carta" style={{position:'absolute',top:14,right:14,width:44,height:44,borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'var(--fill)',color:'var(--text-muted)',display:'grid',placeItems:'center',cursor:'pointer'}}><X size={16}/></button>
      <div role={card.image_url?'button':undefined} tabIndex={card.image_url?0:undefined} aria-label={card.image_url?`Ampliar imagem de ${card.name}`:undefined} onKeyDown={e=>{if(card.image_url&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setZoom(true);}}} style={{maxWidth:230,margin:'2px auto 0',position:'relative',cursor:card.image_url?'zoom-in':'default'}} onClick={()=>card.image_url&&setZoom(true)}>
        <CardThumb card={card} radius={18}/>
        {card.image_url&&<div style={{position:'absolute',right:8,bottom:8,width:32,height:32,borderRadius:'var(--r-control)',background:'var(--overlay-bg)',backdropFilter:'blur(6px)',border:'1px solid var(--line)',display:'grid',placeItems:'center',color:'#fff'}}><Search size={14}/></div>}
      </div>
      <div style={{marginTop:16}}>
        <div style={{fontSize:'var(--fs-2xs)',letterSpacing:1.5,textTransform:'uppercase',color:tc,fontWeight:700}}>{card.type}{card.variant?` · ${card.variant}`:''}</div>
        <div id="card-detail-title" style={{fontFamily:"'Cinzel',serif",fontSize:'var(--fs-xl)',color:'var(--text-strong)',marginTop:3,lineHeight:1.15}}>{card.name}</div>
        {(ownedQty>0||existing)&&<div style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',marginTop:10,flexWrap:'wrap'}}>
          {ownedQty>0&&<Tag color="var(--ok)" style={{fontSize:'var(--fs-2xs)'}}><Check size={10}/> {ownedQty} na sua coleção</Tag>}
          {existing&&<Tag color="var(--gp)" style={{fontSize:'var(--fs-2xs)'}}><ScrollText size={10}/> {existing.quantity} na lista de desejos</Tag>}
        </div>}
      </div>
      <div style={{display:'flex',gap:'var(--sp-2)',alignItems:'stretch',marginTop:20}}>
        <div style={{display:'flex',alignItems:'center',gap:'var(--sp-3)',background:'var(--fill)',border:'1px solid var(--line)',borderRadius:'var(--r-card)',padding:'0 14px'}}>
          <button onClick={()=>{SFX.toggle();setQty(q=>Math.max(1,q-1));}} aria-label="Diminuir quantidade" style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',display:'grid',padding:'var(--sp-2)'}}><Minus size={16}/></button>
          <span aria-live="polite" aria-label={`Quantidade: ${qty}`} style={{minWidth:18,textAlign:'center',fontWeight:700,fontSize:'var(--fs-md)',color:'var(--text-strong)'}}>{qty}</span>
          <button onClick={()=>{SFX.toggle();setQty(q=>q+1);}} aria-label="Aumentar quantidade" style={{background:'none',border:'none',color:'var(--text-strong)',cursor:'pointer',display:'grid',padding:'var(--sp-2)'}}><Plus size={16}/></button>
        </div>
        <Btn full sfx={null} onClick={()=>{onBuy(card,qty);onClose();}} style={{flex:1}}><ShoppingCart size={16}/> Comprar</Btn>
      </div>
      {/* Desejar é o gesto secundário: guarda a carta sem mexer no carrinho. */}
      <Btn full variant="ghost" sfx={null} onClick={()=>{onWish(card,qty);onClose();}} style={{marginTop:8}}><ScrollText size={15}/> Guardar na lista de desejos</Btn>
    </div>
    {zoom&&<ImageLightbox src={card.image_url} alt={card.name} onClose={()=>setZoom(false)}/>}
  </div>);
}

// ══════════════════════════════════════════════════════
// LISTA DE DESEJOS — só desejo, não é pré-carrinho
// ══════════════════════════════════════════════════════
//
// A lista responde uma pergunta só: quais cartas eu quero e quantas ainda me
// faltam. Ela não empurra ninguém para o checkout — não tem "mandar tudo pro
// carrinho", não some quando a carta é comprada, e o que já está na coleção
// aparece riscado do total. Comprar continua possível pelo botão discreto de
// cada linha, para quem já decidiu.

function WishlistPage({wishlist,cartItems,collectionByCard,onAddToCart,onRemove,onUpdateQty,cartCount,theme,nav}){
  const [searchW,setSearchW]=useState('');
  const [zoomSrc,setZoomSrc]=useState(null);
  const [filter,setFilter]=useState('pending'); // 'pending' | 'done'

  const decorated=wishlist.map(w=>{
    const owned=collectionByCard?.get?.(w.card_id)||0;
    const inCart=cartItems.find(c=>c.card_id===w.card_id);
    return {...w,ownedQty:owned,missing:Math.max(0,w.quantity-owned),inCartQty:inCart?inCart.quantity:0};
  });
  const pending=decorated.filter(w=>w.missing>0);
  const complete=decorated.filter(w=>w.missing<=0);
  const missingUnits=pending.reduce((s,w)=>s+w.missing,0);
  const visible=filter==='done'?complete:pending;
  const filtered=searchW?visible.filter(w=>w.card_name.toLowerCase().includes(searchW.toLowerCase())):visible;

  return(<div className="portal-page portal-wants" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)'}}>
    <div id="tut-wants-tags" style={{display:'flex',gap:'var(--sp-1)',flexWrap:'wrap',alignItems:'center'}}>
      <Tag color={theme.primary}><ScrollText size={11}/> {missingUnits} carta{missingUnits!==1?'s':''} faltando</Tag>
      {complete.length>0&&<Tag color="var(--ok)"><Check size={11}/> {complete.length} completa{complete.length!==1?'s':''}</Tag>}
    </div>

    <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',lineHeight:1.5,padding:'0 2px'}}>
      Sua lista de desejos é só sua — nada aqui vai pro carrinho sozinho. Quando quiser comprar uma carta, use o botão do carrinho na linha dela.
    </div>

    {complete.length>0&&<div role="tablist" aria-label="Filtrar lista de desejos" style={{display:'flex',gap:'var(--sp-1)'}}>
      {[{key:'pending',label:`Falta comprar (${pending.length})`},{key:'done',label:`Já tenho (${complete.length})`}].map(t=>(
        <button key={t.key} role="tab" aria-selected={filter===t.key} onClick={()=>{SFX.toggle();setFilter(t.key);}} style={{flex:1,padding:'9px 10px',borderRadius:'var(--r-control)',border:'1px solid '+(filter===t.key?wa(theme.primary,'55'):'var(--line-soft)'),background:filter===t.key?wa(theme.primary,'18'):'var(--fill-soft)',color:filter===t.key?theme.primary:'var(--text-dim)',fontWeight:700,fontSize:'var(--fs-xs)',fontFamily:"'Outfit',sans-serif",cursor:'pointer'}}>{t.label}</button>
      ))}
    </div>}

    {visible.length>3&&<Input icon={Search} placeholder="Buscar na lista..." value={searchW} onChange={e=>setSearchW(e.target.value)}/>}

    {filtered.length>0&&<div className="portal-card-grid portal-wants-grid" style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>
      {filtered.map((w)=>{const img=w.card_image_url;const done=w.missing<=0;return(
        <Card key={w.id} style={{padding:'var(--sp-2)',opacity:done?0.72:1}}>
          <div style={{display:'flex',alignItems:'center',gap:'var(--sp-3)'}}>
            <div onClick={()=>img&&setZoomSrc(img)} role={img?'button':undefined} tabIndex={img?0:undefined} aria-label={img?`Ampliar imagem de ${w.card_name}`:undefined} onKeyDown={e=>{if(img&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setZoomSrc(img);}}} style={{width:54,flexShrink:0,cursor:img?'zoom-in':'default'}}><CardThumb card={w} radius={9}/></div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:'var(--fs-sm)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{w.card_name}</div>
              <span style={{fontSize:'var(--fs-2xs)',color:TC[w.card_type],fontWeight:700}}>{w.card_type}</span>
              <div style={{fontSize:'var(--fs-2xs)',color:done?'var(--ok)':'var(--text-faint)',fontWeight:600,marginTop:2,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}>
                {done?<><Check size={11}/> {w.ownedQty} de {w.quantity} — completa</>:<>{w.ownedQty} de {w.quantity} na coleção</>}
              </div>
              {w.inCartQty>0&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--gold)',fontWeight:700,marginTop:2,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><ShoppingCart size={11}/> {w.inCartQty} no carrinho</div>}
              <div style={{display:'flex',alignItems:'center',gap:'var(--sp-1)',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',borderRadius:'var(--r-control)',border:'1px solid var(--line-soft)',width:'fit-content',marginTop:7}}>
                <button onClick={()=>onUpdateQty(w.id,w.quantity-1)} aria-label={`Diminuir quantidade desejada de ${w.card_name}`} style={{background:'none',border:'none',color:'var(--text-strong)',padding:'10px 12px',cursor:'pointer'}}><Minus size={12}/></button>
                <span aria-label={`Quantidade desejada de ${w.card_name}: ${w.quantity}`} style={{minWidth:18,textAlign:'center',fontSize:'var(--fs-sm)',fontWeight:700}}>{w.quantity}</span>
                <button onClick={()=>onUpdateQty(w.id,w.quantity+1)} aria-label={`Aumentar quantidade desejada de ${w.card_name}`} style={{background:'none',border:'none',color:'var(--text-strong)',padding:'10px 12px',cursor:'pointer'}}><Plus size={12}/></button>
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'var(--sp-1)',alignItems:'stretch'}}>
              {/* Discreto de propósito: a lista é de desejo, comprar é opcional. */}
              {!done&&<button onClick={()=>onAddToCart(w,w.missing)} title="Adicionar ao carrinho" aria-label={`Adicionar ${w.card_name} ao carrinho`} style={{background:'var(--fill)',border:'1px solid '+wa(theme.primary,'40'),borderRadius:'var(--r-control)',padding:'10px 13px',cursor:'pointer',color:theme.primary,display:'flex',alignItems:'center',justifyContent:'center'}}><ShoppingCart size={14}/></button>}
              <button onClick={()=>onRemove(w.id)} title="Tirar da lista" aria-label={`Tirar ${w.card_name} da lista de desejos`} style={{background:'rgba(var(--danger-rgb),0.08)',border:'1px solid rgba(var(--danger-rgb),0.15)',borderRadius:'var(--r-control)',padding:'10px 13px',cursor:'pointer',color:'var(--danger)',display:'flex',alignItems:'center',justifyContent:'center'}}><Trash2 size={13}/></button>
            </div>
          </div>
        </Card>
      );})}
    </div>}

    {filtered.length===0&&(filter==='done'
      ?<EmptyState icon={Check} title="Nenhum desejo completo ainda" sub="Assim que a coleção cobrir o que você quer, a carta aparece aqui"/>
      :<EmptyState icon={ScrollText} title={searchW?'Nenhuma carta encontrada':'Sua lista de desejos está vazia'} sub={searchW?'Tente outro termo':'Marque no catálogo as cartas que você quer um dia'} action={!searchW?<Btn onClick={()=>nav&&nav('catalog')} sfx="nav"><BookOpen size={15}/> Ver catálogo</Btn>:undefined}/>)}

    <ImageLightbox src={zoomSrc} onClose={()=>setZoomSrc(null)}/>
  </div>);
}

const MIN_ORDER_CARDS = 15;

// Faixa fixa do modo "adicionar cartas": enquanto ela está na tela, o que for
// fechado no checkout entra no pedido antigo, não num pedido novo.
function AddingToOrderBanner({addTo,onCancel}){
  return(<Card style={{padding:'10px 12px',borderColor:'rgba(var(--info-rgb),0.25)',background:'rgba(var(--info-rgb),0.07)'}}>
    <div style={{display:'flex',alignItems:'center',gap:'var(--sp-2)'}}>
      <Plus size={15} style={{color:'var(--info)',flexShrink:0}}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:'var(--fs-xs)',fontWeight:700,color:'var(--info)'}}>Adicionando ao pedido #{addTo.shortId}</div>
        <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',lineHeight:1.4}}>Sem frete novo e sem mínimo — as cartas vão na mesma remessa das {addTo.qtyPaid} já pagas, e o preço segue a faixa do volume somado.</div>
      </div>
      {onCancel&&<button onClick={()=>{SFX.click();onCancel();}} aria-label="Sair do modo de adição e montar um pedido novo" title="Sair do modo de adição" style={{background:'none',border:'none',color:'var(--text-faint)',cursor:'pointer',flexShrink:0,padding:'var(--sp-1)'}}><X size={14}/></button>}
    </div>
  </Card>);
}

function CartPage({cartItems,pricing,theme,nav,onRemoveFromCart,onUpdateCartQty,toast,indiv=null,addTo=null,onCancelAdd}){
  // Adição a um pedido já pago: sem mínimo (o pedido de destino já cumpriu o
  // dele) e com a faixa de preço puxada pelo volume somado.
  const isAdding=!!addTo;
  const totalQty=cartItems.reduce((s,c)=>s+c.quantity,0);
  const tierQty=totalQty+(isAdding?(addTo.qtyPaid||0):0);
  const totalBRL=cartItems.reduce((s,c)=>s+c.quantity*unitPriceFor(c.card_type,tierQty,pricing,indiv),0);
  // Economia por volume: diferença entre o preço cheio (faixa mais cara) e o preço atual.
  const baseBRL=cartItems.reduce((s,c)=>s+c.quantity*baseUnitPriceFor(c.card_type,pricing,indiv),0);
  const volumeDiscount=Math.max(0,baseBRL-totalBRL);
  const minCards=isAdding?1:(Number(indiv?.pricing?.min_cards)||MIN_ORDER_CARDS);
  const canCheckout=totalQty>=minCards;
  const missingCards=Math.max(0,minCards-totalQty);
  const [zoomSrc,setZoomSrc]=useState(null);

  return(<div className="portal-page portal-cart" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)',paddingBottom:cartItems.length>0?168:0}}>
    {isAdding&&<AddingToOrderBanner addTo={addTo} onCancel={onCancelAdd}/>}
    {cartItems.length>0&&<>
      <div className="portal-card-grid portal-cart-grid" style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>
        {cartItems.map((c)=>{const itemPrice=unitPriceFor(c.card_type,tierQty,pricing,indiv);const baseItemPrice=baseUnitPriceFor(c.card_type,pricing,indiv);return(
          <Card key={c.id} style={{padding:'var(--sp-2)'}}>
            <div style={{display:'flex',alignItems:'center',gap:'var(--sp-3)'}}>
              <div onClick={()=>c.card_image_url&&setZoomSrc(c.card_image_url)} style={{width:54,flexShrink:0,cursor:c.card_image_url?'zoom-in':'default'}}><CardThumb card={c} radius={9}/></div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:'var(--fs-sm)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.card_name}</div>
                <div style={{display:'flex',gap:'var(--sp-1)',alignItems:'center',flexWrap:'wrap',marginTop:2}}>
                  <span style={{fontSize:'var(--fs-2xs)',color:TC[c.card_type],fontWeight:700}}>{c.card_type}</span>
                </div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'var(--sp-2)',marginTop:7}}>
                  <div style={{display:'flex',alignItems:'center',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',borderRadius:'var(--r-control)',border:'1px solid var(--line-soft)'}}>
                    <button onClick={()=>onUpdateCartQty(c.id,c.quantity-1)} aria-label={`Diminuir quantidade de ${c.card_name}`} style={{background:'none',border:'none',color:'var(--text-strong)',padding:'5px 11px',cursor:'pointer'}}><Minus size={12}/></button>
                    <span style={{minWidth:18,textAlign:'center',fontSize:'var(--fs-sm)',fontWeight:700}}>{c.quantity}</span>
                    <button onClick={()=>onUpdateCartQty(c.id,c.quantity+1)} aria-label={`Aumentar quantidade de ${c.card_name}`} style={{background:'none',border:'none',color:'var(--text-strong)',padding:'5px 11px',cursor:'pointer'}}><Plus size={12}/></button>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'var(--sp-1)'}}>
                    <span style={{fontSize:'var(--fs-sm)',fontWeight:800,color:'var(--text-strong)',whiteSpace:'nowrap'}}>R$ {(c.quantity*itemPrice).toFixed(2).replace('.',',')}</span>
                    <span style={{fontSize:'var(--fs-2xs)',color:'var(--text-dim)',whiteSpace:'nowrap'}}>{baseItemPrice>itemPrice&&<span style={{textDecoration:'line-through',marginRight:4,color:'var(--text-faint)'}}>R$ {baseItemPrice.toFixed(2).replace('.',',')}</span>}<span style={{color:baseItemPrice>itemPrice?'var(--ok)':'var(--text-dim)',fontWeight:baseItemPrice>itemPrice?700:400}}>R$ {itemPrice.toFixed(2).replace('.',',')}</span> /un</span>
                  </div>
                </div>
              </div>
              {/* Uma ação só: tirar do carrinho não mexe na lista de desejos,
                  então "voltar para a lista" e "remover" viraram a mesma coisa. */}
              <button onClick={()=>onRemoveFromCart(c.id)} title="Tirar do carrinho" aria-label={`Tirar ${c.card_name} do carrinho`} style={{alignSelf:'center',background:'rgba(var(--danger-rgb),0.08)',border:'1px solid rgba(var(--danger-rgb),0.15)',borderRadius:'var(--r-control)',padding:'10px 12px',cursor:'pointer',color:'var(--danger)',display:'flex',alignItems:'center',justifyContent:'center'}}><Trash2 size={14}/></button>
            </div>
          </Card>
        );})}
      </div>
      <Btn full variant="ghost" onClick={()=>nav('catalog')} sfx="nav"><ArrowLeft size={14}/> Continuar escolhendo cartas</Btn>
      {/* Barra de resumo fixa */}
      <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:'var(--sheet-bg-alt)',backdropFilter:'blur(20px)',borderTop:'1px solid rgba(var(--ink),calc(0.08*var(--ink-a)))',borderRadius:'20px 20px 0 0',padding:'13px 16px calc(12px + env(safe-area-inset-bottom))',zIndex:25,boxShadow:'0 -10px 30px rgba(var(--sunk),calc(0.4*var(--sunk-a)))'}}>
        {!canCheckout&&(()=>{
          const pct=Math.min(100,Math.round((totalQty/minCards)*100));
          return(<div style={{marginBottom:10,padding:'9px 11px',borderRadius:'var(--r-control)',background:'rgba(var(--gold-rgb),0.08)',border:'1px solid rgba(var(--gold-rgb),0.2)'}}>
            <div style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',marginBottom:7}}>
              <AlertTriangle size={13} style={{color:'var(--gold)',flexShrink:0}}/>
              <span style={{fontSize:'var(--fs-xs)',color:'var(--gold)',fontWeight:600}}>Faltam {missingCards} carta{missingCards!==1?'s':''} para o mínimo de {minCards}</span>
            </div>
            <div role="progressbar" aria-valuenow={totalQty} aria-valuemin={0} aria-valuemax={minCards} aria-label={`${totalQty} de ${minCards} cartas para o mínimo do pedido`} style={{background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',borderRadius:'var(--r-pill)',height:6,overflow:'hidden'}}>
              <div style={{width:pct+'%',height:'100%',borderRadius:'var(--r-pill)',background:'linear-gradient(90deg,var(--gold),var(--gp))',transition:'width .4s'}}/>
            </div>
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginTop:5,textAlign:'right'}}>{totalQty}/{minCards}</div>
          </div>);
        })()}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:11}}>
          <div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-dim)'}}>{totalQty} carta{totalQty!==1?'s':''}</div>{volumeDiscount>0&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--ok)',fontWeight:700,marginTop:2,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><Gift size={11}/> Desconto por volume −R$ {volumeDiscount.toFixed(2).replace('.',',')}</div>}<div style={{fontSize:'var(--fs-xl)',fontWeight:800,color:'var(--text-strong)',marginTop:1}}>≈ R$ {totalBRL.toFixed(2).replace('.',',')}</div></div>
        </div>
        <Btn full onClick={()=>nav('checkout')} disabled={!canCheckout} sfx="nav"><CreditCard size={15}/> {canCheckout?'Ir para checkout':`Mínimo ${minCards} (faltam ${missingCards})`}</Btn>
      </div>
    </>}
    {cartItems.length===0&&<EmptyState icon={ShoppingCart} title="Carrinho vazio" sub="Escolha cartas no catálogo para montar sua encomenda" action={<Btn onClick={()=>nav('catalog')} sfx="nav"><BookOpen size={15}/> Ver catálogo</Btn>}/>}
    <ImageLightbox src={zoomSrc} onClose={()=>setZoomSrc(null)}/>
  </div>);
}
function CheckoutPage({cartItems=[],pricing,theme,nav,profile,token,onOrderDone,toast,unshippedPaidBatches=[],indiv=null,addTo=null,onCancelAdd}){
  // Adição a um pedido já pago: o frete e o mínimo já foram resolvidos no
  // pedido de destino, então este checkout é só o pagamento das cartas novas.
  const isAdding=!!addTo;
  const [freteOptions,setFreteOptions]=useState([]);const [selectedFrete,setSelectedFrete]=useState(null);
  const [lF,setLF]=useState(false);const [submitting,setSubmitting]=useState(false);
  const [step,setStep]=useState('review');
  const [zoomSrc,setZoomSrc]=useState(null);
  const [saveAddressChoice,setSaveAddressChoice]=useState(null);
  // Envio conjunto: manda com um pedido pago que ainda não foi postado, sem
  // pagar frete de novo.
  const [useJointShipping,setUseJointShipping]=useState(false);
  const hasUnshippedPaidOrder=(unshippedPaidBatches||[]).length>0;
  const shippingAnchor=[...(unshippedPaidBatches||[])].sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0))[0]||null;
  const [addr,setAddr]=useState({cep:profile?.cep||'',rua:profile?.rua||'',numero:profile?.numero||'',complemento:profile?.complemento||'',bairro:profile?.bairro||'',cidade:profile?.cidade||'',uf:profile?.uf||''});
  const profileHasSavedAddress=Boolean(profile?.cep&&(profile.cep||'').replace(/\D/g,'').length===8&&profile?.rua);
  const [editingAddr,setEditingAddr]=useState(!profileHasSavedAddress);
  const cart=cartItems;
  const totalQty=cart.reduce((s,c)=>s+c.quantity,0);
  const minCards=isAdding?1:(Number(indiv?.pricing?.min_cards)||MIN_ORDER_CARDS);
  const canCheckout=totalQty>=minCards;
  const missingCards=Math.max(0,minCards-totalQty);
  // Faixa de preço da adição: volume somado (o que já foi pago + o carrinho).
  const tierQty=totalQty+(isAdding?(addTo.qtyPaid||0):0);
  const sub=cart.reduce((s,c)=>s+c.quantity*unitPriceFor(c.card_type,tierQty,pricing,indiv),0);
  // Economia por volume: preço cheio (faixa mais cara) menos o preço aplicado.
  const baseSub=cart.reduce((s,c)=>s+c.quantity*baseUnitPriceFor(c.card_type,pricing,indiv),0);
  const volumeDiscount=Math.max(0,baseSub-sub);
  // Frete: zero quando a remessa já existe (adição ou envio conjunto).
  const shippingSkipped=isAdding||useJointShipping;
  const fV=shippingSkipped?0:(selectedFrete?selectedFrete.price:0);
  const total=sub+fV;
  const cepClean=(addr.cep||'').replace(/\D/g,'');
  const addressUnchanged=addr.cep===(profile?.cep||'')&&addr.rua===(profile?.rua||'')&&addr.numero===(profile?.numero||'')&&addr.complemento===(profile?.complemento||'')&&addr.bairro===(profile?.bairro||'')&&addr.cidade===(profile?.cidade||'')&&addr.uf===(profile?.uf||'');

  useEffect(()=>{if(useJointShipping){setSelectedFrete({carrier:'Envio conjunto',price:0,deadline_days:0});setFreteOptions([]);}else{setSelectedFrete(null);setFreteOptions([]);}},[useJointShipping]);
  useEffect(()=>{if(step==='address'&&profileHasSavedAddress&&!editingAddr&&cepClean.length===8&&freteOptions.length===0&&!lF&&!useJointShipping)calcFrete();},[step]); // eslint-disable-line react-hooks/exhaustive-deps

  async function calcFrete(){
    if(shippingSkipped) return; // frete não é necessário
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
        const opts=d.opcoes.map(o=>({carrier:o.nome,service:o.nome,price:o.preco,deadline_days:o.prazo}));
        setFreteOptions(opts);setSelectedFrete(opts[0]);SFX.success();
      } else {
        toast('O MandaBem não retornou opções para este CEP. Tente outro ou entre em contato.','error');
      }
    }catch(e){console.warn('frete',e);toast('Erro ao conectar com frete','error');}
    setLF(false);
  }

  async function finalize(){
    if(!canCheckout){toast(`Mínimo de ${minCards} cartas por pedido. Adicione mais ${missingCards}.`,'error');return;}
    if(!shippingSkipped&&!selectedFrete){toast('Selecione uma opção de frete para continuar','error');return;}
    setSubmitting(true);
    try {
      const items=cart.map(c=>({card_id:c.card_id,quantity:c.quantity}));
      // Adição não manda frete nem endereço: o servidor herda tudo do lote
      // que pagou o envio no pedido de destino.
      const shipping={
        service:shippingSkipped?(shippingAnchor?.shipping_service||null):(selectedFrete?.service||selectedFrete?.carrier||null),
        price:fV,
        address:{cep:addr.cep,rua:addr.rua,numero:addr.numero,complemento:addr.complemento,bairro:addr.bairro,cidade:addr.cidade,uf:addr.uf,name:profile?.name||''},
        already_paid:shippingSkipped,
        group_id:shippingSkipped?(shippingAnchor?.shipping_group_id||shippingAnchor?.id||null):null,
      };
      const payload=isAdding?{items,addToOrderId:addTo.orderId}:{items,shipping};
      const r=await fetch('/api/individual-checkout',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(payload)});
      const d=await r.json().catch(()=>({}));
      // A janela pode ter fechado entre montar o carrinho e pagar: sai do modo
      // de adição para o carrinho virar um pedido novo, sem perder as cartas.
      if(d.code==='ADD_WINDOW_CLOSED'&&onCancelAdd)onCancelAdd();
      if(!r.ok||!d.ok)throw new Error(d.error||`HTTP ${r.status}`);
      if(saveAddressChoice===true&&addr.rua)await sbPatch('profiles','id=eq.'+(profile.id),{cep:addr.cep,rua:addr.rua,numero:addr.numero,complemento:addr.complemento,bairro:addr.bairro,cidade:addr.cidade,uf:addr.uf},token).catch(()=>{});
      // Esvazia o carrinho-rascunho: os itens definitivos do pedido já foram
      // criados no servidor, então estas linhas viram órfãs. O desejo em si
      // continua guardado em wishlist_items.
      for(const c of cart){ if(c.id) await sbDelete('order_items','id=eq.'+c.id,token).catch(()=>{}); }
      SFX.confirm();
      onOrderDone({totalPaid:d.totalQty,batchId:d.batchId,shortId:d.shortId,orderId:d.orderId,total:d.total,addedToOrderId:isAdding?addTo.orderId:null,cards:cart.map(c=>({name:c.card_name,type:c.card_type,qty:c.quantity}))});
      toast('Gerando link de pagamento...','info');
      const descricao=isAdding?`Cartas adicionadas ao pedido #${d.addedToShortId||addTo.shortId} - ${d.totalQty} cartas`:`Pedido #${d.shortId} - ${d.totalQty} cartas`;
      const mpRes=await fetch(`/api/mp-create`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:String(d.batchId),total:Number(d.total.toFixed(2)),descricao})});
      const mpData=await mpRes.json();
      const mpLink=mpData?.mpLink||mpData?.init_point||mpData?.sandbox_init_point;
      if(mpLink){window.location.href=mpLink;return;}
      if(mpData.error){console.error('MP:',mpData.error);toast('Erro MP: '+mpData.error,'error');}
      nav('success');
    }catch(e){console.error('[finalize]',e);toast('Erro ao finalizar: '+e.message,'error');}
    setSubmitting(false);
  }

  if(totalQty===0)return(<div style={{paddingTop:40}}><EmptyState icon={ShoppingCart} title="Carrinho vazio" sub="Escolha cartas no catálogo para montar sua encomenda" action={<Btn onClick={()=>nav('catalog')} sfx="nav"><BookOpen size={15}/> Ver catálogo</Btn>}/></div>);

  // Bloquear checkout se mínimo não atingido
  if(!canCheckout)return(<div style={{paddingTop:20}}>
    <Card style={{padding:'var(--sp-4)',textAlign:'center',borderColor:'rgba(var(--gold-rgb),0.3)',background:'rgba(var(--gold-rgb),0.06)'}}>
      <AlertTriangle size={32} style={{color:'var(--gold)',marginBottom:8}}/>
      <div style={{fontWeight:700,fontSize:'var(--fs-md)',color:'var(--gold)',marginBottom:6}}>Mínimo não atingido</div>
      <div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',lineHeight:1.5}}>Cada pedido precisa ter pelo menos <b style={{color:'var(--gold)'}}>{minCards} cartas</b>.<br/>Seu carrinho tem {totalQty} carta{totalQty!==1?'s':''}. Adicione mais <b style={{color:'var(--gold)'}}>{missingCards}</b>.</div>
    </Card>
    <div style={{textAlign:'center',marginTop:16}}><Btn onClick={()=>nav('cart')} sfx="nav"><ShoppingCart size={16}/> Voltar ao carrinho</Btn></div>
  </div>);

  return(<div className="portal-page portal-checkout" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)'}}>
    {isAdding&&<AddingToOrderBanner addTo={addTo} onCancel={onCancelAdd}/>}
    <Card id="tut-checkout-summary" style={{padding:'var(--sp-4)'}}>
      <SectionTitle sub={isAdding?`${totalQty} carta${totalQty!==1?'s':''} para somar ao pedido #${addTo.shortId}`:`${totalQty} carta${totalQty!==1?'s':''}`}>{isAdding?'Cartas a adicionar':'Resumo do pedido'}</SectionTitle>
      {cart.map((c,i)=>{const ip=unitPriceFor(c.card_type,tierQty,pricing,indiv);return(<div key={'p'+i} style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',padding:'5px 0',fontSize:'var(--fs-sm)',borderBottom:'1px solid rgba(var(--ink),calc(0.03*var(--ink-a)))'}}><div onClick={()=>c.card_image_url&&setZoomSrc(c.card_image_url)} style={{width:30,flexShrink:0,cursor:c.card_image_url?'zoom-in':'default'}}><CardThumb card={c} radius={6}/></div><span style={{flex:1,minWidth:0,color:'var(--text-muted)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.card_name} <span style={{color:TC[c.card_type],fontSize:'var(--fs-2xs)',fontWeight:700}}>{c.card_type}</span> x{c.quantity}<span style={{color:'var(--text-faint)',fontSize:'var(--fs-2xs)'}}> · R$ {ip.toFixed(2).replace('.',',')}/un</span></span><span style={{fontWeight:700,whiteSpace:'nowrap'}}>R$ {(c.quantity*ip).toFixed(2)}</span></div>);})}
      <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:'var(--sp-1)'}}>
        {volumeDiscount>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-sm)',color:'var(--text-dim)'}}><span>Subtotal (sem desconto)</span><span style={{color:'var(--text-faint)',textDecoration:'line-through'}}>R$ {baseSub.toFixed(2)}</span></div>}
        {volumeDiscount>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-sm)',color:'var(--ok)',fontWeight:700}}><span>Desconto por volume</span><span>−R$ {volumeDiscount.toFixed(2)}</span></div>}
        <div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-sm)',color:'var(--text-dim)'}}><span>Subtotal</span><span style={{color:'var(--text-strong)',fontWeight:600}}>R$ {sub.toFixed(2)}</span></div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-sm)',color:'var(--text-dim)'}}><span>Frete</span><span style={{color:shippingSkipped?'var(--ok)':'var(--text-strong)',fontWeight:600}}>{isAdding?`Já pago no pedido #${addTo.shortId} ✓`:useJointShipping?'Envio conjunto (R$ 0,00)':selectedFrete?'R$ '+fV.toFixed(2):lF?'Calculando...':'—'}</span></div>
        <div style={{height:1,background:'var(--fill)',margin:'3px 0'}}/>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-lg)',fontWeight:800}}><span>Total</span><span style={{color:theme.primary}}>R$ {total.toFixed(2)}</span></div>
      </div>
      {step==='review'&&!isAdding&&<Btn full onClick={()=>setStep('address')} style={{marginTop:12}} sfx="nav"><ArrowRight size={16}/> Avançar para endereço e frete</Btn>}
    </Card>

    {step==='address'&&!isAdding&&<Card style={{padding:'var(--sp-4)'}}>
      <SectionTitle>Endereço de entrega</SectionTitle>

      {!shippingSkipped&&(profileHasSavedAddress&&!editingAddr?<AddressDisplay address={addr} onEdit={()=>{setEditingAddr(true);setFreteOptions([]);setSelectedFrete(null);}}/>:<AddressForm address={addr} setAddress={(a)=>setAddr(a)}/>)}
      {!shippingSkipped&&(editingAddr||!profileHasSavedAddress)&&<Btn full variant="secondary" onClick={calcFrete} disabled={cepClean.length<8||lF} style={{marginTop:10}} sfx="click">{lF?<Spin size={14}/>:<><Truck size={15}/> Calcular frete</>}</Btn>}
      {!shippingSkipped&&profileHasSavedAddress&&!editingAddr&&lF&&<div style={{marginTop:10,textAlign:'center',color:'var(--text-dim)',fontSize:'var(--fs-sm)',display:'flex',alignItems:'center',justifyContent:'center',gap:'var(--sp-1)'}}><Spin size={14}/> Calculando frete...</div>}
      {!shippingSkipped&&freteOptions.length>0&&<div style={{marginTop:12}}>
        <div style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--text-dim)',marginBottom:8}}>Opções de envio</div>
        {freteOptions.map((opt,i)=>(<button key={i} onClick={()=>{SFX.toggle();setSelectedFrete(opt);}} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',borderRadius:'var(--r-control)',border:'1px solid '+(selectedFrete===opt?wa(theme.primary,'30'):'var(--line-soft)'),background:selectedFrete===opt?wa(theme.primary,'10'):'var(--text-faint)',cursor:'pointer',marginBottom:4,fontFamily:"'Outfit',sans-serif"}}>
          <div style={{textAlign:'left'}}><div style={{fontSize:'var(--fs-sm)',fontWeight:600,color:selectedFrete===opt?'var(--text-strong)':'var(--text-dim)'}}>{opt.carrier}</div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{opt.deadline_days} dias úteis</div></div>
          <div style={{display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><span style={{fontSize:14,fontWeight:800,color:selectedFrete===opt?theme.primary:'var(--text-dim)'}}>R$ {Number(opt.price).toFixed(2)}</span>{selectedFrete===opt&&<CheckCircle size={16} style={{color:theme.primary}}/>}</div>
        </button>))}
      </div>}
      {selectedFrete&&!shippingSkipped&&!addressUnchanged&&<div style={{marginTop:10,padding:'10px 12px',borderRadius:'var(--r-control)',background:'var(--fill-soft)',border:'1px solid var(--line-soft)'}}>
        <div style={{fontSize:'var(--fs-xs)',fontWeight:700,marginBottom:8}}>Quer salvar esse endereço?</div>
        <div style={{display:'flex',gap:'var(--sp-2)'}}>
          <Btn variant={saveAddressChoice===true?'success':'ghost'} onClick={()=>setSaveAddressChoice(true)} style={{flex:1,padding:'8px 10px',fontSize:'var(--fs-xs)'}} sfx="">Sim</Btn>
          <Btn variant={saveAddressChoice===false?'secondary':'ghost'} onClick={()=>setSaveAddressChoice(false)} style={{flex:1,padding:'8px 10px',fontSize:'var(--fs-xs)'}} sfx="">Não</Btn>
        </div>
      </div>}

      {/* Envio conjunto — só aparece quando há um pedido pago que ainda não foi postado. */}
      {hasUnshippedPaidOrder&&<div style={{marginTop:14,padding:'12px 14px',borderRadius:'var(--r-control)',background:useJointShipping?'rgba(var(--ok-rgb),0.06)':'var(--text-faint)',border:'1px solid '+(useJointShipping?'rgba(var(--ok-rgb),0.2)':'var(--line)')}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'var(--sp-2)'}}>
          <div>
            <div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:useJointShipping?'var(--ok)':'var(--text-strong)',marginBottom:2,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><Truck size={14} style={{flexShrink:0}}/> Envio conjunto</div>
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',lineHeight:1.4}}>Você tem um pedido pago que ainda não foi postado. Mande tudo na mesma remessa e não pague frete de novo.</div>
          </div>
          <button onClick={()=>{SFX.toggle();setUseJointShipping(v=>!v);}} role="switch" aria-checked={useJointShipping} aria-label="Enviar junto com um pedido pago que ainda não foi postado" style={{flexShrink:0,width:44,height:26,borderRadius:'var(--r-control)',border:'none',background:useJointShipping?'var(--ok)':'var(--fill)',cursor:'pointer',position:'relative',transition:'background .2s'}}>
            <div style={{position:'absolute',top:3,left:useJointShipping?22:4,width:20,height:20,borderRadius:'var(--r-control)',background:'#fff',transition:'left .2s',boxShadow:'0 1px 4px rgba(var(--sunk),calc(0.3*var(--sunk-a)))'}}/>
          </button>
        </div>
      </div>}

      <Btn full variant="ghost" onClick={()=>setStep('review')} style={{marginTop:10}} sfx="nav"><ChevronLeft size={14}/> Voltar para revisão</Btn>
    </Card>}

    <Card id="tut-payment" style={{padding:'var(--sp-4)'}}>
      <SectionTitle sub={isAdding?`Só as cartas novas — o frete do pedido #${addTo.shortId} já está pago`:'Pagamento seguro via Mercado Pago'}>Pagamento</SectionTitle>
      <Btn full onClick={finalize} disabled={submitting||(!shippingSkipped&&!selectedFrete)} sfx="">{submitting?<Spin size={16}/>:<><CreditCard size={18}/> Pagar R$ {total.toFixed(2)}</>}</Btn>
    </Card>
    <ImageLightbox src={zoomSrc} onClose={()=>setZoomSrc(null)}/>
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
  const qty=Number(lastOrder.totalPaid)||0;
  return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-4)',alignItems:'center',textAlign:'center',paddingTop:20}}>
    <div style={{width:72,height:72,borderRadius:'var(--r-sheet)',background:'linear-gradient(135deg,'+theme.primary+','+theme.secondary+')',display:'grid',placeItems:'center',boxShadow:'0 0 36px '+theme.glow}}><Check size={32} color="#fff"/></div>
    <div>
      <h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:'var(--fs-xl)'}}>Pedido registrado!</h1>
      <p style={{color:'var(--text-faint)',fontSize:'var(--fs-sm)',margin:'6px 0 0'}}>#{lastOrder.shortId||''} · {qty} carta{qty!==1?'s':''}{lastOrder.total?` · R$ ${Number(lastOrder.total).toFixed(2).replace('.',',')}`:''}</p>
    </div>
    <div style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)',lineHeight:1.6,maxWidth:320}}>Assim que o pagamento cair, seu pedido entra na próxima compra no fornecedor. Você acompanha cada etapa em <b style={{color:'var(--text-muted)'}}>Minha conta → Meus pedidos</b>.</div>
    <div style={{display:'flex',gap:'var(--sp-2)',width:'100%'}}>
      <Btn full variant="secondary" onClick={()=>nav('profile')} sfx="nav"><Package size={16}/> Meus pedidos</Btn>
      <Btn full onClick={()=>nav('catalog')} sfx="nav"><BookOpen size={16}/> Ver catálogo</Btn>
    </div>
  </div>);
}

// ══════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════

function ProfileSection({title,icon:Icon,color,children,defaultOpen=false}){
  const [open,setOpen]=useState(defaultOpen);
  return(<div style={{borderRadius:'var(--r-card)',border:'1px solid var(--line-soft)',overflow:'hidden',background:'var(--fill-soft)'}}>
    <button onClick={()=>setOpen(o=>!o)} style={{width:'100%',background:'none',border:'none',padding:'14px 16px',display:'flex',alignItems:'center',gap:'var(--sp-2)',cursor:'pointer',color:'var(--text)'}}>
      <div style={{width:32,height:32,borderRadius:'var(--r-control)',background:wa(color,'18'),border:'1px solid '+wa(color,'30'),display:'grid',placeItems:'center',flexShrink:0}}><Icon size={15} style={{color}}/></div>
      <span style={{flex:1,textAlign:'left',fontWeight:700,fontSize:14,fontFamily:"'Outfit',sans-serif"}}>{title}</span>
      <ChevronRight size={15} style={{color:'var(--text-faint)',transform:open?'rotate(90deg)':'none',transition:'transform .2s'}}/>
    </button>
    {open&&<div style={{padding:'0 16px 16px',borderTop:'1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))'}}>{children}</div>}
  </div>);
}

// ── Trilha de status do pedido ────────────────────────────────────────────
// Mesma trilha em toda parte (shared/orderStatus.js): o cliente vê aqui o
// mesmo estágio que o admin avança no console.
function OrderTrack({stage}){
  if(stage.terminal)return(<div style={{fontSize:'var(--fs-2xs)',color:stage.color,fontWeight:700,padding:'8px 0'}}>{stage.label} · {stage.hint}</div>);
  return(<div>
    <div style={{display:'flex',alignItems:'flex-start'}}>
      {ORDER_STAGES.map((s,i)=>(<Fragment key={s.key}>
        {i>0&&<div style={{flex:1,height:2,background:i<=stage.index?'var(--ok)':'var(--fill)',marginTop:7}}/>}
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',width:40,flexShrink:0}}>
          <div style={{width:15,height:15,borderRadius:'var(--r-control)',background:i<=stage.index?'var(--ok)':'var(--fill)',display:'grid',placeItems:'center'}}>{i<stage.index?<Check size={9} style={{color:'var(--ok-ink)'}}/>:null}</div>
          <div style={{fontSize:8,color:i<=stage.index?'var(--ok)':'var(--text-faint)',marginTop:3,textAlign:'center',lineHeight:1.2}}>{s.short}</div>
        </div>
      </Fragment>))}
    </div>
    <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-dim)',marginTop:9,lineHeight:1.45}}>{stage.hint}</div>
  </div>);
}

// ── Álbum de coleção ──────────────────────────────────────────────────────
// Percorre o catálogo inteiro dizendo quantas cópias de cada carta a pessoa
// tem. O que veio de pedido pago é fato e não se edita; o "+ / −" mexe só no
// ajuste manual (cartas que ela conseguiu fora do portal).
function CollectionAlbum({token,collection,onSetExtra,theme}){
  const [search,setSearch]=useState('');
  const [typeF,setTypeF]=useState('Todos');
  const [onlyOwned,setOnlyOwned]=useState(false);
  const [cards,setCards]=useState([]);
  const [total,setTotal]=useState(0);
  const [page,setPage]=useState(0);
  const [loading,setLoading]=useState(false);
  const [zoomSrc,setZoomSrc]=useState(null);
  const [busy,setBusy]=useState(null);
  const PAGE_SIZE=24;
  const fetchRef=useRef(0);
  const ownedIds=useMemo(()=>[...collection.owned.keys()],[collection.owned]);

  useEffect(()=>{setPage(0);setCards([]);},[search,typeF,onlyOwned]);
  useEffect(()=>{
    const id=++fetchRef.current;
    const t=setTimeout(async()=>{
      setLoading(true);
      try{
        // "Só as que tenho" filtra por id no servidor — a posse é sabida aqui,
        // então não há motivo para baixar o catálogo inteiro e descartar.
        if(onlyOwned&&ownedIds.length===0){if(id===fetchRef.current){setCards([]);setTotal(0);}return;}
        let filters=`is_active=eq.true&tcg=eq.${encodeURIComponent(CATALOG_TCG)}`;
        if(typeF!=='Todos')filters+=`&type=eq.${encodeURIComponent(typeF)}`;
        if(search)filters+=`&name=ilike.*${encodeURIComponent(search)}*`;
        if(onlyOwned)filters+=`&id=in.(${ownedIds.join(',')})`;
        const [rows,countRows]=await Promise.all([
          sbGet('cards',`select=id,name,type,image_url&${filters}&order=name&limit=${PAGE_SIZE}&offset=${page*PAGE_SIZE}`,token),
          sbGet('cards',`select=id&${filters}`,token),
        ]);
        if(id!==fetchRef.current)return;
        setCards(prev=>page===0?rows:[...prev,...rows.filter(r=>!prev.some(p=>p.id===r.id))]);
        setTotal(countRows.length);
      }catch(e){if(id===fetchRef.current)console.warn('[CollectionAlbum]',e);}
      finally{if(id===fetchRef.current)setLoading(false);}
    },300);
    return()=>{clearTimeout(t);};
  },[search,typeF,onlyOwned,page,token,ownedIds]);

  async function adjust(cardId,delta){
    const current=collection.extras.get(cardId)||0;
    const next=Math.max(0,current+delta);
    if(next===current)return;
    setBusy(cardId);
    try{await onSetExtra(cardId,next);}finally{setBusy(null);}
  }

  return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)'}}>
    <Card style={{padding:'var(--sp-3)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:9}}>
        <div>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:1,fontWeight:600}}>Álbum</div>
          <div style={{fontSize:'var(--fs-xl)',fontWeight:800,color:theme.primary}}>{collection.stats.distinct} <span style={{fontSize:14,color:'var(--text-faint)',fontWeight:400}}>de {collection.stats.total} cartas</span></div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:'var(--fs-lg)',fontWeight:800,color:'var(--ok)'}}>{collection.stats.percent}%</div>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{collection.stats.copies} cópias</div>
        </div>
      </div>
      <div style={{background:'rgba(var(--sunk),calc(0.35*var(--sunk-a)))',borderRadius:'var(--r-pill)',height:8,overflow:'hidden'}}>
        <div style={{width:collection.stats.percent+'%',height:'100%',borderRadius:'var(--r-pill)',background:'linear-gradient(90deg,'+theme.primary+',var(--ok))',transition:'width .5s'}}/>
      </div>
    </Card>

    <Input icon={Search} placeholder="Buscar no álbum..." value={search} onChange={e=>setSearch(e.target.value)}/>
    <div style={{display:'flex',gap:'var(--sp-1)',flexWrap:'wrap'}}>
      {['Todos',...CATALOG_TYPES].map(t=>(
        <button key={t} onClick={()=>{SFX.toggle();setTypeF(t);}} style={{flex:'1 1 60px',padding:'7px 6px',borderRadius:'var(--r-control)',border:'none',background:typeF===t?theme.primary:'var(--text-faint)',color:typeF===t?'var(--gp-ink)':'var(--text-faint)',fontWeight:600,fontSize:'var(--fs-2xs)',cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>{t}</button>
      ))}
      <button onClick={()=>{SFX.toggle();setOnlyOwned(v=>!v);}} aria-pressed={onlyOwned} style={{flex:'1 1 100px',padding:'7px 6px',borderRadius:'var(--r-control)',border:'1px solid '+(onlyOwned?'rgba(var(--ok-rgb),0.4)':'var(--line-soft)'),background:onlyOwned?'rgba(var(--ok-rgb),0.14)':'var(--fill-soft)',color:onlyOwned?'var(--ok)':'var(--text-dim)',fontWeight:700,fontSize:'var(--fs-2xs)',cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>Só as que tenho</button>
    </div>

    <div className="portal-card-grid portal-catalog-grid" style={{opacity:loading?0.55:1,transition:'opacity .15s'}}>
      {cards.map(c=>{
        const bought=collection.bought.get(c.id)||0;
        const extra=collection.extras.get(c.id)||0;
        const owned=bought+extra;
        return(<Card key={c.id} style={{padding:'var(--sp-2)',opacity:owned>0?1:0.55}}>
          <div style={{position:'relative'}} onClick={()=>c.image_url&&setZoomSrc(c.image_url)}>
            <CardThumb card={c}/>
            {owned>0
              ?<div style={{position:'absolute',top:7,left:7}}><Tag color="var(--ok)" style={{fontSize:'var(--fs-2xs)',padding:'2px 7px'}}><Check size={10}/> {owned}</Tag></div>
              :<div style={{position:'absolute',inset:0,borderRadius:12,background:'rgba(var(--sunk),calc(0.45*var(--sunk-a)))',pointerEvents:'none'}}/>}
          </div>
          <div style={{padding:'8px 3px 2px'}}>
            <div style={{fontWeight:700,fontSize:'var(--fs-xs)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</div>
            <div style={{fontSize:'var(--fs-2xs)',color:TC[c.type],fontWeight:700,marginTop:2}}>{c.type}</div>
            <div style={{fontSize:8,color:'var(--text-faint)',marginTop:3,lineHeight:1.3}}>{bought>0?`${bought} do portal`:'nenhuma do portal'}{extra>0?` · ${extra} manual`:''}</div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:4,marginTop:6,background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',borderRadius:'var(--r-control)',border:'1px solid var(--line-soft)'}}>
              <button onClick={()=>adjust(c.id,-1)} disabled={extra===0||busy===c.id} title="Tirar uma cópia do ajuste manual" aria-label={`Tirar uma cópia manual de ${c.name}`} style={{background:'none',border:'none',color:extra===0?'var(--text-faint)':'var(--text-strong)',padding:'7px 10px',cursor:extra===0?'not-allowed':'pointer'}}><Minus size={11}/></button>
              <span style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--text-dim)'}}>{busy===c.id?'…':`+${extra}`}</span>
              <button onClick={()=>adjust(c.id,1)} disabled={busy===c.id} title="Já tenho mais uma cópia desta carta" aria-label={`Marcar mais uma cópia de ${c.name}`} style={{background:'none',border:'none',color:'var(--text-strong)',padding:'7px 10px',cursor:'pointer'}}><Plus size={11}/></button>
            </div>
          </div>
        </Card>);
      })}
      {cards.length===0&&!loading&&<div style={{gridColumn:'1 / -1'}}><EmptyState icon={BookOpen} title={onlyOwned?'Nenhuma carta na coleção ainda':'Nenhuma carta encontrada'} sub={onlyOwned?'Suas compras entram aqui sozinhas quando o pagamento é confirmado':'Tente outro termo'}/></div>}
    </div>

    {cards.length>0&&<div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'var(--sp-2)',padding:'4px 0 8px'}}>
      <div aria-live="polite" style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)'}}>{cards.length} de {total}</div>
      {cards.length<total&&<Btn variant="secondary" disabled={loading} onClick={()=>setPage(p=>p+1)} sfx="nav" style={{minWidth:200}}>{loading?<><Spin size={14}/> Carregando…</>:<>Carregar mais</>}</Btn>}
    </div>}
    <ImageLightbox src={zoomSrc} onClose={()=>setZoomSrc(null)}/>
  </div>);
}

// ── Um pedido na conta do cliente ─────────────────────────────────────────
// A unidade aqui é o PEDIDO, não o lote de pagamento: quem adicionou cartas
// depois enxergava dois "pedidos" onde existe uma remessa só.
// Troca de endereço de uma remessa já paga. Vale para a caixa inteira (o
// pedido, as cartas adicionadas e os pedidos que pegaram carona no frete).
// Frete mais caro no endereço novo → o cliente paga a diferença e o endereço
// só troca quando o pagamento cai. Regras em shared/shippingAddressChange.js.
function ShipmentAddressEditor({order,allBatches,token,toastFn,onReloadOrders}){
  const mine=useMemo(()=>(allBatches||[]).map(b=>({...b,userId:'me'})),[allBatches]);
  const paidBatch=order.batches.find(b=>isPaidBatchStatus(b)&&!isShippingAdjustment(b));
  const shipment=paidBatch?shipmentOf(mine,paidBatch.id):null;
  const [editing,setEditing]=useState(false);
  const [addr,setAddr]=useState({});
  const [options,setOptions]=useState(null);
  const [service,setService]=useState(null);
  const [busy,setBusy]=useState(false);
  if(!shipment)return null;

  const current=shipment.rootBatch?.shipping_address||null;
  const pending=pendingAdjustmentOf(mine,shipment);
  const canChange=canChangeShipmentAddress(shipment)&&!pending;
  const otherOrders=new Set(shipment.batches.map(b=>String(b.order_id))).size-1;
  const fmt=v=>'R$ '+Number(v||0).toFixed(2).replace('.',',');
  const call=async payload=>{
    const r=await fetch('/api/change-shipping-address',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({batchId:String(paidBatch.id),address:addr,...payload})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);
    return j;
  };

  function startEdit(){setAddr({cep:'',rua:'',numero:'',complemento:'',bairro:'',cidade:'',uf:''});setOptions(null);setService(null);setEditing(true);}
  async function quote(){
    setBusy(true);setOptions(null);
    try{
      const j=await call({});
      setOptions(j.options);
      const keep=j.options.find(o=>o.service===j.currentService)||j.options[0];
      setService(keep?.service||null);
    }catch(e){toastFn('Erro: '+e.message,'error');}
    setBusy(false);
  }
  async function confirmChange(){
    const chosen=(options||[]).find(o=>o.service===service);
    if(!chosen)return;
    if(chosen.difference>0&&!confirm(`O frete para o endereço novo fica ${fmt(chosen.difference)} mais caro. O endereço só muda depois que você pagar essa diferença. Continuar?`))return;
    setBusy(true);
    try{
      const j=await call({service,confirm:true});
      if(j.applied){toastFn('Endereço de entrega atualizado!','success');setEditing(false);onReloadOrders&&onReloadOrders();setBusy(false);return;}
      toastFn('Gerando link de pagamento da diferença...','info');
      const mpRes=await fetch('/api/mp-create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:String(j.adjustmentBatchId),total:j.difference,descricao:`Diferença de frete - pedido #${j.rootShortId}`})});
      const mp=await mpRes.json().catch(()=>({}));
      const link=mp?.mpLink||mp?.init_point;
      if(link){window.location.href=link;return;}
      toastFn('Cobrança criada. Use o botão "Pagar diferença de frete" no pedido.','info');
      setEditing(false);onReloadOrders&&onReloadOrders();
    }catch(e){toastFn('Erro: '+e.message,'error');}
    setBusy(false);
  }

  const label={fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--text-faint)',marginBottom:6,textTransform:'uppercase',letterSpacing:1};
  return(<div style={{marginTop:10}}>
    <div style={label}>Endereço de entrega</div>
    {!editing&&<>
      {current?<AddressDisplay address={current} onEdit={canChange?startEdit:undefined}/>:
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,fontSize:'var(--fs-xs)',color:'var(--text-dim)'}}>
          <span>Endereço do seu cadastro</span>
          {canChange&&<Btn variant="secondary" onClick={startEdit} style={{fontSize:'var(--fs-2xs)',padding:'6px 10px'}} sfx="nav"><Edit3 size={12}/> Trocar</Btn>}
        </div>}
      {pending&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--gold)',marginTop:6,lineHeight:1.4}}>
        Troca para {pending.shipping_address?.rua}{pending.shipping_address?.numero?', '+pending.shipping_address.numero:''} ({pending.shipping_address?.cidade}/{pending.shipping_address?.uf}) aguardando o pagamento da diferença de {fmt(pending.total_locked)}.
      </div>}
      {!canChange&&!pending&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginTop:6}}>A etiqueta já foi gerada — o endereço não pode mais ser trocado por aqui.</div>}
    </>}
    {editing&&<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>
      {otherOrders>0&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-dim)'}}>Vale também para {otherOrders} outro{otherOrders>1?'s':''} pedido{otherOrders>1?'s':''} que vão na mesma caixa.</div>}
      <AddressForm address={addr} setAddress={a=>{setAddr(a);setOptions(null);}}/>
      {!options&&<Btn full onClick={quote} disabled={busy} style={{fontSize:'var(--fs-xs)',padding:'10px 12px'}}>{busy?<Spin size={14}/>:<><Truck size={13}/> Calcular frete</>}</Btn>}
      {options&&<div style={{display:'flex',flexDirection:'column',gap:6}}>
        {options.map(o=>{const sel=o.service===service;return(
          <button key={o.service} onClick={()=>setService(o.service)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 12px',borderRadius:'var(--r-control)',border:'1px solid '+(sel?'var(--gp)':'var(--line)'),background:sel?'var(--fill)':'transparent',color:'var(--text)',cursor:'pointer',fontFamily:"'Outfit',sans-serif",fontSize:'var(--fs-xs)'}}>
            <span style={{fontWeight:700}}>{o.service}{o.prazo?<span style={{fontWeight:400,color:'var(--text-faint)'}}> · {o.prazo} dias úteis</span>:null}</span>
            <span style={{fontWeight:700,color:o.difference>0?'var(--gold)':'var(--ok)'}}>{o.difference>0?`+ ${fmt(o.difference)}`:'Sem custo'}</span>
          </button>);})}
        <Btn full onClick={confirmChange} disabled={busy||!service} style={{fontSize:'var(--fs-xs)',padding:'10px 12px'}}>{busy?<Spin size={14}/>:<><Check size={13}/> Confirmar novo endereço</>}</Btn>
      </div>}
      <Btn full variant="ghost" onClick={()=>setEditing(false)} disabled={busy} style={{fontSize:'var(--fs-2xs)',padding:'6px'}} sfx="">Cancelar</Btn>
    </div>}
  </div>);
}

function ClientOrderCard({order,allBatches,token,theme,expanded,onToggle,onAddCards,canAdd,onReloadOrders,toastFn}){
  const [cards,setCards]=useState(null);
  const [loadingCards,setLoadingCards]=useState(false);
  const stage=order.stage;
  const pendingBatches=order.batches.filter(b=>!isPaidBatchStatus(b)&&!resolveOrderStage(b).terminal);

  useEffect(()=>{
    if(!expanded||cards!==null)return;
    let alive=true;
    setLoadingCards(true);
    Promise.all(order.batches.map(b=>b.cards?Promise.resolve(b.cards):loadOrderCards(b,token)))
      .then(lists=>{
        if(!alive)return;
        const merged=new Map();
        lists.flat().forEach(c=>{
          const key=`${c.name}|${c.type}`;
          merged.set(key,{...c,qty:(merged.get(key)?.qty||0)+Number(c.qty||0)});
        });
        setCards([...merged.values()]);
      })
      .catch(()=>{if(alive)setCards([]);})
      .finally(()=>{if(alive)setLoadingCards(false);});
    return()=>{alive=false;};
  },[expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  return(<div style={{borderRadius:'var(--r-control)',border:`1px solid ${wa(stage.color,'2a')}`,overflow:'hidden',background:'rgba(var(--sunk),calc(0.2*var(--sunk-a)))'}}>
    <button onClick={onToggle} style={{width:'100%',padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'var(--sp-2)',background:'none',border:'none',cursor:'pointer',color:'var(--text)',fontFamily:"'Outfit',sans-serif",textAlign:'left'}}>
      <div style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',minWidth:0}}>
        <div style={{width:36,height:36,borderRadius:'var(--r-control)',background:wa(stage.color,'1a'),display:'grid',placeItems:'center',flexShrink:0}}><Package size={15} style={{color:stage.color}}/></div>
        <div style={{minWidth:0}}>
          <div style={{fontSize:'var(--fs-xs)',fontWeight:700}}>#{order.shortId} · R$ {order.total.toFixed(2).replace('.',',')}</div>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{order.qty} carta{order.qty!==1?'s':''} · {new Date(order.createdAt).toLocaleDateString('pt-BR')}{order.batches.length>1?` · ${order.batches.length} lotes`:''}</div>
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'var(--sp-1)',flexShrink:0}}>
        <Tag color={stage.color} style={{fontSize:'var(--fs-2xs)'}}>{stage.short}</Tag>
        <ChevronRight size={13} style={{color:'var(--text-faint)',transform:expanded?'rotate(90deg)':'none',transition:'transform .2s'}}/>
      </div>
    </button>
    {expanded&&<div style={{padding:'0 14px 12px',borderTop:'1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))'}}>
      <div style={{marginTop:12,padding:'10px 12px',borderRadius:'var(--r-control)',background:'rgba(var(--sunk),calc(0.22*var(--sunk-a)))'}}>
        <div style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--text-faint)',marginBottom:8,textTransform:'uppercase',letterSpacing:1}}>Status</div>
        <OrderTrack stage={stage}/>
        {order.tracking&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--ok)',marginTop:10,fontWeight:600}}>Rastreio: {order.tracking}{order.trackingStatus?` · ${order.trackingStatus}`:''}</div>}
      </div>

      <div style={{marginTop:10}}>
        <div style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--text-faint)',marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>Cartas</div>
        {loadingCards?<div style={{textAlign:'center',padding:10}}><Spin size={16}/></div>:
        (cards&&cards.length>0)?cards.map((c,ci,arr)=>(
          <div key={ci} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:'var(--fs-xs)',borderBottom:ci<arr.length-1?'1px solid rgba(var(--ink),calc(0.03*var(--ink-a)))':'none'}}>
            <span style={{color:'var(--text-dim)'}}>{c.name} <span style={{color:TC[c.type]||'var(--text-faint)',fontSize:'var(--fs-2xs)',fontWeight:700}}>{c.type||''}</span></span>
            <span style={{fontWeight:700}}>x{c.qty}</span>
          </div>
        )):<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>Detalhes não disponíveis</div>}
      </div>

      <ShipmentAddressEditor order={order} allBatches={allBatches} token={token} toastFn={toastFn} onReloadOrders={onReloadOrders}/>

      {canAdd&&<div style={{marginTop:12,paddingTop:10,borderTop:'1px solid rgba(var(--ink),calc(0.05*var(--ink-a)))'}}>
        <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-dim)',lineHeight:1.4,marginBottom:8}}>A compra no fornecedor ainda não foi feita — dá tempo de mandar mais cartas para este mesmo pedido, sem pagar frete de novo.</div>
        <Btn full variant="secondary" onClick={()=>onAddCards(order)} style={{fontSize:'var(--fs-2xs)',padding:'9px 12px'}} sfx="nav"><Plus size={13}/> Adicionar cartas a este pedido</Btn>
      </div>}

      {pendingBatches.map(b=>(
        <div key={b.id} style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:'var(--sp-2)',marginTop:10}}>
          <Btn variant="warn" onClick={()=>pagarAgoraPedido(b,toastFn)} style={{width:'100%',fontSize:'var(--fs-2xs)',justifyContent:'center'}} sfx="nav"><CreditCard size={12}/> {isShippingAdjustment(b)?'Pagar diferença de frete':'Pagar'} R$ {Number(b.total_locked||0).toFixed(2).replace('.',',')}</Btn>
          <Btn variant="ghost" title="Conferir pagamento" onClick={async()=>{try{await mpSync(b.id);onReloadOrders();}catch(err){toastFn('Erro: '+(err.message||String(err)),'error');}}} style={{fontSize:'var(--fs-2xs)',justifyContent:'center'}} sfx=""><RefreshCw size={12}/></Btn>
          <Btn variant="danger" onClick={async()=>{if(!confirm(isShippingAdjustment(b)?'Cancelar a troca de endereço? O envio segue para o endereço atual.':'Cancelar este pedido?'))return;try{const res=await fetch('/api/cancel-order',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({batchId:String(b.id),orderId:String(b.order_id||'')})});const j=await res.json().catch(()=>({}));if(!res.ok||!j.ok)throw new Error(j.error||'Falha');toastFn('Pedido cancelado','success');onReloadOrders();}catch(err){toastFn('Erro: '+(err.message||String(err)),'error');}}} style={{fontSize:'var(--fs-2xs)',justifyContent:'center'}} sfx=""><X size={12}/></Btn>
        </div>
      ))}
    </div>}
  </div>);
}

const ACCOUNT_TABS=[
  {key:'orders',label:'Pedidos',icon:Package},
  {key:'collection',label:'Coleção',icon:BookOpen},
  {key:'account',label:'Conta',icon:User},
];

function ProfileView({profile,token,theme,nav,isAdmin,setShowTutorial,onSaveProfile,onLogout,myOrders=[],onReloadOrders,toast:toastFn,colorMode='dark',onColorModeChange=()=>{},openIndividualOrders={},onAddCards,collection,onSetExtra,initialTab='orders'}){
  const [tab,setTab]=useState(initialTab);
  const [colors,setColors]=useState(profile?.mana_color_1&&profile?.mana_color_2?[profile.mana_color_1,profile.mana_color_2]:['U','R']);
  const [editAddr,setEditAddr]=useState(false);
  const [addr,setAddr]=useState({cep:profile?.cep||'',rua:profile?.rua||'',numero:profile?.numero||'',complemento:profile?.complemento||'',bairro:profile?.bairro||'',cidade:profile?.cidade||'',uf:profile?.uf||''});
  const [saving,setSaving]=useState(false);
  const [editName,setEditName]=useState(false);
  const [nameVal,setNameVal]=useState(profile?.name||'');
  const [wppVal,setWppVal]=useState(profile?.whatsapp||'');
  const [expandedOrder,setExpandedOrder]=useState(null);
  const [showChangePw,setShowChangePw]=useState(false);
  const [newPw,setNewPw]=useState('');const [newPw2,setNewPw2]=useState('');
  const [pwVK,setPwVK]=useState(false);const [pwVKTarget,setPwVKTarget]=useState('pw1');
  const [pwLoading,setPwLoading]=useState(false);const [pwMsg,setPwMsg]=useState(null);
  const [showArchived,setShowArchived]=useState(false);

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

  // Lotes → pedidos. A conta fala em pedidos; lote é detalhe de pagamento.
  const orders=useMemo(()=>groupBatchesIntoOrders(myOrders),[myOrders]);
  const liveOrders=orders.filter(o=>!o.stage.terminal&&o.stage.key!=='DELIVERED');
  const doneOrders=orders.filter(o=>o.stage.terminal||o.stage.key==='DELIVERED');
  const totalSpent=orders.filter(o=>!o.stage.terminal).reduce((s,o)=>s+o.total,0);

  return(<div className="portal-page portal-profile" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)'}}>

    {/* Cabeçalho da conta */}
    <div style={{borderRadius:'var(--r-card)',padding:'var(--sp-4)',background:`linear-gradient(135deg,${gT?wa(gT.primary,'22'):'var(--text-faint)'} 0%,rgba(var(--sunk),0) 100%)`,border:`1px solid ${gT?wa(gT.primary,'30'):'var(--line)'}`,position:'relative',overflow:'hidden'}}>
      {gT&&<div style={{position:'absolute',inset:0,background:`radial-gradient(ellipse at 80% 50%,${gT.glow||gT.primary}18 0%,transparent 70%)`,pointerEvents:'none'}}/>}
      <div style={{display:'flex',alignItems:'center',gap:'var(--sp-3)',position:'relative'}}>
        <div style={{width:56,height:56,borderRadius:'var(--r-card)',background:gT?`linear-gradient(135deg,${gT.primary},${gT.secondary})`:'var(--text-faint)',display:'grid',placeItems:'center',fontSize:24,flexShrink:0,boxShadow:gT?`0 0 20px ${gT.glow||gT.primary}40`:'none'}}>
          {guild?'⚔️':'👤'}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:800,fontSize:'var(--fs-lg)',fontFamily:"'Cinzel',serif",overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{profile?.name||'Aventureiro'}</div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{profile?.email||guild||'Escolha sua guilda'}</div>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'var(--sp-2)',marginTop:14,position:'relative'}}>
        {[
          {v:orders.length,l:'pedidos'},
          {v:collection?.stats?.copies||0,l:'cartas'},
          {v:'R$ '+totalSpent.toFixed(0),l:'comprados'},
        ].map(x=>(<div key={x.l} style={{textAlign:'center',padding:'8px 4px',borderRadius:'var(--r-control)',background:'rgba(var(--sunk),calc(0.25*var(--sunk-a)))'}}>
          <div style={{fontSize:'var(--fs-md)',fontWeight:800,color:'var(--text-strong)'}}>{x.v}</div>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{x.l}</div>
        </div>))}
      </div>
    </div>

    {/* Abas da conta */}
    <div role="tablist" aria-label="Seções da conta" style={{display:'flex',gap:'var(--sp-1)'}}>
      {ACCOUNT_TABS.map(t=>{
        const active=tab===t.key;
        return(<button key={t.key} role="tab" aria-selected={active} onClick={()=>{SFX.toggle();setTab(t.key);}} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:5,padding:'10px 8px',borderRadius:'var(--r-control)',border:'1px solid '+(active?wa(theme.primary,'55'):'var(--line-soft)'),background:active?wa(theme.primary,'18'):'var(--fill-soft)',color:active?theme.primary:'var(--text-dim)',fontWeight:700,fontSize:'var(--fs-xs)',fontFamily:"'Outfit',sans-serif",cursor:'pointer'}}>
          <t.icon size={14}/>{t.label}
        </button>);
      })}
    </div>

    {tab==='orders'&&<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>
      {orders.length===0&&<EmptyState icon={Package} title="Nenhum pedido ainda" sub="Monte sua primeira encomenda pelo catálogo" action={<Btn onClick={()=>nav('catalog')} sfx="nav"><BookOpen size={15}/> Ver catálogo</Btn>}/>}
      {liveOrders.map(o=>{
        const addOpen=openIndividualOrders[String(o.orderId)];
        return <ClientOrderCard key={o.orderId} order={o} allBatches={myOrders} token={token} theme={theme} expanded={expandedOrder===o.orderId} onToggle={()=>setExpandedOrder(expandedOrder===o.orderId?null:o.orderId)} onAddCards={()=>onAddCards&&onAddCards(o)} canAdd={!!onAddCards&&!!addOpen} onReloadOrders={onReloadOrders} toastFn={toastFn}/>;
      })}
      {doneOrders.length>0&&<>
        <button onClick={()=>{SFX.toggle();setShowArchived(v=>!v);}} style={{background:'none',border:'none',color:'var(--text-faint)',fontSize:'var(--fs-2xs)',fontWeight:700,cursor:'pointer',fontFamily:"'Outfit',sans-serif",padding:'6px 2px',textAlign:'left',display:'flex',alignItems:'center',gap:4}}>
          <Archive size={12}/> Concluídos ({doneOrders.length}) <ChevronRight size={12} style={{transform:showArchived?'rotate(90deg)':'none',transition:'transform .2s'}}/>
        </button>
        {showArchived&&doneOrders.map(o=>(
          <ClientOrderCard key={o.orderId} order={o} allBatches={myOrders} token={token} theme={theme} expanded={expandedOrder===o.orderId} onToggle={()=>setExpandedOrder(expandedOrder===o.orderId?null:o.orderId)} canAdd={false} onReloadOrders={onReloadOrders} toastFn={toastFn}/>
        ))}
      </>}
    </div>}

    {tab==='collection'&&<CollectionAlbum token={token} collection={collection} onSetExtra={onSetExtra} theme={theme}/>}

    {tab==='account'&&<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>
      {/* Dados pessoais */}
      <ProfileSection title="Dados pessoais" icon={User} color={theme.primary} defaultOpen={true}>
        <div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)',marginTop:12}}>
          {editName?<>
            <Input icon={User} placeholder="Seu nome" value={nameVal} onChange={e=>setNameVal(e.target.value)}/>
            <Input icon={Phone} placeholder="WhatsApp" value={wppVal} onChange={e=>setWppVal(e.target.value.replace(/\D/g,'').slice(0,11))}/>
            <div style={{display:'flex',gap:'var(--sp-2)'}}>
              <Btn variant="success" onClick={savePessoal} disabled={saving} style={{flex:1}} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar</>}</Btn>
              <Btn variant="ghost" onClick={()=>setEditName(false)} style={{flex:1}} sfx="click">Cancelar</Btn>
            </div>
          </>:<div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginBottom:2}}>Nome</div>
              <div style={{fontSize:14,fontWeight:600}}>{profile?.name||'—'}</div>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginBottom:2}}>WhatsApp</div>
              <div style={{fontSize:14,fontWeight:600}}>{profile?.whatsapp||'—'}</div>
            </div>
            <button onClick={()=>setEditName(true)} style={{background:'var(--fill)',border:'1px solid var(--line)',borderRadius:'var(--r-control)',padding:'6px 10px',cursor:'pointer',color:'var(--text-dim)',display:'flex',alignItems:'center',gap:'var(--sp-1)',fontSize:'var(--fs-2xs)'}}><Edit3 size={12}/> Editar</button>
          </div>}
        </div>
      </ProfileSection>

      {/* Endereço */}
      <ProfileSection title="Endereço de entrega" icon={MapPin} color="var(--gold)">
        <div style={{marginTop:12}}>
          {editAddr?<>
            <AddressForm address={addr} setAddress={setAddr}/>
            <div style={{display:'flex',gap:'var(--sp-2)',marginTop:10}}>
              <Btn variant="success" onClick={saveAddr} disabled={saving} style={{flex:1}} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar</>}</Btn>
              <Btn variant="ghost" onClick={()=>setEditAddr(false)} style={{flex:1}} sfx="click">Cancelar</Btn>
            </div>
          </>:<AddressDisplay address={addr} onEdit={()=>setEditAddr(true)}/>}
        </div>
      </ProfileSection>

      <ProfileSection title="Aparência" icon={colorMode==='light'?Sun:Moon} color="var(--gold)">
        <div style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)',marginBottom:10,lineHeight:1.5}}>Escolha como o portal aparece neste aparelho. A preferência fica salva aqui mesmo.</div>
        <div style={{display:'flex',gap:'var(--sp-1)'}}>
          {[{key:'dark',label:'Escuro',icon:Moon},{key:'light',label:'Claro',icon:Sun}].map(opt=>{
            const active=colorMode===opt.key;
            return(<button key={opt.key} onClick={()=>{SFX.toggle();onColorModeChange(opt.key);}} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:'var(--sp-1)',padding:'11px 8px',borderRadius:'var(--r-control)',border:'1px solid '+(active?wa(theme.primary,'55'):'var(--line)'),background:active?wa(theme.primary,'18'):'var(--text-faint)',color:active?theme.primary:'var(--text-dim)',fontSize:'var(--fs-sm)',fontWeight:700,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>
              <opt.icon size={15}/>{opt.label}
            </button>);
          })}
        </div>
      </ProfileSection>

      <ProfileSection title="Guilda & mana" icon={Sparkles} color="var(--indiv)">
        <div style={{marginTop:12}}>
          <div style={{display:'flex',justifyContent:'center',gap:'var(--sp-3)',margin:'10px 0'}}>{MANA_COLORS.map(m=><ManaOrb key={m.key} mana={m.key} selected={colors.includes(m.key)} onClick={()=>toggleC(m.key)} size={44}/>)}</div>
          {guild&&<div style={{textAlign:'center',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'center',gap:'var(--sp-2)'}}><GuildBadge guild={guild} size={16}/><span style={{fontWeight:700,fontSize:14,color:gT?gT.primary:'var(--text-strong)'}}>{guild}</span></div>}
          {changed&&guild&&<Btn full variant="success" onClick={saveGuild} disabled={saving} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar guilda</>}</Btn>}
        </div>
      </ProfileSection>

      <ProfileSection title="Alterar senha" icon={Lock} color="var(--danger)">
        <div style={{marginTop:12}}>
          {!showChangePw?<Btn full variant="ghost" onClick={()=>setShowChangePw(true)} sfx="click"><Lock size={14}/> Alterar senha</Btn>:
          <div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>
            <div onClick={()=>{setPwVKTarget('pw1');setPwVK(true);}} style={{padding:'12px 14px 12px 42px',borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',cursor:'pointer',position:'relative',minHeight:44}}>
              <Lock size={16} style={{position:'absolute',left:13,top:'50%',transform:'translateY(-50%)',color:'var(--text-faint)'}}/>
              {newPw?<span style={{letterSpacing:6}}>{'●'.repeat(newPw.length)}</span>:<span style={{color:'var(--text-faint)',fontSize:'var(--fs-sm)'}}>Nova senha (6 dígitos)</span>}
            </div>
            <div onClick={()=>{setPwVKTarget('pw2');setPwVK(true);}} style={{padding:'12px 14px 12px 42px',borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',cursor:'pointer',position:'relative',minHeight:44}}>
              <Lock size={16} style={{position:'absolute',left:13,top:'50%',transform:'translateY(-50%)',color:'var(--text-faint)'}}/>
              {newPw2?<span style={{letterSpacing:6}}>{'●'.repeat(newPw2.length)}</span>:<span style={{color:'var(--text-faint)',fontSize:'var(--fs-sm)'}}>Confirmar senha</span>}
            </div>
            {pwVK&&<VirtualKeyboard onKey={pwVKKey} onBackspace={pwVKBack} onDone={()=>setPwVK(false)} maxLen={6} currentLen={pwVKTarget==='pw1'?newPw.length:newPw2.length} doneLabel="Fechar"/>}
            {pwMsg&&<div style={{fontSize:'var(--fs-xs)',color:pwMsg.t==='error'?'var(--danger)':'var(--ok)',textAlign:'center'}}>{pwMsg.m}</div>}
            <div style={{display:'flex',gap:'var(--sp-2)'}}>
              <Btn variant="success" onClick={changePassword} disabled={pwLoading} style={{flex:1}} sfx="success">{pwLoading?<Spin size={14}/>:<><Check size={14}/> Confirmar</>}</Btn>
              <Btn variant="ghost" onClick={()=>{setShowChangePw(false);setNewPw('');setNewPw2('');setPwMsg(null);}} style={{flex:1}} sfx="click">Cancelar</Btn>
            </div>
          </div>}
        </div>
      </ProfileSection>

      <div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)',marginTop:4}}>
        <Btn full variant="secondary" onClick={()=>{SFX.nav();setShowTutorial(true);}} sfx=""><HelpCircle size={15}/> Ver tutorial</Btn>
        {isAdmin&&<Btn full variant="warn" onClick={()=>nav('admin')} sfx="nav"><Shield size={15}/> Painel Admin</Btn>}
        <Btn full variant="danger" onClick={onLogout} sfx="click"><LogOut size={14}/> Sair</Btn>
      </div>
    </div>}

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
    const cleanEmail=email.trim().toLowerCase();
    if(!senhaOk){setErr('A senha deve conter 6 números');return;}
    if(mode==='signup'&&senha!==senha2){setErr('As senhas não coincidem');return;}
    setLoading(true);
    try {
      if(mode==='signup'){
        if(!name){setErr('Preencha o nome');setLoading(false);return;}
        if(!whatsapp||whatsapp.length<10){setErr('WhatsApp inválido');setLoading(false);return;}
        const res=await sbAuthSignUp(cleanEmail,senha);
        let session;
        if (res.access_token) session = res;
        else if (res.session?.access_token) session = res.session;
        else session = await sbAuthSignIn(cleanEmail, senha);
        const userId = session.user?.id || res.user?.id;
        const token = session.access_token;
        await sbUpsert('profiles', { id: userId, name, whatsapp, email: cleanEmail, is_admin: false }, token);
        SFX.confirm();
        onLogin(session, 'signup');
      } else {
        const res=await sbAuthSignIn(cleanEmail,senha);
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
    const cleanEmail=email.trim().toLowerCase();
    if(!cleanEmail.includes('@')){setErr('Digite seu email primeiro');return;}
    setErr('');setLoading(true);
    try{
      await sbAuthResetPassword(cleanEmail);
      setResetSent(true);SFX.success();
    }catch(e){setErr(e.message);}
    setLoading(false);
  }

  if(forgotMode)return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)',paddingTop:16}}>
    <div style={{textAlign:'center'}}><div style={{fontSize:34,marginBottom:4}}>🔑</div><h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:'var(--fs-xl)'}}>Recuperar Senha</h1></div>
    {resetSent?<Card glow="rgba(var(--ok-rgb),0.15)" style={{padding:'var(--sp-4)',textAlign:'center'}}>
      <Check size={32} style={{color:'var(--ok)',marginBottom:8}}/>
      <div style={{fontWeight:700,color:'var(--ok)',fontSize:'var(--fs-md)'}}>Email enviado!</div>
      <div style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',marginTop:6}}>Verifique sua caixa de entrada e spam. Clique no link para redefinir sua senha.</div>
      <Btn full variant="secondary" onClick={()=>{setForgotMode(false);setResetSent(false);}} style={{marginTop:16}} sfx="nav">Voltar ao login</Btn>
    </Card>:<>
      <div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',textAlign:'center'}}>Digite seu email e enviaremos um link para redefinir sua senha.</div>
      <Input icon={Mail} type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="seu@email.com" value={email} onChange={e=>setEmail(e.target.value)}/>
      {err&&<div style={{fontSize:'var(--fs-xs)',color:'var(--danger)',textAlign:'center',padding:'var(--sp-1)'}}><AlertTriangle size={12}/> {err}</div>}
      <Btn full onClick={handleForgot} disabled={!email.includes('@')||loading} sfx="">{loading?<Spin size={16}/>:<><Mail size={16}/> Enviar link de recuperação</>}</Btn>
      <button onClick={()=>{setForgotMode(false);setErr('');}} style={{background:'none',border:'none',color:'var(--gp)',fontSize:'var(--fs-sm)',cursor:'pointer',fontFamily:"'Outfit',sans-serif",padding:'var(--sp-2)',textAlign:'center'}}>Voltar ao login</button>
    </>}
  </div>);

  return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)',paddingTop:16}}>
    <div style={{textAlign:'center'}}><div style={{fontSize:34,marginBottom:4}}>⚔️</div><h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:'var(--fs-xl)'}}>{mode==='login'?'Bem-vindo':'Junte-se'}</h1></div>
    <div style={{display:'flex',borderRadius:'var(--r-control)',background:'var(--fill-soft)',padding:'var(--sp-1)',gap:'var(--sp-1)'}}>{['login','signup'].map(m=>(<button key={m} onClick={()=>{SFX.toggle();setMode(m);setErr('');setSenha('');setSenha2('');setShowVK(false);}} style={{flex:1,padding:'9px 0',borderRadius:'var(--r-control)',border:'none',background:mode===m?'var(--fill)':'transparent',color:mode===m?'var(--text-strong)':'var(--text-faint)',fontWeight:700,fontSize:'var(--fs-sm)',cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>{m==='login'?'Entrar':'Criar conta'}</button>))}</div>
    {mode==='signup'&&<Input icon={User} placeholder="Seu nome" value={name} onChange={e=>setName(e.target.value)}/>}
    <Input icon={Mail} type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="seu@email.com" value={email} onChange={e=>setEmail(e.target.value)}/>
    {mode==='signup'&&<Input icon={Phone} placeholder="WhatsApp (11999999999)" value={whatsapp} onChange={e=>setWhatsapp(e.target.value.replace(/\D/g,'').slice(0,11))}/>}
    <div>
      <div onClick={()=>openVK('senha')} style={{width:'100%',padding:'13px 14px 13px 42px',borderRadius:'var(--r-card)',border:'1px solid '+(showVK&&vkTarget==='senha'?'var(--gp)':'var(--line)'),background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',color:senha?'var(--text)':'var(--text-faint)',fontSize:'var(--fs-md)',fontFamily:"'Outfit',sans-serif",cursor:'pointer',position:'relative',boxSizing:'border-box',minHeight:46}}>
        <Lock size={18} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'var(--text-faint)'}}/>
        {senha?<span style={{letterSpacing:6}}>{'●'.repeat(senha.length)}<span style={{color:'var(--text-faint)',letterSpacing:4}}>{'○'.repeat(6-senha.length)}</span></span>:'Senha (6 dígitos)'}
      </div>
    </div>
    {mode==='signup'&&<div>
      <div onClick={()=>openVK('senha2')} style={{width:'100%',padding:'13px 14px 13px 42px',borderRadius:'var(--r-card)',border:'1px solid '+(showVK&&vkTarget==='senha2'?'var(--gp)':'var(--line)'),background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',color:senha2?'var(--text)':'var(--text-faint)',fontSize:'var(--fs-md)',fontFamily:"'Outfit',sans-serif",cursor:'pointer',position:'relative',boxSizing:'border-box',minHeight:46}}>
        <Lock size={18} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'var(--text-faint)'}}/>
        {senha2?<span style={{letterSpacing:6}}>{'●'.repeat(senha2.length)}<span style={{color:'var(--text-faint)',letterSpacing:4}}>{'○'.repeat(6-senha2.length)}</span></span>:'Confirmar senha'}
      </div>
      {senha2.length===6&&senha!==senha2&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--danger)',marginTop:4,textAlign:'center'}}>As senhas não coincidem</div>}
    </div>}
    {showVK&&<div style={{marginTop:4}}><VirtualKeyboard onKey={vkKey} onBackspace={vkBack} onDone={()=>setShowVK(false)} maxLen={6} currentLen={currentVKLen} doneLabel="Fechar"/></div>}
    {err&&<div style={{fontSize:'var(--fs-xs)',color:'var(--danger)',textAlign:'center',padding:'var(--sp-1)'}}><AlertTriangle size={12}/> {err}</div>}
    <Btn full onClick={submit} disabled={!canSubmit} sfx="">{loading?<Spin size={16}/>:<>{mode==='login'?'Entrar':'Criar conta'} <ArrowRight size={16}/></>}</Btn>
    {mode==='login'&&<button onClick={()=>{setForgotMode(true);setErr('');}} style={{background:'none',border:'none',color:'var(--text-faint)',fontSize:'var(--fs-xs)',cursor:'pointer',fontFamily:"'Outfit',sans-serif",padding:'var(--sp-1)',textAlign:'center'}}>Esqueci minha senha</button>}
  </div>);
}

// ══════════════════════════════════════════════════════
// PASSWORD RECOVERY PAGE
// ══════════════════════════════════════════════════════

function RecoveryPage({token,onDone,theme}){
  const [pw,setPw]=useState('');const [pw2,setPw2]=useState('');
  const [showVK,setShowVK]=useState(false);const [vkTarget,setVkTarget]=useState('pw');
  const [loading,setLoading]=useState(false);const [err,setErr]=useState('');
  const currentVKLen=vkTarget==='pw'?pw.length:pw2.length;
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
  return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)',paddingTop:16}}>
    <div style={{textAlign:'center'}}><div style={{fontSize:34,marginBottom:4}}>🔑</div><h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:'var(--fs-xl)'}}>Nova Senha</h1><p style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',marginTop:6}}>Digite sua nova senha de 6 dígitos</p></div>
    <div onClick={()=>{setVkTarget('pw');setShowVK(true);}} style={{width:'100%',padding:'13px 14px 13px 42px',borderRadius:'var(--r-card)',border:'1px solid '+(showVK&&vkTarget==='pw'?'var(--gp)':'var(--line)'),background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',color:pw?'var(--text)':'var(--text-faint)',fontSize:'var(--fs-md)',fontFamily:"'Outfit',sans-serif",cursor:'pointer',position:'relative',boxSizing:'border-box',minHeight:46}}>
      <Lock size={18} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'var(--text-faint)'}}/>
      {pw?<span style={{letterSpacing:6}}>{'●'.repeat(pw.length)}<span style={{color:'var(--text-faint)',letterSpacing:4}}>{'○'.repeat(6-pw.length)}</span></span>:'Nova senha'}
    </div>
    <div onClick={()=>{setVkTarget('pw2');setShowVK(true);}} style={{width:'100%',padding:'13px 14px 13px 42px',borderRadius:'var(--r-card)',border:'1px solid '+(showVK&&vkTarget==='pw2'?'var(--gp)':'var(--line)'),background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',color:pw2?'var(--text)':'var(--text-faint)',fontSize:'var(--fs-md)',fontFamily:"'Outfit',sans-serif",cursor:'pointer',position:'relative',boxSizing:'border-box',minHeight:46}}>
      <Lock size={18} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'var(--text-faint)'}}/>
      {pw2?<span style={{letterSpacing:6}}>{'●'.repeat(pw2.length)}<span style={{color:'var(--text-faint)',letterSpacing:4}}>{'○'.repeat(6-pw2.length)}</span></span>:'Confirmar senha'}
    </div>
    {pw2.length===6&&pw!==pw2&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--danger)',marginTop:4,textAlign:'center'}}>As senhas não coincidem</div>}
    {showVK&&<div style={{marginTop:4}}><VirtualKeyboard onKey={vkKey} onBackspace={vkBack} onDone={()=>setShowVK(false)} maxLen={6} currentLen={currentVKLen}/></div>}
    {err&&<div style={{fontSize:'var(--fs-xs)',color:'var(--danger)',textAlign:'center'}}><AlertTriangle size={12}/> {err}</div>}
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
    {mood:'🌟',title:'Bem-vindo ao Magic Portal!',body:'"Você acabou de entrar no portal onde fãs de Magic se unem para montar pedidos em grupo e economizar de verdade."'},
    {mood:'📦',title:'Como funciona',body:'"Escolha suas cartas no catálogo, monte seu carrinho e finalize quando estiver pronto. Pagamentos via Mercado Pago com frete calculado na hora."'},
    {mood:'🎁',title:'Bônus especiais',body:'"O administrador pode conceder cartas bônus para você a qualquer momento. Quando disponíveis, elas aparecem no seu carrinho e saem de graça!"'},
    {mood:'🔮',title:'Escolha sua Guilda',body:'"Duas cores de mana definem sua essência. Cada combinação invoca uma guilda diferente — personalize sua jornada!"',hasColors:true},
  ];
  const s=steps[step];

  if(askTutorial)return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-4)',paddingTop:40,alignItems:'center',textAlign:'center'}}>
    <div style={{width:56,height:56,borderRadius:'var(--r-card)',background:'var(--fill-soft)',border:'1px solid var(--line-soft)',display:'grid',placeItems:'center',fontSize:28}}>🧙</div>
    <h2 style={{fontFamily:"'Cinzel',serif",fontSize:20}}>"Vamos explorar o portal juntos!"</h2>
    <p style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',maxWidth:300,fontStyle:'italic'}}>Um guia rápido sobre o ritual da encomenda — leva menos de 1 minuto</p>
    <div style={{display:'flex',gap:'var(--sp-2)',width:'100%',maxWidth:300}}>
      <Btn onClick={()=>onComplete(colors,guild,true)} style={{flex:1}} sfx="confirm">Vamos lá! 🔮</Btn>
    </div>
    <button onClick={()=>onComplete(colors,guild,false)} style={{background:'none',border:'none',color:'var(--text-faint)',fontSize:'var(--fs-xs)',cursor:'pointer',marginTop:4}}>Pular tutorial</button>
  </div>);

  return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-4)',paddingTop:16,minHeight:'70vh',justifyContent:'space-between'}}>
    <div>
      <div style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',marginBottom:18}}><div style={{width:44,height:44,borderRadius:'var(--r-control)',background:'var(--fill-soft)',border:'1px solid var(--line-soft)',display:'grid',placeItems:'center',fontSize:'var(--fs-xl)'}}>{s.mood}</div><div><div style={{fontWeight:800,fontSize:14}}>Goblin Guia</div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>Guardião do Portal</div></div></div>
      <h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:'var(--fs-xl)'}}>{s.title}</h1>
      <p style={{fontSize:14,lineHeight:1.7,color:'var(--text-muted)',marginTop:10,fontStyle:'italic'}}>{s.body}</p>
      {s.illus&&s.illus()}
      {s.hasColors&&<div style={{marginTop:18}}><div style={{display:'flex',justifyContent:'center',gap:'var(--sp-3)',marginBottom:14}}>{MANA_COLORS.map(m=><ManaOrb key={m.key} mana={m.key} selected={colors.includes(m.key)} onClick={()=>toggleC(m.key)} size={50}/>)}</div>{guild&&<div style={{textAlign:'center'}}><GuildBadge guild={guild} size={24}/><span style={{fontFamily:"'Cinzel',serif",fontSize:'var(--fs-lg)',fontWeight:700,color:gT.primary,marginLeft:8}}>{guild}</span></div>}</div>}
    </div>
    <div>
      <div style={{display:'flex',gap:'var(--sp-1)',justifyContent:'center',marginBottom:12}}>{steps.map((_,i)=><div key={i} style={{width:i===step?20:6,height:6,borderRadius:3,background:i===step?gT.primary:'var(--fill)'}}/>)}</div>
      <div style={{display:'flex',gap:'var(--sp-2)'}}>{step>0&&<Btn variant="secondary" onClick={()=>setStep(s=>s-1)} style={{flex:1}} sfx="nav"><ChevronLeft size={15}/></Btn>}{step<steps.length-1?<Btn onClick={()=>setStep(s=>s+1)} style={{flex:1}} sfx="click">Próximo <ChevronRight size={15}/></Btn>:<Btn onClick={()=>{if(!guild)return;SFX.confirm();setAskTutorial(true);}} disabled={!guild} style={{flex:1}} sfx=""><Sparkles size={15}/> Continuar</Btn>}</div>
    </div>
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
  const [pricing,setPricing]=useState(null);
  // Pedido-rascunho do usuário: é nele que o carrinho mora até o checkout.
  const [orderId,setOrderId]=useState(null);
  // Lista de desejos: linhas de wishlist_items, por usuário — não por pedido.
  // É desejo puro: nada aqui vai para o carrinho sozinho.
  const [wishlist,setWishlist]=useState([]);
  // Carrinho: order_items com in_cart=true no pedido-rascunho.
  const [cartItems,setCartItems]=useState([]);
  const [lastOrder,setLastOrder]=useState(null);
  const [myOrders,setMyOrders]=useState([]);
  const [indivPricing,setIndivPricing]=useState(null); // { tiers, pricing, fx }
  // Álbum de coleção: o que veio de lote pago (derivado, não se edita) e o
  // ajuste manual do cliente. Mantidos separados de propósito — ver
  // shared/collection.js.
  const [collectionBought,setCollectionBought]=useState(()=>new Map());
  const [collectionExtras,setCollectionExtras]=useState(()=>new Map());
  const [catalogSize,setCatalogSize]=useState(0);
  // Modo "adicionar cartas": o checkout entra num pedido já pago em vez de
  // abrir um novo. { orderId, rootBatchId, shortId, qtyPaid }
  const [addTo,setAddTo]=useState(null);

  // UI state
  const [page,setPage]=useState('catalog');
  const [showTutorial,setShowTutorial]=useState(false);
  const [tutStep,setTutStep]=useState(0);
  const [isFirstTimeTut,setIsFirstTimeTut]=useState(false);
  const [soundOn,setSoundOn]=useState(false); // opt-in: som em toda interação incomoda mais do que ajuda
  const [colorMode,setColorMode]=useState(readColorMode);

  // O tema pinta o documento inteiro (fundo do body, barra do sistema no PWA),
  // não só a árvore do React.
  useEffect(()=>{
    applyColorMode(colorMode);
    try{localStorage.setItem(COLOR_MODE_KEY,colorMode);}catch(e){}
  },[colorMode]);
  const [appLoading,setAppLoading]=useState(false);
  const [toastMsg,setToastMsg]=useState(null);
  const [recoveryToken,setRecoveryToken]=useState(null);
  const [adminTarget,setAdminTarget]=useState(null); // seção do console vinda de um push

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

  // Deep link do push: /?admin=orders abre o console direto na seção certa.
  // Vale tanto para a notificação que abre o app do zero quanto para a que
  // reaproveita uma janela já aberta (mensagem vinda do service worker).
  useEffect(()=>{
    function applyAdminTarget(rawUrl){
      try{
        const target=new URL(rawUrl,window.location.origin).searchParams.get('admin');
        if(!target)return false;
        setAdminTarget(target);
        setPage('admin');
        return true;
      }catch{return false;}
    }
    if(applyAdminTarget(window.location.href)){
      window.history.replaceState(null,'',window.location.pathname);
    }
    if(!('serviceWorker' in navigator))return;
    const onMessage=e=>{if(e.data?.type==='NOTIFICATION_CLICK'&&e.data.url)applyAdminTarget(e.data.url);};
    navigator.serviceWorker.addEventListener('message',onMessage);
    return ()=>navigator.serviceWorker.removeEventListener('message',onMessage);
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
  // Antes de montar os filhos, para que GuildBadge & cia. leiam a paleta certa.
  setLightMode(colorMode === 'light');
  const theme = guildTheme(guild);
  const isAdmin = profile?.is_admin || false;
  const nav = useCallback(p=>{SFX.nav();setPage(p);if(p==='profile'&&!profile&&token&&session?.user?.id){loadAppData(token,session.user.id);};},[profile,token,session]);

  // Carrega faixas/config/dólar do pedido individual (preço ao vivo)
  useEffect(()=>{
    if(!session)return;
    let alive=true;
    fetch('/api/pricing-individual',{method:'GET'})
      .then(r=>r.json()).then(d=>{if(alive&&d&&d.ok)setIndivPricing(d);})
      .catch(e=>console.warn('pricing-individual:',e));
    return ()=>{alive=false;};
  },[session]);

  function toast(msg,type='info'){setToastMsg({msg,type});setTimeout(()=>setToastMsg(null),4000);}

  // Preço de carta normal (usado como referência quando não há tipo específico)
  const priceBRL = Number(pricing?.normal_price_brl) || 16;

  // ─── Load data after login ─────────────────────────
  async function loadAppData(tkn, userId) {
    const isAuthFailure = (err) => Boolean(err?.isAuth || isAuthErrorMessage(err?.message));
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
        if (isAuthFailure(eProf)) throw eProf;
        console.warn('Profile load failed:', eProf);
        setProfile({ id: userId, name: '', is_admin: false });
      }

      // ── Lista de desejos ──────────────────────────────────────────────────
      // Fora do bloco de pedido de propósito: ela é do usuário, não da
      // campanha, então carrega mesmo quando não há encomenda aberta.
      try {
        const rows = await sbGet('wishlist_items', `user_id=eq.${userId}&select=id,card_id,quantity,cards(name,type,image_url)&order=created_at.desc`, tkn);
        setWishlist((rows || [])
          .filter(w => w && w.id && w.card_id)
          .map(w => ({ ...w, card_name: w.cards?.name || '?', card_type: w.cards?.type || 'Normal', card_image_url: w.cards?.image_url || null })));
      } catch(e) {
        // Banco sem a migração wishlist.sql ainda: a lista fica vazia em vez
        // de derrubar o resto do carregamento.
        console.warn('[loadAppData] Falha ao carregar a lista de desejos (rodou supabase/migrations/wishlist.sql?):', e);
      }

      // Pricing
      try {
        const [pc] = await sbGet('pricing_config', `is_active=eq.true&limit=1`, tkn);
        setPricing(pc);
      } catch(ePrice) {
        if (isAuthFailure(ePrice)) throw ePrice;
        console.warn('Pricing load failed:', ePrice);
      }

      // ── Pedido-rascunho (o carrinho mora nele) ────────────────────────────
      // Um por usuário, sem campanha. O checkout cria o pedido definitivo no
      // servidor; este aqui só segura as linhas de carrinho.
      try {
        let ord = null;
        try {
          // Sem lote = ninguém pagou nada nele = é o carrinho. Um pedido já
          // fechado também fica em DRAFT (quem carrega o pagamento é o lote),
          // então filtrar só por status devolveria um pedido pago aqui.
          const drafts = await sbGet('orders', `user_id=eq.${userId}&status=eq.DRAFT&select=id,created_at,order_batches(id)&order=created_at.desc&limit=20`, tkn);
          ord = (drafts || []).find(o => !(o.order_batches || []).length) || null;
        } catch(e) { console.warn('[loadAppData] draft order query failed:', e); }

        if (!ord) {
          try {
            const created = await sbPost('orders', { user_id: userId, status: 'DRAFT', kind: 'INDIVIDUAL' }, tkn);
            ord = Array.isArray(created) ? (created[0] ?? null) : (created ?? null);
          } catch(e) {
            // Corrida entre abas: outra pode ter criado o rascunho no meio.
            console.warn('[loadAppData] Order creation failed, trying race-condition fallback:', e);
            const fallback = await sbGet('orders', `user_id=eq.${userId}&status=eq.DRAFT&select=id,created_at,order_batches(id)&order=created_at.desc&limit=20`, tkn).catch(() => []);
            const livre = (fallback || []).find(o => !(o.order_batches || []).length);
            if (livre) ord = livre;
            else throw e;
          }
        }

        if (!ord || !ord.id) throw new Error('Não foi possível carregar ou criar seu pedido.');
        setOrderId(ord.id);

        // ── Carrinho: order_items do rascunho, ainda sem batch ──────────────
        try {
          const items = await sbGet('order_items', `order_id=eq.${ord.id}&batch_id=is.null&in_cart=is.true&select=id,card_id,quantity,cards(name,type,image_url)`, tkn);
          setCartItems((items || [])
            .filter(i => i && i.id && i.card_id)
            .map(i=>({...i, card_name:i.cards?.name||'?', card_type:i.cards?.type||'Normal', card_image_url:i.cards?.image_url||null})));
        } catch(e) { console.warn('[loadAppData] Falha ao carregar o carrinho:', e); }
      } catch(eOrder) {
        if (isAuthFailure(eOrder)) throw eOrder;
        console.error('[loadAppData] Order block failed — orderId will be null:', eOrder);
      }

      // ── Histórico de pedidos ──────────────────────────────────────────────
      try {
        const allOrds = await sbGet('orders', `user_id=eq.${userId}&select=id`, tkn);
        if (allOrds && allOrds.length > 0) {
          const ordIds = allOrds.map(o=>o.id).join(',');
          const batches = await sbGet('order_batches', `order_id=in.(${ordIds})&select=id,status,payment_status,total_locked,payment_method,created_at,confirmed_at,qty_in_batch,shipping_locked,shipping_service,shipping_address,shipping_already_paid,shipping_group_id,mandabem_envio_id,mandabem_etiqueta,mandabem_rastreamento,mandabem_status,fulfillment_status,mp_link,brl_unit_price_locked,subtotal_locked,order_id,order_items(quantity,cards(name,type))`, tkn);
          setMyOrders((batches||[]).map(b=>({ ...b, cards: Array.isArray(b.order_items) ? b.order_items.map(i=>({ name:i.cards?.name||'Carta', type:i.cards?.type||'', qty:Number(i.quantity||1) })) : undefined })));
        } else {
          setMyOrders([]);
        }
      } catch(e) {
        if (isAuthFailure(e)) throw e;
        console.warn('Failed to load order batches:', e);
      }

      // ── Álbum de coleção ──────────────────────────────────────────────────
      // O comprado é derivado dos lotes pagos; o extra vem de collection_items.
      // Nenhum dos dois sobrescreve o outro (ver shared/collection.js).
      await loadCollection(tkn, userId);
    } catch(e) {
      console.error('loadAppData', e);
      if (isAuthFailure(e)) {
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

  // ─── Álbum de coleção ─────────────────────────────
  // Duas leituras separadas de propósito: o comprado é derivado dos lotes
  // pagos (fato, não editável) e o extra é o ajuste manual do cliente. Juntar
  // os dois numa coluna só criaria duas verdades sobre a mesma carta.
  async function loadCollection(tkn, userId) {
    try {
      const [ordRows, extras, catalog] = await Promise.all([
        sbGet('orders', `user_id=eq.${userId}&select=id`, tkn).catch(() => []),
        sbGet('collection_items', `user_id=eq.${userId}&select=card_id,extra_qty`, tkn).catch(() => []),
        sbGet('cards', `select=id&is_active=eq.true&tcg=eq.${encodeURIComponent(CATALOG_TCG)}`, tkn).catch(() => []),
      ]);
      // `!inner` no lote: item sem lote é carrinho, e carrinho não é coleção.
      // O filtro por pedido é explícito em vez de depender só da RLS.
      const ids = (ordRows || []).map(o => o.id).join(',');
      const items = ids
        ? await sbGet('order_items', `order_id=in.(${ids})&select=card_id,quantity,order_batches!inner(status,payment_status)&limit=5000`, tkn).catch(() => [])
        : [];
      setCollectionBought(boughtByCard(items));
      setCollectionExtras(extrasByCard(extras));
      setCatalogSize((catalog || []).length);
    } catch (e) {
      // Banco sem a migração minimal-portal.sql ainda: o álbum fica vazio em
      // vez de derrubar o resto do carregamento.
      console.warn('[loadCollection] falha ao montar o álbum (rodou supabase/migrations/minimal-portal.sql?):', e);
    }
  }

  // O "+ / −" do álbum mexe só no ajuste manual. Zero apaga a linha: guardar
  // um zero por carta do catálogo encheria a tabela de nada.
  async function handleSetCollectionExtra(cardId, nextQty) {
    if (!token || !session?.user?.id) return;
    const userId = session.user.id;
    const previous = collectionExtras.get(cardId) || 0;
    setCollectionExtras(prev => { const next = new Map(prev); if (nextQty > 0) next.set(cardId, nextQty); else next.delete(cardId); return next; });
    try {
      if (nextQty > 0) {
        await sbUpsert('collection_items', { user_id: userId, card_id: cardId, extra_qty: nextQty, updated_at: new Date().toISOString() }, token, 'user_id,card_id');
      } else {
        await sbDelete('collection_items', `user_id=eq.${userId}&card_id=eq.${cardId}`, token);
      }
    } catch (e) {
      console.error('[handleSetCollectionExtra]', e);
      setCollectionExtras(prev => { const next = new Map(prev); if (previous > 0) next.set(cardId, previous); else next.delete(cardId); return next; });
      toast('Não deu para salvar o ajuste: ' + e.message, 'error');
    }
  }

  // ─── Auth handler ──────────────────────────────────
  async function handleLogin(res, type) {
    didAutoLoad.current = true; // prevent useEffect from firing a second loadAppData
    setSession(res);
    // Avisa o admin do acesso (o servidor ignora logins do próprio admin e
    // agrupa acessos repetidos do mesmo cliente).
    reportAccess(res.access_token, type === 'signup' ? 'SIGNUP' : 'LOGIN');
    if (type === 'signup') {
      setIsNew(true);
      setPage('onboarding');
      await loadAppData(res.access_token, res.user.id);
    } else {
      await loadAppData(res.access_token, res.user.id);
      setPage('catalog');
    }
  }

  function handleLogout(){
    localStorage.removeItem('cpj_session');
    setSession(null);setProfile(null);setPricing(null);
    setOrderId(null);setWishlist([]);setCartItems([]);setMyOrders([]);setAddTo(null);
    setCollectionBought(new Map());setCollectionExtras(new Map());setCatalogSize(0);
    setPage('catalog');setIsNew(false);didAutoLoad.current=false;
  }

  // ─── Onboarding complete ──────────────────────────
  async function handleOnboardingComplete(colors, guild, showTut) {
    if (token && profile) {
      await sbPatch('profiles', 'id=eq.'+(profile.id), { mana_color_1: colors[0], mana_color_2: colors[1], guild: guild || '' }, token);
      setProfile(p => ({ ...p, mana_color_1: colors[0], mana_color_2: colors[1], guild }));
    }
    setIsNew(false);
    if (showTut) { setIsFirstTimeTut(true); setShowTutorial(true); }
    setPage('catalog');
  }

  // ─── Save profile ─────────────────────────────────
  async function handleSaveProfile(data) {
    if (!token || !profile) return;
    await sbPatch('profiles', 'id=eq.'+(profile.id), data, token);
    setProfile(p => ({ ...p, ...data }));
    SFX.success();
    toast('Perfil salvo!', 'success');
  }

  // ─── Lista de desejos: adicionar ──────────────────
  // Não exige pedido aberto: desejar uma carta independe de haver encomenda
  // ativa. É esse desacoplamento que diferencia a lista do carrinho.
  async function handleAddToWishlist(card, qty) {
    if (!token) { toast('Faça login primeiro','error'); return; }
    const userId = session?.user?.id;
    if (!userId) { toast('Sua sessão ainda está carregando. Tente de novo em instantes.','error'); return; }
    try {
      const existing = wishlist.find(w => w.card_id === card.id);
      if (existing) {
        const newQty = existing.quantity + qty;
        await sbPatch('wishlist_items', 'id=eq.'+(existing.id), { quantity: newQty }, token);
        setWishlist(prev => prev.map(w => w.id === existing.id ? { ...w, quantity: newQty } : w));
      } else {
        // Upsert e não POST: se a linha existir no servidor sem estar no estado
        // local (outra aba, estado velho), o merge evita 409. O payload omite
        // acquired_qty/acquired_at de propósito — o upsert só toca as colunas
        // que recebe, então o histórico de compra sobrevive.
        const created = await sbUpsert('wishlist_items', { user_id: userId, card_id: card.id, quantity: qty }, token, 'user_id,card_id');
        const row = Array.isArray(created) ? created[0] : created;
        if (row?.id) {
          setWishlist(prev => [{ ...row, card_name: card.name, card_type: card.type || 'Normal', card_image_url: card.image_url || null }, ...prev.filter(w => w.card_id !== card.id)]);
        }
      }
      toast(qty+'x '+card.name+' na sua lista de desejos!','success');
    } catch(e) {
      console.error('[handleAddToWishlist]', e);
      toast('Erro ao adicionar: '+e.message,'error');
    }
  }

  // ─── Carrinho: adicionar ──────────────────────────
  // Aceita tanto uma linha da lista de desejos (card_id/card_name) quanto uma
  // carta do catálogo (id/name). Adicionar ao carrinho NUNCA mexe na lista de
  // desejos: querer e comprar são gestos separados.
  async function handleAddCardToCart(card, qty) {
    return handleAddToCart({
      card_id: card.id,
      card_name: card.name,
      card_type: card.type || 'Normal',
      card_image_url: card.image_url || null,
    }, qty);
  }

  async function handleAddToCart(item, qty) {
    if (!token) return;
    if (!orderId) {
      toast('Seu pedido está sendo carregado. Tente de novo em instantes.','error');
      if (session?.user?.id) loadAppData(token, session.user.id).catch(e => console.warn('[handleAddToCart] recovery falhou:', e));
      return;
    }
    const amount = Math.max(1, qty || item.quantity || 1);
    try {
      const existing = cartItems.find(c => c.card_id === item.card_id);
      if (existing) {
        const newQty = existing.quantity + amount;
        await sbPatch('order_items', 'id=eq.'+(existing.id), { quantity: newQty }, token);
        setCartItems(prev => prev.map(c => c.id === existing.id ? { ...c, quantity: newQty } : c));
      } else {
        const created = await sbPost('order_items', { order_id: orderId, card_id: item.card_id, quantity: amount, is_bonus: false, in_cart: true, unit_price_brl: 0 }, token);
        const row = Array.isArray(created) ? created[0] : created;
        if (row?.id) {
          setCartItems(prev => [...prev, { ...row, card_name: item.card_name, card_type: item.card_type, card_image_url: item.card_image_url }]);
        }
      }
      SFX.addCard();
      toast(`${amount}x ${item.card_name} no carrinho`, 'success');
    } catch(e) {
      console.error('[handleAddToCart]', e);
      toast('Erro ao adicionar ao carrinho: '+e.message,'error');
    }
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

  // ─── Lista de desejos: remover ────────────────────
  async function handleRemoveFromWishlist(itemId) {
    if (!token) return;
    await sbDelete('wishlist_items', 'id=eq.'+(itemId), token);
    setWishlist(prev => prev.filter(w => w.id !== itemId));
    SFX.click();
  }

  // ─── Lista de desejos: quantidade ─────────────────
  async function handleUpdateWishlistQty(itemId, newQty) {
    if (!token) return;
    if (newQty <= 0) { handleRemoveFromWishlist(itemId); return; }
    await sbPatch('wishlist_items', 'id=eq.'+(itemId), { quantity: newQty }, token);
    setWishlist(prev => prev.map(w => w.id === itemId ? { ...w, quantity: newQty } : w));
  }

  // ─── Pedido concluído ─────────────────────────────
  async function handleOrderDone(order) {
    setLastOrder(order);
    // As cartas já entraram no pedido antigo: o modo de adição cumpriu o papel.
    if (order.addedToOrderId) setAddTo(null);

    // Comprar NÃO tira a carta da lista de desejos. Querer uma carta e já
    // tê-la são dois estados, não opostos — e agora quem responde "já tenho"
    // é o álbum, alimentado pelos lotes pagos. A lista só registra o desejo.
    setCartItems([]);

    setMyOrders(prev => [{
      id: order.batchId,
      order_id: order.addedToOrderId || order.orderId,
      status: 'DRAFT',
      total_locked: order.total || 0,
      payment_method: 'MERCADO_PAGO',
      qty_in_batch: order.totalPaid,
      created_at: new Date().toISOString(),
      cards: order.cards,
    }, ...prev]);

    // O álbum e o histórico só ficam corretos quando o servidor confirma: a
    // recarga vem do banco, não de um palpite local.
    if (token && session?.user?.id) loadCollection(token, session.user.id).catch(e => console.warn('[handleOrderDone] álbum:', e));

    toast('Pedido registrado!', 'success');
  }

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

  // ── Coleção e desejos ─────────────────────────────
  // O álbum é a fonte de "já tenho": lote pago + ajuste manual, nunca uma
  // cópia disso na lista de desejos.
  const collectionOwned = useMemo(() => {
    const owned = new Map();
    collectionBought.forEach((qty, cardId) => owned.set(cardId, qty));
    collectionExtras.forEach((qty, cardId) => owned.set(cardId, (owned.get(cardId) || 0) + qty));
    return owned;
  }, [collectionBought, collectionExtras]);

  const collection = useMemo(() => {
    const distinct = collectionOwned.size;
    let copies = 0;
    collectionOwned.forEach(qty => { copies += qty; });
    return {
      bought: collectionBought,
      extras: collectionExtras,
      owned: collectionOwned,
      stats: { total: catalogSize, distinct, copies, percent: catalogSize ? Math.round((distinct / catalogSize) * 100) : 0 },
    };
  }, [collectionBought, collectionExtras, collectionOwned, catalogSize]);

  // Um desejo só é "pendente" enquanto a coleção não cobre o que ele quer.
  const wishlistCount = wishlist.reduce((s, w) => s + Math.max(0, w.quantity - (collectionOwned.get(w.card_id) || 0)), 0);
  const cartCount = cartItems.reduce((s, c) => s + c.quantity, 0);

  const bottomTabs = [{ key: 'catalog', icon: BookOpen, label: 'Catálogo' }, { key: 'wants', icon: ScrollText, label: 'Desejos' }, { key: 'cart', icon: ShoppingCart, label: 'Carrinho' }, { key: 'profile', icon: User, label: 'Conta' }];

  // ── Pedidos do cliente ────────────────────────────
  const myOrderGroups = useMemo(() => groupBatchesIntoOrders(myOrders), [myOrders]);

  // Lotes pagos que ainda não foram postados: é neles que um pedido novo pega
  // carona no frete (o "envio conjunto" do checkout).
  const unshippedPaidBatches = useMemo(() => (myOrders || []).filter(b => isPaidBatchStatus(b) && !b.mandabem_envio_id && !b.mandabem_rastreamento), [myOrders]);

  // Pedidos que ainda aceitam cartas novas — a compra no fornecedor não saiu,
  // então um lote novo pega carona no mesmo frete. myOrders é uma lista de
  // LOTES, por isso o agrupamento: a janela é do pedido inteiro.
  const openIndividualOrders = useMemo(() => {
    const open = {};
    myOrderGroups.forEach(group => {
      if (!canAddCardsToOrder(group.batches)) return;
      const anchor = shippingAnchorOf(group.batches);
      if (!anchor) return;
      open[group.orderId] = { orderId: group.orderId, rootBatchId: String(anchor.id), shortId: String(anchor.id).slice(0, 8).toUpperCase(), qtyPaid: paidQtyOf(group.batches) };
    });
    return open;
  }, [myOrderGroups]);

  // A janela pode fechar enquanto o cliente monta o carrinho (o admin comprou
  // no fornecedor). Ao recarregar os pedidos, o modo cai fora sozinho.
  useEffect(() => {
    if (addTo && myOrders.length > 0 && !openIndividualOrders[addTo.orderId]) {
      setAddTo(null);
      toast('O pedido já foi comprado no fornecedor — suas cartas viram um pedido novo.', 'info');
    }
  }, [openIndividualOrders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Entra no modo de adição a partir de "Meus pedidos".
  function handleStartAddCards(order) {
    const info = openIndividualOrders[String(order?.orderId ?? order?.order_id)];
    if (!info) { toast('Este pedido não aceita mais cartas.', 'error'); return; }
    setAddTo(info);
    toast(`Adicionando cartas ao pedido #${info.shortId}`, 'success');
    nav(cartCount > 0 ? 'cart' : 'catalog');
  }

  return (<div className="portal-shell" data-page={page} style={{ '--gp': theme.primary, '--gs': theme.secondary, '--gg': theme.glow, '--gp-ink': inkOn(theme.primary), minHeight: '100vh', background: `radial-gradient(ellipse at 50% -20%,${theme.primary}12 0%,transparent 50%),radial-gradient(ellipse at 80% 100%,${theme.secondary}08 0%,transparent 40%),var(--bg)`, color: 'var(--text)', fontFamily: "'Outfit',sans-serif", maxWidth: 480, margin: '0 auto', position: 'relative', paddingBottom: 78 }}>
    <FloatingMana theme={theme}/>
    <style>{"*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg);margin:0}input:focus{border-color:var(--gp)!important;outline:none}button:active:not(:disabled){transform:scale(.97)}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(var(--ink),calc(.07*var(--ink-a)));border-radius:3px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes tutPulse{0%,100%{opacity:1;box-shadow:0 0 0 9999px var(--scrim),0 0 30px var(--gg)}50%{opacity:.85;box-shadow:0 0 0 9999px var(--scrim),0 0 50px var(--gg)}}@keyframes tutArrowBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(6px)}}@keyframes tutHandBounce{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-6px) scale(1.15)}}@keyframes manaFloat{0%{transform:translateY(0) translateX(0) rotate(0deg);opacity:0}10%{opacity:0.06}90%{opacity:0.03}100%{transform:translateY(-110vh) translateX(var(--drift,20px)) rotate(360deg);opacity:0}}@keyframes flyToWants{0%{transform:translate(-50%,-50%) scale(1);opacity:1}50%{transform:translate(calc(-50vw + 160px),-60vh) scale(0.6);opacity:0.8}100%{transform:translate(calc(-50vw + 160px),-80vh) scale(0.2);opacity:0}}@keyframes sheetUp{from{transform:translateY(48px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}"}</style>

    {toastMsg && <Toast msg={toastMsg.msg} type={toastMsg.type} onClose={() => setToastMsg(null)} />}
    {showTutorial && <TutorialOverlay step={tutStep} steps={TUTORIAL_STEPS} onNext={tutNext} onSkip={tutSkip} theme={theme} onNavTo={p => setPage(p)} isFirstTime={isFirstTimeTut} />}

    {/* Password recovery mode */}
    {recoveryToken && <div className="portal-auth-container" style={{ padding: '14px 20px' }}>
      <RecoveryPage token={recoveryToken} onDone={()=>{setRecoveryToken(null);toast('Senha alterada! Faça login.','success');}} theme={theme}/>
    </div>}

    {/* Not logged in */}
    {!session && !recoveryToken && <div className="portal-auth-container" style={{ padding: '14px 20px' }}><AuthPage onLogin={handleLogin} theme={theme} /></div>}

    {/* Session exists but still loading */}
    {session && !recoveryToken && !profile && !appLoading && <div style={{ padding: '60px 20px', textAlign: 'center' }}><div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div><div style={{ fontSize: 14, color: 'rgba(var(--ink),calc(0.5*var(--ink-a)))', marginBottom: 16 }}>Erro ao carregar perfil</div><Btn onClick={() => loadAppData(token, session?.user?.id)} sfx="click"><RefreshCw size={16}/> Tentar novamente</Btn></div>}

    {/* Logged in */}
    {session && !recoveryToken && <>
      {/* Loading indicator - non-blocking */}
      {appLoading && <div style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 50, background: 'var(--chrome-bg)', borderRadius: 20, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Spin size={14}/><span style={{ fontSize: 12, color: 'rgba(var(--ink),calc(0.5*var(--ink-a)))' }}>Carregando...</span>
      </div>}

      <aside className="portal-sidebar" aria-label="Navegação principal">
        <div className="portal-sidebar-brand">
          <div className="portal-sidebar-mark">NOZ</div>
          <div><strong>Cartas para Jogar</strong><span>Portal de encomendas</span></div>
        </div>
        <nav className="portal-sidebar-nav">
          {bottomTabs.map((t) => {
            const active = page === t.key;
            const badge = t.key === 'cart' && cartCount > 0;
            return <button key={t.key} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} onClick={() => nav(t.key)}>
              <t.icon size={18}/><span>{t.label}</span>
              {badge && <b>{cartCount}</b>}
            </button>;
          })}
          {isAdmin && <button className={page === 'admin' ? 'is-active' : ''} aria-current={page === 'admin' ? 'page' : undefined} onClick={() => nav('admin')}><Shield size={18}/><span>Admin</span></button>}
        </nav>
        <div className="portal-sidebar-footer">
          <GuildBadge guild={profile?.guild} size={28}/><div><strong>{profile?.name || 'Minha conta'}</strong><span>{profile?.email || session?.user?.email || ''}</span></div>
        </div>
      </aside>

      {/* Header */}
      {page !== 'onboarding' && <div className="portal-header" style={{ padding: '13px 20px 11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(var(--ink),calc(0.035*var(--ink-a)))', position: 'sticky', top: 0, zIndex: 10, background: 'var(--chrome-bg)', backdropFilter: 'blur(20px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(page === 'success' || page === 'admin' || page === 'checkout') && <button onClick={() => nav(page === 'admin' ? 'profile' : page === 'checkout' ? 'cart' : 'catalog')} className="mp-tap" aria-label="Voltar" style={{ background: 'none', border: 'none', color: 'var(--text-strong)', cursor: 'pointer' }}><ChevronLeft size={20} /></button>}
          <span style={{ fontFamily: "'Cinzel',serif", fontSize: 'var(--fs-md)', fontWeight: 700, letterSpacing: .3 }}>{({ catalog: 'Catálogo', wants: 'Lista de desejos', cart: 'Carrinho', checkout: 'Checkout', success: '', profile: 'Minha conta', admin: 'Admin', onboarding: '' })[page] || ''}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Modo de adição: enquanto ele está ligado, o checkout entra num
              pedido já pago. Clicável para sair. */}
          {addTo && ['catalog','wants','cart','checkout'].includes(page) && (
            <button onClick={() => { SFX.click(); setAddTo(null); }} title="Sair do modo de adição" aria-label={`Adicionando cartas ao pedido ${addTo.shortId}. Toque para sair.`} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 'var(--r-pill)', cursor: 'pointer', border: '1px solid rgba(var(--info-rgb),0.35)', background: 'rgba(var(--info-rgb),0.10)', color: 'var(--info)', fontSize: 'var(--fs-2xs)', fontWeight: 700, fontFamily: "'Outfit',sans-serif", whiteSpace: 'nowrap' }}>
              <Plus size={11}/>#{addTo.shortId}
            </button>
          )}
          <button onClick={() => { SFX.toggle(); setColorMode(m => m === 'light' ? 'dark' : 'light'); }} className="mp-tap" title={colorMode === 'light' ? 'Mudar para o modo escuro' : 'Mudar para o modo claro'} aria-label={colorMode === 'light' ? 'Mudar para o modo escuro' : 'Mudar para o modo claro'} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer' }}>{colorMode === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button>
          <button onClick={() => setSoundOn(s => !s)} className="mp-tap" role="switch" aria-checked={soundOn} title={soundOn ? 'Desligar sons' : 'Ligar sons'} aria-label={soundOn ? 'Desligar sons' : 'Ligar sons'} style={{ background: 'none', border: 'none', color: soundOn ? 'var(--text-faint)' : 'rgba(var(--ink),calc(0.14*var(--ink-a)))', cursor: 'pointer' }}>{soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
        </div>
      </div>}

      {/* Bottom tabs */}
      {page !== 'onboarding' && page !== 'success' && page !== 'admin' && page !== 'checkout' && <nav className="portal-bottom-tabs" id="tut-bottom-tabs" aria-label="Navegação principal" style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 480, background: 'var(--chrome-bg-strong)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))', display: 'flex', justifyContent: 'space-around', padding: '5px 0 10px', zIndex: 20 }}>
        {bottomTabs.map((t, ti) => {
          const active = page === t.key; const badge = t.key === 'cart' && cartCount > 0;
          return (<button key={t.key} id={'tut-tab-' + ti} onClick={() => nav(t.key)} aria-current={active ? 'page' : undefined} aria-label={badge ? `${t.label}, ${cartCount} ${cartCount === 1 ? 'item' : 'itens'}` : t.label} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '4px 10px', borderRadius: 10, position: 'relative', color: active ? theme.primary : 'rgba(var(--ink),calc(0.22*var(--ink-a)))', transition: 'all .2s' }}>
            <t.icon size={20} />{badge && <div style={{ position: 'absolute', top: 0, right: 3, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 9, background: theme.primary, fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--gp-ink)', display: 'grid', placeItems: 'center' }}>{cartCount}</div>}
            <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: active ? 700 : 400 }}>{t.label}</span>{active && <div style={{ width: 4, height: 4, borderRadius: 2, background: theme.primary }} />}
          </button>);
        })}
      </nav>}

      {/* Pages */}
      <main className="portal-content" style={{ padding: page === 'onboarding' ? '0 20px' : '14px 20px' }}>
        {page === 'catalog' && <CatalogPage token={token} wishlist={wishlist} cartItems={cartItems} collectionByCard={collectionOwned} onAddToWishlist={handleAddToWishlist} onAddToCart={handleAddCardToCart} priceBRL={priceBRL} theme={theme} tutStep={showTutorial?tutStep:-1} onTutNext={tutNext} />}
        {page === 'wants' && <WishlistPage wishlist={wishlist} cartItems={cartItems} collectionByCard={collectionOwned} onAddToCart={handleAddToCart} onRemove={handleRemoveFromWishlist} onUpdateQty={handleUpdateWishlistQty} cartCount={cartCount} theme={theme} nav={nav} />}
        {page === 'cart' && <CartPage cartItems={cartItems} pricing={pricing} theme={theme} nav={nav} onRemoveFromCart={handleRemoveFromCart} onUpdateCartQty={handleUpdateCartQty} toast={toast} indiv={indivPricing} addTo={addTo} onCancelAdd={()=>setAddTo(null)} />}
        {page === 'checkout' && <CheckoutPage cartItems={cartItems} pricing={pricing} theme={theme} nav={nav} profile={profile} token={token} onOrderDone={handleOrderDone} toast={toast} unshippedPaidBatches={unshippedPaidBatches} indiv={indivPricing} addTo={addTo} onCancelAdd={()=>setAddTo(null)} />}
        {page === 'success' && <SuccessPage lastOrder={lastOrder} theme={theme} nav={nav} />}
        {page === 'profile' && !profile && <div style={{padding:20,color:'var(--danger)',fontSize:'var(--fs-xs)'}}><div>profile: null</div><div>token: {token?'ok':'null'}</div><div>appLoading: {String(appLoading)}</div><Btn onClick={()=>loadAppData(token,session?.user?.id)} sfx="click"><RefreshCw size={14}/> Recarregar</Btn></div>}
        {page === 'profile' && profile && (() => { try { return <ProfileView profile={profile} token={token} theme={theme} nav={nav} isAdmin={isAdmin} setShowTutorial={setShowTutorial} onSaveProfile={handleSaveProfile} onLogout={handleLogout} myOrders={myOrders} onReloadOrders={()=>loadAppData(token,session?.user?.id)} toast={toast} colorMode={colorMode} onColorModeChange={setColorMode} openIndividualOrders={openIndividualOrders} onAddCards={handleStartAddCards} collection={collection} onSetExtra={handleSetCollectionExtra} />; } catch(e) { return <div style={{padding:20,color:'var(--danger)',fontSize:'var(--fs-xs)'}}>Crash: {e.message}</div>; } })()}
        {page === 'admin' && <AdminConsole pricing={pricing} theme={theme} token={token} nav={nav} onReload={()=>loadAppData(token,session?.user?.id)} toast={toast} initialSection={adminTarget} />}
        {page === 'onboarding' && <OnboardingPage onComplete={handleOnboardingComplete} theme={theme} />}
      </main>
    </>}
  </div>);
}
