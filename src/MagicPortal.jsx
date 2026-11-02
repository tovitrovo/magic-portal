import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { ScrollText, ShoppingCart, User, Shield, Plus, Minus, Trash2, ChevronRight, ChevronLeft, ChevronUp, Sparkles, LogOut, Check, Search, BookOpen, Eye, EyeOff, Mail, Lock, ArrowRight, ArrowLeft, X, Gift, Truck, CreditCard, Circle, CheckCircle, ArrowDown, Upload, Copy, Calendar, DollarSign, Settings, Camera, Phone, MessageCircle, Bell, Package, MapPin, Edit3, RefreshCw, Volume2, VolumeX, HelpCircle, Loader, AlertTriangle, Wifi, WifiOff, Archive, Sun, Moon, LayoutDashboard, Users, TrendingUp, BellRing, BellOff, Clock, Layers, ShoppingBag, ClipboardList, Zap, Store, Wallet, Activity, Inbox, LogIn, UserPlus } from 'lucide-react';
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
import { GT, GT_LIGHT, MONO, inkOn } from './guildTheme';
import { SFX, wa, useDialogA11y, TC, Card, Btn, Input, Tag, EmptyState, Spin, CardThumb, ImageLightbox, CATALOG_TCG, CATALOG_TYPES } from './kit';
import { SB_URL, SB_KEY, mpSync } from './config';
import { findAlternatives, findTwin, indexActiveCards, searchStem } from '../shared/wishlistReconcile';
import { PASSWORD_V2_FLAG, needsPasswordUpgrade, passwordChecks, passwordProblem } from '../shared/passwordPolicy';
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
  const r = await fetch(`${SB_URL}/auth/v1/signup`, { method: 'POST', headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, data: { [PASSWORD_V2_FLAG]: true } }) });
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
    // A marca vai junto: a partir daqui a conta não usa mais o código de 6 números.
    body: JSON.stringify({ password: newPassword, data: { [PASSWORD_V2_FLAG]: true } })
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const msg = String(d.msg || d.error_description || d.message || '');
    if (/different from the old|same as the old/i.test(msg)) throw new Error('A senha nova precisa ser diferente da atual');
    if (/weak|short|at least/i.test(msg)) throw new Error('Senha fraca demais. Tente outra.');
    throw new Error('Erro ao alterar senha');
  }
  return r.json().catch(() => null);
}

// Usuário atual, direto do servidor (metadados frescos).
async function sbAuthGetUser(token) {
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
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
const MODE_BG={dark:'#0b0b0c',light:'#fafaf8'};
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
function unitPriceFor(cardType, totalQty, pricing, indiv, extraUsd = 0) {
  if (indiv && Array.isArray(indiv.tiers) && indiv.tiers.length) {
    return indivPricePerCard({ qty: totalQty, type: cardType, tiers: indiv.tiers, pricing: indiv.pricing, fxRate: indiv.fx && indiv.fx.rate, extraUsd });
  }
  return getCardPrice(cardType, pricing);
}

// Preço unitário "cheio" (faixa mais cara / menor volume), sem o desconto por
// volume. Serve de referência para mostrar a economia ao cliente.
function baseUnitPriceFor(cardType, pricing, indiv, extraUsd = 0) {
  if (indiv && Array.isArray(indiv.tiers) && indiv.tiers.length) {
    return Math.max(...indiv.tiers.map(t => indivPricePerCard({ qty: Number(t.min_qty) || 0, type: cardType, tiers: indiv.tiers, pricing: indiv.pricing, fxRate: indiv.fx && indiv.fx.rate, extraUsd })));
  }
  return getCardPrice(cardType, pricing);
}

// ══════════════════════════════════════════════════════
// UI PRIMITIVES
// ══════════════════════════════════════════════════════

const ManaOrb=({mana,selected,onClick,size=44})=>{const m=MANA_COLORS.find(c=>c.key===mana);return <button onClick={()=>{SFX.toggle();onClick&&onClick();}} style={{width:size,height:size,borderRadius:size,background:selected?wa(m.color,'28'):'var(--fill-soft)',border:'2.5px solid '+(selected?m.color:'var(--text-faint)'),display:'grid',placeItems:'center',cursor:'pointer',fontSize:size*.4,transition:'all .2s',boxShadow:selected?'0 0 14px '+wa(m.color,'35'):'none'}}>{m.emoji}</button>;};
const GuildBadge=({guild,size=22})=>{if(!guild||!GT[guild])return null;const t=guildTheme(guild);return <div style={{width:size,height:size,borderRadius:size,background:'linear-gradient(135deg,'+t.primary+','+t.secondary+')',boxShadow:'0 0 '+size*.5+'px '+t.glow,flexShrink:0}}/>;};

const Toast=({msg,type='info',onClose})=>{const bg=type==='error'?'rgba(var(--danger-rgb),0.15)':type==='success'?'rgba(var(--ok-rgb),0.15)':'rgba(var(--info-rgb),0.15)';const c=type==='error'?'var(--danger)':type==='success'?'var(--ok)':'var(--info)';return <div style={{position:'fixed',top:16,left:'50%',transform:'translateX(-50%)',zIndex:200,padding:'10px 18px',borderRadius:'var(--r-card)',background:bg,border:'1px solid '+wa(c,'30'),color:c,fontSize:'var(--fs-sm)',fontWeight:600,display:'flex',alignItems:'center',gap:'var(--sp-2)',backdropFilter:'blur(12px)',maxWidth:'90%'}}>{type==='error'?<AlertTriangle size={15}/>:<Check size={15}/>}{msg}<button onClick={onClose} style={{background:'none',border:'none',color:c,cursor:'pointer',padding:'var(--sp-1)'}}><X size={14}/></button></div>;};

// ══════════════════════════════════════════════════════
// MENU DA CONTA — o avatar do topo
// ══════════════════════════════════════════════════════
//
// Substitui a barra de abas de baixo e a lateral do desktop. O catálogo é
// aberto centenas de vezes por compra; pedidos, desejos e conta, poucas. Por
// isso eles saíram da tela e foram para cá. O anel do avatar é a cor da
// guilda — o último lugar onde ela aparece na interface.
function AccountMenu({isAdmin,activeOrders=0,wishCount=0,colorMode,onToggleColorMode,soundOn,onToggleSound,onNavigate,onLogout}){
  const [open,setOpen]=useState(false);
  const ref=useRef(null);
  useEffect(()=>{
    if(!open)return;
    const onDown=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    const onKey=e=>{if(e.key==='Escape')setOpen(false);};
    document.addEventListener('pointerdown',onDown);
    document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('pointerdown',onDown);document.removeEventListener('keydown',onKey);};
  },[open]);
  const go=(p,tab)=>{setOpen(false);onNavigate(p,tab);};
  const item={width:'100%',minHeight:44,padding:'0 12px',borderRadius:'var(--r-control)',border:'none',background:'transparent',color:'var(--text-strong)',display:'flex',alignItems:'center',gap:10,fontSize:'var(--fs-sm)',fontFamily:"'Inter',system-ui,sans-serif",cursor:'pointer',textAlign:'left'};
  const hint={marginLeft:'auto',fontSize:'var(--fs-xs)',color:'var(--text-dim)'};
  return(<div ref={ref} style={{position:'relative'}}>
    <button id="tut-account-btn" onClick={()=>{SFX.toggle();setOpen(o=>!o);}} className="mp-tap" aria-haspopup="menu" aria-expanded={open} aria-label={activeOrders>0?`Menu da conta, ${activeOrders} pedido${activeOrders>1?'s':''} em andamento`:'Menu da conta'} style={{background:'none',border:'none',cursor:'pointer',position:'relative'}}>
      <span style={{width:32,height:32,borderRadius:'50%',display:'grid',placeItems:'center',background:'var(--fill)',color:'var(--text-strong)',boxShadow:'0 0 0 2px var(--bg), 0 0 0 3.5px var(--ga)'}}><User size={16}/></span>
      {activeOrders>0&&<span aria-hidden="true" style={{position:'absolute',top:7,right:7,width:10,height:10,borderRadius:'50%',background:'var(--info)',border:'2px solid var(--bg)'}}/>}
    </button>
    {open&&<div role="menu" aria-label="Conta" style={{position:'absolute',top:48,right:4,width:250,padding:6,borderRadius:14,background:'var(--sheet-bg)',border:'1px solid var(--line)',boxShadow:'0 12px 40px rgba(var(--sunk),calc(0.35*var(--sunk-a)))',display:'flex',flexDirection:'column',zIndex:60,animation:'fadeIn .12s ease'}}>
      <button role="menuitem" style={item} onClick={()=>go('profile','orders')}><Package size={17}/>Meus pedidos{activeOrders>0&&<span style={{marginLeft:'auto',fontSize:'var(--fs-2xs)',fontWeight:600,color:'#fff',background:'var(--info)',padding:'2px 8px',borderRadius:'var(--r-pill)'}}>{activeOrders} em andamento</span>}</button>
      <button role="menuitem" style={item} onClick={()=>go('wants')}><ScrollText size={17}/>Lista de desejos{wishCount>0&&<span style={hint}>{wishCount}</span>}</button>
      <button role="menuitem" style={item} onClick={()=>go('profile','collection')}><Layers size={17}/>Minha coleção</button>
      <button role="menuitem" style={item} onClick={()=>go('profile','account')}><MapPin size={17}/>Dados e endereço</button>
      {isAdmin&&<button role="menuitem" style={item} onClick={()=>go('admin')}><Shield size={17}/>Admin</button>}
      <span aria-hidden="true" style={{height:1,margin:'4px 8px',background:'var(--line)'}}/>
      <button role="menuitemcheckbox" aria-checked={colorMode==='dark'} style={item} onClick={()=>{SFX.toggle();onToggleColorMode();}}>{colorMode==='light'?<Moon size={17}/>:<Sun size={17}/>}{colorMode==='light'?'Modo escuro':'Modo claro'}</button>
      <button role="menuitemcheckbox" aria-checked={soundOn} style={item} onClick={onToggleSound}>{soundOn?<Volume2 size={17}/>:<VolumeX size={17}/>}Sons<span style={hint}>{soundOn?'ligados':'desligados'}</span></button>
      <span aria-hidden="true" style={{height:1,margin:'4px 8px',background:'var(--line)'}}/>
      <button role="menuitem" style={{...item,color:'var(--text-dim)'}} onClick={()=>{setOpen(false);onLogout();}}><LogOut size={17}/>Sair</button>
    </div>}
  </div>);
}

// ══════════════════════════════════════════════════════
// PÍLULA DO PEDIDO — o carrinho que acompanha o catálogo
// ══════════════════════════════════════════════════════
//
// O único elemento fixo da Galeria. Mostra o progresso até o mínimo e o total
// já com a faixa de volume aplicada; tocar leva ao pedido. Ela "pula" a cada
// carta somada — é o retorno do "+" da grade, no lugar de um toast.
function OrderPill({count,minCards,total,isAdding,onOpen}){
  const [pop,setPop]=useState(0);
  const prev=useRef(count);
  useEffect(()=>{if(count>prev.current)setPop(p=>p+1);prev.current=count;},[count]);
  const label=count===0
    ?`Mínimo ${minCards} cartas`
    :isAdding?`${count} carta${count!==1?'s':''} a mais`:`${count} / ${minCards} cartas`;
  const money='R$ '+total.toFixed(2).replace('.',',');
  return(<button key={pop} className="portal-order-pill" onClick={()=>{SFX.nav();onOpen();}} aria-label={`Abrir pedido: ${label}, ${money}`} style={{position:'fixed',left:'50%',bottom:'max(24px, env(safe-area-inset-bottom))',transform:'translateX(-50%)',zIndex:40,height:52,padding:'0 22px',border:'none',borderRadius:26,background:'var(--gp)',color:'var(--gp-ink)',display:'flex',alignItems:'center',gap:12,fontFamily:"'Inter',system-ui,sans-serif",fontSize:'var(--fs-sm)',fontWeight:500,whiteSpace:'nowrap',boxShadow:'0 8px 28px rgba(var(--sunk),calc(0.3*var(--sunk-a)))',cursor:'pointer'}}>
    <span style={{display:'inline-block',animation:pop?'pillPop .3s ease':'none'}}>{label}</span>
    <span aria-hidden="true" style={{width:1,height:16,background:'currentColor',opacity:.35}}/>
    <span>{money}</span>
    <ChevronUp size={16}/>
  </button>);
}

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
    {onEdit&&<button onClick={onEdit} style={{minHeight:44,background:'none',border:'none',padding:'0 4px',cursor:'pointer',color:'var(--text-strong)',fontSize:'var(--fs-sm)',fontWeight:500,textDecoration:'underline',flexShrink:0,fontFamily:"'Inter',system-ui,sans-serif"}}>Editar</button>}
  </div>);
};


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
    <div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',width:'calc(100% - 40px)',maxWidth:420,zIndex:102}}>
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
  {title:'Catálogo',body:'Aqui ficam todas as cartas de Magic à venda. A tela é delas: o resto do app fica no menu da sua conta, no topo.',navTo:'catalog',spotlightId:null,icon:'📖'},
  {title:'Busca e filtros',body:'Filtre por tipo logo acima das cartas, ou toque na lupa para buscar pelo nome.',navTo:'catalog',spotlightId:'tut-search-area',scrollTo:true,icon:'🔍'},
  {title:'Montar o pedido',body:'O + põe a carta no pedido sem sair da tela. Tocar na carta abre o detalhe, onde você ajusta a quantidade ou guarda nos desejos.',navTo:'catalog',spotlightId:null,icon:'➕',interactive:true},
  {title:'Seu pedido',body:'A pílula embaixo mostra quantas cartas faltam para o mínimo e o total. Tocando nela, o pedido abre por cima das cartas: lá você revisa, confere o frete e paga pelo Mercado Pago.',navTo:'catalog',spotlightId:null,icon:'🛒'},
  {title:'Menu da conta',body:'No avatar do topo ficam seus pedidos, a lista de desejos, a coleção e seus dados.',navTo:'catalog',spotlightId:'tut-account-btn',icon:'👤'},
];

// ══════════════════════════════════════════════════════
// CATALOG — Supabase powered, server-side search/filter
// ══════════════════════════════════════════════════════


function CatalogPage({token,wishlist,cartItems=[],collectionByCard,onAddToWishlist,onRemoveFromWishlist,onAddToCart,onUpdateCartQty,priceFor,theme,tutStep,onTutNext}){
  const [search,setSearch]=useState('');const [typeF,setTypeF]=useState('Todos');const [variantF,setVariantF]=useState('');const [cards,setCards]=useState([]);const [total,setTotal]=useState(0);
  const [page,setPage]=useState(0);const [loading,setLoading]=useState(false);
  // Índice da carta aberta no detalhe (não a carta): é o que deixa as setas
  // andarem pela grade sem fechar a folha.
  const [detailIdx,setDetailIdx]=useState(null);
  const [searchOpen,setSearchOpen]=useState(false);
  const PAGE_SIZE=20;
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

  useEffect(()=>{setPage(0);setCards([]);setDetailIdx(null);},[search,typeF,variantF]);
  useEffect(()=>{const t=setTimeout(fetchCards,300);return()=>{clearTimeout(t);latestFetchRef.current++;};},[fetchCards,page]);

  // "+" da grade e do detalhe: soma uma. O retorno é o selo ×N na carta e a
  // pílula pulando — sem toast, que cobriria a grade a cada toque.
  function add(card){onAddToCart(card,1);if(tutStep===2&&onTutNext)onTutNext();}
  function dec(card){const row=cartItems.find(ci=>ci.card_id===card.id);if(row){SFX.click();onUpdateCartQty(row.id,row.quantity-1);}}
  function toggleWish(card){const row=wishlist.find(w=>w.card_id===card.id);if(row)onRemoveFromWishlist(row.id);else{SFX.addCard();onAddToWishlist(card,1);}}

  const money=n=>'R$ '+Number(n||0).toFixed(2).replace('.',',');
  const detail=detailIdx!==null?cards[detailIdx]:null;
  const filterBtn=active=>({flex:'none',height:36,padding:0,border:'none',borderBottom:'1.5px solid '+(active?'var(--text-strong)':'transparent'),background:'transparent',color:active?'var(--text-strong)':'var(--text-dim)',fontSize:'var(--fs-sm)',fontWeight:500,cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif",whiteSpace:'nowrap'});

  return(<div className="portal-page portal-catalog" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)',paddingBottom:96}}>
    <div id="tut-search-area" style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>
      <div style={{display:'flex',alignItems:'center',gap:'var(--sp-2)'}}>
        {(searchOpen||search)
          ? <label style={{flex:1,display:'flex',alignItems:'center',gap:'var(--sp-2)',height:44,padding:'0 12px',borderRadius:'var(--r-pill)',background:'var(--fill)'}}>
              <Search size={17} style={{color:'var(--text-dim)',flexShrink:0}} aria-hidden="true"/>
              <span className="mp-sr-only">Buscar carta</span>
              <input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar carta" style={{flex:1,minWidth:0,border:'none',outline:'none',background:'transparent',color:'var(--text-strong)',fontSize:'var(--fs-md)',fontFamily:"'Inter',system-ui,sans-serif"}}/>
              <button onClick={()=>{setSearch('');setSearchOpen(false);}} aria-label="Fechar busca" className="mp-tap" style={{marginRight:-10,background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer'}}><X size={17}/></button>
            </label>
          : <>
              <nav aria-label="Filtros" style={{flex:1,minWidth:0,display:'flex',gap:18,overflowX:'auto',scrollbarWidth:'none'}}>
                {catalogFilters.map(t=>(<button key={t} aria-pressed={typeF===t} onClick={()=>{SFX.toggle();setTypeF(t);}} style={filterBtn(typeF===t)}>{t==='Todos'?'Todas':t===RECENT_CARDS_FILTER?'Novas':t}</button>))}
              </nav>
              <button onClick={()=>setSearchOpen(true)} aria-label="Buscar carta" className="mp-tap" style={{marginRight:-10,background:'none',border:'none',color:'var(--text-strong)',cursor:'pointer'}}><Search size={20}/></button>
            </>}
      </div>
      {typeF===VARIANTS_FILTER&&<div style={{display:'flex',gap:14,overflowX:'auto',scrollbarWidth:'none'}}>
        {['',...VARIANTS].map(v=>(<button key={v||'all'} aria-pressed={variantF===v} onClick={()=>{SFX.toggle();setVariantF(v);}} style={{...filterBtn(variantF===v),fontSize:'var(--fs-xs)',height:32}}>{v||'Todas'}</button>))}
      </div>}
    </div>
    {loading&&cards.length===0?(
      // Skeleton em vez de spinner: mantendo a altura, nada pula a cada tecla.
      <div className="portal-card-grid portal-catalog-grid" aria-hidden="true">
        {Array.from({length:6}).map((_,i)=>(
          <div key={'sk'+i}>
            <div style={{width:'100%',aspectRatio:'63 / 88',borderRadius:9,background:'var(--fill)',animation:'skPulse 1.2s ease-in-out infinite'}}/>
            <div style={{height:11,width:'70%',borderRadius:4,background:'var(--fill)',marginTop:10,animation:'skPulse 1.2s ease-in-out infinite'}}/>
            <div style={{height:10,width:'35%',borderRadius:4,background:'var(--fill)',marginTop:6,animation:'skPulse 1.2s ease-in-out infinite'}}/>
          </div>
        ))}
      </div>
    ):(
      <div className="portal-card-grid portal-catalog-grid" style={{opacity:loading?0.55:1,transition:'opacity .15s'}}>
        {cards.map((c,i)=>{
          const inCart=cartItems.find(ci=>ci.card_id===c.id);
          const ownedQty=collectionByCard?.get?.(c.id)||0;
          return(<article key={c.id} style={{display:'flex',flexDirection:'column',gap:6,minWidth:0}}>
            <button onClick={()=>{SFX.nav();setDetailIdx(i);}} aria-label={`Ver ${c.name}`} style={{position:'relative',display:'block',width:'100%',padding:0,border:'none',background:'none',cursor:'pointer',borderRadius:9}}>
              <CardThumb card={c} radius={9} style={{aspectRatio:'63 / 88',border:'none'}}/>
              {inCart&&<span style={{position:'absolute',left:8,top:8,minWidth:26,height:26,padding:'0 7px',borderRadius:13,background:'var(--ga)',color:'var(--ga-ink)',fontSize:'var(--fs-xs)',fontWeight:600,display:'grid',placeItems:'center',boxShadow:'0 2px 8px rgba(var(--sunk),calc(0.3*var(--sunk-a)))'}}>×{inCart.quantity}</span>}
            </button>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:1}}>
                <h2 style={{margin:0,fontSize:'var(--fs-sm)',fontWeight:500,color:'var(--text-strong)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</h2>
                <span style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{money(priceFor(c))}{c.variant?` · ${c.variant}`:c.type&&c.type!=='Normal'?` · ${c.type}`:''}{ownedQty>0?` · tenho ${ownedQty}`:''}</span>
              </div>
              <button ref={i===0?firstAddBtnRef:null} id={i===0?'tut-add-btn':undefined} onClick={()=>add(c)} aria-label={`Adicionar uma ${c.name} ao pedido`} className="mp-tap" style={{flexShrink:0,marginRight:-10,background:'none',border:'none',color:'var(--text-strong)',cursor:'pointer'}}><Plus size={19}/></button>
            </div>
          </article>);
        })}
        {cards.length===0&&!loading&&<div style={{gridColumn:'1 / -1'}}><EmptyState icon={Search} title="Nenhuma carta encontrada" sub="Tente outro termo"/></div>}
      </div>
    )}
    {cards.length>0&&<div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'var(--sp-2)',padding:'8px 0'}}>
      <div aria-live="polite" style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)'}}>
        {cards.length} de {total} carta{total!==1?'s':''}
      </div>
      {cards.length<total&&<Btn variant="secondary" disabled={loading} onClick={()=>setPage(p=>p+1)} sfx="nav" style={{minWidth:200}}>
        {loading?<><Spin size={14}/> Carregando…</>:<>Carregar mais {Math.min(PAGE_SIZE,total-cards.length)}</>}
      </Btn>}
    </div>}
    {tutStep===2&&handPos&&<div style={{position:'fixed',top:handPos.top,left:handPos.left,zIndex:200,pointerEvents:'none',fontSize:'var(--fs-xl)',animation:'tutHandBounce 0.8s ease-in-out infinite',transform:'translateX(-50%)'}}>👆</div>}
    {detail&&<CardDetailModal
      card={detail}
      price={priceFor(detail)}
      cartRow={cartItems.find(ci=>ci.card_id===detail.id)}
      wished={wishlist.some(w=>w.card_id===detail.id)}
      ownedQty={collectionByCard?.get?.(detail.id)||0}
      hasPrev={detailIdx>0}
      hasNext={detailIdx<cards.length-1}
      onPrev={()=>setDetailIdx(i=>Math.max(0,i-1))}
      onNext={()=>setDetailIdx(i=>Math.min(cards.length-1,i+1))}
      onAdd={()=>add(detail)}
      onDec={()=>dec(detail)}
      onToggleWish={()=>toggleWish(detail)}
      onClose={()=>setDetailIdx(null)}/>}
  </div>);
}

// Folha de detalhe da carta. Não existe mais "Comprar": o −/+ mexe direto no
// pedido, então o que a folha mostra é o que está no pedido. As setas (e o
// arrasto lateral na imagem) passam para a carta vizinha sem fechar a folha.
// Desejar é o gesto secundário e só existe aqui.
function CardDetailModal({card,price,cartRow,wished,ownedQty=0,hasPrev,hasNext,onPrev,onNext,onAdd,onDec,onToggleWish,onClose}){
  const [zoom,setZoom]=useState(false);
  const touchX=useRef(null);
  const dialogRef=useDialogA11y(onClose);
  const qty=cartRow?.quantity||0;
  const meta=[card.type,card.variant].filter(Boolean).join(' · ');
  const money='R$ '+Number(price||0).toFixed(2).replace('.',',');
  useEffect(()=>{
    const onKey=e=>{if(e.key==='ArrowLeft'&&hasPrev)onPrev();if(e.key==='ArrowRight'&&hasNext)onNext();};
    document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);
  },[hasPrev,hasNext,onPrev,onNext]);
  const arrow=on=>({flexShrink:0,width:44,height:44,borderRadius:22,border:'none',background:'var(--fill)',color:'var(--text-strong)',display:'grid',placeItems:'center',cursor:on?'pointer':'default',opacity:on?1:.3});
  return(<div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="card-detail-title" style={{position:'fixed',inset:0,zIndex:120,display:'flex',alignItems:'flex-end',justifyContent:'center',animation:'fadeIn .15s ease'}}>
    <div onClick={onClose} aria-hidden="true" style={{position:'absolute',inset:0,background:'var(--scrim)'}}/>
    <div className="portal-modal" style={{position:'relative',width:'100%',maxWidth:480,maxHeight:'94vh',overflowY:'auto',background:'var(--sheet-bg)',borderRadius:'var(--r-sheet) var(--r-sheet) 0 0',padding:'10px 20px max(24px, env(safe-area-inset-bottom))',display:'flex',flexDirection:'column',gap:14,animation:'sheetUp .22s ease'}}>
      <div aria-hidden="true" style={{alignSelf:'center',width:40,height:5,borderRadius:3,background:'var(--line)'}}/>
      <button onClick={onClose} aria-label="Fechar" className="mp-tap" style={{position:'absolute',top:6,right:8,background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer'}}><X size={18}/></button>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
        <button onClick={()=>hasPrev&&onPrev()} disabled={!hasPrev} aria-label="Carta anterior" style={arrow(hasPrev)}><ChevronLeft size={18}/></button>
        <div
          role={card.image_url?'button':undefined} tabIndex={card.image_url?0:undefined} aria-label={card.image_url?`Ampliar imagem de ${card.name}`:undefined}
          onClick={()=>card.image_url&&setZoom(true)}
          onKeyDown={e=>{if(card.image_url&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setZoom(true);}}}
          onTouchStart={e=>{touchX.current=e.touches[0].clientX;}}
          onTouchEnd={e=>{const x0=touchX.current;touchX.current=null;if(x0==null)return;const dx=e.changedTouches[0].clientX-x0;if(dx>50&&hasPrev)onPrev();else if(dx<-50&&hasNext)onNext();}}
          style={{width:'min(230px, 60vw)',cursor:card.image_url?'zoom-in':'default'}}>
          <CardThumb key={card.id} card={card} radius={12} style={{aspectRatio:'63 / 88',border:'none'}}/>
        </div>
        <button onClick={()=>hasNext&&onNext()} disabled={!hasNext} aria-label="Próxima carta" style={arrow(hasNext)}><ChevronRight size={18}/></button>
      </div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:12}}>
        <div style={{minWidth:0}}>
          <h2 id="card-detail-title" style={{margin:0,fontSize:'var(--fs-xl)',fontWeight:600,letterSpacing:-0.3,color:'var(--text-strong)',lineHeight:1.15}}>{card.name}</h2>
          <div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',marginTop:3}}>{meta}{ownedQty>0?` · você tem ${ownedQty}`:''}</div>
        </div>
        <span style={{fontSize:'var(--fs-lg)',fontWeight:600,color:'var(--text-strong)',whiteSpace:'nowrap'}}>{money}</span>
      </div>
      {qty>0
        ? <div style={{height:52,display:'flex',alignItems:'center',borderRadius:26,background:'var(--fill)'}}>
            <button onClick={onDec} aria-label="Tirar uma do pedido" style={{width:64,height:52,border:'none',background:'transparent',color:'var(--text-strong)',display:'grid',placeItems:'center',cursor:'pointer'}}><Minus size={18}/></button>
            <span aria-live="polite" style={{flex:1,textAlign:'center',fontSize:'var(--fs-md)',fontWeight:500,color:'var(--text-strong)'}}>{qty} no pedido</span>
            <button onClick={onAdd} aria-label="Pôr mais uma no pedido" style={{width:64,height:52,border:'none',background:'transparent',color:'var(--text-strong)',display:'grid',placeItems:'center',cursor:'pointer'}}><Plus size={18}/></button>
          </div>
        : <button onClick={onAdd} style={{height:52,border:'none',borderRadius:26,background:'var(--gp)',color:'var(--gp-ink)',fontSize:'var(--fs-md)',fontWeight:500,fontFamily:"'Inter',system-ui,sans-serif",cursor:'pointer'}}>Adicionar ao pedido</button>}
      <button onClick={onToggleWish} aria-pressed={wished} style={{height:44,border:'none',background:'transparent',color:'var(--text-dim)',fontSize:'var(--fs-sm)',fontFamily:"'Inter',system-ui,sans-serif",display:'flex',alignItems:'center',justifyContent:'center',gap:8,cursor:'pointer'}}>
        <ScrollText size={16} fill={wished?'currentColor':'none'}/>{wished?'Nos seus desejos':'Guardar nos desejos'}
      </button>
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

function WishlistPage({token,wishlist,cartItems,collectionByCard,onAddToCart,onRemove,onUpdateQty,onSwap,cartCount,theme,nav}){
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
  // Desejos em cartas que saíram do catálogo: procura a mesma carta ainda à
  // venda (outro tipo, ou a gêmea se a checagem diária ainda não passou).
  const [alts,setAlts]=useState({});
  const gone=wishlist.filter(w=>w.card_active===false);
  const goneKey=gone.map(w=>w.id+':'+w.card_id).join(',');
  useEffect(()=>{
    if(!token||!gone.length)return;
    let alive=true;
    (async()=>{
      const out={};
      for(const w of gone.slice(0,40)){
        const stem=searchStem(w.card_name);
        if(!stem)continue;
        try{
          const rows=await sbGet('cards',`is_active=eq.true&tcg=eq.${encodeURIComponent(CATALOG_TCG)}&name=ilike.*${encodeURIComponent(stem)}*&select=id,name,type,image_url,supplier_extra_usd,source_url,created_at&limit=40`,token);
          const index=indexActiveCards(rows||[]);
          const card={id:w.card_id,name:w.card_name,type:w.card_type};
          const twin=findTwin(card,index);
          out[w.id]=twin?[twin]:findAlternatives(card,index);
        }catch(e){console.warn('[wishlist] alternativas:',e);}
      }
      if(alive)setAlts(out);
    })();
    return()=>{alive=false;};
  },[token,goneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabBtn=active=>({flex:'none',height:36,padding:0,border:'none',borderBottom:'1.5px solid '+(active?'var(--text-strong)':'transparent'),background:'transparent',color:active?'var(--text-strong)':'var(--text-dim)',fontSize:'var(--fs-sm)',fontWeight:500,cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif",whiteSpace:'nowrap'});

  return(<div className="portal-page portal-wants" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)',paddingBottom:96}}>
    <div id="tut-wants-tags" style={{display:'flex',flexDirection:'column',gap:4}}>
      <div style={{fontSize:'var(--fs-xl)',fontWeight:600,letterSpacing:-0.3,color:'var(--text-strong)'}}>{missingUnits} carta{missingUnits!==1?'s':''} faltando</div>
      <div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',lineHeight:1.5}}>Só o que você quer ter. Nada daqui vai para o pedido sozinho.</div>
    </div>

    {(complete.length>0||visible.length>3)&&<div style={{display:'flex',alignItems:'center',gap:18}}>
      {complete.length>0&&<div role="tablist" aria-label="Filtrar lista de desejos" style={{display:'flex',gap:18}}>
        {[{key:'pending',label:`Falta comprar (${pending.length})`},{key:'done',label:`Já tenho (${complete.length})`}].map(t=>(
          <button key={t.key} role="tab" aria-selected={filter===t.key} onClick={()=>{SFX.toggle();setFilter(t.key);}} style={tabBtn(filter===t.key)}>{t.label}</button>
        ))}
      </div>}
    </div>}

    {visible.length>3&&<label style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',height:44,padding:'0 14px',borderRadius:'var(--r-pill)',background:'var(--fill)'}}>
      <Search size={17} style={{color:'var(--text-dim)',flexShrink:0}} aria-hidden="true"/>
      <span className="mp-sr-only">Buscar na lista</span>
      <input value={searchW} onChange={e=>setSearchW(e.target.value)} placeholder="Buscar na lista" style={{flex:1,minWidth:0,border:'none',outline:'none',background:'transparent',color:'var(--text-strong)',fontSize:'var(--fs-md)',fontFamily:"'Inter',system-ui,sans-serif"}}/>
    </label>}

    {filtered.length>0&&<ul className="portal-wants-grid" style={{listStyle:'none',margin:0,padding:0,display:'grid',columnGap:24}}>
      {filtered.map((w)=>{const img=w.card_image_url;const done=w.missing<=0;
        const off=w.card_active===false;
        const options=off?(alts[w.id]||[]):[];
        const meta=[off?'fora do catálogo no momento':null,done?`completa · ${w.ownedQty} na coleção`:`${w.ownedQty} de ${w.quantity} na coleção`,w.card_type&&w.card_type!=='Normal'?w.card_type:null,w.inCartQty>0?`${w.inCartQty} no pedido`:null].filter(Boolean).join(' · ');
        return(
        <li key={w.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid var(--line-soft)',opacity:done?0.7:1}}>
          <button onClick={()=>img&&setZoomSrc(img)} disabled={!img} aria-label={img?`Ampliar imagem de ${w.card_name}`:w.card_name} style={{width:48,flexShrink:0,padding:0,border:'none',background:'none',cursor:img?'zoom-in':'default'}}><CardThumb card={w} radius={5} style={{aspectRatio:'63 / 88',border:'none'}}/></button>
          <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:1}}>
            <span style={{fontSize:'var(--fs-sm)',fontWeight:500,color:'var(--text-strong)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{w.card_name}</span>
            <span style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{meta}</span>
            {/* Discreto de propósito: a lista é de desejo, comprar é opcional. */}
            {off&&options.map(alt=>(<button key={alt.id} onClick={()=>onSwap&&onSwap(w,alt)} aria-label={`Trocar por ${alt.name} (${alt.type||'Normal'})`} style={{alignSelf:'flex-start',minHeight:32,padding:'4px 0',border:'none',background:'none',color:'var(--text-strong)',fontSize:'var(--fs-xs)',fontWeight:500,textDecoration:'underline',cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif"}}>{alt.type===w.card_type?'Voltou ao catálogo · atualizar':`Tem em ${alt.type||'Normal'} · trocar`}</button>))}
            {!done&&!off&&<button onClick={()=>onAddToCart(w,w.missing)} aria-label={`Pôr ${w.missing} ${w.card_name} no pedido`} style={{alignSelf:'flex-start',minHeight:32,padding:'4px 0',border:'none',background:'none',color:'var(--text-strong)',fontSize:'var(--fs-xs)',fontWeight:500,textDecoration:'underline',cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif"}}>Pôr {w.missing} no pedido</button>}
          </div>
          <div style={{display:'flex',alignItems:'center',borderRadius:22,background:'var(--fill)',flexShrink:0}}>
            <button onClick={()=>w.quantity<=1?onRemove(w.id):onUpdateQty(w.id,w.quantity-1)} aria-label={w.quantity<=1?`Tirar ${w.card_name} da lista`:`Querer uma ${w.card_name} a menos`} style={{width:44,height:44,border:'none',background:'transparent',color:'var(--text-strong)',display:'grid',placeItems:'center',cursor:'pointer'}}>{w.quantity<=1?<Trash2 size={15}/>:<Minus size={16}/>}</button>
            <span aria-label={`Quantidade desejada: ${w.quantity}`} style={{minWidth:18,textAlign:'center',fontSize:'var(--fs-sm)',fontWeight:600,color:'var(--text-strong)'}}>{w.quantity}</span>
            <button onClick={()=>onUpdateQty(w.id,w.quantity+1)} aria-label={`Querer mais uma ${w.card_name}`} style={{width:44,height:44,border:'none',background:'transparent',color:'var(--text-strong)',display:'grid',placeItems:'center',cursor:'pointer'}}><Plus size={16}/></button>
          </div>
        </li>
      );})}
    </ul>}

    {filtered.length===0&&(filter==='done'
      ?<EmptyState icon={Check} title="Nenhum desejo completo ainda" sub="Assim que a coleção cobrir o que você quer, a carta aparece aqui"/>
      :<EmptyState icon={ScrollText} title={searchW?'Nenhuma carta encontrada':'Sua lista de desejos está vazia'} sub={searchW?'Tente outro termo':'Abra uma carta no catálogo e toque em "Guardar nos desejos"'} action={!searchW?<Btn onClick={()=>nav&&nav('catalog')} sfx="nav">Ver cartas</Btn>:undefined}/>)}

    <ImageLightbox src={zoomSrc} onClose={()=>setZoomSrc(null)}/>
  </div>);
}

const MIN_ORDER_CARDS = 15;

// ══════════════════════════════════════════════════════
// FOLHA DO PEDIDO — carrinho + checkout numa tela só
// ══════════════════════════════════════════════════════
//
// Antes: aba Carrinho → "Ir para checkout" → "Avançar para endereço e frete"
// → escolher frete → Pagar. Agora a pílula abre esta folha por cima do
// catálogo e tudo acontece nela. Com endereço salvo, o frete é calculado e o
// mais barato já vem marcado: do catálogo ao pagamento são dois toques.
//
// A lógica de dinheiro é a mesma do checkout antigo (mínimo, faixa de volume,
// envio conjunto, modo de adição, salvar endereço, Mercado Pago); só a
// apresentação mudou.
function OrderSheet({cartItems=[],pricing,profile,token,onOrderDone,onSuccess,onClose,onUpdateCartQty,toast,unshippedPaidBatches=[],indiv=null,addTo=null,onCancelAdd}){
  const dialogRef=useDialogA11y(onClose);
  // Adição a um pedido já pago: o frete e o mínimo já foram resolvidos no
  // pedido de destino, então só as cartas novas são cobradas.
  const isAdding=!!addTo;
  const [freteOptions,setFreteOptions]=useState([]);const [selectedFrete,setSelectedFrete]=useState(null);
  const [lF,setLF]=useState(false);const [submitting,setSubmitting]=useState(false);
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
  const sub=cart.reduce((s,c)=>s+c.quantity*unitPriceFor(c.card_type,tierQty,pricing,indiv,c.card_extra_usd),0);
  // Economia por volume: preço cheio (faixa mais cara) menos o preço aplicado.
  const baseSub=cart.reduce((s,c)=>s+c.quantity*baseUnitPriceFor(c.card_type,pricing,indiv,c.card_extra_usd),0);
  const volumeDiscount=Math.max(0,baseSub-sub);
  // Frete: zero quando a remessa já existe (adição ou envio conjunto).
  const shippingSkipped=isAdding||useJointShipping;
  const fV=shippingSkipped?0:(selectedFrete?selectedFrete.price:0);
  const total=sub+fV;
  const cepClean=(addr.cep||'').replace(/\D/g,'');
  const addressUnchanged=addr.cep===(profile?.cep||'')&&addr.rua===(profile?.rua||'')&&addr.numero===(profile?.numero||'')&&addr.complemento===(profile?.complemento||'')&&addr.bairro===(profile?.bairro||'')&&addr.cidade===(profile?.cidade||'')&&addr.uf===(profile?.uf||'');
  const brl=n=>'R$ '+Number(n||0).toFixed(2).replace('.',',');

  useEffect(()=>{if(useJointShipping){setSelectedFrete({carrier:'Envio conjunto',price:0,deadline_days:0});setFreteOptions([]);}else{setSelectedFrete(null);setFreteOptions([]);}},[useJointShipping]);
  // Frete automático: com endereço salvo e o mínimo cumprido, calcula sozinho
  // — e recalcula quando a quantidade muda, porque o pacote muda junto.
  useEffect(()=>{
    if(!canCheckout||shippingSkipped||editingAddr||!profileHasSavedAddress||cepClean.length!==8)return;
    const t=setTimeout(calcFrete,400);return()=>clearTimeout(t);
  },[canCheckout,totalQty,shippingSkipped,editingAddr]); // eslint-disable-line react-hooks/exhaustive-deps

  async function calcFrete(){
    if(shippingSkipped) return; // frete não é necessário
    if(cepClean.length<8){toast('CEP inválido','error');return;}
    setLF(true);
    try{
      const r=await fetch(`/api/frete`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({cepDestino:cepClean,quantidade:totalQty})
      });
      const text=await r.text();
      let d;
      try{d=JSON.parse(text);}catch(pe){toast('Frete retornou resposta inválida','error');setLF(false);return;}
      if(d.error){toast('Erro frete: '+d.error,'error');setFreteOptions([]);setSelectedFrete(null);}
      else if(d.opcoes&&d.opcoes.length>0){
        // Mais barato primeiro, e já marcado. Se o cliente tinha escolhido
        // outro serviço, a escolha sobrevive ao recálculo.
        const opts=d.opcoes.map(o=>({carrier:o.nome,service:o.nome,price:Number(o.preco),deadline_days:o.prazo})).sort((a,b)=>a.price-b.price);
        setFreteOptions(opts);
        setSelectedFrete(prev=>opts.find(o=>prev&&o.service===prev.service)||opts[0]);
      } else {
        setFreteOptions([]);setSelectedFrete(null);
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
      onSuccess();
    }catch(e){console.error('[finalize]',e);toast('Erro ao finalizar: '+e.message,'error');}
    setSubmitting(false);
  }

  const row={display:'flex',justifyContent:'space-between',fontSize:'var(--fs-sm)',color:'var(--text-dim)'};
  const freteLabel=isAdding?`já pago no pedido #${addTo.shortId}`:useJointShipping?'envio conjunto · R$ 0,00':selectedFrete?brl(fV):lF?'calculando…':editingAddr?'calcule o frete':'—';
  const pct=Math.min(100,Math.round((totalQty/minCards)*100));

  return(<div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="order-sheet-title" style={{position:'fixed',inset:0,zIndex:110,display:'flex',alignItems:'flex-end',justifyContent:'center',animation:'fadeIn .15s ease'}}>
    <div onClick={onClose} aria-hidden="true" style={{position:'absolute',inset:0,background:'var(--scrim)'}}/>
    <div className="portal-modal portal-order-sheet" style={{position:'relative',width:'100%',maxWidth:480,maxHeight:'min(92vh, 860px)',background:'var(--sheet-bg)',borderRadius:'var(--r-sheet) var(--r-sheet) 0 0',display:'flex',flexDirection:'column',overflow:'hidden',animation:'sheetUp .22s ease'}}>
      <div style={{padding:'10px 20px 12px',borderBottom:'1px solid var(--line)',display:'flex',flexDirection:'column',gap:10}}>
        <div aria-hidden="true" style={{alignSelf:'center',width:40,height:5,borderRadius:3,background:'var(--line)'}}/>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <h2 id="order-sheet-title" style={{flex:1,margin:0,fontSize:'var(--fs-lg)',fontWeight:600,color:'var(--text-strong)'}}>{isAdding?`Adicionar ao pedido #${addTo.shortId}`:'Seu pedido'}</h2>
          <button onClick={onClose} aria-label="Fechar pedido" className="mp-tap" style={{marginRight:-12,background:'none',border:'none',color:'var(--text-strong)',cursor:'pointer'}}><X size={18}/></button>
        </div>
        {isAdding
          ? <div style={{display:'flex',alignItems:'center',gap:8,fontSize:'var(--fs-xs)',color:'var(--text-dim)',lineHeight:1.4}}>
              <span style={{flex:1}}>Sem frete novo e sem mínimo: vai na mesma remessa das {addTo.qtyPaid} cartas já pagas.</span>
              {onCancelAdd&&<button onClick={()=>{SFX.click();onCancelAdd();}} style={{flexShrink:0,height:32,padding:'0 10px',border:'1px solid var(--line)',borderRadius:'var(--r-pill)',background:'transparent',color:'var(--text-strong)',fontSize:'var(--fs-2xs)',fontWeight:600,cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif"}}>Fazer pedido novo</button>}
            </div>
          : totalQty>0&&<div style={{display:'flex',flexDirection:'column',gap:6}}>
              <div role="progressbar" aria-valuenow={totalQty} aria-valuemin={0} aria-valuemax={minCards} aria-label={`${totalQty} de ${minCards} cartas para o mínimo do pedido`} style={{height:4,borderRadius:2,background:'var(--fill)',overflow:'hidden'}}>
                <div style={{height:4,width:pct+'%',background:'var(--gp)',transition:'width .3s'}}/>
              </div>
              <span style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)'}}>{canCheckout?`${totalQty} cartas · pedido liberado`:`${totalQty} de ${minCards} cartas · faltam ${missingCards} para fechar o pedido`}</span>
            </div>}
      </div>

      <div style={{flex:1,minHeight:0,overflowY:'auto',padding:'0 20px'}}>
        {totalQty===0
          ? <EmptyState icon={ShoppingCart} title="Seu pedido está vazio" sub="Toque no + das cartas para montar a encomenda."/>
          : <ul style={{listStyle:'none',margin:0,padding:'4px 0'}}>
              {cart.map(c=>{const ip=unitPriceFor(c.card_type,tierQty,pricing,indiv,c.card_extra_usd);return(
                <li key={c.id} style={{display:'flex',alignItems:'center',gap:12,padding:'8px 0',borderBottom:'1px solid var(--line-soft)'}}>
                  <div style={{width:36,flexShrink:0}}><CardThumb card={c} radius={4} style={{aspectRatio:'63 / 88',border:'none'}}/></div>
                  <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:1}}>
                    <span style={{fontSize:'var(--fs-sm)',fontWeight:500,color:'var(--text-strong)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.card_name}</span>
                    <span style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)'}}>{brl(ip)} cada{c.card_type&&c.card_type!=='Normal'?` · ${c.card_type}`:''}</span>
                  </div>
                  <div style={{display:'flex',alignItems:'center',borderRadius:22,background:'var(--fill)'}}>
                    <button onClick={()=>{SFX.click();onUpdateCartQty(c.id,c.quantity-1);}} aria-label={c.quantity===1?`Tirar ${c.card_name} do pedido`:`Tirar uma ${c.card_name}`} style={{width:44,height:44,border:'none',background:'transparent',color:'var(--text-strong)',display:'grid',placeItems:'center',cursor:'pointer'}}>{c.quantity===1?<Trash2 size={15}/>:<Minus size={16}/>}</button>
                    <span aria-live="polite" style={{minWidth:18,textAlign:'center',fontSize:'var(--fs-sm)',fontWeight:600,color:'var(--text-strong)'}}>{c.quantity}</span>
                    <button onClick={()=>{SFX.click();onUpdateCartQty(c.id,c.quantity+1);}} aria-label={`Pôr mais uma ${c.card_name}`} style={{width:44,height:44,border:'none',background:'transparent',color:'var(--text-strong)',display:'grid',placeItems:'center',cursor:'pointer'}}><Plus size={16}/></button>
                  </div>
                </li>);})}
            </ul>}

        {/* Entrega: só quando o pedido pode fechar e há frete a resolver. */}
        {canCheckout&&!isAdding&&<section aria-label="Entrega" style={{display:'flex',flexDirection:'column',gap:10,padding:'16px 0'}}>
          {hasUnshippedPaidOrder&&<div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:'var(--fs-sm)',fontWeight:600,color:'var(--text-strong)'}}>Enviar junto, sem frete</div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',lineHeight:1.4}}>Você tem um pedido pago que ainda não foi postado.</div>
            </div>
            <button onClick={()=>{SFX.toggle();setUseJointShipping(v=>!v);}} role="switch" aria-checked={useJointShipping} aria-label="Enviar junto com um pedido pago que ainda não foi postado" style={{flexShrink:0,width:48,height:28,borderRadius:14,border:'none',background:useJointShipping?'var(--gp)':'var(--fill)',cursor:'pointer',position:'relative',transition:'background .2s'}}>
              <span style={{position:'absolute',top:3,left:useJointShipping?23:3,width:22,height:22,borderRadius:11,background:useJointShipping?'var(--gp-ink)':'var(--sheet-bg)',transition:'left .2s',boxShadow:'0 1px 4px rgba(var(--sunk),calc(0.3*var(--sunk-a)))'}}/>
            </button>
          </div>}
          {!shippingSkipped&&<>
            {profileHasSavedAddress&&!editingAddr
              ? <div style={{display:'flex',alignItems:'center',gap:10,fontSize:'var(--fs-sm)'}}>
                  <MapPin size={16} style={{flexShrink:0,color:'var(--text-dim)'}}/>
                  <span style={{flex:1,minWidth:0,color:'var(--text-dim)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{[addr.rua&&(addr.rua+(addr.numero?', '+addr.numero:'')),addr.cidade&&(addr.cidade+(addr.uf?'/'+addr.uf:''))].filter(Boolean).join(' · ')}</span>
                  <button onClick={()=>{setEditingAddr(true);setFreteOptions([]);setSelectedFrete(null);}} style={{flexShrink:0,minHeight:44,padding:'0 4px',border:'none',background:'none',color:'var(--text-strong)',fontWeight:500,fontSize:'var(--fs-sm)',textDecoration:'underline',cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif"}}>Trocar</button>
                </div>
              : <>
                  <AddressForm address={addr} setAddress={(a)=>setAddr(a)}/>
                  <Btn full variant="secondary" onClick={calcFrete} disabled={cepClean.length<8||lF} sfx="click">{lF?<Spin size={14}/>:<><Truck size={15}/> Calcular frete</>}</Btn>
                </>}
            {lF&&freteOptions.length===0&&!editingAddr&&<div style={{display:'flex',alignItems:'center',gap:8,fontSize:'var(--fs-sm)',color:'var(--text-dim)'}}><Spin size={14}/> Calculando frete…</div>}
            {freteOptions.length>0&&<div role="radiogroup" aria-label="Frete" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8,opacity:lF?.6:1}}>
              {freteOptions.map((opt,i)=>{const on=selectedFrete&&selectedFrete.service===opt.service;return(
                <button key={i} role="radio" aria-checked={!!on} onClick={()=>{SFX.toggle();setSelectedFrete(opt);}} style={{minHeight:56,padding:'8px 12px',borderRadius:12,border:'1.5px solid '+(on?'var(--text-strong)':'var(--line)'),background:'transparent',color:'var(--text-strong)',textAlign:'left',display:'flex',flexDirection:'column',justifyContent:'center',gap:2,cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif"}}>
                  <span style={{fontSize:'var(--fs-sm)',fontWeight:600}}>{opt.carrier} · {brl(opt.price)}</span>
                  <span style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)'}}>{opt.deadline_days} dias úteis</span>
                </button>);})}
            </div>}
            {selectedFrete&&!addressUnchanged&&<div style={{display:'flex',alignItems:'center',gap:8,fontSize:'var(--fs-sm)'}}>
              <span style={{flex:1,color:'var(--text-dim)'}}>Salvar este endereço?</span>
              <Btn variant={saveAddressChoice===true?'primary':'ghost'} onClick={()=>setSaveAddressChoice(true)} style={{padding:'8px 14px',fontSize:'var(--fs-xs)'}} sfx="">Sim</Btn>
              <Btn variant={saveAddressChoice===false?'secondary':'ghost'} onClick={()=>setSaveAddressChoice(false)} style={{padding:'8px 14px',fontSize:'var(--fs-xs)'}} sfx="">Não</Btn>
            </div>}
          </>}
        </section>}
      </div>

      {totalQty>0&&<div id="tut-payment" style={{padding:'12px 20px max(20px, env(safe-area-inset-bottom))',borderTop:'1px solid var(--line)',display:'flex',flexDirection:'column',gap:8}}>
        {volumeDiscount>0&&<div style={row}><span>Desconto por volume</span><span style={{color:'var(--ok)',fontWeight:600}}>−{brl(volumeDiscount)}</span></div>}
        {canCheckout
          ? <>
              <div style={row}><span>Cartas</span><span style={{color:'var(--text-strong)'}}>{brl(sub)}</span></div>
              <div style={row}><span>Frete</span><span style={{color:'var(--text-strong)'}}>{freteLabel}</span></div>
              <Btn full onClick={finalize} disabled={submitting||(!shippingSkipped&&!selectedFrete)} sfx="" style={{height:54,borderRadius:27,fontSize:'var(--fs-md)'}}>{submitting?<Spin size={16} color="var(--gp-ink)"/>:<>Pagar {brl(total)}</>}</Btn>
              <span style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',textAlign:'center'}}>Pix ou cartão pelo Mercado Pago</span>
            </>
          : <>
              <div style={row}><span>Subtotal</span><span style={{color:'var(--text-strong)',fontWeight:600}}>{brl(sub)}</span></div>
              <Btn full onClick={onClose} sfx="nav" style={{height:54,borderRadius:27,fontSize:'var(--fs-md)'}}>Escolher mais {missingCards} carta{missingCards!==1?'s':''}</Btn>
            </>}
      </div>}
    </div>
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
    <div style={{width:72,height:72,borderRadius:'50%',background:'var(--gp)',color:'var(--gp-ink)',display:'grid',placeItems:'center'}}><Check size={32}/></div>
    <div>
      <h1 style={{margin:0,fontSize:'var(--fs-xl)',fontWeight:600,color:'var(--text-strong)'}}>Pedido feito</h1>
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
  // Galeria: linha de lista, não cartão colorido. O ícone recua, o título manda.
  const [open,setOpen]=useState(defaultOpen);
  return(<div style={{borderBottom:'1px solid var(--line-soft)'}}>
    <button onClick={()=>setOpen(o=>!o)} aria-expanded={open} style={{width:'100%',minHeight:56,background:'none',border:'none',padding:'0 2px',display:'flex',alignItems:'center',gap:12,cursor:'pointer',color:'var(--text-strong)'}}>
      <Icon size={18} strokeWidth={1.75} style={{color:'var(--text-dim)',flexShrink:0}}/>
      <span style={{flex:1,textAlign:'left',fontWeight:500,fontSize:'var(--fs-md)',fontFamily:"'Inter',system-ui,sans-serif"}}>{title}</span>
      <ChevronRight size={16} style={{color:'var(--text-dim)',transform:open?'rotate(90deg)':'none',transition:'transform .2s'}}/>
    </button>
    {open&&<div style={{padding:'2px 2px 18px 32px'}}>{children}</div>}
  </div>);
}

// ── Trilha de status do pedido ────────────────────────────────────────────
// Mesma trilha em toda parte (shared/orderStatus.js): o cliente vê aqui o
// mesmo estágio que o admin avança no console.
function OrderTrack({stage}){
  if(stage.terminal)return(<div style={{fontSize:'var(--fs-sm)',color:stage.color,fontWeight:600,padding:'4px 0'}}>{stage.label} · {stage.hint}</div>);
  // Só pontos na linha e uma legenda: com oito etapas, um rótulo embaixo de
  // cada ponto não cabe no celular sem encavalar.
  return(<div>
    <div role="img" aria-label={`Etapa ${stage.index+1} de ${ORDER_STAGES.length}: ${stage.label}`} style={{display:'flex',alignItems:'center'}}>
      {ORDER_STAGES.map((s,i)=>(<Fragment key={s.key}>
        {i>0&&<div style={{flex:1,height:2,background:i<=stage.index?'var(--text-strong)':'var(--line)'}}/>}
        <div title={s.label} style={{width:i===stage.index?14:10,height:i===stage.index?14:10,borderRadius:'50%',flexShrink:0,background:i<=stage.index?'var(--text-strong)':'var(--line)',boxShadow:i===stage.index?'0 0 0 4px var(--fill)':'none'}}/>
      </Fragment>))}
    </div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginTop:12}}>
      <span style={{fontSize:'var(--fs-md)',fontWeight:600,color:'var(--text-strong)'}}>{stage.label}</span>
      <span style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',whiteSpace:'nowrap'}}>etapa {stage.index+1} de {ORDER_STAGES.length}</span>
    </div>
    <div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',marginTop:4,lineHeight:1.45}}>{stage.hint}</div>
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

  const filterBtn=active=>({flex:'none',height:36,padding:0,border:'none',borderBottom:'1.5px solid '+(active?'var(--text-strong)':'transparent'),background:'transparent',color:active?'var(--text-strong)':'var(--text-dim)',fontSize:'var(--fs-sm)',fontWeight:500,cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif",whiteSpace:'nowrap'});
  return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)'}}>
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:12}}>
        <div style={{fontSize:'var(--fs-xl)',fontWeight:600,letterSpacing:-0.3,color:'var(--text-strong)'}}>{collection.stats.distinct} <span style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',fontWeight:400}}>de {collection.stats.total} cartas</span></div>
        <div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)'}}>{collection.stats.percent}% · {collection.stats.copies} cópias</div>
      </div>
      <div role="progressbar" aria-valuenow={collection.stats.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do álbum" style={{background:'var(--fill)',borderRadius:2,height:4,overflow:'hidden'}}>
        <div style={{width:collection.stats.percent+'%',height:'100%',background:'var(--gp)',transition:'width .5s'}}/>
      </div>
    </div>

    <label style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',height:44,padding:'0 14px',borderRadius:'var(--r-pill)',background:'var(--fill)'}}>
      <Search size={17} style={{color:'var(--text-dim)',flexShrink:0}} aria-hidden="true"/>
      <span className="mp-sr-only">Buscar no álbum</span>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar no álbum" style={{flex:1,minWidth:0,border:'none',outline:'none',background:'transparent',color:'var(--text-strong)',fontSize:'var(--fs-md)',fontFamily:"'Inter',system-ui,sans-serif"}}/>
    </label>
    <nav aria-label="Filtros do álbum" style={{display:'flex',gap:18,overflowX:'auto',scrollbarWidth:'none'}}>
      {['Todos',...CATALOG_TYPES].map(t=>(
        <button key={t} aria-pressed={typeF===t} onClick={()=>{SFX.toggle();setTypeF(t);}} style={filterBtn(typeF===t)}>{t==='Todos'?'Todas':t}</button>
      ))}
      <span aria-hidden="true" style={{width:1,alignSelf:'center',height:16,background:'var(--line)',flexShrink:0}}/>
      <button onClick={()=>{SFX.toggle();setOnlyOwned(v=>!v);}} aria-pressed={onlyOwned} style={filterBtn(onlyOwned)}>Só as que tenho</button>
    </nav>

    <div className="portal-card-grid portal-catalog-grid" style={{opacity:loading?0.55:1,transition:'opacity .15s'}}>
      {cards.map(c=>{
        const bought=collection.bought.get(c.id)||0;
        const extra=collection.extras.get(c.id)||0;
        const owned=bought+extra;
        return(<article key={c.id} style={{display:'flex',flexDirection:'column',gap:6,minWidth:0}}>
          <button onClick={()=>c.image_url&&setZoomSrc(c.image_url)} aria-label={`Ampliar ${c.name}`} style={{position:'relative',display:'block',width:'100%',padding:0,border:'none',background:'none',cursor:c.image_url?'zoom-in':'default',borderRadius:9}}>
            {/* Carta que você não tem fica em tons de cinza: o álbum se lê de longe. */}
            <CardThumb card={c} radius={9} style={{aspectRatio:'63 / 88',border:'none',filter:owned>0?'none':'grayscale(1)',opacity:owned>0?1:.45}}/>
            {owned>0&&<span style={{position:'absolute',left:8,top:8,minWidth:26,height:26,padding:'0 7px',borderRadius:13,background:'var(--ga)',color:'var(--ga-ink)',fontSize:'var(--fs-xs)',fontWeight:600,display:'grid',placeItems:'center'}}>×{owned}</span>}
          </button>
          <div style={{display:'flex',alignItems:'center',gap:4}}>
            <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:1}}>
              <span style={{fontSize:'var(--fs-sm)',fontWeight:500,color:'var(--text-strong)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</span>
              <span style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{bought>0?`${bought} do portal`:'nenhuma do portal'}{extra>0?` · ${extra} manual`:''}</span>
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',borderRadius:22,background:'var(--fill)'}}>
            <button onClick={()=>adjust(c.id,-1)} disabled={extra===0||busy===c.id} title="Tirar uma cópia do ajuste manual" aria-label={`Tirar uma cópia manual de ${c.name}`} style={{width:44,height:40,border:'none',background:'none',color:'var(--text-strong)',opacity:extra===0?.3:1,display:'grid',placeItems:'center',cursor:extra===0?'not-allowed':'pointer'}}><Minus size={14}/></button>
            <span style={{fontSize:'var(--fs-xs)',fontWeight:500,color:'var(--text-dim)'}}>{busy===c.id?'…':extra>0?`+${extra} manual`:'tenho fora'}</span>
            <button onClick={()=>adjust(c.id,1)} disabled={busy===c.id} title="Já tenho mais uma cópia desta carta" aria-label={`Marcar mais uma cópia de ${c.name}`} style={{width:44,height:40,border:'none',background:'none',color:'var(--text-strong)',display:'grid',placeItems:'center',cursor:'pointer'}}><Plus size={14}/></button>
          </div>
        </article>);
      })}
      {cards.length===0&&!loading&&<div style={{gridColumn:'1 / -1'}}><EmptyState icon={BookOpen} title={onlyOwned?'Nenhuma carta na coleção ainda':'Nenhuma carta encontrada'} sub={onlyOwned?'Suas compras entram aqui sozinhas quando o pagamento é confirmado':'Tente outro termo'}/></div>}
    </div>

    {cards.length>0&&<div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'var(--sp-2)',padding:'4px 0 8px'}}>
      <div aria-live="polite" style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)'}}>{cards.length} de {total}</div>
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

  const label={fontSize:'var(--fs-xs)',fontWeight:500,color:'var(--text-dim)',marginBottom:6};
  return(<div style={{marginTop:10}}>
    <div style={label}>Endereço de entrega</div>
    {!editing&&<>
      {current?<AddressDisplay address={current} onEdit={canChange?startEdit:undefined}/>:
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,fontSize:'var(--fs-xs)',color:'var(--text-dim)'}}>
          <span>Endereço do seu cadastro</span>
          {canChange&&<button onClick={()=>{SFX.nav();startEdit();}} style={{minHeight:44,background:'none',border:'none',padding:'0 4px',cursor:'pointer',color:'var(--text-strong)',fontSize:'var(--fs-sm)',fontWeight:500,textDecoration:'underline',flexShrink:0,fontFamily:"'Inter',system-ui,sans-serif"}}>Trocar</button>}
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
          <button key={o.service} onClick={()=>setService(o.service)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 12px',borderRadius:'var(--r-control)',border:'1px solid '+(sel?'var(--gp)':'var(--line)'),background:sel?'var(--fill)':'transparent',color:'var(--text)',cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif",fontSize:'var(--fs-xs)'}}>
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

  return(<div style={{borderBottom:'1px solid var(--line-soft)'}}>
    <button onClick={onToggle} aria-expanded={expanded} style={{width:'100%',minHeight:64,padding:'10px 2px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'var(--sp-3)',background:'none',border:'none',cursor:'pointer',color:'var(--text-strong)',fontFamily:"'Inter',system-ui,sans-serif",textAlign:'left'}}>
      <div style={{minWidth:0,display:'flex',flexDirection:'column',gap:2}}>
        <div style={{fontSize:'var(--fs-md)',fontWeight:500}}>#{order.shortId} · R$ {order.total.toFixed(2).replace('.',',')}</div>
        <div style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)'}}>{order.qty} carta{order.qty!==1?'s':''} · {new Date(order.createdAt).toLocaleDateString('pt-BR')}{order.batches.length>1?` · ${order.batches.length} lotes`:''}</div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
        <span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:'var(--fs-xs)',fontWeight:500,color:'var(--text-strong)'}}><span aria-hidden="true" style={{width:8,height:8,borderRadius:'50%',background:stage.color}}/>{stage.short}</span>
        <ChevronRight size={16} style={{color:'var(--text-dim)',transform:expanded?'rotate(90deg)':'none',transition:'transform .2s'}}/>
      </div>
    </button>
    {expanded&&<div style={{padding:'0 2px 18px'}}>
      <div style={{marginTop:4,padding:'14px',borderRadius:'var(--r-card)',background:'var(--fill-soft)'}}>
        <div style={{fontSize:'var(--fs-xs)',fontWeight:500,color:'var(--text-dim)',marginBottom:10}}>Status</div>
        <OrderTrack stage={stage}/>
        {order.tracking&&<div style={{fontSize:'var(--fs-sm)',color:'var(--text-strong)',marginTop:10,fontWeight:500}}>Rastreio: {order.tracking}{order.trackingStatus?` · ${order.trackingStatus}`:''}</div>}
      </div>

      <div style={{marginTop:16}}>
        <div style={{fontSize:'var(--fs-xs)',fontWeight:500,color:'var(--text-dim)',marginBottom:6}}>Cartas</div>
        {loadingCards?<div style={{textAlign:'center',padding:10}}><Spin size={16}/></div>:
        (cards&&cards.length>0)?cards.map((c,ci,arr)=>(
          <div key={ci} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:'var(--fs-sm)',borderBottom:ci<arr.length-1?'1px solid var(--line-soft)':'none'}}>
            <span style={{color:'var(--text-strong)'}}>{c.name}{c.type&&c.type!=='Normal'?<span style={{color:'var(--text-dim)'}}> · {c.type}</span>:null}</span>
            <span style={{color:'var(--text-dim)'}}>×{c.qty}</span>
          </div>
        )):<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>Detalhes não disponíveis</div>}
      </div>

      <ShipmentAddressEditor order={order} allBatches={allBatches} token={token} toastFn={toastFn} onReloadOrders={onReloadOrders}/>

      {canAdd&&<div style={{marginTop:16}}>
        <div style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',lineHeight:1.45,marginBottom:8}}>A compra no fornecedor ainda não foi feita — dá tempo de mandar mais cartas para este mesmo pedido, sem pagar frete de novo.</div>
        <Btn full variant="secondary" onClick={()=>onAddCards(order)} sfx="nav"><Plus size={13}/> Adicionar cartas a este pedido</Btn>
      </div>}

      {pendingBatches.map(b=>(
        <div key={b.id} style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:'var(--sp-2)',marginTop:10}}>
          <Btn onClick={()=>pagarAgoraPedido(b,toastFn)} style={{width:'100%',fontSize:'var(--fs-sm)',justifyContent:'center'}} sfx="nav"> {isShippingAdjustment(b)?'Pagar diferença de frete':'Pagar'} R$ {Number(b.total_locked||0).toFixed(2).replace('.',',')}</Btn>
          <Btn variant="secondary" title="Conferir pagamento" onClick={async()=>{try{await mpSync(b.id);onReloadOrders();}catch(err){toastFn('Erro: '+(err.message||String(err)),'error');}}} style={{width:48,padding:0,justifyContent:'center'}} sfx=""><RefreshCw size={15}/></Btn>
          <Btn variant="secondary" title="Cancelar" onClick={async()=>{if(!confirm(isShippingAdjustment(b)?'Cancelar a troca de endereço? O envio segue para o endereço atual.':'Cancelar este pedido?'))return;try{const res=await fetch('/api/cancel-order',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({batchId:String(b.id),orderId:String(b.order_id||'')})});const j=await res.json().catch(()=>({}));if(!res.ok||!j.ok)throw new Error(j.error||'Falha');toastFn('Pedido cancelado','success');onReloadOrders();}catch(err){toastFn('Erro: '+(err.message||String(err)),'error');}}} style={{width:48,padding:0,justifyContent:'center',color:'var(--danger)'}} sfx=""><X size={15}/></Btn>
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

function ProfileView({profile,token,theme,nav,isAdmin,setShowTutorial,onSaveProfile,onLogout,myOrders=[],onReloadOrders,toast:toastFn,colorMode='dark',onColorModeChange=()=>{},openIndividualOrders={},onAddCards,collection,onSetExtra,initialTab='orders',onPasswordChanged}){
  const [tab,setTab]=useState(initialTab);
  const [colors,setColors]=useState(profile?.mana_color_1&&profile?.mana_color_2?[profile.mana_color_1,profile.mana_color_2]:['U','R']);
  const [editAddr,setEditAddr]=useState(false);
  const [addr,setAddr]=useState({cep:profile?.cep||'',rua:profile?.rua||'',numero:profile?.numero||'',complemento:profile?.complemento||'',bairro:profile?.bairro||'',cidade:profile?.cidade||'',uf:profile?.uf||''});
  const [saving,setSaving]=useState(false);
  const [editName,setEditName]=useState(false);
  const [nameVal,setNameVal]=useState(profile?.name||'');
  const [wppVal,setWppVal]=useState(profile?.whatsapp||'');
  const [expandedOrder,setExpandedOrder]=useState(null);
  const [showChangePw,setShowChangePw]=useState(false);const [pwSaved,setPwSaved]=useState(false);
  const [showArchived,setShowArchived]=useState(false);

  function toggleC(k){setColors(p=>{if(p.includes(k))return p.filter(c=>c!==k);if(p.length>=2)return[p[1],k];return[...p,k];});}
  const guild=colors.length===2?getGuild(colors[0],colors[1]):null;const gT=guild?GT[guild]:null;
  const origColors=[profile?.mana_color_1,profile?.mana_color_2].filter(Boolean);
  const changed=JSON.stringify(colors)!==JSON.stringify(origColors);

  async function saveGuild(){setSaving(true);await onSaveProfile({mana_color_1:colors[0],mana_color_2:colors[1],guild:guild||''});setSaving(false);}
  async function saveAddr(){setSaving(true);await onSaveProfile(addr);setEditAddr(false);setSaving(false);}
  async function savePessoal(){setSaving(true);await onSaveProfile({name:nameVal,whatsapp:wppVal});setEditName(false);setSaving(false);}

  // Lotes → pedidos. A conta fala em pedidos; lote é detalhe de pagamento.
  const orders=useMemo(()=>groupBatchesIntoOrders(myOrders),[myOrders]);
  const liveOrders=orders.filter(o=>!o.stage.terminal&&o.stage.key!=='DELIVERED');
  const doneOrders=orders.filter(o=>o.stage.terminal||o.stage.key==='DELIVERED');
  const totalSpent=orders.filter(o=>!o.stage.terminal).reduce((s,o)=>s+o.total,0);

  return(<div className="portal-page portal-profile" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)'}}>

    {/* Cabeçalho da conta — sem cartão nem brilho: a guilda é o anel do avatar. */}
    <div style={{display:'flex',alignItems:'center',gap:'var(--sp-3)',padding:'4px 0'}}>
      <div style={{width:56,height:56,borderRadius:'50%',background:'var(--fill)',color:'var(--text-strong)',display:'grid',placeItems:'center',flexShrink:0,boxShadow:'0 0 0 2px var(--bg), 0 0 0 4px '+(gT?gT.primary:'var(--line)')}}>
        <User size={24} strokeWidth={1.5}/>
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:600,fontSize:'var(--fs-xl)',letterSpacing:-0.3,color:'var(--text-strong)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{profile?.name||'Aventureiro'}</div>
        {guild&&<div style={{fontSize:'var(--fs-sm)',color:'var(--text-strong)',marginTop:2}}>{guild}</div>}
        <div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',marginTop:1,lineHeight:1.4}}>{`${orders.length} pedido${orders.length!==1?'s':''} · ${collection?.stats?.copies||0} cartas · R$ ${totalSpent.toFixed(0)} comprados`}</div>
      </div>
    </div>

    {/* Abas da conta — texto sublinhado, como os filtros do catálogo */}
    <div role="tablist" aria-label="Seções da conta" style={{display:'flex',gap:22,borderBottom:'1px solid var(--line-soft)'}}>
      {ACCOUNT_TABS.map(t=>{
        const active=tab===t.key;
        return(<button key={t.key} role="tab" aria-selected={active} onClick={()=>{SFX.toggle();setTab(t.key);}} style={{height:44,padding:0,marginBottom:-1,border:'none',borderBottom:'1.5px solid '+(active?'var(--text-strong)':'transparent'),background:'transparent',color:active?'var(--text-strong)':'var(--text-dim)',fontWeight:500,fontSize:'var(--fs-md)',fontFamily:"'Inter',system-ui,sans-serif",cursor:'pointer'}}>{t.label}</button>);
      })}
    </div>

    {tab==='orders'&&<div style={{display:'flex',flexDirection:'column'}}>
      {orders.length===0&&<EmptyState icon={Package} title="Nenhum pedido ainda" sub="Monte sua primeira encomenda pelo catálogo" action={<Btn onClick={()=>nav('catalog')} sfx="nav">Ver cartas</Btn>}/>}
      {liveOrders.map(o=>{
        const addOpen=openIndividualOrders[String(o.orderId)];
        return <ClientOrderCard key={o.orderId} order={o} allBatches={myOrders} token={token} theme={theme} expanded={expandedOrder===o.orderId} onToggle={()=>setExpandedOrder(expandedOrder===o.orderId?null:o.orderId)} onAddCards={()=>onAddCards&&onAddCards(o)} canAdd={!!onAddCards&&!!addOpen} onReloadOrders={onReloadOrders} toastFn={toastFn}/>;
      })}
      {doneOrders.length>0&&<>
        <button onClick={()=>{SFX.toggle();setShowArchived(v=>!v);}} aria-expanded={showArchived} style={{minHeight:48,background:'none',border:'none',color:'var(--text-dim)',fontSize:'var(--fs-sm)',fontWeight:500,cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif",padding:'6px 2px',textAlign:'left',display:'flex',alignItems:'center',gap:6}}>
          Concluídos ({doneOrders.length}) <ChevronRight size={14} style={{transform:showArchived?'rotate(90deg)':'none',transition:'transform .2s'}}/>
        </button>
        {showArchived&&doneOrders.map(o=>(
          <ClientOrderCard key={o.orderId} order={o} allBatches={myOrders} token={token} theme={theme} expanded={expandedOrder===o.orderId} onToggle={()=>setExpandedOrder(expandedOrder===o.orderId?null:o.orderId)} canAdd={false} onReloadOrders={onReloadOrders} toastFn={toastFn}/>
        ))}
      </>}
    </div>}

    {tab==='collection'&&<CollectionAlbum token={token} collection={collection} onSetExtra={onSetExtra} theme={theme}/>}

    {tab==='account'&&<div style={{display:'flex',flexDirection:'column'}}>
      {/* Dados pessoais */}
      <ProfileSection title="Dados pessoais" icon={User} color={theme.primary} defaultOpen={true}>
        <div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)',marginTop:12}}>
          {editName?<>
            <Input icon={User} placeholder="Seu nome" value={nameVal} onChange={e=>setNameVal(e.target.value)}/>
            <Input icon={Phone} placeholder="WhatsApp" value={wppVal} onChange={e=>setWppVal(e.target.value.replace(/\D/g,'').slice(0,11))}/>
            <div style={{display:'flex',gap:'var(--sp-2)'}}>
              <Btn variant="primary" onClick={savePessoal} disabled={saving} style={{flex:1}} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar</>}</Btn>
              <Btn variant="ghost" onClick={()=>setEditName(false)} style={{flex:1}} sfx="click">Cancelar</Btn>
            </div>
          </>:<div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',marginBottom:2}}>Nome</div>
              <div style={{fontSize:'var(--fs-md)',color:'var(--text-strong)'}}>{profile?.name||'—'}</div>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',marginBottom:2}}>WhatsApp</div>
              <div style={{fontSize:'var(--fs-md)',color:'var(--text-strong)'}}>{profile?.whatsapp||'—'}</div>
            </div>
            <button onClick={()=>setEditName(true)} style={{minHeight:44,background:'none',border:'none',padding:'0 4px',cursor:'pointer',color:'var(--text-strong)',fontSize:'var(--fs-sm)',fontWeight:500,textDecoration:'underline',fontFamily:"'Inter',system-ui,sans-serif"}}>Editar</button>
          </div>}
        </div>
      </ProfileSection>

      {/* Endereço */}
      <ProfileSection title="Endereço de entrega" icon={MapPin} color="var(--gold)">
        <div style={{marginTop:12}}>
          {editAddr?<>
            <AddressForm address={addr} setAddress={setAddr}/>
            <div style={{display:'flex',gap:'var(--sp-2)',marginTop:10}}>
              <Btn variant="primary" onClick={saveAddr} disabled={saving} style={{flex:1}} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar</>}</Btn>
              <Btn variant="ghost" onClick={()=>setEditAddr(false)} style={{flex:1}} sfx="click">Cancelar</Btn>
            </div>
          </>:<AddressDisplay address={addr} onEdit={()=>setEditAddr(true)}/>}
        </div>
      </ProfileSection>

      <ProfileSection title="Aparência" icon={colorMode==='light'?Sun:Moon} color="var(--gold)">
        <div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',marginBottom:10,lineHeight:1.5}}>Escolha como o portal aparece neste aparelho. A preferência fica salva aqui mesmo.</div>
        <div role="radiogroup" aria-label="Tema" style={{display:'flex',gap:4,padding:4,borderRadius:'var(--r-pill)',background:'var(--fill)'}}>
          {[{key:'dark',label:'Escuro',icon:Moon},{key:'light',label:'Claro',icon:Sun}].map(opt=>{
            const active=colorMode===opt.key;
            return(<button key={opt.key} role="radio" aria-checked={active} onClick={()=>{SFX.toggle();onColorModeChange(opt.key);}} style={{flex:1,minHeight:40,display:'flex',alignItems:'center',justifyContent:'center',gap:'var(--sp-1)',padding:'8px',borderRadius:'var(--r-pill)',border:'none',background:active?'var(--sheet-bg)':'transparent',boxShadow:active?'0 1px 3px rgba(var(--sunk),calc(0.2*var(--sunk-a)))':'none',color:active?'var(--text-strong)':'var(--text-dim)',fontSize:'var(--fs-sm)',fontWeight:500,cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif"}}>
              <opt.icon size={15}/>{opt.label}
            </button>);
          })}
        </div>
      </ProfileSection>

      <ProfileSection title="Guilda & mana" icon={Sparkles} color="var(--indiv)">
        <div style={{marginTop:12}}>
          <div style={{display:'flex',justifyContent:'center',gap:'var(--sp-3)',margin:'10px 0'}}>{MANA_COLORS.map(m=><ManaOrb key={m.key} mana={m.key} selected={colors.includes(m.key)} onClick={()=>toggleC(m.key)} size={44}/>)}</div>
          {guild&&<div style={{textAlign:'center',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'center',gap:'var(--sp-2)'}}><GuildBadge guild={guild} size={16}/><span style={{fontWeight:700,fontSize:14,color:gT?gT.primary:'var(--text-strong)'}}>{guild}</span></div>}
          {changed&&guild&&<Btn full variant="primary" onClick={saveGuild} disabled={saving} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar guilda</>}</Btn>}
        </div>
      </ProfileSection>

      <ProfileSection title="Alterar senha" icon={Lock} color="var(--danger)">
        <div style={{marginTop:12}}>
          {pwSaved&&<div role="status" style={{fontSize:'var(--fs-sm)',color:'var(--text-strong)',marginBottom:10,display:'flex',alignItems:'center',gap:6}}><Check size={15}/> Senha alterada</div>}
          {!showChangePw?<Btn full variant="secondary" onClick={()=>{setPwSaved(false);setShowChangePw(true);}} sfx="click">Escolher nova senha</Btn>:<>
            <NewPasswordForm token={token} onSaved={user=>{setShowChangePw(false);setPwSaved(true);onPasswordChanged&&onPasswordChanged(user);}} submitLabel="Salvar senha nova"/>
            <Btn full variant="ghost" onClick={()=>setShowChangePw(false)} style={{marginTop:6}} sfx="click">Cancelar</Btn>
          </>}
        </div>
      </ProfileSection>

      {/* Admin e tema também moram no menu do avatar; aqui fica o que é da conta. */}
      <div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)',marginTop:20}}>
        <Btn full variant="secondary" onClick={()=>{SFX.nav();setShowTutorial(true);}} sfx="">Ver tutorial de novo</Btn>
        <Btn full variant="ghost" onClick={onLogout} sfx="click" style={{color:'var(--danger)'}}>Sair da conta</Btn>
      </div>
    </div>}

  </div>);
}

// ══════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════

// Campo de senha nativo. Substitui o teclado de números desenhado pelo app,
// que era lento (o navegador segurava cada toque esperando um toque duplo) e
// impedia o celular de salvar e preencher a senha. 16px de fonte: abaixo
// disso o iPhone dá zoom na tela ao focar o campo.
function PasswordField({value,onChange,placeholder,autoComplete,id,autoFocus,label}){
  const [show,setShow]=useState(false);
  return(<div style={{position:'relative'}}>
    <Lock size={18} aria-hidden="true" style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'var(--text-faint)',pointerEvents:'none'}}/>
    <input id={id} aria-label={label||placeholder} type={show?'text':'password'} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus={autoFocus}
      style={{width:'100%',minHeight:48,padding:'12px 52px 12px 42px',borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'var(--field-bg)',color:'var(--text)',fontSize:16,fontFamily:"'Inter',system-ui,sans-serif",outline:'none',boxSizing:'border-box'}}/>
    <button type="button" onClick={()=>setShow(v=>!v)} aria-label={show?'Esconder senha':'Mostrar senha'} aria-pressed={show} className="mp-tap" style={{position:'absolute',right:2,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer'}}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button>
  </div>);
}

// O que falta na senha nova, ao vivo — em vez de um erro só depois de enviar.
function PasswordChecklist({value}){
  return(<ul aria-label="Requisitos da senha" style={{listStyle:'none',margin:0,padding:'0 2px',display:'flex',gap:14,flexWrap:'wrap'}}>
    {passwordChecks(value).map(c=>(<li key={c.key} style={{display:'flex',alignItems:'center',gap:5,fontSize:'var(--fs-xs)',color:c.ok?'var(--text-strong)':'var(--text-dim)'}}>
      {c.ok?<Check size={13} aria-hidden="true"/>:<Circle size={11} aria-hidden="true"/>}<span>{c.label}</span><span className="mp-sr-only">{c.ok?'ok':'falta'}</span>
    </li>))}
  </ul>);
}

const AUTH_BRAND=({title,sub})=><div style={{display:'flex',flexDirection:'column',gap:6,padding:'24px 0 8px'}}><span style={{fontSize:'var(--fs-sm)',fontWeight:600,color:'var(--text-dim)'}}>Cartas para Jogar</span><h1 style={{margin:0,fontSize:'var(--fs-2xl)',fontWeight:600,letterSpacing:-0.5,color:'var(--text-strong)'}}>{title}</h1>{sub&&<p style={{margin:0,fontSize:'var(--fs-sm)',color:'var(--text-dim)',lineHeight:1.5}}>{sub}</p>}</div>;

function AuthPage({onLogin,theme}){
  const [mode,setMode]=useState('login');const [email,setEmail]=useState('');const [senha,setSenha]=useState('');const [senha2,setSenha2]=useState('');
  const [name,setName]=useState('');const [whatsapp,setWhatsapp]=useState('');
  const [loading,setLoading]=useState(false);const [err,setErr]=useState('');
  const [forgotMode,setForgotMode]=useState(false);const [resetSent,setResetSent]=useState(false);

  // No login vale qualquer senha — inclusive o código antigo de 6 números,
  // que entra uma última vez e cai na troca obrigatória (PasswordUpgradeGate).
  const canSubmit=email.includes('@')&&!loading&&(mode==='login'
    ?senha.length>0
    :(!passwordProblem(senha)&&senha===senha2&&!!name&&whatsapp.length>=10));

  async function submit(e){
    if(e)e.preventDefault();
    setErr('');
    const cleanEmail=email.trim().toLowerCase();
    if(mode==='signup'){
      const problem=passwordProblem(senha);
      if(problem){setErr(problem);return;}
      if(senha!==senha2){setErr('As senhas não coincidem');return;}
    }
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

  async function handleForgot(e){
    if(e)e.preventDefault();
    const cleanEmail=email.trim().toLowerCase();
    if(!cleanEmail.includes('@')){setErr('Digite seu email primeiro');return;}
    setErr('');setLoading(true);
    try{
      await sbAuthResetPassword(cleanEmail);
      setResetSent(true);SFX.success();
    }catch(e){setErr(e.message);}
    setLoading(false);
  }

  const emailField=<Input icon={Mail} type="email" name="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="seu@email.com" aria-label="Email" value={email} onChange={e=>setEmail(e.target.value)}/>;
  const errBox=err&&<div role="alert" style={{fontSize:'var(--fs-sm)',color:'var(--danger)',textAlign:'center',padding:'var(--sp-1)'}}>{err}</div>;

  if(forgotMode)return(<form onSubmit={handleForgot} style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)',paddingTop:16}}>
    <AUTH_BRAND title="Recuperar senha"/>
    {resetSent?<Card style={{padding:'var(--sp-4)',textAlign:'center'}}>
      <Check size={28} style={{color:'var(--text-strong)',marginBottom:8}}/>
      <div style={{fontWeight:600,color:'var(--text-strong)',fontSize:'var(--fs-md)'}}>Email enviado</div>
      <div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',marginTop:6,lineHeight:1.5}}>Verifique sua caixa de entrada e o spam. O link abre a tela para criar a senha nova.</div>
      <Btn full variant="secondary" onClick={()=>{setForgotMode(false);setResetSent(false);}} style={{marginTop:16}} sfx="nav">Voltar ao login</Btn>
    </Card>:<>
      <div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',lineHeight:1.5}}>Digite seu email e enviaremos um link para criar uma senha nova.</div>
      {emailField}
      {errBox}
      <Btn full type="submit" disabled={!email.includes('@')||loading} sfx="">{loading?<Spin size={16} color="var(--gp-ink)"/>:'Enviar link'}</Btn>
      <button type="button" onClick={()=>{setForgotMode(false);setErr('');}} style={{background:'none',border:'none',color:'var(--text-strong)',fontSize:'var(--fs-sm)',textDecoration:'underline',minHeight:44,cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif",padding:'var(--sp-2)',textAlign:'center'}}>Voltar ao login</button>
    </>}
  </form>);

  return(<form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)',paddingTop:16}}>
    <AUTH_BRAND title={mode==='login'?'Boas-vindas de volta':'Crie sua conta'} sub="Suas cartas de Magic, encomendadas uma a uma."/>
    <div role="tablist" aria-label="Entrar ou criar conta" style={{display:'flex',borderRadius:'var(--r-pill)',background:'var(--fill)',padding:4,gap:4}}>{['login','signup'].map(m=>(<button type="button" key={m} role="tab" aria-selected={mode===m} onClick={()=>{SFX.toggle();setMode(m);setErr('');setSenha('');setSenha2('');}} style={{flex:1,minHeight:40,padding:'8px 0',borderRadius:'var(--r-pill)',border:'none',background:mode===m?'var(--sheet-bg)':'transparent',boxShadow:mode===m?'0 1px 3px rgba(var(--sunk),calc(0.2*var(--sunk-a)))':'none',color:mode===m?'var(--text-strong)':'var(--text-dim)',fontWeight:500,fontSize:'var(--fs-sm)',cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif"}}>{m==='login'?'Entrar':'Criar conta'}</button>))}</div>
    {mode==='signup'&&<Input icon={User} name="name" autoComplete="name" placeholder="Seu nome" aria-label="Nome" value={name} onChange={e=>setName(e.target.value)}/>}
    {emailField}
    {mode==='signup'&&<Input icon={Phone} type="tel" name="tel" autoComplete="tel-national" inputMode="numeric" placeholder="WhatsApp (11999999999)" aria-label="WhatsApp" value={whatsapp} onChange={e=>setWhatsapp(e.target.value.replace(/\D/g,'').slice(0,11))}/>}
    {mode==='login'
      ? <>
          <PasswordField value={senha} onChange={setSenha} placeholder="Senha" label="Senha" autoComplete="current-password"/>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',lineHeight:1.5,padding:'0 2px'}}>Ainda usa o código de 6 números? Digite ele aqui uma última vez — depois você cria sua senha nova.</div>
        </>
      : <>
          <PasswordField value={senha} onChange={setSenha} placeholder="Crie uma senha" label="Senha nova" autoComplete="new-password"/>
          <PasswordChecklist value={senha}/>
          <PasswordField value={senha2} onChange={setSenha2} placeholder="Repita a senha" label="Repita a senha" autoComplete="new-password"/>
          {senha2.length>0&&senha!==senha2&&<div style={{fontSize:'var(--fs-xs)',color:'var(--danger)',padding:'0 2px'}}>As senhas não coincidem</div>}
        </>}
    {errBox}
    <Btn full type="submit" disabled={!canSubmit} sfx="">{loading?<Spin size={16} color="var(--gp-ink)"/>:<>{mode==='login'?'Entrar':'Criar conta'}</>}</Btn>
    {mode==='login'&&<button type="button" onClick={()=>{setForgotMode(true);setErr('');}} style={{background:'none',border:'none',color:'var(--text-dim)',fontSize:'var(--fs-sm)',minHeight:44,cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif",padding:'var(--sp-1)',textAlign:'center'}}>Esqueci minha senha</button>}
  </form>);
}

// ══════════════════════════════════════════════════════
// PASSWORD RECOVERY PAGE
// ══════════════════════════════════════════════════════

// Formulário de senha nova, compartilhado pela recuperação por email, pela
// troca obrigatória (código → senha) e pela troca em Minha conta.
function NewPasswordForm({token,onSaved,submitLabel='Salvar senha'}){
  const [pw,setPw]=useState('');const [pw2,setPw2]=useState('');
  const [loading,setLoading]=useState(false);const [err,setErr]=useState('');
  const problem=passwordProblem(pw);
  async function save(e){
    if(e)e.preventDefault();
    if(problem){setErr(problem);return;}
    if(pw!==pw2){setErr('As senhas não coincidem');return;}
    setLoading(true);setErr('');
    try{const user=await sbAuthUpdatePassword(pw,token);SFX.success();onSaved(user);}
    catch(e){setErr(e.message);setLoading(false);}
  }
  return(<form onSubmit={save} style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)'}}>
    <PasswordField value={pw} onChange={setPw} placeholder="Senha nova" label="Senha nova" autoComplete="new-password" autoFocus/>
    <PasswordChecklist value={pw}/>
    <PasswordField value={pw2} onChange={setPw2} placeholder="Repita a senha" label="Repita a senha" autoComplete="new-password"/>
    {pw2.length>0&&pw!==pw2&&<div style={{fontSize:'var(--fs-xs)',color:'var(--danger)',padding:'0 2px'}}>As senhas não coincidem</div>}
    {err&&<div role="alert" style={{fontSize:'var(--fs-sm)',color:'var(--danger)',textAlign:'center'}}>{err}</div>}
    <Btn full type="submit" disabled={!!problem||pw!==pw2||loading} sfx="">{loading?<Spin size={16} color="var(--gp-ink)"/>:submitLabel}</Btn>
  </form>);
}

function RecoveryPage({token,onDone,theme}){
  return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)',paddingTop:16}}>
    <AUTH_BRAND title="Senha nova" sub="Crie a senha que você vai usar daqui pra frente."/>
    <NewPasswordForm token={token} onSaved={()=>onDone()} submitLabel="Salvar senha nova"/>
  </div>);
}

// ── Troca obrigatória: do código de 6 números para senha ──────────────────
// Aparece para quem entrou com o código (conta sem a marca password_v2).
// Antes de bloquear, confere no servidor: a pessoa pode ter trocado a senha
// em outro aparelho, e a sessão salva aqui ainda teria os metadados antigos.
function PasswordUpgradeGate({token,onUpgraded,onLogout}){
  const [checking,setChecking]=useState(true);
  useEffect(()=>{
    let alive=true;
    sbAuthGetUser(token)
      .then(user=>{if(alive&&user&&!needsPasswordUpgrade(user))onUpgraded(user);})
      .catch(()=>{})
      .finally(()=>{if(alive)setChecking(false);});
    return()=>{alive=false;};
  },[token]); // eslint-disable-line react-hooks/exhaustive-deps
  if(checking)return(<div style={{padding:'80px 20px',display:'grid',placeItems:'center'}}><Spin size={20}/></div>);
  return(<div className="portal-auth-container" style={{padding:'14px 20px 40px',display:'flex',flexDirection:'column',gap:'var(--sp-3)'}}>
    <AUTH_BRAND title="O portal mudou" sub="O login agora é com senha, não mais com o código de 6 números. Crie sua senha para continuar — é ela que você vai usar a partir de agora."/>
    <NewPasswordForm token={token} onSaved={onUpgraded} submitLabel="Criar senha e entrar"/>
    <button type="button" onClick={onLogout} style={{background:'none',border:'none',color:'var(--text-dim)',fontSize:'var(--fs-sm)',minHeight:44,cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif"}}>Sair</button>
  </div>);
}

// ══════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════

function OnboardingPage({onComplete,theme}){
  const [step,setStep]=useState(0);const [colors,setColors]=useState([]);const [askTutorial,setAskTutorial]=useState(false);
  function toggleC(k){setColors(p=>{if(p.includes(k))return p.filter(c=>c!==k);if(p.length>=2)return[p[1],k];return[...p,k];});}
  const guild=colors.length===2?getGuild(colors[0],colors[1]):null;const gT=guild?GT[guild]:theme;
  // Texto alinhado ao produto de hoje: encomenda individual, mínimo por
  // pedido e preço por volume. (Pedido em grupo e cartas bônus não existem mais.)
  const steps=[
    {title:'Cartas de Magic, uma a uma',body:'Escolha no catálogo exatamente as cartas que você quer. A gente encomenda e entrega na sua casa.'},
    {title:'Como funciona',body:'Toque no + das cartas para montar o pedido. A partir de 15 cartas ele fecha — e quanto mais cartas, menor o preço de cada uma. O pagamento é pelo Mercado Pago, com o frete calculado na hora.'},
    {title:'Escolha sua guilda',body:'Duas cores de mana definem sua guilda. Ela vira a cor da sua conta.',hasColors:true},
  ];
  const s=steps[step];

  if(askTutorial)return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-4)',paddingTop:40,alignItems:'center',textAlign:'center'}}>
    <h2 style={{margin:0,fontSize:'var(--fs-xl)',fontWeight:600,color:'var(--text-strong)'}}>Quer um tour rápido?</h2>
    <p style={{margin:0,fontSize:'var(--fs-sm)',color:'var(--text-dim)',maxWidth:300,lineHeight:1.5}}>Mostramos onde fica cada coisa. Leva menos de um minuto.</p>
    <div style={{display:'flex',gap:'var(--sp-2)',width:'100%',maxWidth:300}}>
      <Btn onClick={()=>onComplete(colors,guild,true)} style={{flex:1}} sfx="confirm">Ver o tour</Btn>
    </div>
    <button onClick={()=>onComplete(colors,guild,false)} style={{minHeight:44,background:'none',border:'none',color:'var(--text-dim)',fontSize:'var(--fs-sm)',cursor:'pointer',fontFamily:"'Inter',system-ui,sans-serif"}}>Agora não</button>
  </div>);

  return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-4)',paddingTop:16,minHeight:'70vh',justifyContent:'space-between'}}>
    <div>
      <div style={{fontSize:'var(--fs-sm)',fontWeight:500,color:'var(--text-dim)',marginBottom:10}}>{step+1} de {steps.length}</div>
      <h1 style={{margin:0,fontSize:'var(--fs-2xl)',fontWeight:600,letterSpacing:-0.5,color:'var(--text-strong)',lineHeight:1.15}}>{s.title}</h1>
      <p style={{fontSize:'var(--fs-md)',lineHeight:1.6,color:'var(--text-muted)',marginTop:12}}>{s.body}</p>
      {s.illus&&s.illus()}
      {s.hasColors&&<div style={{marginTop:18}}><div style={{display:'flex',justifyContent:'center',gap:'var(--sp-3)',marginBottom:14}}>{MANA_COLORS.map(m=><ManaOrb key={m.key} mana={m.key} selected={colors.includes(m.key)} onClick={()=>toggleC(m.key)} size={50}/>)}</div>{guild&&<div style={{textAlign:'center'}}><GuildBadge guild={guild} size={24}/><span style={{fontSize:'var(--fs-lg)',fontWeight:600,color:'var(--text-strong)',marginLeft:8}}>{guild}</span></div>}</div>}
    </div>
    <div>
      <div style={{display:'flex',gap:'var(--sp-1)',justifyContent:'center',marginBottom:12}}>{steps.map((_,i)=><div key={i} style={{width:i===step?20:6,height:6,borderRadius:3,background:i===step?'var(--text-strong)':'var(--fill)'}}/>)}</div>
      <div style={{display:'flex',gap:'var(--sp-2)'}}>{step>0&&<Btn variant="secondary" onClick={()=>setStep(s=>s-1)} style={{flex:1}} sfx="nav"><ChevronLeft size={15}/></Btn>}{step<steps.length-1?<Btn onClick={()=>setStep(s=>s+1)} style={{flex:1}} sfx="click">Próximo <ChevronRight size={15}/></Btn>:<Btn onClick={()=>{if(!guild)return;SFX.confirm();setAskTutorial(true);}} disabled={!guild} style={{flex:1}} sfx="">Continuar</Btn>}</div>
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
  const [profileTab,setProfileTab]=useState('orders');
  const [orderOpen,setOrderOpen]=useState(false); // folha do pedido (carrinho + checkout) // aba de "Minha conta" aberta pelo menu do avatar
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
  // Galeria: a interface é monocromática; a guilda vira só acento (--ga).
  const theme = { ...(colorMode === 'light' ? MONO.light : MONO.dark), accent: guildTheme(guild).primary };
  const isAdmin = profile?.is_admin || false;
  // "cart" e "checkout" deixaram de ser páginas: são a folha do pedido, que
  // abre por cima do catálogo (ou da lista de desejos, se o cliente estiver lá).
  const nav = useCallback(p=>{SFX.nav();if(p==='cart'||p==='checkout'){setOrderOpen(true);setPage(cur=>cur==='wants'?'wants':'catalog');return;}setOrderOpen(false);setPage(p);if(p==='profile'&&!profile&&token&&session?.user?.id){loadAppData(token,session.user.id);};},[profile,token,session]);

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
        const rows = await sbGet('wishlist_items', `user_id=eq.${userId}&select=id,card_id,quantity,cards(name,type,image_url,supplier_extra_usd,is_active)&order=created_at.desc`, tkn);
        setWishlist((rows || [])
          .filter(w => w && w.id && w.card_id)
          .map(w => ({ ...w, card_name: w.cards?.name || '?', card_type: w.cards?.type || 'Normal', card_image_url: w.cards?.image_url || null, card_extra_usd: Number(w.cards?.supplier_extra_usd) || 0, card_active: w.cards?.is_active !== false })));
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
          const items = await sbGet('order_items', `order_id=eq.${ord.id}&batch_id=is.null&in_cart=is.true&select=id,card_id,quantity,cards(name,type,image_url,supplier_extra_usd)`, tkn);
          setCartItems((items || [])
            .filter(i => i && i.id && i.card_id)
            .map(i=>({...i, card_name:i.cards?.name||'?', card_type:i.cards?.type||'Normal', card_image_url:i.cards?.image_url||null, card_extra_usd:Number(i.cards?.supplier_extra_usd)||0})));
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

  // Senha trocada (troca obrigatória ou em Minha conta): a sessão salva passa
  // a carregar a marca, para a tela de troca não voltar a aparecer.
  function applyUpgradedUser(user){
    setSession(prev=>prev?{...prev,user:{...prev.user,...(user||{}),user_metadata:{...(prev.user?.user_metadata||{}),...(user?.user_metadata||{}),[PASSWORD_V2_FLAG]:true}}}:prev);
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
          setWishlist(prev => [{ ...row, card_name: card.name, card_type: card.type || 'Normal', card_image_url: card.image_url || null, card_extra_usd: Number(card.supplier_extra_usd) || 0 }, ...prev.filter(w => w.card_id !== card.id)]);
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
      card_extra_usd: Number(card.supplier_extra_usd) || 0,
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
          setCartItems(prev => [...prev, { ...row, card_name: item.card_name, card_type: item.card_type, card_image_url: item.card_image_url, card_extra_usd: Number(item.card_extra_usd) || 0 }]);
        }
      }
      // Sem toast: o retorno é o selo ×N na carta e a pílula do pedido pulando.
      SFX.addCard();
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
  // ─── Lista de desejos: trocar carta que saiu do catálogo ──
  // A versão desejada saiu; o cliente escolhe outra (outro tipo). Se ele já
  // desejava a escolhida, junta ficando com a maior quantidade.
  async function handleSwapWish(item, alt) {
    if (!token || !alt?.id) return;
    try {
      const existing = wishlist.find(w => w.card_id === alt.id && w.id !== item.id);
      const card = { card_id: alt.id, card_name: alt.name, card_type: alt.type || 'Normal', card_image_url: alt.image_url || null, card_extra_usd: Number(alt.supplier_extra_usd) || 0, card_active: true };
      if (existing) {
        const quantity = Math.max(existing.quantity, item.quantity);
        await sbPatch('wishlist_items', 'id=eq.' + existing.id, { quantity }, token);
        await sbDelete('wishlist_items', 'id=eq.' + item.id, token);
        setWishlist(prev => prev.filter(w => w.id !== item.id).map(w => w.id === existing.id ? { ...w, quantity } : w));
      } else {
        await sbPatch('wishlist_items', 'id=eq.' + item.id, { card_id: alt.id }, token);
        setWishlist(prev => prev.map(w => w.id === item.id ? { ...w, ...card } : w));
      }
      SFX.success();
      toast(`Trocado por ${alt.name} (${alt.type || 'Normal'})`, 'success');
    } catch (e) {
      console.error('[handleSwapWish]', e);
      toast('Não deu para trocar: ' + e.message, 'error');
    }
  }

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

  // ── Pílula do pedido e preço na grade ─────────────
  // Adição a um pedido pago: sem mínimo, e a faixa considera o que já foi pago.
  const minCards = addTo ? 1 : (Number(indivPricing?.pricing?.min_cards) || MIN_ORDER_CARDS);
  const cartTierQty = cartCount + (addTo ? (addTo.qtyPaid || 0) : 0);
  const cartTotal = cartItems.reduce((s, c) => s + c.quantity * unitPriceFor(c.card_type, cartTierQty, pricing, indivPricing, c.card_extra_usd), 0);
  // Preço que a grade mostra: o da PRÓXIMA carta, na faixa em que o pedido vai
  // cair — pelo menos a do mínimo, que é o menor pedido possível.
  const priceFor = useCallback(card => unitPriceFor(card?.type, Math.max(cartTierQty + 1, minCards), pricing, indivPricing, card?.supplier_extra_usd), [cartTierQty, minCards, pricing, indivPricing]);

  // Pedidos ainda andando (nem entregues nem cancelados): é o aviso do avatar.
  const activeOrderCount = useMemo(() => groupBatchesIntoOrders(myOrders).filter(g => { const st = resolveOrderStageFromBatches(g.batches); return !st.terminal && st.index >= 1 && st.key !== 'DELIVERED'; }).length, [myOrders]);

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

  return (<div className="portal-shell" data-page={page} style={{ '--gp': theme.primary, '--gs': theme.secondary, '--gg': theme.glow, '--gp-ink': inkOn(theme.primary), '--ga': theme.accent, '--ga-ink': inkOn(theme.accent), minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Inter',system-ui,sans-serif", maxWidth: 480, margin: '0 auto', position: 'relative' }}>
    <style>{"*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg);margin:0}input:focus{border-color:var(--gp)!important;outline:none}button:active:not(:disabled){transform:scale(.97)}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(var(--ink),calc(.07*var(--ink-a)));border-radius:3px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes tutPulse{0%,100%{opacity:1;box-shadow:0 0 0 9999px var(--scrim),0 0 30px var(--gg)}50%{opacity:.85;box-shadow:0 0 0 9999px var(--scrim),0 0 50px var(--gg)}}@keyframes tutArrowBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(6px)}}@keyframes tutHandBounce{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-6px) scale(1.15)}}@keyframes sheetUp{from{transform:translateY(48px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes pillPop{0%{transform:scale(1)}40%{transform:scale(1.06)}100%{transform:scale(1)}}"}</style>

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
    {/* Migração do login: quem entrou com o código de 6 números cria a senha
        nova antes de qualquer outra coisa. Ver shared/passwordPolicy.js. */}
    {session && !recoveryToken && needsPasswordUpgrade(session.user) && <PasswordUpgradeGate token={token} onUpgraded={applyUpgradedUser} onLogout={handleLogout} />}

    {session && !recoveryToken && !needsPasswordUpgrade(session.user) && <>
      {/* Loading indicator - non-blocking */}
      {appLoading && <div style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 50, background: 'var(--chrome-bg)', borderRadius: 20, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Spin size={14}/><span style={{ fontSize: 12, color: 'rgba(var(--ink),calc(0.5*var(--ink-a)))' }}>Carregando...</span>
      </div>}

      {/* Topo: a única navegação do app. Sem barra de abas embaixo — o
          catálogo é a casa, e o resto (pedidos, desejos, coleção, conta) mora
          no menu do avatar. O carrinho vive na pílula flutuante. */}
      {page !== 'onboarding' && <header className="portal-header" style={{ padding: '10px 8px 6px 20px', display: 'flex', alignItems: 'center', gap: 4, position: 'sticky', top: 0, zIndex: 20, background: 'var(--chrome-bg)', backdropFilter: 'blur(16px)' }}>
        {page !== 'catalog' && <button onClick={() => nav(page === 'admin' ? 'profile' : 'catalog')} className="mp-tap" aria-label="Voltar" style={{ marginLeft: -14, background: 'none', border: 'none', color: 'var(--text-strong)', cursor: 'pointer' }}><ChevronLeft size={22}/></button>}
        <h1 style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-md)', fontWeight: 600, letterSpacing: -0.2, color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{({ catalog: 'Cartas para Jogar', wants: 'Lista de desejos', cart: 'Seu pedido', checkout: 'Pagamento', success: '', profile: 'Minha conta', admin: 'Admin' })[page] ?? 'Cartas para Jogar'}</h1>
        {/* Modo de adição: enquanto ele está ligado, o checkout entra num
            pedido já pago. Clicável para sair. */}
        {addTo && ['catalog','wants','cart','checkout'].includes(page) && (
          <button onClick={() => { SFX.click(); setAddTo(null); }} title="Sair do modo de adição" aria-label={`Adicionando cartas ao pedido ${addTo.shortId}. Toque para sair.`} style={{ display: 'flex', alignItems: 'center', gap: 4, height: 32, padding: '0 10px', borderRadius: 'var(--r-pill)', border: '1px solid var(--line)', background: 'var(--fill-soft)', color: 'var(--text-strong)', fontSize: 'var(--fs-2xs)', fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter',system-ui,sans-serif" }}>
            <Plus size={11}/>#{addTo.shortId}<X size={11}/>
          </button>
        )}
        <AccountMenu
          isAdmin={isAdmin}
          activeOrders={activeOrderCount}
          wishCount={wishlistCount}
          colorMode={colorMode}
          onToggleColorMode={() => setColorMode(m => m === 'light' ? 'dark' : 'light')}
          soundOn={soundOn}
          onToggleSound={() => setSoundOn(s => !s)}
          onNavigate={(p, tab) => { if (p === 'profile') setProfileTab(tab || 'orders'); nav(p); }}
          onLogout={handleLogout}
        />
      </header>}

      {/* Pages */}
      <main className="portal-content" style={{ padding: page === 'onboarding' ? '0 20px' : '14px 20px' }}>
        {page === 'catalog' && <CatalogPage token={token} wishlist={wishlist} cartItems={cartItems} collectionByCard={collectionOwned} onAddToWishlist={handleAddToWishlist} onRemoveFromWishlist={handleRemoveFromWishlist} onAddToCart={handleAddCardToCart} onUpdateCartQty={handleUpdateCartQty} priceFor={priceFor} theme={theme} tutStep={showTutorial?tutStep:-1} onTutNext={tutNext} />}
        {page === 'wants' && <WishlistPage token={token} wishlist={wishlist} cartItems={cartItems} collectionByCard={collectionOwned} onAddToCart={handleAddToCart} onRemove={handleRemoveFromWishlist} onUpdateQty={handleUpdateWishlistQty} onSwap={handleSwapWish} cartCount={cartCount} theme={theme} nav={nav} />}
        {page === 'success' && <SuccessPage lastOrder={lastOrder} theme={theme} nav={nav} />}
        {page === 'profile' && !profile && <div style={{padding:20,color:'var(--danger)',fontSize:'var(--fs-xs)'}}><div>profile: null</div><div>token: {token?'ok':'null'}</div><div>appLoading: {String(appLoading)}</div><Btn onClick={()=>loadAppData(token,session?.user?.id)} sfx="click"><RefreshCw size={14}/> Recarregar</Btn></div>}
        {page === 'profile' && profile && (() => { try { return <ProfileView profile={profile} token={token} theme={theme} nav={nav} isAdmin={isAdmin} setShowTutorial={setShowTutorial} onSaveProfile={handleSaveProfile} onLogout={handleLogout} myOrders={myOrders} onReloadOrders={()=>loadAppData(token,session?.user?.id)} toast={toast} colorMode={colorMode} onColorModeChange={setColorMode} openIndividualOrders={openIndividualOrders} onAddCards={handleStartAddCards} collection={collection} onSetExtra={handleSetCollectionExtra} initialTab={profileTab} key={profileTab} onPasswordChanged={applyUpgradedUser} />; } catch(e) { return <div style={{padding:20,color:'var(--danger)',fontSize:'var(--fs-xs)'}}>Crash: {e.message}</div>; } })()}
        {page === 'admin' && <AdminConsole pricing={pricing} theme={theme} token={token} nav={nav} onReload={()=>loadAppData(token,session?.user?.id)} toast={toast} initialSection={adminTarget} />}
        {page === 'onboarding' && <OnboardingPage onComplete={handleOnboardingComplete} theme={theme} />}
      </main>
      {(page === 'catalog' || page === 'wants') && !showTutorial && !orderOpen && <OrderPill count={cartCount} minCards={minCards} total={cartTotal} isAdding={!!addTo} onOpen={() => nav('cart')} />}
      {orderOpen && <OrderSheet cartItems={cartItems} pricing={pricing} profile={profile} token={token} onOrderDone={handleOrderDone} onSuccess={() => nav('success')} onClose={() => setOrderOpen(false)} onUpdateCartQty={handleUpdateCartQty} toast={toast} unshippedPaidBatches={unshippedPaidBatches} indiv={indivPricing} addTo={addTo} onCancelAdd={() => setAddTo(null)} />}
    </>}
  </div>);
}
