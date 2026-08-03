import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { Home, ScrollText, ShoppingCart, User, Shield, Plus, Minus, Trash2, ChevronRight, ChevronLeft, Sparkles, LogOut, Check, Search, BookOpen, Eye, EyeOff, Mail, Lock, ArrowRight, ArrowLeft, X, Gift, Truck, CreditCard, Circle, CheckCircle, ArrowDown, Upload, Copy, Calendar, DollarSign, Settings, Camera, Phone, MessageCircle, Bell, Package, MapPin, Edit3, RefreshCw, Volume2, VolumeX, HelpCircle, Loader, AlertTriangle, Wifi, WifiOff, Archive, Sun, Moon, LayoutDashboard, Users, TrendingUp, BellRing, BellOff, Clock, Layers, ShoppingBag, ClipboardList, Zap, Store, Wallet, Activity, Inbox, LogIn, UserPlus } from 'lucide-react';
import { buildCatalogQueries, buildLatestCardQuery, RECENT_CARDS_FILTER } from './catalogQuery';
import { buildShippingGroups, SHIPPING_SERVICE_UNKNOWN } from '../shared/shipping-groups';
import { buildCardsFromCsv, parseCardLinkList } from '../shared/cardImport';
import { pricePerCard as indivPricePerCard } from '../shared/individualPricing';
import { DEFAULT_WHATSAPP_MESSAGES, WHATSAPP_AUDIENCES, buildShipmentWhatsAppUrl, buildWhatsAppUrl, getWhatsAppRecipients } from './whatsappCommunication';
import { PUSH_NEEDS_INSTALL, disablePush, enablePush, getPushState, reportAccess, sendTestPush, updatePushPrefs } from './push';
import { GT, GT_LIGHT, inkOn } from './guildTheme';
import './theme.css';
import './responsive.css';
import './ui.css';

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

// Opacidade sobre uma cor arbitrária (hex OU var() do tema). O sufixo é o
// mesmo par hexadecimal que o CSS usa em #rrggbbaa, para manter os call sites
// legíveis: wa(theme.primary,'30') ≈ 19% de opacidade.
function wa(color,hexAlpha){
  if(!color)return 'transparent';
  const pct=Math.round(parseInt(hexAlpha,16)/255*100);
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
// Acessibilidade de diálogo, num hook só: Escape fecha, Tab circula dentro da
// folha em vez de vazar para a página atrás dela, o fundo para de rolar e o
// foco volta para o elemento que abriu o modal. Sem isso, quem navega por
// teclado ou leitor de tela continua "dentro" do catálogo com a folha aberta.
//
// `onClose` fica num ref para o efeito rodar só na montagem: como os call
// sites passam arrow function inline, uma dependência normal remontaria o
// trap (e re-focaria o primeiro elemento) a cada render.
const FOCUSABLE='button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
function useDialogA11y(onClose){
  const ref=useRef(null);
  const closeRef=useRef(onClose);
  closeRef.current=onClose;
  useEffect(()=>{
    const node=ref.current;
    const previous=typeof document!=='undefined'?document.activeElement:null;
    const bodyOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const focusables=()=>Array.from(node?.querySelectorAll(FOCUSABLE)||[]).filter(el=>el.offsetParent!==null);
    const first=focusables()[0];
    if(first)first.focus();
    else if(node){node.setAttribute('tabindex','-1');node.focus();}
    function onKey(e){
      if(e.key==='Escape'){e.stopPropagation();if(closeRef.current)closeRef.current();return;}
      if(e.key!=='Tab')return;
      const f=focusables();
      if(!f.length)return;
      const i=f.indexOf(document.activeElement);
      if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus();}
      else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus();}
    }
    document.addEventListener('keydown',onKey);
    return()=>{
      document.removeEventListener('keydown',onKey);
      document.body.style.overflow=bodyOverflow;
      if(previous&&typeof previous.focus==='function')previous.focus();
    };
  },[]);
  return ref;
}

function getGuild(a,b){return a&&b&&a!==b?(GUILD_MAP[a+b]||null):null;}
const TC={Normal:'var(--text-dim)',Holo:'var(--gold)',Foil:'var(--tc-foil)',English:'var(--tc-blue)',Chinese:'var(--tc-red)',Japanese:'var(--tc-amber)',Promo:'var(--tc-pink)','Showcase Foil':'var(--tc-violet)',Regular:'var(--text-dim)','Enchanted Foil':'var(--tc-purple)','Cold Foil':'var(--tc-sky)'};
const TCG_LIST=[
  {key:'Magic',color:'var(--indiv)',types:['Todos','Normal','Holo','Foil']},
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

// Preço unitário conforme o modo de pedido.
// CAMPAIGN → preço fixo por tipo. INDIVIDUAL → faixa por volume (depende da qtd total) com piso por tipo.
function unitPriceFor(cardType, totalQty, mode, pricing, indiv) {
  if (mode === 'INDIVIDUAL' && indiv && Array.isArray(indiv.tiers) && indiv.tiers.length) {
    return indivPricePerCard({ qty: totalQty, type: cardType, tiers: indiv.tiers, pricing: indiv.pricing, fxRate: indiv.fx && indiv.fx.rate });
  }
  return getCardPrice(cardType, pricing);
}

// Preço unitário "cheio" (faixa mais cara / menor volume), sem o desconto por volume.
// Serve de referência para mostrar a economia ao cliente. CAMPAIGN não tem faixas → mesmo preço.
function baseUnitPriceFor(cardType, mode, pricing, indiv) {
  if (mode === 'INDIVIDUAL' && indiv && Array.isArray(indiv.tiers) && indiv.tiers.length) {
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

const Card=({children,style,glow,onClick,id})=><div id={id} onClick={onClick} style={{background:'var(--card-bg)',border:'1px solid '+(glow||'var(--card-border)'),borderRadius:'var(--r-card)',padding:'var(--sp-4)',boxShadow:glow?'0 0 20px '+glow:'var(--card-shadow)',...(onClick?{cursor:'pointer'}:{}),...style}}>{children}</div>;
const Btn=({children,variant='primary',disabled,onClick,style,full,sfx='click',id})=>{const v={primary:{background:'var(--gp)',color:'var(--gp-ink)',boxShadow:'0 4px 18px var(--gg)'},secondary:{background:'var(--fill)',color:'var(--text-strong)',border:'1px solid var(--line)'},ghost:{background:'transparent',color:'var(--gp)',padding:'12px'},danger:{background:'rgba(var(--danger-rgb),0.1)',color:'var(--danger)',border:'1px solid rgba(var(--danger-rgb),0.15)'},success:{background:'rgba(var(--ok-rgb),0.1)',color:'var(--ok)',border:'1px solid rgba(var(--ok-rgb),0.15)'},pix:{background:'rgba(var(--pix-rgb),0.12)',color:'var(--pix)',border:'1px solid rgba(var(--pix-rgb),0.2)'},warn:{background:'rgba(var(--gold-rgb),0.1)',color:'var(--gold)',border:'1px solid rgba(var(--gold-rgb),0.15)'}};return <button id={id} onClick={e=>{if(!disabled&&sfx&&SFX[sfx])SFX[sfx]();if(onClick)onClick(e);}} disabled={disabled} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:'var(--sp-2)',border:'none',borderRadius:'var(--r-card)',padding:'13px 20px',fontWeight:700,fontSize:14,cursor:disabled?'not-allowed':'pointer',opacity:disabled?.4:1,transition:'all .15s',fontFamily:"'Outfit',sans-serif",...(full?{width:'100%'}:{}),...v[variant],...style}}>{children}</button>;};
const Input=({icon:Icon,...p})=><div style={{position:'relative'}}>{Icon&&<Icon size={18} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'var(--text-faint)',pointerEvents:'none'}}/>}<input {...p} style={{width:'100%',padding:Icon?'13px 14px 13px 42px':'13px 14px',borderRadius:'var(--r-card)',border:'1px solid var(--line)',background:'var(--field-bg)',color:'var(--text)',fontSize:'var(--fs-md)',fontFamily:"'Outfit',sans-serif",outline:'none',boxSizing:'border-box',...p.style}}/></div>;
const Tag=({children,color,style})=><span style={{display:'inline-flex',alignItems:'center',gap:'var(--sp-1)',padding:'5px 11px',borderRadius:'var(--r-pill)',background:color?wa(color,'14'):'var(--fill-soft)',border:'1px solid '+(color?wa(color,'22'):'var(--line-soft)'),fontSize:'var(--fs-xs)',color:color||'var(--text-muted)',fontWeight:600,whiteSpace:'nowrap',...style}}>{children}</span>;
const SectionTitle=({children,sub})=><div style={{marginBottom:12}}><h2 style={{margin:0,fontSize:'var(--fs-lg)',fontFamily:"'Cinzel',serif",color:'var(--text-strong)',letterSpacing:.3}}>{children}</h2>{sub&&<p style={{margin:'3px 0 0',fontSize:'var(--fs-xs)',color:'var(--text-faint)'}}>{sub}</p>}</div>;
const EmptyState=({icon:Icon,title,sub,action})=><div style={{textAlign:'center',padding:'var(--sp-6) var(--sp-5)'}}><Icon size={34} style={{marginBottom:'var(--sp-2)',color:'var(--text-faint)'}}/><div style={{fontSize:'var(--fs-md)',fontWeight:700,marginBottom:'var(--sp-1)',color:'var(--text-strong)'}}>{title}</div><div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)'}}>{sub}</div>{action&&<div style={{marginTop:'var(--sp-4)',display:'flex',justifyContent:'center'}}>{action}</div>}</div>;
const ManaOrb=({mana,selected,onClick,size=44})=>{const m=MANA_COLORS.find(c=>c.key===mana);return <button onClick={()=>{SFX.toggle();onClick&&onClick();}} style={{width:size,height:size,borderRadius:size,background:selected?wa(m.color,'28'):'var(--fill-soft)',border:'2.5px solid '+(selected?m.color:'var(--text-faint)'),display:'grid',placeItems:'center',cursor:'pointer',fontSize:size*.4,transition:'all .2s',boxShadow:selected?'0 0 14px '+wa(m.color,'35'):'none'}}>{m.emoji}</button>;};
const GuildBadge=({guild,size=22})=>{if(!guild||!GT[guild])return null;const t=guildTheme(guild);return <div style={{width:size,height:size,borderRadius:size,background:'linear-gradient(135deg,'+t.primary+','+t.secondary+')',boxShadow:'0 0 '+size*.5+'px '+t.glow,flexShrink:0}}/>;};
const Spin=({size=18,color})=><Loader size={size} style={{color:color||'var(--gp)',animation:'spin 1s linear infinite'}}/>;

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
    <button onClick={onEdit} style={{background:'var(--fill)',border:'1px solid var(--line)',borderRadius:'var(--r-control)',padding:'6px 10px',cursor:'pointer',color:'var(--text-dim)',display:'flex',alignItems:'center',gap:'var(--sp-1)',fontSize:'var(--fs-2xs)',flexShrink:0}}><Edit3 size={12}/> Editar</button>
  </div>);
};

function FlyingCard({show,onDone}){
  useEffect(()=>{if(show){const t=setTimeout(()=>onDone&&onDone(),600);return()=>clearTimeout(t);}},[show]);
  if(!show)return null;
  return <div style={{position:'fixed',zIndex:999,pointerEvents:'none',top:'50%',left:'50%',animation:'flyToWants 0.6s ease-in forwards'}}>
    <div style={{width:32,height:44,borderRadius:4,background:'linear-gradient(135deg,var(--gp),var(--gs))',boxShadow:'0 0 16px var(--gg)',border:'1px solid var(--line)'}}/>
  </div>;
}

function SwipeableCard({children,onSwipeLeft,onSwipeRight,leftLabel='Excluir',rightLabel='Carrinho',leftColor='var(--danger)',rightColor}){
  const ref=useRef(null);const startX=useRef(0);const [dx,setDx]=useState(0);const [swiping,setSwiping]=useState(false);
  const threshold=80;
  function onTouchStart(e){startX.current=e.touches[0].clientX;setSwiping(true);}
  function onTouchMove(e){if(!swiping)return;const d=e.touches[0].clientX-startX.current;setDx(Math.max(-150,Math.min(150,d)));}
  function onTouchEnd(){
    if(dx<-threshold&&onSwipeLeft)onSwipeLeft();
    else if(dx>threshold&&onSwipeRight)onSwipeRight();
    setDx(0);setSwiping(false);
  }
  const bgColor=dx<-30?wa(leftColor,'20'):dx>30?wa((rightColor||'var(--gp)'),'20'):'transparent';
  return(<div style={{position:'relative',overflow:'hidden',borderRadius:'var(--r-card)',background:bgColor,transition:swiping?'none':'background .3s'}}>
    {dx<-20&&<div style={{position:'absolute',right:16,top:'50%',transform:'translateY(-50%)',color:leftColor,fontSize:'var(--fs-2xs)',fontWeight:700,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><Trash2 size={14}/>{leftLabel}</div>}
    {dx>20&&<div style={{position:'absolute',left:16,top:'50%',transform:'translateY(-50%)',color:rightColor||'var(--gp)',fontSize:'var(--fs-2xs)',fontWeight:700,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><ShoppingCart size={14}/>{rightLabel}</div>}
    <div ref={ref} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} style={{transform:`translateX(${dx}px)`,transition:swiping?'none':'transform .3s',position:'relative',zIndex:1}}>{children}</div>
  </div>);
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
  {title:'Catálogo',body:'Aqui ficam todas as cartas. Busque pelo nome e filtre por tipo.',navTo:'catalog',tabIndex:1,spotlightId:null,icon:'📖'},
  {title:'Busca e filtros',body:'Use a barra de busca, selecione o TCG e filtre por tipo de carta.',navTo:'catalog',tabIndex:1,spotlightId:'tut-search-area',scrollTo:true,icon:'🔍'},
  {title:'Adicionar à lista',body:'Toque no + de qualquer carta para adicioná-la à sua lista de desejos.',navTo:'catalog',tabIndex:1,spotlightId:null,icon:'➕',interactive:true},
  {title:'Lista de desejos',body:'As cartas que você quer ficam aqui — inclusive as que já comprou. Toque no 🛒 para mandar para o carrinho; a carta continua na lista.',navTo:'wants',tabIndex:2,spotlightId:null,icon:'📋'},
  {title:'Bônus',body:'O administrador pode conceder cartas bônus para você. Quando disponíveis, elas aparecem aqui e saem de graça no próximo checkout!',navTo:'wants',tabIndex:2,spotlightId:null,icon:'🎁'},
  {title:'Carrinho',body:'Edite quantidades, tire o que não quer agora e avance para o checkout.',navTo:'cart',tabIndex:3,spotlightId:null,icon:'🛒'},
  {title:'Checkout',body:'Revise o pedido, preencha o endereço e calcule o frete antes de finalizar.',navTo:'checkout',tabIndex:3,spotlightId:'tut-checkout-summary',icon:'📦'},
  {title:'Pagamento',body:'Pague com segurança via Mercado Pago — cartão, boleto ou saldo.',navTo:'checkout',tabIndex:3,spotlightId:'tut-payment',icon:'💳'},
  {title:'Perfil',body:'Veja seus pedidos, altere endereço, mude a senha e reabra este tutorial quando quiser.',navTo:'profile',tabIndex:4,spotlightId:null,icon:'👤'},
];

// ══════════════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════════════

function HomePage({pool,minCards,pricing,closeDate,theme,nav,wishlistCount,cartCount,bonusAvail,campaign_status}){
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
  return(<div className="portal-page portal-home" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)'}}>
    <div style={{textAlign:'center',padding:'6px 0 0'}}>
      <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',letterSpacing:2.5,textTransform:'uppercase',fontFamily:"'Cinzel',serif"}}>Encomenda em Grupo</div>
      <h1 className="mp-gradient-text" style={{margin:'5px 0 0',fontSize:'var(--fs-2xl)',fontFamily:"'Cinzel',serif",background:'linear-gradient(135deg,'+theme.primary+','+theme.secondary+')',color:theme.primary}}>Cartas para Jogar</h1>
    </div>

    {/* Status da campanha se não estiver ativa */}
    {campaign_status&&campaign_status!=='ACTIVE'&&<Card style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:'var(--sp-2)',background:'rgba(var(--danger-rgb),0.06)',borderColor:'rgba(var(--danger-rgb),0.15)'}}>
      <AlertTriangle size={16} style={{color:'#d94452'}}/><div><div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:'var(--danger)'}}>{campaignLabel(campaign_status)}</div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>Novos pedidos disponíveis apenas quando a encomenda estiver ativa.</div></div>
    </Card>}

    {/* Progresso da meta mínima */}
    <Card style={{padding:'var(--sp-4)',borderColor:isViable?'rgba(var(--ok-rgb),0.2)':undefined,background:isViable?'rgba(var(--ok-rgb),0.04)':undefined}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
        <div>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',textTransform:'uppercase',letterSpacing:1,marginBottom:3,fontWeight:600}}>Progresso da encomenda</div>
          <div style={{fontSize:'var(--fs-xl)',fontWeight:800,color:isViable?'var(--ok)':theme.primary}}>{pool} <span style={{fontSize:14,color:'var(--text-faint)',fontWeight:400}}>/ {goalCards} cartas</span></div>
        </div>
        {isViable?<div style={{display:'flex',alignItems:'center',gap:'var(--sp-1)',padding:'5px 10px',borderRadius:'var(--r-pill)',background:'rgba(var(--ok-rgb),0.12)',border:'1px solid rgba(var(--ok-rgb),0.25)'}}><Check size={12} style={{color:'var(--ok)'}}/><span style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--ok)'}}>Meta atingida</span></div>:<div style={{display:'flex',alignItems:'center',gap:'var(--sp-1)',padding:'5px 10px',borderRadius:'var(--r-pill)',background:'var(--fill-soft)',border:'1px solid var(--line)'}}><span style={{fontSize:'var(--fs-2xs)',fontWeight:600,color:'var(--text-dim)'}}>Meta: {goalCards} cartas</span></div>}
      </div>
      <div style={{background:'rgba(var(--sunk),calc(0.35*var(--sunk-a)))',borderRadius:'var(--r-pill)',height:8,overflow:'hidden',marginBottom:10}}>
        <div style={{width:progress+'%',height:'100%',borderRadius:'var(--r-pill)',background:isViable?'linear-gradient(90deg,var(--ok),var(--ok-2))':'linear-gradient(90deg,'+theme.primary+','+theme.secondary+')',transition:'width .5s',boxShadow:'0 0 10px '+(isViable?'rgba(var(--ok-rgb),0.3)':theme.glow)}}/>
      </div>
      <div style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)',lineHeight:1.5}}>
        {isViable
          ?<>✅ Encomenda confirmada! Continuaremos recebendo pedidos até a data prevista de fechamento.</>
          :<>⏳ Faltam <b style={{color:theme.primary}}>{missingForMeta} carta{missingForMeta!==1?'s':''}</b> para a encomenda ser confirmada. A encomenda permanece aberta até atingir a meta mínima.</>
        }
      </div>
    </Card>

    {/* Data prevista de fechamento */}
    {closeD&&<Card style={{padding:'12px 16px',display:'flex',alignItems:'flex-start',gap:'var(--sp-2)'}}>
      <Calendar size={16} style={{color:theme.primary,flexShrink:0,marginTop:1}}/>
      <div>
        <div style={{fontSize:'var(--fs-sm)',fontWeight:700,marginBottom:2}}>
          {datePassed?'Data prevista já passou':'Data prevista de fechamento: '+closeDateText}
          {!datePassed&&daysLeft!==null&&<span style={{fontSize:'var(--fs-2xs)',fontWeight:400,color:'var(--text-faint)',marginLeft:6}}>({daysLeft} dia{daysLeft!==1?'s':''})</span>}
        </div>
        <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',lineHeight:1.5}}>
          {isViable
            ?datePassed?'A meta mínima foi atingida. O admin pode fechar a encomenda a qualquer momento.':'Quando a data chegar e a meta estiver atingida, o admin encerrará a encomenda.'
            :'Se a data chegar antes de atingirmos a meta, a encomenda continuará aberta até as '+goalCards+' cartas serem alcançadas.'
          }
        </div>
      </div>
    </Card>}

    {/* Resumo stats */}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'var(--sp-2)'}}>
      {[{icon:ScrollText,val:wishlistCount,lbl:'Desejos',c:theme.primary},{icon:ShoppingCart,val:cartCount,lbl:'Carrinho',c:'var(--gold)'},{icon:Gift,val:bonusAvail,lbl:'Bônus',c:'var(--ok)'}].map(s=>(<Card key={s.lbl} style={{textAlign:'center',padding:'var(--sp-3)'}}><s.icon size={16} style={{color:s.c,marginBottom:3}}/><div style={{fontSize:'var(--fs-lg)',fontWeight:800}}>{s.val}</div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{s.lbl}</div></Card>))}
    </div>

    {/* Bônus disponíveis */}
    {bonusAvail>0&&<Card style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:'var(--sp-2)',background:'rgba(var(--ok-rgb),0.06)',borderColor:'rgba(var(--ok-rgb),0.18)'}}>
      <Gift size={18} style={{color:'var(--ok)',flexShrink:0}}/><div><div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:'var(--ok)'}}>Você tem {bonusAvail} carta{bonusAvail!==1?'s':''} bônus! 🎉</div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>Serão incluídas automaticamente no seu próximo checkout.</div></div>
    </Card>}

    {/* Tabela de preços por tipo */}
    <Card style={{padding:'var(--sp-4)'}}>
      <SectionTitle sub="Preços fixos por tipo de carta">Preços</SectionTitle>
      {[{label:'Carta Normal',price:normalPrice,color:'var(--text-muted)',desc:'Cartas comuns e não-foil'},{label:'Carta Holo',price:outerPrice,color:'var(--gold)',desc:'Cartas Holo / especiais'},{label:'Carta Foil',price:foilPrice,color:'#d94452',desc:'Cartas foil de qualquer tipo'}].map(t=>(
        <div key={t.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 12px',borderRadius:'var(--r-control)',marginBottom:3,background:'var(--fill-soft)',border:'1px solid var(--line-soft)'}}>
          <div><div style={{fontSize:'var(--fs-sm)',fontWeight:600,color:t.color}}>{t.label}</div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{t.desc}</div></div>
          <span style={{fontSize:'var(--fs-md)',fontWeight:800,color:t.color}}>R$ {t.price.toFixed(2)}</span>
        </div>
      ))}
      <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginTop:8,textAlign:'center'}}>Mínimo de 15 cartas pagas por pedido</div>
    </Card>

    <Btn full onClick={()=>{SFX.nav();nav('catalog');}} sfx="nav"><BookOpen size={18}/> Ver catálogo</Btn>
    {cartCount>0&&<Btn full variant="secondary" onClick={()=>nav('cart')} sfx="nav"><ShoppingCart size={18}/> Carrinho ({cartCount})</Btn>}
  </div>);
}

// ══════════════════════════════════════════════════════
// CATALOG — Supabase powered, server-side search/filter
// ══════════════════════════════════════════════════════

// Card image with graceful fallback. Accepts both catalog cards
// (name/type/image_url) and order items (card_name/card_type/card_image_url).
function CardThumb({card,radius=12,style}){
  const [err,setErr]=useState(false);
  const name=card.name||card.card_name||'';
  const type=card.type||card.card_type||'Normal';
  const img=card.image_url||card.card_image_url;
  const tc=TC[type]||'var(--text-dim)';
  return(<div style={{position:'relative',width:'100%',aspectRatio:'0.72',borderRadius:radius,overflow:'hidden',background:'linear-gradient(150deg,rgba(var(--ink),calc(0.07*var(--ink-a))),rgba(var(--ink),calc(0.02*var(--ink-a))))',border:'1px solid var(--line-soft)',...style}}>
    {img&&!err
      ? <img src={img} alt={name} loading="lazy" onError={()=>setErr(true)} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
      : <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'var(--sp-1)',padding:'var(--sp-2)',textAlign:'center'}}>
          <div style={{fontSize:24,opacity:.45}}>🃏</div>
          <div style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--text-muted)',lineHeight:1.15,wordBreak:'break-word'}}>{name}</div>
          <div style={{fontSize:8,fontWeight:700,color:tc,textTransform:'uppercase',letterSpacing:.4}}>{type}</div>
        </div>}
  </div>);
}

// Fullscreen image zoom — replaces opening card images in a new browser tab.
// A casca só decide se abre; o conteúdo é um componente à parte porque
// `useDialogA11y` é um hook e não pode ficar depois de um `return null`.
function ImageLightbox({src,alt,onClose}){
  if(!src)return null;
  return <ImageLightboxOpen src={src} alt={alt} onClose={onClose}/>;
}

function ImageLightboxOpen({src,alt,onClose}){
  const dialogRef=useDialogA11y(onClose);
  return(<div ref={dialogRef} role="dialog" aria-modal="true" aria-label={alt?`Imagem ampliada: ${alt}`:'Imagem ampliada'} onClick={onClose} style={{position:'fixed',inset:0,zIndex:140,background:'rgba(var(--sunk),calc(0.93*var(--sunk-a)))',display:'grid',placeItems:'center',cursor:'zoom-out',padding:'var(--sp-4)',animation:'fadeIn .15s ease'}}>
    <button onClick={onClose} aria-label="Fechar imagem" className="mp-tap" style={{position:'absolute',top:14,right:14,borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'var(--overlay-bg)',backdropFilter:'blur(6px)',color:'var(--text-strong)',cursor:'pointer'}}><X size={18}/></button>
    <img src={src} alt={alt||''} style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain',borderRadius:'var(--r-control)'}}/>
  </div>);
}

function CatalogPage({token,wishlist,cartItems=[],onAddToWishlist,priceBRL,theme,campaignStatus,orderMode='CAMPAIGN',tutStep,onTutNext}){
  const [search,setSearch]=useState('');const [typeF,setTypeF]=useState('Todos');const [tcgFilter,setTcgFilter]=useState('Magic');const [cards,setCards]=useState([]);const [total,setTotal]=useState(0);
  const [page,setPage]=useState(0);const [loading,setLoading]=useState(false);const [addQty,setAddQty]=useState({});
  const [detail,setDetail]=useState(null);
  const [flyAnim,setFlyAnim]=useState(false);const PAGE_SIZE=20;
  const currentTcg=TCG_LIST.find(t=>t.key===tcgFilter)||TCG_LIST[0];
  const catalogFilters=['Todos',RECENT_CARDS_FILTER,...currentTcg.types.filter(t=>t!=='Todos')];
  const firstAddBtnRef=useRef(null);const latestFetchRef=useRef(0);const [handPos,setHandPos]=useState(null);
  useEffect(()=>{
    if(tutStep!==2){setHandPos(null);return;}
    const update=()=>{if(firstAddBtnRef.current){const r=firstAddBtnRef.current.getBoundingClientRect();setHandPos({top:r.top-26,left:r.left+r.width/2});}};
    update();const t=setInterval(update,300);return()=>clearInterval(t);
  },[tutStep,cards]);
  
  const isIndividual = orderMode==='INDIVIDUAL';
  const campaignOpen = isIndividual||campaignCanOrder(campaignStatus);
  const campaignStatusText = campaignLabel(campaignStatus);

  const fetchCards = useCallback(async()=>{
    const fetchId=++latestFetchRef.current;
    setLoading(true);
    try {
      let latestCreatedAt;
      if(typeF===RECENT_CARDS_FILTER){
        const latestCards=await sbGet('cards',buildLatestCardQuery(tcgFilter),token);
        if(fetchId!==latestFetchRef.current)return;
        latestCreatedAt=latestCards[0]?.created_at;
        if(!latestCreatedAt){setCards([]);setTotal(0);return;}
      }

      const {cardsQuery,countQuery}=buildCatalogQueries({tcg:tcgFilter,filter:typeF,search,page,pageSize:PAGE_SIZE,latestCreatedAt});
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
  },[search,typeF,tcgFilter,page,token]);

  useEffect(()=>{setPage(0);setCards([]);},[search,typeF,tcgFilter]);
  useEffect(()=>{const t=setTimeout(fetchCards,300);return()=>{clearTimeout(t);latestFetchRef.current++;};},[fetchCards,page]);

  const getQ=id=>addQty[id]||1;const setQ=(id,v)=>setAddQty(q=>({...q,[id]:Math.max(1,v)}));
  function add(card,qty){SFX.addCard();setFlyAnim(true);onAddToWishlist(card,qty);setQ(card.id,1);if(tutStep===2&&onTutNext)onTutNext();}

  return(<div className="portal-page portal-catalog" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)'}}>
    {!isIndividual&&!campaignOpen&&<Card style={{padding:'var(--sp-3)',borderColor:'rgba(var(--gold-rgb),0.25)',background:'rgba(var(--gold-rgb),0.08)'}}><div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:'var(--gold)'}}>Encomenda fechada no momento</div><div style={{fontSize:'var(--fs-xs)',color:'var(--text-muted)',marginTop:4}}>{campaignStatusText} Você ainda pode montar sua lista de desejos.</div></Card>}
    <FlyingCard show={flyAnim} onDone={()=>setFlyAnim(false)}/>
    <div style={{display:'flex',gap:'var(--sp-1)',overflowX:'auto',WebkitOverflowScrolling:'touch',paddingBottom:2}}>
      {TCG_LIST.map(t=>(<button key={t.key} onClick={()=>{SFX.toggle();setTcgFilter(t.key);setTypeF(current=>current===RECENT_CARDS_FILTER?current:'Todos');}} style={{padding:'7px 12px',borderRadius:'var(--r-control)',border:'none',background:tcgFilter===t.key?wa(t.color,'22'):'var(--text-faint)',color:tcgFilter===t.key?t.color:'var(--text-faint)',fontWeight:700,fontSize:'var(--fs-2xs)',cursor:'pointer',fontFamily:"'Outfit',sans-serif",whiteSpace:'nowrap',flexShrink:0,boxShadow:tcgFilter===t.key?`0 0 0 1.5px ${t.color}60`:'none'}}>{t.key}</button>))}
    </div>
    <div id="tut-search-area" style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>
      <Input icon={Search} placeholder="Buscar carta..." value={search} onChange={e=>setSearch(e.target.value)}/>
      <div style={{display:'flex',gap:'var(--sp-1)',flexWrap:'wrap'}}>
        {catalogFilters.map(t=>(<button key={t} onClick={()=>{SFX.toggle();setTypeF(t);}} style={{flex:'1 1 64px',minWidth:t===RECENT_CARDS_FILTER?96:64,padding:'7px 6px',borderRadius:'var(--r-control)',border:'none',background:typeF===t?currentTcg.color:'var(--text-faint)',color:typeF===t?'#fff':'var(--text-faint)',fontWeight:600,fontSize:'var(--fs-2xs)',cursor:'pointer',fontFamily:"'Outfit',sans-serif",whiteSpace:'nowrap'}}>{t}</button>))}
      </div>
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
          // Três estados, em ordem de precedência: já comprada > no carrinho >
          // na lista. Antes só existia "está nos wants".
          const wish=wishlist.find(w=>w.card_id===c.id);
          const inCart=cartItems.find(ci=>ci.card_id===c.id);
          const acquiredQty=wish?.acquired_qty||0;
          const badge=acquiredQty>0
            ?{color:'var(--ok)',icon:Check,text:acquiredQty>1?`${acquiredQty}x comprada`:'comprada'}
            :inCart?{color:'var(--gold)',icon:ShoppingCart,text:String(inCart.quantity)}
            :wish?{color:theme.primary,icon:ScrollText,text:String(wish.quantity)}
            :null;
          return(<Card key={c.id} onClick={()=>{SFX.nav();setDetail(c);}} style={{padding:'var(--sp-2)'}}>
            <div style={{position:'relative'}}>
              <CardThumb card={c}/>
              {badge&&<div style={{position:'absolute',top:7,left:7}}><Tag color={badge.color} style={{fontSize:'var(--fs-2xs)',padding:'2px 7px'}}><badge.icon size={10}/> {badge.text}</Tag></div>}
              <button ref={i===0?firstAddBtnRef:null} id={i===0?'tut-add-btn':undefined} title="Adicionar à lista de desejos" aria-label={`Adicionar ${c.name} à lista de desejos`} onClick={e=>{e.stopPropagation();add(c,1);}} style={{position:'absolute',right:7,bottom:7,width:40,height:40,border:'none',borderRadius:'var(--r-control)',background:wish?'rgba(var(--ok-rgb),0.92)':'var(--gp)',color:'var(--gp-ink)',display:'grid',placeItems:'center',cursor:'pointer',boxShadow:'0 6px 16px var(--gg)'}}><Plus size={18}/></button>
            </div>
            <div style={{padding:'9px 3px 2px'}}>
              <div style={{fontWeight:700,fontSize:'var(--fs-sm)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</div>
              <div style={{display:'flex',alignItems:'center',marginTop:5}}>
                <span style={{fontSize:'var(--fs-2xs)',color:TC[c.type],fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.type}</span>
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
    {detail&&<CardDetailModal card={detail} priceBRL={priceBRL} existing={wishlist.find(w=>w.card_id===detail.id)} campaignOpen={campaignOpen} onClose={()=>setDetail(null)} onAdd={(c,q)=>add(c,q)}/>}
  </div>);
}

// In-app card detail sheet — replaces opening the image in a new browser tab.
function CardDetailModal({card,priceBRL,existing,campaignOpen,onClose,onAdd}){
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
        <div style={{fontSize:'var(--fs-2xs)',letterSpacing:1.5,textTransform:'uppercase',color:tc,fontWeight:700}}>{card.type}</div>
        <div id="card-detail-title" style={{fontFamily:"'Cinzel',serif",fontSize:'var(--fs-xl)',color:'var(--text-strong)',marginTop:3,lineHeight:1.15}}>{card.name}</div>
        {existing&&<div style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',marginTop:10}}>
          <Tag color="var(--ok)" style={{fontSize:'var(--fs-2xs)'}}>{existing.quantity} na sua lista</Tag>
        </div>}
      </div>
      <div style={{display:'flex',gap:'var(--sp-2)',alignItems:'stretch',marginTop:20}}>
        <div style={{display:'flex',alignItems:'center',gap:'var(--sp-3)',background:'var(--fill)',border:'1px solid var(--line)',borderRadius:'var(--r-card)',padding:'0 14px'}}>
          <button onClick={()=>{SFX.toggle();setQty(q=>Math.max(1,q-1));}} aria-label="Diminuir quantidade" style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',display:'grid',padding:'var(--sp-2)'}}><Minus size={16}/></button>
          <span aria-live="polite" aria-label={`Quantidade: ${qty}`} style={{minWidth:18,textAlign:'center',fontWeight:700,fontSize:'var(--fs-md)',color:'var(--text-strong)'}}>{qty}</span>
          <button onClick={()=>{SFX.toggle();setQty(q=>q+1);}} aria-label="Aumentar quantidade" style={{background:'none',border:'none',color:'var(--text-strong)',cursor:'pointer',display:'grid',padding:'var(--sp-2)'}}><Plus size={16}/></button>
        </div>
        {/* Sem `disabled`: a lista de desejos é do usuário e não depende de
            encomenda aberta. O aviso de encomenda fechada, no topo da página,
            informa; quem bloqueia a compra é o carrinho. */}
        <Btn full sfx={null} onClick={()=>{onAdd(card,qty);onClose();}} style={{flex:1}}><Plus size={16}/> Adicionar à lista</Btn>
      </div>
    </div>
    {zoom&&<ImageLightbox src={card.image_url} alt={card.name} onClose={()=>setZoom(false)}/>}
  </div>);
}

// ══════════════════════════════════════════════════════
// WANTS — reads order_items, cart is local toggle
// ══════════════════════════════════════════════════════

function WishlistPage({wishlist,cartItems,onAddToCart,onAddAllToCart,onRemove,onUpdateQty,cartCount,bonusAvail,theme,nav}){
  const [searchW,setSearchW]=useState('');
  const [zoomSrc,setZoomSrc]=useState(null);
  const [showAcquired,setShowAcquired]=useState(false);
  const bonus=bonusAvail||0;

  // Três estados por carta, e é isso que separa lista de desejos de carrinho:
  // uma carta já comprada continua aqui, marcada, em vez de sumir.
  const decorated=wishlist.map(w=>{
    const acquired=w.acquired_qty||0;
    const inCart=cartItems.find(c=>c.card_id===w.card_id);
    return {...w,acquiredQty:acquired,pending:Math.max(0,w.quantity-acquired),inCartQty:inCart?inCart.quantity:0};
  });
  const pending=decorated.filter(w=>w.pending>0);
  const acquired=decorated.filter(w=>w.pending<=0);
  const pendingUnits=pending.reduce((s,w)=>s+w.pending,0);
  const visible=showAcquired?acquired:pending;
  const filtered=searchW?visible.filter(w=>w.card_name.toLowerCase().includes(searchW.toLowerCase())):visible;
  const addableCount=pending.filter(w=>!w.inCartQty).length;

  return(<div className="portal-page portal-wants" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)',paddingBottom:pending.length>0?86:0}}>
    <div id="tut-wants-tags" style={{display:'flex',gap:'var(--sp-1)',flexWrap:'wrap',alignItems:'center'}}>
      <Tag color={theme.primary}><ScrollText size={11}/> {pendingUnits} na lista</Tag>
      <Tag color="var(--gold)"><ShoppingCart size={11}/> {cartCount} no carrinho</Tag>
      {bonus>0&&<Tag color="var(--ok)"><Gift size={11}/> {bonus} bônus</Tag>}
    </div>

    {bonus>0&&<Card id="tut-bonus-card" glow="rgba(var(--ok-rgb),0.12)" style={{padding:'var(--sp-3)',background:'rgba(var(--ok-rgb),0.03)'}}>
      <div style={{display:'flex',alignItems:'center',gap:'var(--sp-2)'}}><Gift size={16} style={{color:'var(--ok)'}}/><div style={{fontSize:'var(--fs-sm)'}}><span style={{fontWeight:700,color:'var(--ok)'}}>{bonus} carta(s) bônus</span><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginTop:2}}>Primeiras do carrinho saem grátis!</div></div></div>
    </Card>}

    {acquired.length>0&&<div role="tablist" aria-label="Filtrar lista de desejos" style={{display:'flex',gap:'var(--sp-1)'}}>
      {[{key:false,label:`Quero (${pending.length})`},{key:true,label:`Já comprei (${acquired.length})`}].map(t=>(
        <button key={String(t.key)} role="tab" aria-selected={showAcquired===t.key} onClick={()=>{SFX.toggle();setShowAcquired(t.key);}} style={{flex:1,padding:'9px 10px',borderRadius:'var(--r-control)',border:'1px solid '+(showAcquired===t.key?wa(theme.primary,'55'):'var(--line-soft)'),background:showAcquired===t.key?wa(theme.primary,'18'):'var(--fill-soft)',color:showAcquired===t.key?theme.primary:'var(--text-dim)',fontWeight:700,fontSize:'var(--fs-xs)',fontFamily:"'Outfit',sans-serif",cursor:'pointer'}}>{t.label}</button>
      ))}
    </div>}

    {visible.length>3&&<Input icon={Search} placeholder="Buscar na lista..." value={searchW} onChange={e=>setSearchW(e.target.value)}/>}

    {filtered.length>0&&<div className="portal-card-grid portal-wants-grid" style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>
      {filtered.map((w)=>{const img=w.card_image_url;const done=w.pending<=0;return(
        <Card key={w.id} style={{padding:'var(--sp-2)',opacity:done?0.72:1}}>
          <div style={{display:'flex',alignItems:'center',gap:'var(--sp-3)'}}>
            <div onClick={()=>img&&setZoomSrc(img)} role={img?'button':undefined} tabIndex={img?0:undefined} aria-label={img?`Ampliar imagem de ${w.card_name}`:undefined} onKeyDown={e=>{if(img&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setZoomSrc(img);}}} style={{width:54,flexShrink:0,cursor:img?'zoom-in':'default'}}><CardThumb card={w} radius={9}/></div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:'var(--fs-sm)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{w.card_name}</div>
              <span style={{fontSize:'var(--fs-2xs)',color:TC[w.card_type],fontWeight:700}}>{w.card_type}</span>
              {w.acquiredQty>0&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--ok)',fontWeight:700,marginTop:2,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><Check size={11}/> {w.acquiredQty} de {w.quantity} já comprada{w.acquiredQty!==1?'s':''}</div>}
              {w.inCartQty>0&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--gold)',fontWeight:700,marginTop:2,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><ShoppingCart size={11}/> {w.inCartQty} no carrinho</div>}
              {!done&&<div style={{display:'flex',alignItems:'center',gap:'var(--sp-1)',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',borderRadius:'var(--r-control)',border:'1px solid var(--line-soft)',width:'fit-content',marginTop:7}}>
                <button onClick={()=>onUpdateQty(w.id,w.quantity-1)} aria-label={`Diminuir quantidade desejada de ${w.card_name}`} style={{background:'none',border:'none',color:'var(--text-strong)',padding:'10px 12px',cursor:'pointer'}}><Minus size={12}/></button>
                <span aria-label={`Quantidade desejada de ${w.card_name}: ${w.quantity}`} style={{minWidth:18,textAlign:'center',fontSize:'var(--fs-sm)',fontWeight:700}}>{w.quantity}</span>
                <button onClick={()=>onUpdateQty(w.id,w.quantity+1)} aria-label={`Aumentar quantidade desejada de ${w.card_name}`} style={{background:'none',border:'none',color:'var(--text-strong)',padding:'10px 12px',cursor:'pointer'}}><Plus size={12}/></button>
              </div>}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'var(--sp-1)',alignItems:'stretch'}}>
              {!done&&<button onClick={()=>onAddToCart(w,w.pending)} title="Adicionar ao carrinho" aria-label={`Adicionar ${w.card_name} ao carrinho`} style={{background:'var(--gp)',border:'none',borderRadius:'var(--r-control)',padding:'11px 13px',cursor:'pointer',color:'var(--gp-ink)',display:'flex',alignItems:'center',gap:'var(--sp-1)',fontSize:'var(--fs-xs)',fontWeight:700,fontFamily:"'Outfit',sans-serif",boxShadow:'0 4px 14px var(--gg)'}}><ShoppingCart size={14}/></button>}
              <button onClick={()=>onRemove(w.id)} title="Tirar da lista" aria-label={`Tirar ${w.card_name} da lista de desejos`} style={{background:'rgba(var(--danger-rgb),0.08)',border:'1px solid rgba(var(--danger-rgb),0.15)',borderRadius:'var(--r-control)',padding:'10px 13px',cursor:'pointer',color:'var(--danger)',display:'flex',alignItems:'center',justifyContent:'center'}}><Trash2 size={13}/></button>
            </div>
          </div>
        </Card>
      );})}
    </div>}

    {filtered.length===0&&(showAcquired
      ?<EmptyState icon={Check} title="Nada comprado ainda" sub="As cartas que você comprar ficam registradas aqui"/>
      :<EmptyState icon={ScrollText} title={searchW?'Nenhuma carta encontrada':'Sua lista de desejos está vazia'} sub={searchW?'Tente outro termo':'Adicione cartas pelo catálogo'}/>)}

    {pending.length>0&&!showAcquired&&<div style={{position:'fixed',bottom:78,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,padding:'10px 16px 12px',background:'var(--fade-to-bg)',zIndex:15,display:'flex',gap:'var(--sp-2)'}}>
      <Btn variant="secondary" onClick={onAddAllToCart} disabled={addableCount===0} sfx="addCard" style={{flex:'0 0 auto',padding:'13px 14px'}}><CheckCircle size={15}/> Tudo</Btn>
      <Btn full onClick={()=>nav&&nav('cart')} sfx="nav" style={{flex:1}}><ShoppingCart size={15}/> Ver carrinho{cartCount>0?` (${cartCount})`:''}</Btn>
    </div>}
    <ImageLightbox src={zoomSrc} onClose={()=>setZoomSrc(null)}/>
  </div>);
}

const MIN_ORDER_CARDS = 15;

function CartPage({cartItems,pricing,bonusAvail,campaignStatus,theme,nav,onRemoveFromCart,onUpdateCartQty,token,orderId,campaignId,onOrderDone,toast,profile,previousPaidBatches,orderMode='CAMPAIGN',indiv=null}){
  const isIndividual=orderMode==='INDIVIDUAL';
  const totalQty=cartItems.reduce((s,c)=>s+c.quantity,0);
  const bonus=isIndividual?0:(bonusAvail||0); // pedido individual não usa bônus
  let bL=bonus;
  const bd=cartItems.map(c=>{const bq=Math.min(c.quantity,bL);bL-=bq;return{...c,bonusQty:bq,paidQty:c.quantity-bq};});
  const totalBonus=bd.reduce((s,c)=>s+c.bonusQty,0);
  const totalPaid=bd.reduce((s,c)=>s+c.paidQty,0);
  const totalBRL=bd.reduce((s,c)=>s+c.paidQty*unitPriceFor(c.card_type,totalQty,orderMode,pricing,indiv),0);
  // Economia por volume: diferença entre o preço cheio (faixa mais cara) e o preço atual.
  const baseBRL=bd.reduce((s,c)=>s+c.paidQty*baseUnitPriceFor(c.card_type,orderMode,pricing,indiv),0);
  const volumeDiscount=Math.max(0,baseBRL-totalBRL);
  const campaignOpen=campaignCanOrder(campaignStatus);
  const minCards=isIndividual?(Number(indiv?.pricing?.min_cards)||MIN_ORDER_CARDS):MIN_ORDER_CARDS;
  const isFullBonus=totalPaid===0&&totalBonus>0;
  const previousPaidCards=(previousPaidBatches||[]).reduce((s,b)=>s+(b.qty_in_batch||0),0);
  const hasMetMinimumBefore=!isIndividual&&previousPaidCards>=MIN_ORDER_CARDS;
  const canCheckout=isIndividual?(totalQty>=minCards):(isFullBonus||totalPaid>=MIN_ORDER_CARDS||hasMetMinimumBefore);
  const missingCards=hasMetMinimumBefore?0:Math.max(0,minCards-(isIndividual?totalQty:totalPaid));
  const canGoCheckout=isIndividual||campaignOpen;
  const [zoomSrc,setZoomSrc]=useState(null);

  return(<div className="portal-page portal-cart" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)',paddingBottom:cartItems.length>0?(canGoCheckout?168:120):0}}>
    {!isIndividual&&!campaignOpen&&<Card style={{padding:'var(--sp-3)',borderColor:'rgba(var(--gold-rgb),0.25)',background:'rgba(var(--gold-rgb),0.06)'}}>
      <div style={{display:'flex',alignItems:'center',gap:'var(--sp-2)'}}><AlertTriangle size={14} style={{color:'var(--gold)'}}/><div style={{fontSize:'var(--fs-xs)',color:'var(--gold)',fontWeight:600}}>{campaignStatus?campaignLabel(campaignStatus):'Nenhuma encomenda ativa'}<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',fontWeight:400,marginTop:2}}>Continue montando seu carrinho. O checkout estará disponível quando a encomenda abrir.</div></div></div>
    </Card>}
    {cartItems.length>0&&<>
      <div className="portal-card-grid portal-cart-grid" style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>
        {bd.map((c)=>{const itemPrice=unitPriceFor(c.card_type,totalQty,orderMode,pricing,indiv);const baseItemPrice=baseUnitPriceFor(c.card_type,orderMode,pricing,indiv);return(
          <Card key={c.id} style={{padding:'var(--sp-2)'}}>
            <div style={{display:'flex',alignItems:'center',gap:'var(--sp-3)'}}>
              <div onClick={()=>c.card_image_url&&setZoomSrc(c.card_image_url)} style={{width:54,flexShrink:0,cursor:c.card_image_url?'zoom-in':'default'}}><CardThumb card={c} radius={9}/></div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:'var(--fs-sm)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.card_name}</div>
                <div style={{display:'flex',gap:'var(--sp-1)',alignItems:'center',flexWrap:'wrap',marginTop:2}}>
                  <span style={{fontSize:'var(--fs-2xs)',color:TC[c.card_type],fontWeight:700}}>{c.card_type}</span>
                  {c.bonusQty>0&&<Tag color="var(--ok)" style={{fontSize:'var(--fs-2xs)',padding:'1px 5px'}}>🎁 {c.bonusQty} grátis</Tag>}
                </div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'var(--sp-2)',marginTop:7}}>
                  <div style={{display:'flex',alignItems:'center',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',borderRadius:'var(--r-control)',border:'1px solid var(--line-soft)'}}>
                    <button onClick={()=>onUpdateCartQty(c.id,c.quantity-1)} style={{background:'none',border:'none',color:'var(--text-strong)',padding:'5px 11px',cursor:'pointer'}}><Minus size={12}/></button>
                    <span style={{minWidth:18,textAlign:'center',fontSize:'var(--fs-sm)',fontWeight:700}}>{c.quantity}</span>
                    <button onClick={()=>onUpdateCartQty(c.id,c.quantity+1)} style={{background:'none',border:'none',color:'var(--text-strong)',padding:'5px 11px',cursor:'pointer'}}><Plus size={12}/></button>
                  </div>
                  {c.paidQty>0
                    ?<div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'var(--sp-1)'}}>
                      <span style={{fontSize:'var(--fs-sm)',fontWeight:800,color:'var(--text-strong)',whiteSpace:'nowrap'}}>R$ {(c.paidQty*itemPrice).toFixed(2).replace('.',',')}</span>
                      <span style={{fontSize:'var(--fs-2xs)',color:'var(--text-dim)',whiteSpace:'nowrap'}}>{baseItemPrice>itemPrice&&<span style={{textDecoration:'line-through',marginRight:4,color:'var(--text-faint)'}}>R$ {baseItemPrice.toFixed(2).replace('.',',')}</span>}<span style={{color:baseItemPrice>itemPrice?'var(--ok)':'var(--text-dim)',fontWeight:baseItemPrice>itemPrice?700:400}}>R$ {itemPrice.toFixed(2).replace('.',',')}</span> /un</span>
                    </div>
                    :<span style={{fontSize:'var(--fs-sm)',fontWeight:800,color:'var(--ok)',whiteSpace:'nowrap'}}>Grátis</span>}
                </div>
              </div>
              {/* Uma ação só: tirar do carrinho não mexe na lista de desejos,
                  então "voltar para a lista" e "remover" viraram a mesma coisa. */}
              <button onClick={()=>onRemoveFromCart(c.id)} title="Tirar do carrinho" aria-label={`Tirar ${c.card_name} do carrinho`} style={{alignSelf:'center',background:'rgba(var(--danger-rgb),0.08)',border:'1px solid rgba(var(--danger-rgb),0.15)',borderRadius:'var(--r-control)',padding:'10px 12px',cursor:'pointer',color:'var(--danger)',display:'flex',alignItems:'center',justifyContent:'center'}}><Trash2 size={14}/></button>
            </div>
          </Card>
        );})}
      </div>
      <Btn full variant="ghost" onClick={()=>nav('wants')} sfx="nav"><ArrowLeft size={14}/> Voltar para a lista de desejos</Btn>
      {/* Barra de resumo fixa */}
      <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:'var(--sheet-bg-alt)',backdropFilter:'blur(20px)',borderTop:'1px solid rgba(var(--ink),calc(0.08*var(--ink-a)))',borderRadius:'20px 20px 0 0',padding:'13px 16px calc(12px + env(safe-area-inset-bottom))',zIndex:25,boxShadow:'0 -10px 30px rgba(var(--sunk),calc(0.4*var(--sunk-a)))'}}>
        {canGoCheckout&&!canCheckout&&!isFullBonus&&(()=>{
          const atuais=isIndividual?totalQty:totalPaid;
          const pct=Math.min(100,Math.round((atuais/minCards)*100));
          return(<div style={{marginBottom:10,padding:'9px 11px',borderRadius:'var(--r-control)',background:'rgba(var(--gold-rgb),0.08)',border:'1px solid rgba(var(--gold-rgb),0.2)'}}>
            <div style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',marginBottom:7}}>
              <AlertTriangle size={13} style={{color:'var(--gold)',flexShrink:0}}/>
              <span style={{fontSize:'var(--fs-xs)',color:'var(--gold)',fontWeight:600}}>Faltam {missingCards} carta{missingCards!==1?'s':''} para o mínimo de {minCards}{isIndividual?'':' pagas'}</span>
            </div>
            <div role="progressbar" aria-valuenow={atuais} aria-valuemin={0} aria-valuemax={minCards} aria-label={`${atuais} de ${minCards} cartas para o mínimo do pedido`} style={{background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',borderRadius:'var(--r-pill)',height:6,overflow:'hidden'}}>
              <div style={{width:pct+'%',height:'100%',borderRadius:'var(--r-pill)',background:'linear-gradient(90deg,var(--gold),var(--gp))',transition:'width .4s'}}/>
            </div>
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginTop:5,textAlign:'right'}}>{atuais}/{minCards}</div>
          </div>);
        })()}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:11}}>
          <div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-dim)'}}>{totalQty} carta{totalQty!==1?'s':''}{totalBonus>0?` · ${totalBonus} bônus`:''}</div>{volumeDiscount>0&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--ok)',fontWeight:700,marginTop:2,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><Gift size={11}/> Desconto por volume −R$ {volumeDiscount.toFixed(2).replace('.',',')}</div>}<div style={{fontSize:'var(--fs-xl)',fontWeight:800,color:'var(--text-strong)',marginTop:1}}>≈ R$ {totalBRL.toFixed(2).replace('.',',')}</div></div>
          {totalBonus>0&&<Tag color="var(--ok)"><Gift size={12}/> {totalBonus} grátis</Tag>}
        </div>
        {canGoCheckout&&<Btn full onClick={()=>nav('checkout')} disabled={!canCheckout} sfx="nav"><CreditCard size={15}/> {canCheckout?'Ir para checkout':`Mínimo ${minCards} (faltam ${missingCards})`}</Btn>}
      </div>
    </>}
    {cartItems.length===0&&<><EmptyState icon={ShoppingCart} title="Carrinho vazio" sub="Escolha cartas na sua lista de desejos"/><div style={{textAlign:'center',marginTop:8}}><Btn variant="secondary" onClick={()=>nav('wants')} sfx="nav"><ScrollText size={15}/> Ir para Wants</Btn></div></>}
    <ImageLightbox src={zoomSrc} onClose={()=>setZoomSrc(null)}/>
  </div>);
}
function CheckoutPage({cartItems=[],pricing,bonusAvail,theme,nav,profile,token,orderId,campaignId,campaignStatus,onOrderDone,toast,previousPaidBatches=[],onRemoveFromCart,onUpdateCartQty,orderMode='CAMPAIGN',indiv=null}){
  const isIndividual=orderMode==='INDIVIDUAL';
  const [freteOptions,setFreteOptions]=useState([]);const [selectedFrete,setSelectedFrete]=useState(null);
  const [lF,setLF]=useState(false);const [submitting,setSubmitting]=useState(false);
  const [step,setStep]=useState('review');
  const [zoomSrc,setZoomSrc]=useState(null);
  const [saveAddressChoice,setSaveAddressChoice]=useState(null);
  // Frete conjunto: true = enviar junto com pedidos anteriores desta encomenda (sem novo frete)
  const [useJointShipping,setUseJointShipping]=useState(false);
  // Já paguei o frete: true = cliente informa que o frete já foi pago anteriormente
  const [alreadyPaidShipping,setAlreadyPaidShipping]=useState(false);
  const hasPreviousOrders=previousPaidBatches.length>0;
  // "Já paguei o frete" só faz sentido se há um pedido pago nesta encomenda que ainda
  // não foi enviado (sem etiqueta/envio gerado) — é nele que este pedido vai pegar carona.
  const hasUnshippedPaidOrder=(previousPaidBatches||[]).some(b=>!(b.mandabem_envio_id||b.mandabem_rastreamento));
  const shippingAnchor=[...(previousPaidBatches||[])].sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0))[0]||null;
  const [addr,setAddr]=useState({cep:profile?.cep||'',rua:profile?.rua||'',numero:profile?.numero||'',complemento:profile?.complemento||'',bairro:profile?.bairro||'',cidade:profile?.cidade||'',uf:profile?.uf||''});
  const profileHasSavedAddress=Boolean(profile?.cep&&(profile.cep||'').replace(/\D/g,'').length===8&&profile?.rua);
  const [editingAddr,setEditingAddr]=useState(!profileHasSavedAddress);
  const cart=cartItems;
  const bonus=isIndividual?0:(bonusAvail||0); // pedido individual não usa bônus
  let bL=bonus;
  const bd=cart.map(c=>{const bq=Math.min(c.quantity,bL);bL-=bq;return{...c,bonusQty:bq,paidQty:c.quantity-bq};});
  const totalQty=cart.reduce((s,c)=>s+c.quantity,0);
  const totalBonus=bd.reduce((s,c)=>s+c.bonusQty,0);const totalPaid=bd.reduce((s,c)=>s+c.paidQty,0);
  const campaignOpen = campaignCanOrder(campaignStatus);
  const campaignStatusText = campaignLabel(campaignStatus);
  const isFullBonus=totalPaid===0&&totalBonus>0;
  const previousPaidCards=(previousPaidBatches||[]).reduce((s,b)=>s+(b.qty_in_batch||0),0);
  const minCards=isIndividual?(Number(indiv?.pricing?.min_cards)||MIN_ORDER_CARDS):MIN_ORDER_CARDS;
  const hasMetMinimumBefore=!isIndividual&&previousPaidCards>=MIN_ORDER_CARDS;
  const canCheckout=isIndividual?(totalQty>=minCards):(isFullBonus||totalPaid>=MIN_ORDER_CARDS||hasMetMinimumBefore);
  const missingCards=hasMetMinimumBefore?0:Math.max(0,minCards-(isIndividual?totalQty:totalPaid));
  // Subtotal: preço por tipo (campanha) ou por faixa de volume (individual)
  const sub=bd.reduce((s,c)=>s+c.paidQty*unitPriceFor(c.card_type,totalQty,orderMode,pricing,indiv),0);
  // Economia por volume: preço cheio (faixa mais cara) menos o preço atual aplicado.
  const baseSub=bd.reduce((s,c)=>s+c.paidQty*baseUnitPriceFor(c.card_type,orderMode,pricing,indiv),0);
  const volumeDiscount=Math.max(0,baseSub-sub);
  // Frete: 0 se "já paguei" ou frete conjunto, senão valor da opção selecionada
  const shippingSkipped = alreadyPaidShipping || useJointShipping;
  const fV=shippingSkipped?0:(selectedFrete?selectedFrete.price:0);
  const total=sub+fV;
  const cepClean=(addr.cep||'').replace(/\D/g,'');
  const addressUnchanged=addr.cep===(profile?.cep||'')&&addr.rua===(profile?.rua||'')&&addr.numero===(profile?.numero||'')&&addr.complemento===(profile?.complemento||'')&&addr.bairro===(profile?.bairro||'')&&addr.cidade===(profile?.cidade||'')&&addr.uf===(profile?.uf||'');
  // payViaBonusFlow: pedido só de bônus E frete não será cobrado agora
  const payViaBonusFlow = isFullBonus && shippingSkipped;

  useEffect(()=>{if(useJointShipping){setSelectedFrete({carrier:'Envio conjunto',price:0,deadline_days:0});setFreteOptions([]);}else{setSelectedFrete(null);setFreteOptions([]);}},[useJointShipping]);
  // Dep array intentionally only [alreadyPaidShipping]: effect runs on toggle change; closure vars are fresh from latest render at that point
  useEffect(()=>{if(alreadyPaidShipping){setSelectedFrete(null);setFreteOptions([]);}else if(step==='address'&&profileHasSavedAddress&&!editingAddr&&cepClean.length===8&&!lF&&!useJointShipping){calcFrete();}},[alreadyPaidShipping]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(step==='address'&&profileHasSavedAddress&&!editingAddr&&cepClean.length===8&&freteOptions.length===0&&!lF&&!useJointShipping&&!alreadyPaidShipping)calcFrete();},[step]);

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

  async function finalizeIndividual(){
    if(!canCheckout){toast(`Mínimo de ${minCards} cartas por pedido. Adicione mais ${missingCards}.`,'error');return;}
    if(!shippingSkipped&&!selectedFrete){toast('Selecione uma opção de frete para continuar','error');return;}
    setSubmitting(true);
    try {
      const items=bd.map(c=>({card_id:c.card_id,quantity:c.quantity}));
      const shipping={
        service:shippingSkipped?(shippingAnchor?.shipping_service||null):(selectedFrete?.service||selectedFrete?.carrier||null),
        price:fV,
        address:{cep:addr.cep,rua:addr.rua,numero:addr.numero,complemento:addr.complemento,bairro:addr.bairro,cidade:addr.cidade,uf:addr.uf,name:profile?.name||''},
        already_paid:shippingSkipped,
        group_id:shippingSkipped?(shippingAnchor?.shipping_group_id||shippingAnchor?.id||null):null,
      };
      const r=await fetch('/api/individual-checkout',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({items,shipping})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d.ok)throw new Error(d.error||`HTTP ${r.status}`);
      if(saveAddressChoice===true&&addr.rua)await sbPatch('profiles','id=eq.'+(profile.id),{cep:addr.cep,rua:addr.rua,numero:addr.numero,complemento:addr.complemento,bairro:addr.bairro,cidade:addr.cidade,uf:addr.uf},token).catch(()=>{});
      // Esvazia o carrinho-rascunho: os itens definitivos do pedido já foram
      // criados no servidor, então estas linhas viram órfãs. O desejo em si
      // continua guardado em wishlist_items.
      for(const c of cart){ if(c.id) await sbDelete('order_items','id=eq.'+c.id,token).catch(()=>{}); }
      SFX.confirm();
      onOrderDone({method:'mp',totalPaid:d.totalQty,totalBonus:0,pricing,isFullBonus:false,alreadyPaidShipping:shippingSkipped,batchId:d.batchId,shortId:d.shortId,cards:cart.map(c=>({name:c.card_name,type:c.card_type,qty:c.quantity}))});
      toast('Gerando link de pagamento...','info');
      const mpRes=await fetch(`/api/mp-create`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:String(d.batchId),total:Number(d.total.toFixed(2)),descricao:`Pedido individual #${d.shortId} - ${d.totalQty} cartas`})});
      const mpData=await mpRes.json();
      const mpLink=mpData?.mpLink||mpData?.init_point||mpData?.sandbox_init_point;
      if(mpLink){window.location.href=mpLink;return;}
      if(mpData.error){console.error('MP:',mpData.error);toast('Erro MP: '+mpData.error,'error');}
      nav('success');
    }catch(e){console.error('[finalizeIndividual]',e);toast('Erro ao finalizar: '+e.message,'error');}
    setSubmitting(false);
  }

  async function finalize(){
    if(isIndividual)return finalizeIndividual();
    if(!campaignOpen){toast('Encomenda fechada no momento','error');return;}
    if(!canCheckout){toast(`Mínimo de ${MIN_ORDER_CARDS} cartas pagas por pedido. Adicione mais ${missingCards} carta${missingCards!==1?'s':''}.`,'error');return;}
    if(!shippingSkipped&&!selectedFrete){toast('Selecione uma opção de frete para continuar','error');return;}
    setSubmitting(true);
    try {
      const batchBaseData = {
        order_id:orderId,
        status:'DRAFT',
        brl_unit_price_locked:null,
        qty_in_batch:totalQty,
        subtotal_locked:sub,
        shipping_locked:fV,
        shipping_service:shippingSkipped?(shippingAnchor?.shipping_service||null):(selectedFrete?.service||selectedFrete?.carrier||null),
        shipping_address:{cep:addr.cep,rua:addr.rua,numero:addr.numero,complemento:addr.complemento,bairro:addr.bairro,cidade:addr.cidade,uf:addr.uf,name:profile?.name||''},
        shipping_already_paid:shippingSkipped,
        shipping_group_id:shippingSkipped?(shippingAnchor?.shipping_group_id||shippingAnchor?.id||null):null,
        total_locked:total,
        payment_method:payViaBonusFlow?'BONUS':'MERCADO_PAGO',
      };
      // Try batch creation with shipping_already_paid column; fall back if column doesn't exist yet
      let batch;
      try {
        const created = await sbPost('order_batches', batchBaseData, token);
        batch = Array.isArray(created) ? created[0] : created;
      } catch(eBatch) {
        console.warn('[finalize] batch POST with shipping_already_paid failed (column may not exist), retrying without it:', eBatch);
        const {shipping_already_paid:_shippingAlreadyPaid,shipping_group_id:_shippingGroupId,shipping_service:_shippingService,shipping_address:_shippingAddress,...batchFallback}=batchBaseData;
        const created = await sbPost('order_batches', batchFallback, token);
        batch = Array.isArray(created) ? created[0] : created;
      }
      if(!batch?.id) throw new Error('Falha ao criar lote de pedido');
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
      onOrderDone({method:payViaBonusFlow?'bonus':'mp',totalPaid,totalBonus,pricing,isFullBonus,alreadyPaidShipping,batchId:batch.id,shortId,cards:cart.map(c=>({name:c.card_name,type:c.card_type,qty:c.quantity}))});

      if(payViaBonusFlow){
        try{const cbRes=await fetch('/api/confirm-bonus-batch',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({batchId:batch.id})});if(!cbRes.ok)console.warn('confirm-bonus-batch status:',cbRes.status);}catch(e){console.warn('confirm-bonus-batch:',e);}
        nav('success');
      } else {
        toast('Gerando link de pagamento...','info');
        const descricao=isFullBonus?`Frete pedido bônus #${shortId}`:`Pedido #${shortId} - ${totalPaid} cartas`;
        const mpRes=await fetch(`/api/mp-create`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:String(batch.id),total:Number(total.toFixed(2)),descricao})});
        const mpData=await mpRes.json();
        const mpLink=mpData?.mpLink||mpData?.init_point||mpData?.sandbox_init_point; if(mpLink){window.location.href=mpLink;return;}
        else if(mpData.error){console.error('MP:',mpData.error);toast('Erro MP: '+mpData.error,'error');}
        nav('success');
      }
    }catch(e){console.error('[finalize]',e);toast('Erro ao finalizar: '+e.message,'error');}
    setSubmitting(false);
  }

  if(!isIndividual&&!campaignOpen)return(<div style={{paddingTop:40}}>
    <Card style={{padding:'var(--sp-4)',textAlign:'center',borderColor:'rgba(var(--gold-rgb),0.25)',background:'rgba(var(--gold-rgb),0.08)'}}>
      <AlertTriangle size={32} style={{color:'var(--gold)',marginBottom:8}}/>
      <div style={{fontWeight:700,fontSize:'var(--fs-md)',color:'var(--gold)',marginBottom:6}}>Encomenda fechada</div>
      <div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)'}}>{campaignStatusText}</div>
      <div style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)',marginTop:8}}>Você pode navegar o catálogo e adicionar cartas à lista de wants. O carrinho será liberado quando a encomenda estiver ativa.</div>
    </Card>
    <div style={{textAlign:'center',marginTop:16}}><Btn onClick={()=>nav('catalog')} sfx="nav"><BookOpen size={16}/> Ver catálogo</Btn></div>
  </div>);
  if(totalQty===0)return(<div style={{paddingTop:40}}><EmptyState icon={ShoppingCart} title="Carrinho vazio" sub="Escolha cartas na sua lista de desejos"/><div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)',alignItems:'center',marginTop:16}}><Btn onClick={()=>nav('wants')} sfx="nav"><ScrollText size={14}/> Ir para Wants</Btn></div></div>);

  // Bloquear checkout se mínimo não atingido
  if(!canCheckout&&!isFullBonus)return(<div style={{paddingTop:20}}>
    <Card style={{padding:'var(--sp-4)',textAlign:'center',borderColor:'rgba(var(--gold-rgb),0.3)',background:'rgba(var(--gold-rgb),0.06)'}}>
      <AlertTriangle size={32} style={{color:'var(--gold)',marginBottom:8}}/>
      <div style={{fontWeight:700,fontSize:'var(--fs-md)',color:'var(--gold)',marginBottom:6}}>Mínimo não atingido</div>
      <div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)',lineHeight:1.5}}>Cada pedido precisa ter pelo menos <b style={{color:'var(--gold)'}}>{minCards} cartas{isIndividual?'':' pagas'}</b>.<br/>Seu carrinho tem {isIndividual?totalQty:totalPaid} carta{(isIndividual?totalQty:totalPaid)!==1?'s':''}{isIndividual?'':' paga'+(totalPaid!==1?'s':'')}. Adicione mais <b style={{color:'var(--gold)'}}>{missingCards}</b>.</div>
      {totalBonus>0&&<div style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)',marginTop:6}}>Cartas bônus não contam para o mínimo.</div>}
    </Card>
    <div style={{textAlign:'center',marginTop:16}}><Btn onClick={()=>nav('cart')} sfx="nav"><ShoppingCart size={16}/> Voltar ao carrinho</Btn></div>
  </div>);

  return(<div className="portal-page portal-checkout" style={{display:'flex',flexDirection:'column',gap:'var(--sp-3)'}}>
    <Card id="tut-checkout-summary" style={{padding:'var(--sp-4)'}}>
      <SectionTitle sub={totalQty+' cartas ('+totalBonus+' bônus + '+totalPaid+' pagas)'}>Resumo do pedido</SectionTitle>
      {totalBonus>0&&<><div style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--ok)',marginBottom:6,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><Gift size={12}/> Bônus (grátis)</div>
        {bd.filter(c=>c.bonusQty>0).map((c,i)=>(<div key={'b'+i} style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',padding:'5px 0',fontSize:'var(--fs-sm)',borderBottom:'1px solid rgba(var(--ok-rgb),0.08)'}}><div onClick={()=>c.card_image_url&&setZoomSrc(c.card_image_url)} style={{width:30,flexShrink:0,cursor:c.card_image_url?'zoom-in':'default'}}><CardThumb card={c} radius={6}/></div><span style={{flex:1,minWidth:0,color:'var(--text-muted)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.card_name} <span style={{color:TC[c.card_type],fontSize:'var(--fs-2xs)',fontWeight:700}}>{c.card_type}</span> x{c.bonusQty}</span><span style={{fontWeight:700,color:'var(--ok)'}}>R$ 0,00</span></div>))}</>}
      {totalPaid>0&&<><div style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--text-dim)',marginTop:totalBonus>0?12:0,marginBottom:6,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><CreditCard size={12}/> Pagas</div>
        {bd.filter(c=>c.paidQty>0).map((c,i)=>{const ip=unitPriceFor(c.card_type,totalQty,orderMode,pricing,indiv);return(<div key={'p'+i} style={{display:'flex',alignItems:'center',gap:'var(--sp-2)',padding:'5px 0',fontSize:'var(--fs-sm)',borderBottom:'1px solid rgba(var(--ink),calc(0.03*var(--ink-a)))'}}><div onClick={()=>c.card_image_url&&setZoomSrc(c.card_image_url)} style={{width:30,flexShrink:0,cursor:c.card_image_url?'zoom-in':'default'}}><CardThumb card={c} radius={6}/></div><span style={{flex:1,minWidth:0,color:'var(--text-muted)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.card_name} <span style={{color:TC[c.card_type],fontSize:'var(--fs-2xs)',fontWeight:700}}>{c.card_type}</span> x{c.paidQty}<span style={{color:'var(--text-faint)',fontSize:'var(--fs-2xs)'}}> · R$ {ip.toFixed(2).replace('.',',')}/un</span></span><span style={{fontWeight:700,whiteSpace:'nowrap'}}>R$ {(c.paidQty*ip).toFixed(2)}</span></div>);})}</>}
      <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:'var(--sp-1)'}}>
        {totalPaid>0&&volumeDiscount>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-sm)',color:'var(--text-dim)'}}><span>Subtotal (sem desconto)</span><span style={{color:'var(--text-faint)',textDecoration:'line-through'}}>R$ {baseSub.toFixed(2)}</span></div>}
        {totalPaid>0&&volumeDiscount>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-sm)',color:'var(--ok)',fontWeight:700}}><span>Desconto por volume</span><span>−R$ {volumeDiscount.toFixed(2)}</span></div>}
        {totalPaid>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-sm)',color:'var(--text-dim)'}}><span>Subtotal</span><span style={{color:'var(--text-strong)',fontWeight:600}}>R$ {sub.toFixed(2)}</span></div>}
        <div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-sm)',color:'var(--text-dim)'}}><span>Frete</span><span style={{color:alreadyPaidShipping?'var(--ok)':'var(--text-strong)',fontWeight:600}}>{alreadyPaidShipping?'Já pago ✓':useJointShipping?'Envio conjunto (R$ 0,00)':selectedFrete?'R$ '+fV.toFixed(2):lF?'Calculando...':'—'}</span></div>
        <div style={{height:1,background:'var(--fill)',margin:'3px 0'}}/>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-lg)',fontWeight:800}}><span>Total</span><span style={{color:payViaBonusFlow?'var(--ok)':theme.primary}}>{payViaBonusFlow?'R$ 0,00 (bônus!)':'R$ '+total.toFixed(2)}</span></div>
      </div>
      {step==='review'&&<Btn full onClick={()=>setStep('address')} style={{marginTop:12}} sfx="nav"><ArrowRight size={16}/> Avançar para endereço e frete</Btn>}
    </Card>

    {step==='address'&&<Card style={{padding:'var(--sp-4)'}}>
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

      {/* Frete conjunto — aparece automaticamente se houver pedidos anteriores nesta encomenda */}
      {hasPreviousOrders&&!alreadyPaidShipping&&<div style={{marginTop:14,padding:'12px 14px',borderRadius:'var(--r-control)',background:useJointShipping?'rgba(var(--ok-rgb),0.06)':'var(--text-faint)',border:'1px solid '+(useJointShipping?'rgba(var(--ok-rgb),0.2)':'var(--line)')}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'var(--sp-2)'}}>
          <div>
            <div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:useJointShipping?'var(--ok)':'var(--text-strong)',marginBottom:2,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><Truck size={14} style={{flexShrink:0}}/> Envio conjunto</div>
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',lineHeight:1.4}}>Você já tem pedidos nesta encomenda. Envie tudo junto sem custo de frete adicional.</div>
          </div>
          <button onClick={()=>{SFX.toggle();setUseJointShipping(v=>!v);}} role="switch" aria-checked={useJointShipping} aria-label="Enviar junto com pedidos anteriores desta encomenda" style={{flexShrink:0,width:44,height:26,borderRadius:'var(--r-control)',border:'none',background:useJointShipping?'var(--ok)':'var(--fill)',cursor:'pointer',position:'relative',transition:'background .2s'}}>
            <div style={{position:'absolute',top:3,left:useJointShipping?22:4,width:20,height:20,borderRadius:'var(--r-control)',background:'#fff',transition:'left .2s',boxShadow:'0 1px 4px rgba(var(--sunk),calc(0.3*var(--sunk-a)))'}}/>
          </button>
        </div>
      </div>}

      {/* Já paguei o frete — só aparece se há uma compra ativa nesta encomenda ainda não enviada */}
      {hasUnshippedPaidOrder&&<div style={{marginTop:14,padding:'12px 14px',borderRadius:'var(--r-control)',background:alreadyPaidShipping?'rgba(var(--ok-rgb),0.06)':'var(--text-faint)',border:'1px solid '+(alreadyPaidShipping?'rgba(var(--ok-rgb),0.2)':'var(--line)')}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'var(--sp-2)'}}>
          <div>
            <div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:alreadyPaidShipping?'var(--ok)':'var(--text-dim)',marginBottom:2,display:'flex',alignItems:'center',gap:'var(--sp-1)'}}><CheckCircle size={14} style={{flexShrink:0,color:alreadyPaidShipping?'var(--ok)':'var(--text-faint)'}}/> Já paguei o frete</div>
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',lineHeight:1.4}}>Marque se o frete deste envio já foi pago em um pedido anterior.</div>
          </div>
          <button onClick={()=>{SFX.toggle();setAlreadyPaidShipping(v=>!v);if(useJointShipping)setUseJointShipping(false);}} role="switch" aria-checked={alreadyPaidShipping} aria-label="O frete deste envio já foi pago em um pedido anterior" style={{flexShrink:0,width:44,height:26,borderRadius:'var(--r-control)',border:'none',background:alreadyPaidShipping?'var(--ok)':'var(--text-faint)',cursor:'pointer',position:'relative',transition:'background .2s'}}>
            <div style={{position:'absolute',top:3,left:alreadyPaidShipping?22:4,width:20,height:20,borderRadius:'var(--r-control)',background:'#fff',transition:'left .2s',boxShadow:'0 1px 4px rgba(var(--sunk),calc(0.3*var(--sunk-a)))'}}/>
          </button>
        </div>
      </div>}

      <Btn full variant="ghost" onClick={()=>setStep('review')} style={{marginTop:10}} sfx="nav"><ChevronLeft size={14}/> Voltar para revisão</Btn>
    </Card>}

    <Card id="tut-payment" style={{padding:'var(--sp-4)'}}>
      {payViaBonusFlow?<Btn full variant="success" onClick={finalize} disabled={submitting || !campaignOpen} sfx="">{submitting?<Spin size={16}/>:<><Gift size={18}/> Finalizar pedido bônus</>}</Btn>:
      <><SectionTitle sub={isFullBonus?'Pagamento do frete via Mercado Pago':'Pagamento seguro via Mercado Pago'}>Pagamento</SectionTitle>
      <Btn full onClick={finalize} disabled={submitting||!campaignOpen||(!shippingSkipped&&!selectedFrete)} sfx="">{submitting?<Spin size={16}/>:<><CreditCard size={18}/> Pagar R$ {total.toFixed(2)}</>}</Btn></>}
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
  const isBonus=lastOrder.isFullBonus;
  return(<div style={{display:'flex',flexDirection:'column',gap:'var(--sp-4)',alignItems:'center',textAlign:'center',paddingTop:20}}>
    <div style={{width:72,height:72,borderRadius:'var(--r-sheet)',background:isBonus?'linear-gradient(135deg,var(--ok),var(--pix))':'linear-gradient(135deg,'+theme.primary+','+theme.secondary+')',display:'grid',placeItems:'center',boxShadow:'0 0 36px '+(isBonus?'rgba(var(--ok-rgb),0.3)':theme.glow)}}>{isBonus?<Gift size={32} color="#fff"/>:<Check size={32} color="#fff"/>}</div>
    <div><h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:'var(--fs-xl)'}}>{isBonus?'Pedido Bônus!':'Pedido Registrado!'}</h1><p style={{color:'var(--text-faint)',fontSize:'var(--fs-sm)',margin:'6px 0 0'}}>{isBonus?'Bônus escolhidos':lastOrder.totalPaid+' cartas a R$ '+lastOrder.priceBRL.toFixed(2)}</p></div>
    <div style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)'}}>Pedido salvo no banco de dados.</div>
    <Btn full onClick={()=>nav('home')} sfx="nav"><Home size={16}/> Voltar</Btn>
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

function ProfileView({profile,token,theme,nav,isAdmin,setShowTutorial,onSaveProfile,onLogout,myOrders=[],onReloadOrders,toast:toastFn,campaign,colorMode='dark',onColorModeChange=()=>{}}){
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
  const campColor=campOpen?'var(--ok)':campaign?.status?'var(--gold)':'var(--text-faint)';
  const campLabel=campaign?.status?campaignLabel(campaign.status):'Sem encomenda ativa';

  return(<div className="portal-page portal-profile" style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)'}}>

    {/* Hero card */}
    <div style={{borderRadius:'var(--r-card)',padding:'var(--sp-4)',background:`linear-gradient(135deg,${gT?wa(gT.primary,'22'):'var(--text-faint)'} 0%,rgba(var(--sunk),0) 100%)`,border:`1px solid ${gT?wa(gT.primary,'30'):'var(--line)'}`,position:'relative',overflow:'hidden'}}>
      {gT&&<div style={{position:'absolute',inset:0,background:`radial-gradient(ellipse at 80% 50%,${gT.glow||gT.primary}18 0%,transparent 70%)`,pointerEvents:'none'}}/>}
      <div style={{display:'flex',alignItems:'center',gap:'var(--sp-3)'}}>
        <div style={{width:56,height:56,borderRadius:'var(--r-card)',background:gT?`linear-gradient(135deg,${gT.primary},${gT.secondary})`:'var(--text-faint)',display:'grid',placeItems:'center',fontSize:24,flexShrink:0,boxShadow:gT?`0 0 20px ${gT.glow||gT.primary}40`:'none'}}>
          {guild?'⚔️':'👤'}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:800,fontSize:'var(--fs-lg)',fontFamily:"'Cinzel',serif",overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{profile?.name||'Aventureiro'}</div>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',marginTop:2}}>{guild||'Escolha sua guilda'}</div>
        </div>
        <div style={{textAlign:'right',flexShrink:0}}>
          <div style={{fontSize:'var(--fs-2xs)',color:campColor,fontWeight:700,textTransform:'uppercase',letterSpacing:1}}>{campLabel}</div>
          <div style={{width:8,height:8,borderRadius:4,background:campColor,margin:'4px auto 0',boxShadow:`0 0 6px ${campColor}`}}/>
        </div>
      </div>
    </div>

    {/* Dados pessoais */}
    <ProfileSection title="Dados Pessoais" icon={User} color={theme.primary} defaultOpen={true}>
      <div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)',marginTop:12}}>
        {editName?<>
          <Input icon={User} placeholder="Seu nome" value={nameVal} onChange={e=>setNameVal(e.target.value)}/>
          <Input icon={Phone} placeholder="WhatsApp" value={wppVal} onChange={e=>setWppVal(e.target.value.replace(/\D/g,'').slice(0,11))}/>
          <div style={{display:'flex',gap:'var(--sp-2)'}}>
            <Btn variant="success" onClick={savePessoal} disabled={saving} style={{flex:1}} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar</>}</Btn>
            <Btn variant="ghost" onClick={()=>setEditName(false)} style={{flex:1}} sfx="click">Cancelar</Btn>
          </div>
        </>:<>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginBottom:2}}>Nome</div>
              <div style={{fontSize:14,fontWeight:600}}>{profile?.name||'—'}</div>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginBottom:2}}>WhatsApp</div>
              <div style={{fontSize:14,fontWeight:600}}>{profile?.whatsapp||'—'}</div>
            </div>
            <button onClick={()=>setEditName(true)} style={{background:'var(--fill)',border:'1px solid var(--line)',borderRadius:'var(--r-control)',padding:'6px 10px',cursor:'pointer',color:'var(--text-dim)',display:'flex',alignItems:'center',gap:'var(--sp-1)',fontSize:'var(--fs-2xs)'}}><Edit3 size={12}/> Editar</button>
          </div>
        </>}
      </div>
    </ProfileSection>

    {/* Endereço */}
    <ProfileSection title="Endereço de Entrega" icon={MapPin} color="var(--gold)">
      <div style={{marginTop:12}}>
        {editAddr?<>
          <AddressForm address={addr} setAddress={setAddr} onCalcFrete={()=>{}} frete={null} loadingFrete={false}/>
          <div style={{display:'flex',gap:'var(--sp-2)',marginTop:10}}>
            <Btn variant="success" onClick={saveAddr} disabled={saving} style={{flex:1}} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar</>}</Btn>
            <Btn variant="ghost" onClick={()=>setEditAddr(false)} style={{flex:1}} sfx="click">Cancelar</Btn>
          </div>
        </>:<AddressDisplay address={addr} onEdit={()=>setEditAddr(true)}/>}
      </div>
    </ProfileSection>

    {/* Guilda */}
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

    <ProfileSection title="Guilda & Mana" icon={Sparkles} color="var(--indiv)">
      <div style={{marginTop:12}}>
        <div style={{display:'flex',justifyContent:'center',gap:'var(--sp-3)',margin:'10px 0'}}>{MANA_COLORS.map(m=><ManaOrb key={m.key} mana={m.key} selected={colors.includes(m.key)} onClick={()=>toggleC(m.key)} size={44}/>)}</div>
        {guild&&<div style={{textAlign:'center',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'center',gap:'var(--sp-2)'}}><GuildBadge guild={guild} size={16}/><span style={{fontWeight:700,fontSize:14,color:gT?gT.primary:'var(--text-strong)'}}>{guild}</span></div>}
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
        return(<div key={o.id} style={{borderRadius:'var(--r-control)',border:`1px solid ${isPending?'rgba(var(--gold-rgb),0.2)':isPaid?'rgba(var(--ok-rgb),0.12)':'var(--text-faint)'}`,overflow:'hidden',background:'rgba(var(--sunk),calc(0.2*var(--sunk-a)))',cursor:'pointer'}} onClick={async()=>{const next=isExp?null:o.id;setExpandedOrder(next);if(next!==null&&!o.cards&&!orderCardsCache[String(o.id)]){const cards=await loadOrderCards(o,token);setOrderCardsCache(prev=>({...prev,[String(o.id)]:cards}));}}}>
          <div style={{padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{display:'flex',alignItems:'center',gap:'var(--sp-2)'}}>
              <div style={{width:36,height:36,borderRadius:'var(--r-control)',background:isPaid?'rgba(var(--ok-rgb),0.1)':isPending?'rgba(var(--gold-rgb),0.1)':'var(--text-faint)',display:'grid',placeItems:'center'}}>
                <Package size={15} style={{color:isPaid?'var(--ok)':isPending?'var(--gold)':'var(--text-faint)'}}/>
              </div>
              <div>
                <div style={{fontSize:'var(--fs-xs)',fontWeight:700}}>{Number(o.total_locked)>0?'R$ '+Number(o.total_locked).toFixed(2):'Bônus'}</div>
                <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{o.qty_in_batch} cartas · {new Date(o.created_at).toLocaleDateString('pt-BR')}</div>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'var(--sp-1)'}}>
              <Tag color={isPending?'var(--gold)':isPaid?'var(--ok)':'var(--info)'} style={{fontSize:'var(--fs-2xs)'}}>{isPending?'Pendente':isPaid?'Pago':o.status}</Tag>
              <ChevronRight size={13} style={{color:'var(--text-faint)',transform:isExp?'rotate(90deg)':'none',transition:'transform .2s'}}/>
            </div>
          </div>
          {isExp&&<div style={{padding:'0 14px 12px',borderTop:'1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))'}}>
            {((o.cards&&o.cards.length>0)?o.cards:(orderCardsCache[String(o.id)]||[])).length>0?
              <div style={{marginTop:8}}>{((o.cards&&o.cards.length>0)?o.cards:(orderCardsCache[String(o.id)]||[])).map((c,ci,arr)=>(
                <div key={ci} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:'var(--fs-xs)',borderBottom:ci<arr.length-1?'1px solid rgba(var(--ink),calc(0.03*var(--ink-a)))':'none'}}>
                  <span style={{color:'var(--text-dim)'}}>{c.name} <span style={{color:TC[c.type]||'var(--text-faint)',fontSize:'var(--fs-2xs)',fontWeight:700}}>{c.type||''}</span></span>
                  <span style={{fontWeight:700}}>x{c.qty}</span>
                </div>
              ))}</div>
              :<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginTop:8}}>Detalhes não disponíveis</div>}
            {o.orderKind==='INDIVIDUAL'&&isPaid&&(()=>{
              const idx=indivStageIndex(o.fulfillment_status);
              const trackingCode=o.mandabem_rastreamento||o.mandabem_etiqueta;
              return(<div style={{marginTop:10,padding:'10px 12px',borderRadius:'var(--r-control)',background:'rgba(var(--sunk),calc(0.2*var(--sunk-a)))'}}>
                <div style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--text-faint)',marginBottom:8,textTransform:'uppercase',letterSpacing:1}}>Status do pedido</div>
                <div style={{display:'flex',alignItems:'flex-start'}}>
                  {INDIV_FULFILLMENT_STAGES.map((s,i)=>(<Fragment key={s.key}>
                    {i>0&&<div style={{flex:1,height:2,background:i<=idx?'var(--ok)':'var(--fill)',marginTop:7}}/>}
                    <div style={{display:'flex',flexDirection:'column',alignItems:'center',width:44,flexShrink:0}}>
                      <div style={{width:15,height:15,borderRadius:'var(--r-control)',background:i<=idx?'var(--ok)':'var(--fill)',display:'grid',placeItems:'center'}}>{i<idx?<Check size={9} style={{color:'var(--ok-ink)'}}/>:null}</div>
                      <div style={{fontSize:8,color:i<=idx?'var(--ok)':'var(--text-faint)',marginTop:3,textAlign:'center',lineHeight:1.2}}>{s.short}</div>
                    </div>
                  </Fragment>))}
                </div>
                {trackingCode&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--ok)',marginTop:10}}>Rastreio: {trackingCode}{o.mandabem_status?` · ${o.mandabem_status}`:''}</div>}
              </div>);
            })()}
            {showActions&&isPending&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'var(--sp-2)',marginTop:10}}>
              <Btn variant="warn" onClick={(e)=>{e.stopPropagation();pagarAgoraPedido(o,toastFn);}} style={{width:'100%',fontSize:'var(--fs-2xs)',whiteSpace:'nowrap',justifyContent:'center'}} sfx="nav"><CreditCard size={12}/> Pagar</Btn>
              <Btn variant="ghost" onClick={async(e)=>{e.stopPropagation();try{await mpSync(o.id);onReloadOrders();}catch(err){toastFn('Erro: '+(err.message||String(err)),'error');}}} style={{width:'100%',fontSize:'var(--fs-2xs)',justifyContent:'center'}} sfx=""><RefreshCw size={12}/></Btn>
              <Btn variant="danger" onClick={async(e)=>{e.stopPropagation();if(!confirm('Cancelar este pedido?'))return;try{const res=await fetch('/api/cancel-order',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({batchId:String(o.id),orderId:String(o.order_id||'')})});const j=await res.json().catch(()=>({}));if(!res.ok||!j.ok)throw new Error(j.error||'Falha');toastFn('Pedido cancelado','success');onReloadOrders();}catch(err){toastFn('Erro: '+(err.message||String(err)),'error');}}} style={{width:'100%',fontSize:'var(--fs-2xs)',justifyContent:'center'}} sfx=""><X size={12}/> Cancelar</Btn>
            </div>}
          </div>}
        </div>);
      }
      return(<>
        <ProfileSection title={`Meus Pedidos${activeOrders.length>0?' ('+activeOrders.length+')':''}`} icon={Package} color="var(--info)">
          <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:'var(--sp-1)'}}>
            {activeOrders.length===0?<div style={{fontSize:'var(--fs-sm)',color:'var(--text-faint)',textAlign:'center',padding:'var(--sp-3)'}}>Nenhum pedido ativo</div>:
            activeOrders.map(o=>renderOrder(o,true))}
          </div>
        </ProfileSection>
        {archivedOrders.length>0&&<ProfileSection title={`Arquivados (${archivedOrders.length})`} icon={Archive} color="rgba(var(--ink),calc(0.25*var(--ink-a)))">
          <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:'var(--sp-1)'}}>
            {archivedOrders.map(o=>renderOrder(o,false))}
          </div>
        </ProfileSection>}
      </>);
    })()}

    {/* Senha */}
    <ProfileSection title="Alterar Senha" icon={Lock} color="var(--danger)">
      <div style={{marginTop:12}}>
        {!showChangePw?<Btn full variant="ghost" onClick={()=>setShowChangePw(true)} sfx="click"><Lock size={14}/> Alterar senha</Btn>:<>
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
          </div>
        </>}
      </div>
    </ProfileSection>

    {/* Ações */}
    <div style={{display:'flex',flexDirection:'column',gap:'var(--sp-2)',marginTop:4}}>
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
// ADMIN — console de vendas
//
// Organizado em seções fixas (Visão geral, Pedidos, Envios, Clientes,
// Catálogo, Encomendas, Ajustes). A campanha selecionada é apenas um
// contexto das seções coletivas — não é mais um portão para entrar no
// painel, e os Pedidos Individuais convivem com os coletivos na mesma tela.
// ══════════════════════════════════════════════════════
const CAMPAIGN_STATUSES=['DRAFT','ACTIVE','LOCKED','ORDERING','ORDERED','RECEIVED','PACKING','SHIPPING','DONE','CANCELLED'];
const CAMPAIGN_STATUS_LABELS={DRAFT:'Rascunho',ACTIVE:'Aberta',LOCKED:'Fechada',ORDERING:'Comprando',ORDERED:'Comprada',RECEIVED:'Recebida',PACKING:'Separando',SHIPPING:'Enviando',DONE:'Concluída',CANCELLED:'Cancelada'};

// Pipeline simplificado de importação do Pedido Individual (dropship via AliExpress).
// Só se aplica a orders.kind==='INDIVIDUAL' — a Encomenda Coletiva usa o status da campanha.
const INDIV_FULFILLMENT_STAGES=[
  {key:'AWAITING_SUPPLIER_ORDER',label:'Aguardando compra',short:'Aguardando'},
  {key:'ORDERED_FROM_SUPPLIER',label:'Encomenda feita',short:'Encomendado'},
  {key:'SHIPPED_TO_BR',label:'A caminho do Brasil',short:'A caminho'},
  {key:'ARRIVED_BR',label:'Chegou no Brasil',short:'Chegou'},
  {key:'PREPARING',label:'Em preparação',short:'Preparando'},
  {key:'LABEL_GENERATED',label:'Etiqueta gerada',short:'Enviado'},
];
function indivStageIndex(status){const i=INDIV_FULFILLMENT_STAGES.findIndex(s=>s.key===status);return i<0?0:i;}

const ADMIN_SECTIONS=[
  {key:'overview',icon:LayoutDashboard,label:'Visão geral',sub:'O que precisa de você agora'},
  {key:'orders',icon:ShoppingBag,label:'Pedidos',sub:'Coletiva e individual no mesmo lugar'},
  {key:'shipping',icon:Truck,label:'Envios',sub:'Etiquetas, agrupamento e rastreio'},
  {key:'clients',icon:Users,label:'Clientes',sub:'Contatos, bônus e WhatsApp'},
  {key:'catalog',icon:BookOpen,label:'Catálogo',sub:'Cartas disponíveis para venda'},
  {key:'campaigns',icon:Calendar,label:'Encomendas',sub:'Campanhas coletivas e lista de compra'},
  {key:'settings',icon:Settings,label:'Ajustes',sub:'Preços, notificações e conta'},
];

const PAID_BATCH_STATUSES=new Set(['PAID','PAID_CONFIRMED','CONFIRMED']);
const PENDING_BATCH_STATUSES=new Set(['DRAFT','AWAITING_PAYMENT','PENDING_PAYMENT']);
const isPaidBatch=s=>PAID_BATCH_STATUSES.has(String(s||'').toUpperCase());
const isPendingBatch=s=>PENDING_BATCH_STATUSES.has(String(s||'').toUpperCase());
const isCancelledBatch=s=>String(s||'').toUpperCase()==='CANCELLED';

const brl=v=>'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const brlCompact=v=>{const n=Number(v||0);return n>=1000?'R$ '+(n/1000).toFixed(n>=10000?0:1).replace('.',',')+'k':'R$ '+n.toFixed(0);};
const shortBatchId=id=>String(id||'').slice(0,8).toUpperCase();
const CHANNEL_LABEL={CAMPAIGN:'Coletiva',INDIVIDUAL:'Individual'};

const NOTIF_META={
  NEW_ORDER:{icon:ShoppingBag,color:'var(--gold)',label:'Pedido novo'},
  ORDER_PAID:{icon:Wallet,color:'var(--ok)',label:'Pagamento'},
  BONUS_ORDER:{icon:Gift,color:'var(--ok)',label:'Pedido bônus'},
  LOGIN:{icon:LogIn,color:'var(--info)',label:'Login'},
  SIGNUP:{icon:UserPlus,color:'var(--info)',label:'Nova conta'},
};

function timeAgo(iso){
  if(!iso)return '';
  const diff=Date.now()-new Date(iso).getTime();
  if(!Number.isFinite(diff))return '';
  const min=Math.floor(diff/60000);
  if(min<1)return 'agora';
  if(min<60)return `${min} min`;
  const h=Math.floor(min/60);
  if(h<24)return `${h}h`;
  const d=Math.floor(h/24);
  if(d<7)return `${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

// Mesmo dia civil? Usado nos indicadores de "hoje" da visão geral.
function isToday(iso){
  if(!iso)return false;
  const d=new Date(iso);const now=new Date();
  return d.getDate()===now.getDate()&&d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
}

// ── Blocos visuais do console ─────────────────────────
const AdminStat=({label,value,sub,color,icon:Icon,onClick,accent})=>(
  <Card onClick={onClick} style={{padding:'12px 14px',display:'flex',flexDirection:'column',gap:2,borderLeft:'3px solid '+((accent||color||'rgba(var(--ink),calc(0.12*var(--ink-a)))')+(accent?'':'55'))}}>
    <div style={{display:'flex',alignItems:'center',gap:5,fontSize:'var(--fs-2xs)',color:'var(--text-faint)',fontWeight:600,textTransform:'uppercase',letterSpacing:.6}}>
      {Icon&&<Icon size={11}/>}{label}
    </div>
    <div style={{fontSize:'var(--fs-xl)',fontWeight:800,color:color||'var(--text-strong)',lineHeight:1.1}}>{value}</div>
    {sub&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{sub}</div>}
  </Card>
);

const AdminPanel=({title,sub,icon:Icon,accent,right,children,style})=>(
  <Card style={{padding:16,...style}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10,marginBottom:12}}>
      <div style={{display:'flex',gap:10,alignItems:'flex-start',minWidth:0}}>
        {Icon&&<div style={{width:30,height:30,borderRadius:'var(--r-control)',flexShrink:0,display:'grid',placeItems:'center',background:wa((accent||'var(--gp)'),'14'),border:'1px solid '+wa((accent||'var(--gp)'),'22'),color:accent||'var(--gp)'}}><Icon size={15}/></div>}
        <div style={{minWidth:0}}>
          <h2 style={{margin:0,fontSize:'var(--fs-md)',fontFamily:"'Cinzel',serif",color:'var(--text-strong)',letterSpacing:.3}}>{title}</h2>
          {sub&&<p style={{margin:'3px 0 0',fontSize:'var(--fs-2xs)',color:'var(--text-faint)',lineHeight:1.45}}>{sub}</p>}
        </div>
      </div>
      {right&&<div style={{flexShrink:0}}>{right}</div>}
    </div>
    {children}
  </Card>
);

// Pílulas de filtro/sub-navegação reutilizadas por várias seções.
const AdminPills=({options,value,onChange,style})=>(
  <div style={{display:'flex',gap:4,flexWrap:'wrap',...style}}>
    {options.map(opt=>{
      const active=value===opt.key;
      const color=opt.color||'var(--gp)';
      return(<button key={opt.key} onClick={()=>{SFX.toggle();onChange(opt.key);}} style={{display:'inline-flex',alignItems:'center',gap:5,padding:'6px 11px',borderRadius:'var(--r-pill)',border:'1px solid '+(active?wa(color,'45'):'rgba(var(--ink),calc(0.06*var(--ink-a)))'),background:active?wa(color,'16'):'rgba(var(--ink),calc(0.022*var(--ink-a)))',color:active?color:'var(--text-faint)',fontSize:'var(--fs-2xs)',fontWeight:700,cursor:'pointer',fontFamily:"'Outfit',sans-serif",whiteSpace:'nowrap'}}>
        {opt.icon&&<opt.icon size={11}/>}{opt.label}{opt.count!==undefined&&<span style={{fontSize:'var(--fs-2xs)',opacity:.65}}>({opt.count})</span>}
      </button>);
    })}
  </div>
);

const AdminField=({label,hint,children})=>(
  <div style={{marginBottom:10}}>
    <label style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',display:'block',marginBottom:4,fontWeight:600}}>{label}</label>
    {children}
    {hint&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginTop:3,lineHeight:1.45}}>{hint}</div>}
  </div>
);

const adminInputStyle={width:'100%',padding:'9px 12px',borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',color:'var(--text-strong)',fontSize:'var(--fs-sm)',fontFamily:"'Outfit',sans-serif",outline:'none',boxSizing:'border-box'};

// Linha "isso aqui precisa de você" da visão geral.
const AdminTodo=({icon:Icon,color,title,detail,actionLabel,onAction})=>(
  <div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:'1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))'}}>
    <div style={{width:26,height:26,borderRadius:'var(--r-control)',flexShrink:0,display:'grid',placeItems:'center',background:wa(color,'14'),color}}><Icon size={13}/></div>
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:'var(--fs-xs)',fontWeight:700}}>{title}</div>
      <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{detail}</div>
    </div>
    {onAction&&<button onClick={onAction} style={{flexShrink:0,display:'inline-flex',alignItems:'center',gap:3,background:'var(--fill)',border:'1px solid var(--line)',borderRadius:'var(--r-control)',padding:'5px 9px',color:'var(--text-muted)',fontSize:'var(--fs-2xs)',fontWeight:700,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>{actionLabel||'Abrir'} <ChevronRight size={11}/></button>}
  </div>
);

// Trilha de status do Pedido Individual (compra no fornecedor → etiqueta).
const IndivStageTrack=({status})=>{
  const idx=indivStageIndex(status);
  return(<div style={{display:'flex',alignItems:'center',gap:3,marginTop:6}}>
    {INDIV_FULFILLMENT_STAGES.map((stage,i)=>(
      <div key={stage.key} title={stage.label} style={{flex:1,height:3,borderRadius:2,background:i<=idx?(i>=5?'var(--ok)':'var(--gp)'):'rgba(var(--ink),calc(0.07*var(--ink-a)))'}}/>
    ))}
  </div>);
};

// ── Central de notificações ───────────────────────────
// Feed de eventos (pedidos novos, pagamentos, logins) gravados por
// /api/admin-notifications. O push do celular é a mesma fonte de dados.
function AdminNotificationFeed({notifications,loading,unread,onRefresh,onMarkAll,onClear,onOpenEvent,compact=false,limit}){
  const list=limit?notifications.slice(0,limit):notifications;
  return(<div style={{display:'flex',flexDirection:'column'}}>
    {!compact&&<div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
      <Btn variant="secondary" onClick={onRefresh} disabled={loading} style={{padding:'6px 11px',fontSize:'var(--fs-2xs)'}} sfx="click">{loading?<Spin size={12}/>:<RefreshCw size={12}/>} Atualizar</Btn>
      <Btn variant="secondary" onClick={onMarkAll} disabled={!unread} style={{padding:'6px 11px',fontSize:'var(--fs-2xs)'}} sfx=""><CheckCircle size={12}/> Marcar tudo lido</Btn>
      <Btn variant="ghost" onClick={onClear} style={{padding:'6px 11px',fontSize:'var(--fs-2xs)'}} sfx=""><Trash2 size={12}/> Limpar lidas</Btn>
    </div>}
    {loading&&list.length===0?<div style={{textAlign:'center',padding:24}}><Spin size={20}/></div>:
    list.length===0?<EmptyState icon={Inbox} title="Nada por aqui" sub="Pedidos novos e logins aparecem nesta lista"/>:
    list.map(n=>{
      const meta=NOTIF_META[n.type]||{icon:Bell,color:'var(--text-dim)',label:n.type};
      const isUnread=!n.read_at;
      return(<div key={n.id} onClick={()=>onOpenEvent&&onOpenEvent(n)} style={{display:'flex',gap:10,alignItems:'flex-start',padding:'9px 0',borderBottom:'1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))',cursor:onOpenEvent?'pointer':'default',opacity:isUnread?1:0.55}}>
        <div style={{width:28,height:28,borderRadius:'var(--r-control)',flexShrink:0,display:'grid',placeItems:'center',background:wa(meta.color,'14'),color:meta.color}}><meta.icon size={13}/></div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:'var(--fs-xs)',fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{n.title}</span>
            {isUnread&&<span style={{width:6,height:6,borderRadius:3,background:meta.color,flexShrink:0}}/>}
          </div>
          {n.body&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginTop:1,lineHeight:1.4}}>{n.body}</div>}
        </div>
        <span style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',flexShrink:0,marginTop:2}}>{timeAgo(n.created_at)}</span>
      </div>);
    })}
  </div>);
}

// Ativação do push neste aparelho. A permissão só pode ser pedida dentro de
// um clique, então tudo aqui parte de um botão.
function AdminPushSettings({token,toast:toastFn}){
  const [state,setState]=useState(null);
  const [busy,setBusy]=useState('');

  async function refresh(){
    try{setState(await getPushState(token));}
    catch(e){console.warn('push state:',e);setState(s=>s||{supported:false,reason:'unsupported'});}
  }
  useEffect(()=>{refresh();},[token]);

  async function handleEnable(){
    setBusy('enable');
    try{
      await enablePush(token,state?.prefs);
      SFX.success();if(toastFn)toastFn('Notificações ativadas neste aparelho','success');
      await refresh();
    }catch(e){if(toastFn)toastFn(e.message||String(e),'error');}
    setBusy('');
  }

  async function handleDisable(){
    setBusy('disable');
    try{await disablePush(token);if(toastFn)toastFn('Notificações desligadas neste aparelho','success');await refresh();}
    catch(e){if(toastFn)toastFn(e.message||String(e),'error');}
    setBusy('');
  }

  async function togglePref(key){
    if(!state?.endpoint)return;
    const next={...state.prefs,[key]:!state.prefs[key]};
    setState(s=>({...s,prefs:next}));
    try{await updatePushPrefs(token,state.endpoint,next);}
    catch(e){if(toastFn)toastFn('Não foi possível salvar a preferência','error');await refresh();}
  }

  async function handleTest(){
    setBusy('test');
    try{await sendTestPush(token,state.endpoint);if(toastFn)toastFn('Push de teste enviado','success');}
    catch(e){if(toastFn)toastFn(e.message||String(e),'error');}
    setBusy('');
  }

  if(!state)return <div style={{textAlign:'center',padding:16}}><Spin size={18}/></div>;

  if(!state.supported)return(<div style={{fontSize:'var(--fs-xs)',color:'var(--text-dim)',lineHeight:1.6}}>
    {state.reason===PUSH_NEEDS_INSTALL
      ? <>No iPhone/iPad o push só funciona com o portal <b style={{color:'var(--text-strong)'}}>instalado na tela de início</b>. Abra o site no Safari, toque em <b style={{color:'var(--text-strong)'}}>Compartilhar → Adicionar à Tela de Início</b> e ative as notificações por dentro do app instalado.</>
      : <>Este navegador não suporta notificações push. Abra o portal no Chrome (Android/desktop) ou no app instalado do iPhone.</>}
  </div>);

  if(!state.serverConfigured)return(<div style={{fontSize:'var(--fs-xs)',color:'var(--gold)',lineHeight:1.6}}>
    O servidor ainda não tem as chaves VAPID. Rode <b style={{fontFamily:'monospace'}}>node scripts/generate-vapid-keys.mjs</b> e cadastre <b style={{fontFamily:'monospace'}}>VAPID_PUBLIC_KEY</b>, <b style={{fontFamily:'monospace'}}>VAPID_PRIVATE_KEY</b> e <b style={{fontFamily:'monospace'}}>VAPID_SUBJECT</b> nas variáveis do Cloudflare Pages.
  </div>);

  return(<div style={{display:'flex',flexDirection:'column',gap:10}}>
    <div style={{display:'flex',alignItems:'center',gap:9}}>
      <div style={{width:32,height:32,borderRadius:'var(--r-control)',display:'grid',placeItems:'center',background:state.subscribed?'rgba(var(--ok-rgb),0.1)':'rgba(var(--ink),calc(0.04*var(--ink-a)))',color:state.subscribed?'var(--ok)':'rgba(var(--ink),calc(0.3*var(--ink-a)))'}}>{state.subscribed?<BellRing size={15}/>:<BellOff size={15}/>}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:state.subscribed?'var(--ok)':'rgba(var(--ink),calc(0.6*var(--ink-a)))'}}>{state.subscribed?'Este aparelho recebe notificações':'Notificações desligadas neste aparelho'}</div>
        <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{state.permission==='denied'?'Permissão bloqueada nas configurações do navegador':'Cada aparelho é ativado separadamente'}</div>
      </div>
    </div>

    {state.subscribed&&<div style={{display:'flex',flexDirection:'column',gap:6}}>
      {[{k:'newOrders',label:'Pedidos novos e pagamentos',icon:ShoppingBag},{k:'logins',label:'Logins e novas contas',icon:LogIn}].map(({k,label,icon:Icon})=>(
        <label key={k} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:'var(--r-control)',background:'var(--fill-soft)',cursor:'pointer',fontSize:'var(--fs-xs)'}}>
          <input type="checkbox" checked={!!state.prefs[k]} onChange={()=>togglePref(k)} style={{cursor:'pointer'}}/>
          <Icon size={13} style={{color:'var(--text-faint)'}}/>
          <span style={{color:'var(--text-muted)'}}>{label}</span>
        </label>
      ))}
    </div>}

    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
      {!state.subscribed
        ? <Btn variant="success" onClick={handleEnable} disabled={busy==='enable'||state.permission==='denied'} style={{padding:'8px 13px',fontSize:'var(--fs-xs)'}} sfx="">{busy==='enable'?<Spin size={13}/>:<><Bell size={13}/> Ativar neste aparelho</>}</Btn>
        : <>
            <Btn variant="secondary" onClick={handleTest} disabled={busy==='test'} style={{padding:'8px 13px',fontSize:'var(--fs-xs)'}} sfx="">{busy==='test'?<Spin size={13}/>:<><Zap size={13}/> Enviar teste</>}</Btn>
            <Btn variant="ghost" onClick={handleDisable} disabled={busy==='disable'} style={{padding:'8px 13px',fontSize:'var(--fs-xs)'}} sfx=""><BellOff size={13}/> Desligar</Btn>
          </>}
    </div>
    {state.permission==='denied'&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--gold)',lineHeight:1.5}}>A permissão foi negada. Libere as notificações do site nas configurações do navegador/aparelho e volte aqui.</div>}
  </div>);
}

function AdminPage({pool,pricing:pricingProp,campaign:campProp,theme,token,nav,onReload,toast:toastFn,initialSection}){
  // ── Navegação do console ────────────────────────────
  const validSection=key=>ADMIN_SECTIONS.some(s=>s.key===key)?key:null;
  const [section,setSection]=useState(()=>validSection(initialSection)||'overview');
  const [showNotifications,setShowNotifications]=useState(initialSection==='notifications');
  // Um push clicado com o console já aberto troca a seção em exibição.
  useEffect(()=>{
    if(!initialSection)return;
    if(initialSection==='notifications'){setShowNotifications(true);return;}
    const target=validSection(initialSection);
    if(target)setSection(target);
  },[initialSection]);

  // ── Dados ───────────────────────────────────────────
  const [campaigns,setCampaigns]=useState([]);
  const [selectedCampaign,setSelectedCampaign]=useState(campProp||null);
  const [orders,setOrders]=useState([]);
  const [indivOrders,setIndivOrders]=useState([]);
  const [allProfiles,setAllProfiles]=useState([]);
  const [loading,setLoading]=useState(true);
  const [ordersLoading,setOrdersLoading]=useState(false);
  const [indivLoading,setIndivLoading]=useState(false);
  const [saving,setSaving]=useState(false);

  // ── Notificações ────────────────────────────────────
  const [notifications,setNotifications]=useState([]);
  const [notifUnread,setNotifUnread]=useState(0);
  const [notifLoading,setNotifLoading]=useState(false);

  // ── Encomendas (campanhas) ──────────────────────────
  const [archiving,setArchiving]=useState(false);
  const [showArchiveConfirm,setShowArchiveConfirm]=useState(false);
  const [showCreateForm,setShowCreateForm]=useState(false);
  const [newCamp,setNewCamp]=useState({name:'',status:'DRAFT',close_at:'',max_cards:null,min_cards:150});
  const [creating,setCreating]=useState(false);
  const [editCamp,setEditCamp]=useState(campProp?{...campProp}:{});

  // ── Catálogo: importação via CSV do fornecedor ──────
  const [importCsv,setImportCsv]=useState('');
  const [importFileName,setImportFileName]=useState('');
  const [importPreview,setImportPreview]=useState(null);
  const [importDeactivate,setImportDeactivate]=useState(true);
  const [importing,setImporting]=useState(false);
  const [importResult,setImportResult]=useState(null);

  // ── Catálogo: cartas avulsas por link de imagem ─────
  const [linkListText,setLinkListText]=useState('');
  const [linkPreview,setLinkPreview]=useState(null);
  const [linkAdding,setLinkAdding]=useState(false);
  const [linkResult,setLinkResult]=useState(null);
  const [linkTcg,setLinkTcg]=useState('Magic');
  const [linkType,setLinkType]=useState('Normal');
  const linkTypeOptions=(TCG_LIST.find(t=>t.key===linkTcg)?.types||[]).filter(t=>t!=='Todos');

  // ── Preços ──────────────────────────────────────────
  const [editPricing,setEditPricing]=useState(pricingProp?{...pricingProp}:{});
  const [indivCfg,setIndivCfg]=useState(null);
  const [indivTiers,setIndivTiers]=useState([]);
  const [indivFx,setIndivFx]=useState(null);
  const [savingIndiv,setSavingIndiv]=useState(false);
  const [settingsTab,setSettingsTab]=useState('prices');

  // ── Pedidos ─────────────────────────────────────────
  const [orderView,setOrderView]=useState('list'); // 'list' | 'supplier'
  const [channelFilter,setChannelFilter]=useState('ALL');
  const [ordStatusFilter,setOrdStatusFilter]=useState('ALL');
  const [ordSort,setOrdSort]=useState('date_desc');
  const [searchOrders,setSearchOrders]=useState('');
  const [expandedOrdBatch,setExpandedOrdBatch]=useState(null);
  const [batchCards,setBatchCards]=useState({});
  const [busyBatch,setBusyBatch]=useState(null);
  const [supplierFilter,setSupplierFilter]=useState('PENDING');

  // ── Clientes ────────────────────────────────────────
  const [expandedClient,setExpandedClient]=useState(null);
  const [expandedBatch,setExpandedBatch]=useState(null);
  const [searchOrd,setSearchOrd]=useState('');
  const [clientActiveFilter,setClientActiveFilter]=useState(false);
  const [adminBonusGrants,setAdminBonusGrants]=useState([]);
  const [bonusLoading,setBonusLoading]=useState(false);
  const [bonusForm,setBonusForm]=useState({userId:null,qty:1});
  const [whatsappAudience,setWhatsappAudience]=useState(WHATSAPP_AUDIENCES.BUYERS);
  const [whatsappMessages,setWhatsappMessages]=useState(DEFAULT_WHATSAPP_MESSAGES);
  const [whatsappContacted,setWhatsappContacted]=useState(()=>new Set());

  // ── Envios / etiquetas ──────────────────────────────
  const [shippingTab,setShippingTab]=useState('CAMPAIGN');
  const [labelLoading,setLabelLoading]=useState({});
  const [labelSelected,setLabelSelected]=useState(()=>new Set());
  const [labelStatus,setLabelStatus]=useState({});
  const [labelExpanded,setLabelExpanded]=useState(null);

  // ── Lista de compra ─────────────────────────────────
  const [finalList,setFinalList]=useState([]);
  const [listLoading,setListLoading]=useState(false);
  const [copied,setCopied]=useState(false);
  const [zoomSrc,setZoomSrc]=useState(null);

  // ─── Carregamento ──────────────────────────────────
  useEffect(()=>{loadCampaigns();loadIndivOrders();loadNotifications();loadAllProfiles();},[]);
  useEffect(()=>{if(pricingProp)setEditPricing({...pricingProp});},[pricingProp]);
  useEffect(()=>{if(campProp&&!selectedCampaign)setSelectedCampaign(campProp);},[campProp]);

  useEffect(()=>{
    let alive=true;
    fetch('/api/pricing-individual',{method:'GET'}).then(r=>r.json()).then(d=>{
      if(!alive||!d||!d.ok)return;
      setIndivCfg(d.pricing||{});
      setIndivTiers((d.tiers||[]).slice().sort((a,b)=>Number(a.min_qty)-Number(b.min_qty)));
      setIndivFx(d.fx||null);
    }).catch(e=>console.warn('admin pricing-individual:',e));
    return ()=>{alive=false;};
  },[]);

  useEffect(()=>{
    if(selectedCampaign){loadOrders();loadBonusGrants();setEditCamp({...selectedCampaign});}
    else{setOrders([]);setOrdersLoading(false);setAdminBonusGrants([]);}
  },[selectedCampaign?.id]);

  // Notificações novas chegam por push; aqui garantimos que a tela acompanhe
  // quem já está com o painel aberto.
  useEffect(()=>{
    const id=setInterval(()=>{loadNotifications(true);},60000);
    return ()=>clearInterval(id);
  },[]);

  async function apiPost(path,body){
    const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(body||{})});
    const json=await r.json().catch(()=>({}));
    if(!r.ok||json.ok===false)throw new Error(json.error||`HTTP ${r.status}`);
    return json;
  }

  async function loadCampaigns(){
    try{const r=await fetch('/api/campaigns',{method:'GET'});const data=await r.json();
      const list=Array.isArray(data)?data:[];
      setCampaigns(list);
      // Sem campanha vinda do app: assume a mais recente ainda aberta.
      setSelectedCampaign(prev=>prev||list.find(c=>c.status!=='DONE'&&c.status!=='CANCELLED')||null);
    }catch(e){console.error(e);}finally{setLoading(false);}
  }

  async function loadOrders(){
    if(!selectedCampaign)return;
    setOrdersLoading(true);
    try{setOrders((await apiPost('/api/admin-orders',{campaignId:selectedCampaign.id})).orders||[]);}
    catch(e){console.error(e);if(toastFn)toastFn('Erro ao carregar pedidos: '+(e.message||String(e)),'error');}
    setOrdersLoading(false);
  }

  async function loadIndivOrders(){
    setIndivLoading(true);
    try{setIndivOrders((await apiPost('/api/admin-individual-orders')).orders||[]);}
    catch(e){console.error(e);if(toastFn)toastFn('Erro ao carregar pedidos individuais: '+(e.message||String(e)),'error');}
    setIndivLoading(false);
  }

  async function loadAllProfiles(){
    try{setAllProfiles((await apiPost('/api/admin-profiles')).profiles||[]);}
    catch(e){console.warn('loadAllProfiles error:',e);}
  }

  async function loadNotifications(silent=false){
    if(!silent)setNotifLoading(true);
    try{
      const json=await apiPost('/api/admin-notifications',{action:'list',limit:60});
      setNotifications(json.notifications||[]);setNotifUnread(json.unread||0);
    }catch(e){if(!silent)console.warn('loadNotifications:',e);}
    if(!silent)setNotifLoading(false);
  }

  async function markAllNotificationsRead(){
    try{await apiPost('/api/admin-notifications',{action:'readAll'});await loadNotifications();}
    catch(e){if(toastFn)toastFn('Erro ao marcar como lido: '+(e.message||String(e)),'error');}
  }

  async function clearReadNotifications(){
    try{await apiPost('/api/admin-notifications',{action:'clear'});await loadNotifications();}
    catch(e){if(toastFn)toastFn('Erro ao limpar: '+(e.message||String(e)),'error');}
  }

  // Clicar num evento leva para o lugar certo do console.
  async function openNotification(n){
    if(!n.read_at){apiPost('/api/admin-notifications',{action:'read',ids:[n.id]}).then(()=>loadNotifications(true)).catch(()=>{});}
    if(n.type==='LOGIN'||n.type==='SIGNUP'){setSection('clients');setSearchOrd(n.data?.name||'');}
    else{setSection('orders');setChannelFilter('ALL');setOrdStatusFilter('ALL');setSearchOrders(n.data?.shortId||'');}
    setShowNotifications(false);
  }

  async function loadBonusGrants(){
    if(!selectedCampaign)return;
    setBonusLoading(true);
    try{setAdminBonusGrants((await apiPost('/api/admin-bonus',{action:'list',campaignId:selectedCampaign.id})).grants||[]);}
    catch(e){console.error(e);if(toastFn)toastFn('Erro ao carregar bônus: '+(e.message||String(e)),'error');}
    setBonusLoading(false);
  }

  async function reloadAll(){
    await Promise.all([loadOrders(),loadIndivOrders(),loadNotifications(),loadCampaigns()]);
    if(onReload)onReload();
  }

  // ─── Dados derivados ───────────────────────────────
  // Lotes da encomenda coletiva selecionada.
  const campaignBatches=useMemo(()=>{
    const list=[];
    orders.forEach(o=>{(o.order_batches||[]).forEach(b=>{
      list.push({...b,channel:'CAMPAIGN',orderId:o.id,userId:o.user_id,clientName:o.profiles?.name||'—',clientWhatsapp:o.profiles?.whatsapp||'',clientEmail:o.profiles?.email||'',qtyPaid:o.qty_paid||0,qtyBonus:o.qty_bonus||0,orderCreatedAt:o.created_at,shippingPriceLocked:o.shipping_price_brl_locked,campaignName:selectedCampaign?.name||''});
    });});
    return list;
  },[orders,selectedCampaign]);

  // Lotes (já pagos) dos pedidos individuais — independem de campanha.
  const individualBatches=useMemo(()=>{
    const list=[];
    indivOrders.forEach(o=>{(o.order_batches||[]).forEach(b=>{
      list.push({...b,channel:'INDIVIDUAL',orderId:o.id,userId:o.user_id,clientName:o.profiles?.name||'—',clientWhatsapp:o.profiles?.whatsapp||'',clientEmail:o.profiles?.email||'',orderCreatedAt:o.created_at,campaignName:''});
    });});
    return list;
  },[indivOrders]);

  const allBatches=useMemo(()=>[...campaignBatches,...individualBatches],[campaignBatches,individualBatches]);

  const batchDateOf=b=>b.confirmed_at||b.created_at||b.orderCreatedAt;

  const stats=useMemo(()=>{
    const build=list=>{
      const paid=list.filter(b=>isPaidBatch(b.status));
      const pending=list.filter(b=>isPendingBatch(b.status));
      const cancelled=list.filter(b=>isCancelledBatch(b.status));
      return{
        total:list.length,paidCount:paid.length,pendingCount:pending.length,cancelledCount:cancelled.length,
        revenue:paid.reduce((s,b)=>s+Number(b.total_locked||0),0),
        pendingRevenue:pending.reduce((s,b)=>s+Number(b.total_locked||0),0),
        cards:paid.reduce((s,b)=>s+Number(b.qty_in_batch||0),0),
        paidToday:paid.filter(b=>isToday(batchDateOf(b))).length,
        revenueToday:paid.filter(b=>isToday(batchDateOf(b))).reduce((s,b)=>s+Number(b.total_locked||0),0),
      };
    };
    return {all:build(allBatches),campaign:build(campaignBatches),individual:build(individualBatches)};
  },[allBatches,campaignBatches,individualBatches]);

  const filteredBatches=useMemo(()=>{
    let list=allBatches;
    if(channelFilter!=='ALL')list=list.filter(b=>b.channel===channelFilter);
    if(ordStatusFilter==='PAID')list=list.filter(b=>isPaidBatch(b.status));
    else if(ordStatusFilter==='AWAITING_PAYMENT')list=list.filter(b=>isPendingBatch(b.status));
    else if(ordStatusFilter==='CANCELLED')list=list.filter(b=>isCancelledBatch(b.status));
    if(searchOrders){
      const q=searchOrders.toLowerCase();
      list=list.filter(b=>b.clientName.toLowerCase().includes(q)||String(b.clientEmail||'').toLowerCase().includes(q)||shortBatchId(b.id).includes(q.toUpperCase())||String(b.mp_payment_id||'').includes(q));
    }
    const sorted=[...list];
    if(ordSort==='date_desc')sorted.sort((a,b)=>new Date(batchDateOf(b))-new Date(batchDateOf(a)));
    else if(ordSort==='date_asc')sorted.sort((a,b)=>new Date(batchDateOf(a))-new Date(batchDateOf(b)));
    else if(ordSort==='value_desc')sorted.sort((a,b)=>Number(b.total_locked||0)-Number(a.total_locked||0));
    else if(ordSort==='value_asc')sorted.sort((a,b)=>Number(a.total_locked||0)-Number(b.total_locked||0));
    return sorted;
  },[allBatches,channelFilter,ordStatusFilter,searchOrders,ordSort]);

  // Compras no fornecedor: pedidos individuais agrupados por dia de pagamento
  // (o admin compra tudo do dia de uma vez no AliExpress).
  const supplierGroups=useMemo(()=>{
    const groups=new Map();
    individualBatches.forEach(b=>{
      const ts=b.confirmed_at||b.created_at;
      const dayKey=ts?new Date(ts).toLocaleDateString('pt-BR'):'—';
      if(!groups.has(dayKey))groups.set(dayKey,{dayKey,ts:ts?new Date(ts).getTime():0,batches:[]});
      groups.get(dayKey).batches.push(b);
    });
    return [...groups.values()].sort((a,b)=>b.ts-a.ts);
  },[individualBatches]);

  const visibleSupplierGroups=useMemo(()=>supplierFilter==='ALL'?supplierGroups:supplierGroups.filter(g=>g.batches.some(b=>b.fulfillment_status!=='LABEL_GENERATED')),[supplierGroups,supplierFilter]);

  const clientGroups=useMemo(()=>{
    const groups={};
    const attach=(o,channel)=>{
      const allB=(o.order_batches||[]);
      if(allB.length===0)return;
      const key=o.user_id;
      if(!groups[key])groups[key]={userId:o.user_id,name:o.profiles?.name||'—',whatsapp:o.profiles?.whatsapp||'',email:o.profiles?.email||'',orders:[],totalCards:0,hasOrder:true,hasActiveOrder:false,hasPaidOrder:false};
      groups[key].hasOrder=true;
      groups[key].orders.push({...o,order_batches:allB,channel});
      groups[key].totalCards+=allB.reduce((s,b)=>s+(b.qty_in_batch||0),0);
      if(allB.some(b=>b.status&&!isCancelledBatch(b.status)))groups[key].hasActiveOrder=true;
      if(allB.some(b=>isPaidBatch(b.status)))groups[key].hasPaidOrder=true;
    };
    orders.forEach(o=>attach(o,'CAMPAIGN'));
    indivOrders.forEach(o=>attach(o,'INDIVIDUAL'));
    allProfiles.forEach(p=>{
      if(!groups[p.id]&&!p.is_admin)groups[p.id]={userId:p.id,name:p.name||'—',whatsapp:p.whatsapp||'',email:p.email||'',orders:[],totalCards:0,hasOrder:false,hasActiveOrder:false,hasPaidOrder:false};
    });
    return Object.values(groups).sort((a,b)=>b.hasActiveOrder-a.hasActiveOrder||b.hasOrder-a.hasOrder||a.name.localeCompare(b.name));
  },[orders,indivOrders,allProfiles]);

  const filteredClients=useMemo(()=>{
    let list=clientGroups;
    if(clientActiveFilter)list=list.filter(c=>c.hasActiveOrder);
    if(searchOrd){const q=searchOrd.toLowerCase();list=list.filter(c=>c.name.toLowerCase().includes(q)||c.whatsapp.toLowerCase().includes(q)||c.email.toLowerCase().includes(q)||c.orders.some(o=>String(o.id).toLowerCase().includes(q)||o.order_batches?.some(b=>shortBatchId(b.id).includes(q.toUpperCase()))));}
    return list;
  },[clientGroups,clientActiveFilter,searchOrd]);

  const whatsappRecipients=useMemo(()=>getWhatsAppRecipients(clientGroups,whatsappAudience),[clientGroups,whatsappAudience]);
  const whatsappMissingCount=useMemo(()=>{
    const audienceClients=whatsappAudience===WHATSAPP_AUDIENCES.BUYERS?clientGroups.filter(c=>c.hasPaidOrder):clientGroups;
    return audienceClients.filter(c=>!c.whatsapp).length;
  },[clientGroups,whatsappAudience]);
  const whatsappContactKey=client=>`${selectedCampaign?.id||'campaign'}:${whatsappAudience}:${client.userId}`;
  const nextWhatsappRecipient=whatsappRecipients.find(client=>!whatsappContacted.has(whatsappContactKey(client)));

  // Grupos de etiqueta da coletiva — um item por grupo de frete pago.
  const labelGroups=useMemo(()=>{
    return buildShippingGroups(campaignBatches).map(group=>{
      const root=group.rootBatch||{};
      const addr=root.shipping_address||{};
      const profileData=allProfiles.find(p=>p.id===root.userId)||{};
      return {...group,
        clientName:root.clientName||addr.name||'—',
        email:addr.email||profileData.email||'',
        whatsapp:root.clientWhatsapp||profileData.whatsapp||'',
        userId:root.userId,
        address:{cep:addr.cep||'',rua:addr.rua||'',numero:addr.numero||'',complemento:addr.complemento||'',bairro:addr.bairro||'',cidade:addr.cidade||'',uf:addr.uf||''},
      };
    }).sort((a,b)=>{
      if(!a.hasLabel&&b.hasLabel)return -1;
      if(a.hasLabel&&!b.hasLabel)return 1;
      return a.clientName.localeCompare(b.clientName);
    });
  },[campaignBatches,allProfiles]);

  // Individuais prontos para etiqueta (ou já etiquetados).
  const individualShipments=useMemo(()=>individualBatches.filter(b=>['PREPARING','LABEL_GENERATED'].includes(b.fulfillment_status)).sort((a,b)=>indivStageIndex(a.fulfillment_status)-indivStageIndex(b.fulfillment_status)||a.clientName.localeCompare(b.clientName)),[individualBatches]);

  const identifyingLabelGroups=useRef(new Set());
  useEffect(()=>{
    if(section!=='shipping'||shippingTab!=='CAMPAIGN')return;
    const pending=labelGroups.filter(group=>(!group.shippingService||(group.hasLabel&&!group.hasCompleteLabel))&&!identifyingLabelGroups.current.has(group.key));
    if(!pending.length)return;
    pending.forEach(async group=>{
      identifyingLabelGroups.current.add(group.key);
      try{
        await apiPost('/api/admin-mandabem-label',{action:group.hasLabel?'refresh':'identify',rootBatchId:group.rootId,batchIds:group.batches.map(batch=>batch.id)});
        await loadOrders();
      }catch(error){console.error('Shipping service identification error:',error);}
      finally{identifyingLabelGroups.current.delete(group.key);}
    });
  },[section,shippingTab,labelGroups,token]);

  const minCards=selectedCampaign?.min_cards||150;
  const isViableAdmin=pool>=minCards;
  const isFinalized=selectedCampaign?.status==='DONE'||selectedCampaign?.status==='CANCELLED';
  const activeCampaigns=campaigns.filter(c=>c.status!=='DONE'&&c.status!=='CANCELLED');
  const finalizedCampaigns=campaigns.filter(c=>c.status==='DONE'||c.status==='CANCELLED');

  // Pendências que a Visão geral cobra do admin.
  const pendingLabelCount=labelGroups.filter(g=>!g.hasLabel).length;
  const supplierPendingCount=individualBatches.filter(b=>indivStageIndex(b.fulfillment_status)<4).length;
  const awaitingPaymentCount=stats.all.pendingCount;
  const indivToPrepareCount=individualBatches.filter(b=>b.fulfillment_status==='PREPARING').length;

  // ─── Ações de pedido ───────────────────────────────
  async function loadBatchCards(batchId){
    if(batchCards[batchId])return;
    try{
      const json=await apiPost('/api/admin-batch-items',{batchIds:[batchId]});
      setBatchCards(prev=>({...prev,[batchId]:(json.items||[]).map(i=>({name:i.cards?.name||'Carta',type:i.cards?.type||'',qty:Number(i.quantity||1),image_url:i.cards?.image_url||null}))}));
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao carregar itens: '+(e.message||String(e)),'error');}
  }

  async function cancelBatch(batchId,isPaid){
    const msg=isPaid?'Cancelar pedido pago? O reembolso deve ser feito manualmente no Mercado Pago.':'Cancelar este pedido pendente?';
    if(!confirm(msg))return;
    try{await apiPost('/api/admin-cancel-batch',{batchId});SFX.success();await reloadAll();}
    catch(e){console.error(e);if(toastFn)toastFn('Erro ao cancelar: '+(e.message||String(e)),'error');}
  }

  async function markBatchPaid(batchId){
    if(!confirm('Marcar este pedido como PAGO manualmente?'))return;
    try{await apiPost('/api/admin-mark-paid',{batchId});SFX.success();await reloadAll();}
    catch(e){console.error(e);if(toastFn)toastFn('Erro ao marcar como pago: '+(e.message||String(e)),'error');}
  }

  async function syncBatchMP(batchId){
    try{await mpSync(batchId);SFX.success();await reloadAll();}
    catch(e){console.error('Sync error:',e);if(toastFn)toastFn('Erro ao sincronizar com o Mercado Pago','error');}
  }

  // Avança o estágio de importação de um ou vários lotes individuais.
  async function setFulfillment(batchIds,status,busyId){
    setBusyBatch(busyId);
    try{await apiPost('/api/admin-update-fulfillment',{batchIds,fulfillmentStatus:status});SFX.success();await loadIndivOrders();}
    catch(e){console.error(e);if(toastFn)toastFn('Erro ao atualizar status: '+(e.message||String(e)),'error');}
    setBusyBatch(null);
  }

  // Etiqueta de um pedido individual (não agrupa: cada pedido vai sozinho).
  async function generateIndividualLabel(batch){
    let formaEnvio=batch.shipping_service&&batch.shipping_service!==SHIPPING_SERVICE_UNKNOWN?batch.shipping_service:'';
    const action=batch.mandabem_envio_id?'refresh':'generate';
    if(action==='generate'){
      if(!formaEnvio){
        const svc=prompt('Serviço não identificado. Selecione PAC, SEDEX ou PACMINI:','PACMINI');
        if(svc===null)return;
        formaEnvio=svc.trim().toUpperCase().replace(/[\s_-]+/g,'');
        if(!['PAC','SEDEX','PACMINI'].includes(formaEnvio)){if(toastFn)toastFn('Serviço inválido. Use PAC, SEDEX ou PACMINI.','error');return;}
      }
      if(!confirm('Gerar etiqueta/envio no MandaBem para este pedido?'))return;
    }
    setBusyBatch(batch.id);
    try{
      await apiPost('/api/admin-mandabem-label',{batchId:batch.id,action,formaEnvio});
      if(action==='generate')await apiPost('/api/admin-update-fulfillment',{batchIds:[batch.id],fulfillmentStatus:'LABEL_GENERATED'}).catch(()=>{});
      SFX.success();if(toastFn)toastFn(action==='refresh'?'Envio atualizado no MandaBem':'Etiqueta gerada no MandaBem','success');
      await loadIndivOrders();
    }catch(e){console.error(e);if(toastFn)toastFn('Erro MandaBem: '+(e.message||String(e)),'error');}
    setBusyBatch(null);
  }

  // ─── Comunicação ───────────────────────────────────
  function openWhatsAppFor(client){
    const url=buildWhatsAppUrl(client,whatsappMessages[whatsappAudience],selectedCampaign?.name);
    if(!url)return;
    window.open(url,'_blank','noopener,noreferrer');
    setWhatsappContacted(prev=>new Set(prev).add(whatsappContactKey(client)));
  }

  function getBatchTrackingInfo(batch){
    return {code:batch?.tracking_code||batch?.mandabem_rastreamento||batch?.mandabem_etiqueta||'',status:batch?.tracking_status||batch?.mandabem_status||''};
  }

  function openShipmentWhatsAppFor(batch){
    const trackingInfo=getBatchTrackingInfo(batch);
    const url=buildShipmentWhatsAppUrl({name:batch?.clientName,whatsapp:batch?.clientWhatsapp},batch?.channel==='INDIVIDUAL'?'':selectedCampaign?.name,trackingInfo.code,trackingInfo.status);
    if(!url){if(toastFn)toastFn('Cliente sem WhatsApp válido','error');return;}
    window.open(url,'_blank','noopener,noreferrer');
  }

  async function copyWhatsAppMessage(){
    try{await navigator.clipboard.writeText(whatsappMessages[whatsappAudience]);SFX.success();if(toastFn)toastFn('Mensagem copiada!','success');}
    catch(e){if(toastFn)toastFn('Não foi possível copiar a mensagem','error');}
  }

  // ─── Bônus ─────────────────────────────────────────
  async function grantBonus(userId,qty){
    if(!selectedCampaign||!userId||!qty||qty<1)return;
    try{
      await apiPost('/api/admin-bonus',{action:'grant',userId,campaignId:selectedCampaign.id,bonusQty:qty});
      SFX.success();if(toastFn)toastFn(`Bônus de ${qty} carta(s) concedido!`,'success');
      loadBonusGrants();
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao conceder bônus: '+(e.message||String(e)),'error');}
    setBonusForm({userId:null,qty:1});
  }

  async function revokeBonus(grantId){
    if(!confirm('Revogar este bônus?'))return;
    try{await apiPost('/api/admin-bonus',{action:'revoke',grantId});SFX.success();if(toastFn)toastFn('Bônus revogado','success');loadBonusGrants();}
    catch(e){console.error(e);if(toastFn)toastFn('Erro ao revogar: '+(e.message||String(e)),'error');}
  }

  // ─── Etiquetas agrupadas (coletiva) ────────────────
  async function handleGroupLabel(groupKey,force=false){
    const group=labelGroups.find(g=>g.key===groupKey);
    if(!group)return;
    if(group.hasLabel&&!force){if(!confirm('Este grupo já tem etiqueta gerada. Regerar mesmo assim?'))return;}
    const targetBatch=group.rootBatch||group.batches[0];
    if(!targetBatch)return;
    let formaEnvio=group.shippingService||targetBatch.shipping_service||'';
    if(!formaEnvio||formaEnvio===SHIPPING_SERVICE_UNKNOWN){
      const svc=prompt('Serviço não identificado. Selecione PAC, SEDEX ou PACMINI:','PACMINI');
      if(svc===null)return;
      formaEnvio=svc.trim().toUpperCase().replace(/[\s_-]+/g,'');
      if(!['PAC','SEDEX','PACMINI'].includes(formaEnvio)){if(toastFn)toastFn('Serviço inválido. Use PAC, SEDEX ou PACMINI.','error');return;}
    }
    setLabelStatus(prev=>({...prev,[groupKey]:{status:'generating',message:''}}));
    try{
      await apiPost('/api/admin-mandabem-label',{rootBatchId:targetBatch.id,batchIds:group.batches.map(batch=>batch.id),action:'generate',formaEnvio,force});
      SFX.success();
      setLabelStatus(prev=>({...prev,[groupKey]:{status:'done',message:'Etiqueta gerada com sucesso'}}));
      await loadOrders();
      if(onReload)onReload();
    }catch(e){
      console.error('handleGroupLabel error:',e);
      setLabelStatus(prev=>({...prev,[groupKey]:{status:'error',message:e.message||String(e)}}));
      if(toastFn)toastFn('Erro ao gerar etiqueta: '+(e.message||String(e)),'error');
    }
  }

  async function handleMandaBemLabel(batchId,action='generate',formaEnvio=''){
    const group=labelGroups.find(item=>item.batches.some(batch=>batch.id===batchId));
    if(action==='generate'&&group)return handleGroupLabel(group.key);
    if(action==='generate'&&!String(formaEnvio||'').trim()){if(toastFn)toastFn('Informe o serviço de envio (PAC, SEDEX ou PACMINI)','error');return;}
    if(action==='generate'&&!confirm('Gerar etiqueta/envio no MandaBem para este pedido?'))return;
    setLabelLoading(prev=>({...prev,[batchId]:true}));
    try{
      await apiPost('/api/admin-mandabem-label',group?{rootBatchId:group.rootId,batchIds:group.batches.map(batch=>batch.id),action,formaEnvio}:{batchId,action,formaEnvio});
      SFX.success();
      if(toastFn)toastFn(action==='refresh'?'Envio atualizado no MandaBem':'Etiqueta gerada no MandaBem','success');
      await loadOrders();
      if(onReload)onReload();
    }catch(e){console.error('MandaBem label error:',e);if(toastFn)toastFn('Erro MandaBem: '+(e.message||String(e)),'error');}
    setLabelLoading(prev=>({...prev,[batchId]:false}));
  }

  function handleToggleAllPendingLabels(){
    const pendingKeys=labelGroups.filter(g=>!g.hasLabel).map(g=>g.key);
    const allSelected=pendingKeys.length>0&&pendingKeys.every(k=>labelSelected.has(k));
    setLabelSelected(allSelected?new Set():new Set(pendingKeys));
  }

  async function handleBulkLabels(){
    const pending=labelGroups.filter(g=>labelSelected.has(g.key)&&!g.hasLabel);
    if(pending.length===0){if(toastFn)toastFn('Nenhum grupo selecionado com etiqueta pendente','error');return;}
    for(const group of pending){await handleGroupLabel(group.key);}
    if(toastFn)toastFn('Processamento em lote concluído','success');
  }

  // ─── Lista de compra ───────────────────────────────
  async function loadFinalList(){
    setListLoading(true);
    try{
      const paidBatchIds=[];const batchMeta={};
      orders.forEach(o=>{(o.order_batches||[]).forEach(b=>{
        if(isPaidBatch(b.status)){paidBatchIds.push(b.id);batchMeta[b.id]={userName:o.profiles?.name||'—',date:b.confirmed_at||b.created_at||o.created_at};}
      });});
      if(paidBatchIds.length===0){setFinalList([]);setListLoading(false);return;}
      const allItems=[];
      for(let i=0;i<paidBatchIds.length;i+=75){
        const json=await apiPost('/api/admin-batch-items',{batchIds:paidBatchIds.slice(i,i+75)});
        allItems.push(...(json.items||[]));
      }
      const list=allItems.map(i=>{const m=batchMeta[i.batch_id]||{};return{name:i.cards?.name||'Carta',type:i.cards?.type||'',qty:Number(i.quantity||1),image_url:i.cards?.image_url||null,userName:m.userName||'—',date:m.date||''};});
      list.sort((a,b)=>new Date(a.date)-new Date(b.date));
      setFinalList(list);
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao gerar lista: '+(e.message||String(e)),'error');}
    setListLoading(false);
  }

  function copyFinalList(){
    const text=finalList.map(c=>`${c.qty}x ${c.name}${c.type?' ('+c.type+')':''}`).join('\n');
    navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),2000);SFX.success();
  }

  // ─── Preços ────────────────────────────────────────
  async function savePricing(){
    setSaving(true);
    try{
      const{id,...rest}=editPricing;delete rest.is_active;delete rest.created_at;delete rest.updated_at;
      await apiPost('/api/admin-save-pricing',{id,...rest});
      SFX.success();if(toastFn)toastFn('Preços salvos','success');if(onReload)onReload();
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao salvar preços: '+(e.message||String(e)),'error');}
    setSaving(false);
  }

  async function saveIndividualPricing(){
    setSavingIndiv(true);
    try{
      const tiers=indivTiers.map(t=>({min_qty:t.min_qty,max_qty:t.max_qty,usd_per_card:t.usd_per_card}));
      await apiPost('/api/admin-save-individual-pricing',{pricing:indivCfg,tiers});
      SFX.success();if(toastFn)toastFn('Precificação individual salva!','success');
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao salvar: '+(e.message||String(e)),'error');}
    setSavingIndiv(false);
  }

  // ─── Catálogo ──────────────────────────────────────
  function onImportFile(e){
    const file=e.target.files&&e.target.files[0];
    setImportResult(null);
    if(!file){setImportCsv('');setImportFileName('');setImportPreview(null);return;}
    const reader=new FileReader();
    reader.onload=()=>{
      const text=String(reader.result||'');
      setImportCsv(text);setImportFileName(file.name);
      try{
        const {cards,skipped,total}=buildCardsFromCsv(text);
        const types=cards.reduce((a,c)=>{a[c.type]=(a[c.type]||0)+1;return a;},{});
        setImportPreview({valid:cards.length,skipped,total,types});
      }catch(err){setImportPreview({error:String(err&&err.message||err)});}
    };
    reader.readAsText(file);
  }

  async function importCards(){
    if(!importCsv.trim())return;
    setImporting(true);setImportResult(null);
    try{const json=await apiPost('/api/admin-import-cards',{csv:importCsv,deactivatePrevious:importDeactivate});setImportResult(json);SFX.success();if(onReload)onReload();}
    catch(e){console.error(e);if(toastFn)toastFn('Erro ao importar catálogo: '+(e.message||String(e)),'error');}
    setImporting(false);
  }

  function onLinkListChange(text){
    setLinkListText(text);
    setLinkResult(null);
    setLinkPreview(text.trim()?parseCardLinkList(text):null);
  }

  async function addCardsByLink(){
    if(!linkPreview||linkPreview.items.length===0)return;
    setLinkAdding(true);setLinkResult(null);
    try{
      const json=await apiPost('/api/admin-add-cards-by-link',{items:linkPreview.items,tcg:linkTcg,type:linkType});
      setLinkResult(json);
      if(json.added>0){SFX.success();if(onReload)onReload();}
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao adicionar cartas: '+(e.message||String(e)),'error');}
    setLinkAdding(false);
  }

  // ─── Encomendas (campanhas) ────────────────────────
  async function createCampaign(){
    if(!newCamp.name.trim()){if(toastFn)toastFn('Nome obrigatório','error');return;}
    setCreating(true);
    try{
      const r=await fetch('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({name:newCamp.name,status:newCamp.status,close_at:newCamp.close_at||null,max_cards:newCamp.max_cards||null,min_cards:newCamp.min_cards||150})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
      SFX.success();setShowCreateForm(false);setNewCamp({name:'',status:'DRAFT',close_at:'',max_cards:null,min_cards:150});
      if(Array.isArray(d)&&d[0])setSelectedCampaign(d[0]);
      loadCampaigns();if(onReload)onReload();
    }catch(e){if(toastFn)toastFn('Erro ao criar: '+(e.message||String(e)),'error');}
    setCreating(false);
  }

  async function saveCampaign(){
    setSaving(true);
    try{
      const r=await fetch('/api/campaigns',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({id:editCamp.id,name:editCamp.name,status:editCamp.status,close_at:editCamp.close_at||null,max_cards:editCamp.max_cards||null,min_cards:editCamp.min_cards||150})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
      SFX.success();setSelectedCampaign(prev=>({...prev,...editCamp}));if(onReload)onReload();loadCampaigns();
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao salvar encomenda: '+(e.message||String(e)),'error');}
    setSaving(false);
  }

  async function archiveCampaign(){
    setArchiving(true);
    try{await apiPost('/api/archive-campaign',{campaignId:selectedCampaign.id});SFX.success();setSelectedCampaign(null);setShowArchiveConfirm(false);loadCampaigns();if(onReload)onReload();}
    catch(e){if(toastFn)toastFn('Erro ao arquivar: '+(e.message||String(e)),'error');}
    setArchiving(false);
  }

  async function deleteCampaign(campaignId,campaignName){
    if(!confirm(`Excluir "${campaignName||'esta encomenda'}"? Todos os dados serão perdidos.`))return;
    try{
      const r=await fetch('/api/campaigns',{method:'DELETE',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({id:campaignId})});
      const data=await r.json().catch(()=>({}));
      if(data.success){SFX.success();if(selectedCampaign?.id===campaignId)setSelectedCampaign(null);loadCampaigns();if(onReload)onReload();}
    }catch(e){console.error(e);if(toastFn)toastFn('Erro ao excluir encomenda','error');}
  }

  // ─── Linha de pedido (usada na lista unificada) ────
  function renderBatchRow(b){
    const isExp=expandedOrdBatch===b.id;
    const paid=isPaidBatch(b.status);
    const cancelled=isCancelledBatch(b.status);
    const pendingPay=isPendingBatch(b.status);
    const sid=shortBatchId(b.id);
    const ship=Number(b.shipping_locked||0);
    const total=Number(b.total_locked||0);
    const valNoShip=b.subtotal_locked?Number(b.subtotal_locked):total-ship;
    const statusColor=paid?'var(--ok)':cancelled?'var(--danger)':'var(--gold)';
    const statusLabel=paid?'Pago':cancelled?'Cancelado':'Aguardando pagamento';
    const mpCode=b.mp_payment_id||b.mp_preference_id||'';
    const isIndiv=b.channel==='INDIVIDUAL';
    const stageInfo=isIndiv?INDIV_FULFILLMENT_STAGES[indivStageIndex(b.fulfillment_status)]:null;
    const nextStage=isIndiv?INDIV_FULFILLMENT_STAGES[indivStageIndex(b.fulfillment_status)+1]:null;
    const tracking=getBatchTrackingInfo(b);
    const canMandaBem=!isIndiv&&paid&&!cancelled&&!b.shipping_already_paid&&ship>0;
    const busy=busyBatch===b.id||!!labelLoading[b.id];

    return(<Card key={b.id} style={{padding:0,marginBottom:5,borderLeft:'3px solid '+wa(statusColor,'50')}}>
      <div onClick={async()=>{const next=isExp?null:b.id;setExpandedOrdBatch(next);if(next)await loadBatchCards(b.id);}} style={{padding:'11px 14px',cursor:'pointer'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4,gap:8}}>
          <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>
            <span style={{fontSize:'var(--fs-2xs)',fontWeight:800,fontFamily:'monospace',color:'var(--text-dim)'}}>#{sid}</span>
            <span style={{fontSize:'var(--fs-sm)',fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.clientName}</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
            <Tag color={isIndiv?'var(--indiv)':theme.primary} style={{fontSize:'var(--fs-2xs)',padding:'3px 7px'}}>{CHANNEL_LABEL[b.channel]}</Tag>
            <Tag color={statusColor} style={{fontSize:'var(--fs-2xs)',padding:'3px 7px'}}>{paid?'Pago':cancelled?'Cancelado':'Pendente'}</Tag>
            <ChevronRight size={12} style={{color:'var(--text-faint)',transform:isExp?'rotate(90deg)':'none',transition:'transform .2s'}}/>
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:'var(--fs-2xs)',color:'var(--text-faint)',minWidth:0,flexWrap:'wrap'}}>
            <span>{b.qty_in_batch} cartas</span><span>•</span>
            <span>{new Date(batchDateOf(b)).toLocaleDateString('pt-BR')}</span>
            {b.payment_method&&<><span>•</span><span>{b.payment_method==='MERCADO_PAGO'?'MP':b.payment_method==='BONUS'?'Bônus':'Outro'}</span></>}
            {isIndiv&&stageInfo&&<><span>•</span><span style={{color:indivStageIndex(b.fulfillment_status)>=5?'var(--ok)':'var(--gp)'}}>{stageInfo.short}</span></>}
          </div>
          <span style={{fontSize:'var(--fs-sm)',fontWeight:800,color:paid?'var(--ok)':'rgba(var(--ink),calc(0.6*var(--ink-a)))',flexShrink:0}}>{brl(total)}</span>
        </div>
        {isIndiv&&paid&&<IndivStageTrack status={b.fulfillment_status}/>}
      </div>

      {isExp&&<div style={{borderTop:'1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))',padding:'12px 14px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
          <div style={{padding:'8px 10px',borderRadius:'var(--r-control)',background:'rgba(var(--sunk),calc(0.2*var(--sunk-a)))'}}><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginBottom:2}}>Subtotal</div><div style={{fontSize:'var(--fs-sm)',fontWeight:700}}>{brl(valNoShip)}</div></div>
          <div style={{padding:'8px 10px',borderRadius:'var(--r-control)',background:b.shipping_already_paid?'rgba(var(--ok-rgb),0.06)':'rgba(var(--sunk),calc(0.2*var(--sunk-a)))',border:b.shipping_already_paid?'1px solid rgba(var(--ok-rgb),0.2)':'none'}}>
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginBottom:2}}>Frete</div>
            <div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:b.shipping_already_paid?'var(--ok)':undefined}}>{b.shipping_already_paid?'Já pago ✓':brl(ship)}</div>
            {!b.shipping_already_paid&&b.shipping_service&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginTop:2}}>{b.shipping_service}</div>}
          </div>
          <div style={{padding:'8px 10px',borderRadius:'var(--r-control)',background:'rgba(var(--sunk),calc(0.2*var(--sunk-a)))'}}><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginBottom:2}}>Total</div><div style={{fontSize:'var(--fs-sm)',fontWeight:800,color:theme.primary}}>{brl(total)}</div></div>
          <div style={{padding:'8px 10px',borderRadius:'var(--r-control)',background:'rgba(var(--sunk),calc(0.2*var(--sunk-a)))'}}><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginBottom:2}}>Status</div><div style={{fontSize:'var(--fs-xs)',fontWeight:700,color:statusColor}}>{statusLabel}</div></div>
        </div>

        {mpCode&&<div style={{padding:'6px 10px',borderRadius:'var(--r-control)',background:'rgba(var(--sunk),calc(0.15*var(--sunk-a)))',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>Código MP</div><div style={{fontSize:'var(--fs-2xs)',fontFamily:'monospace',color:'var(--text-dim)'}}>{mpCode}</div></div>
          <button onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(mpCode);SFX.success();}} style={{background:'var(--fill)',border:'1px solid var(--line)',borderRadius:6,padding:'3px 6px',color:'var(--text-dim)',fontSize:'var(--fs-2xs)',cursor:'pointer'}}><Copy size={10}/></button>
        </div>}

        {tracking.code&&<div style={{padding:'8px 10px',borderRadius:'var(--r-control)',background:'rgba(var(--ok-rgb),0.06)',border:'1px solid rgba(var(--ok-rgb),0.14)',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
          <div>
            <div style={{fontSize:'var(--fs-2xs)',color:'rgba(var(--ok-rgb),0.6)',marginBottom:2}}>MandaBem · Rastreamento</div>
            <div style={{fontSize:'var(--fs-xs)',fontFamily:'monospace',fontWeight:800,color:'var(--ok)'}}>{tracking.code}</div>
            {tracking.status&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{tracking.status}</div>}
          </div>
          <div style={{display:'flex',gap:5,flexShrink:0}}>
            <button title="Copiar rastreamento" onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(tracking.code);SFX.success();}} style={{background:'var(--fill)',border:'1px solid var(--line)',borderRadius:6,padding:'4px 7px',color:'var(--text-dim)',cursor:'pointer'}}><Copy size={10}/></button>
            {b.clientWhatsapp&&<button title="Enviar rastreamento" onClick={e=>{e.stopPropagation();openShipmentWhatsAppFor(b);}} style={{display:'inline-flex',alignItems:'center',gap:4,background:'rgba(var(--wa-rgb),0.08)',border:'1px solid rgba(var(--wa-rgb),0.18)',borderRadius:6,padding:'4px 7px',color:'var(--wa)',fontSize:'var(--fs-2xs)',cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}><MessageCircle size={10}/> Enviar</button>}
          </div>
        </div>}

        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,flexWrap:'wrap'}}>
          {b.clientEmail&&<span style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',display:'flex',alignItems:'center',gap:3}}><Mail size={10}/>{b.clientEmail}</span>}
          {b.clientWhatsapp&&<a href={buildWhatsAppUrl({name:b.clientName,whatsapp:b.clientWhatsapp},whatsappMessages[whatsappAudience],b.channel==='INDIVIDUAL'?'':selectedCampaign?.name)} target="_blank" rel="noopener noreferrer" style={{fontSize:'var(--fs-2xs)',color:'var(--wa)',textDecoration:'none',display:'flex',alignItems:'center',gap:3}}><MessageCircle size={10}/> WhatsApp</a>}
        </div>

        <div style={{marginBottom:10}}>
          <div style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--text-faint)',marginBottom:4}}>Itens do pedido</div>
          {(batchCards[b.id]||[]).length>0?batchCards[b.id].map((c,ci)=>(
            <div key={ci} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0',fontSize:'var(--fs-xs)',borderBottom:'1px solid rgba(var(--ink),calc(0.03*var(--ink-a)))'}}>
              <div onClick={e=>{e.stopPropagation();c.image_url&&setZoomSrc(c.image_url);}} style={{width:26,flexShrink:0,cursor:c.image_url?'zoom-in':'default'}}><CardThumb card={c} radius={5}/></div>
              <span style={{flex:1,minWidth:0,color:'var(--text-dim)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name} <span style={{color:TC[c.type]||'rgba(var(--ink),calc(0.3*var(--ink-a)))',fontSize:'var(--fs-2xs)',fontWeight:700}}>{c.type||''}</span></span>
              <span style={{fontWeight:700}}>x{c.qty}</span>
            </div>
          )):<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>Carregando itens...</div>}
        </div>

        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {pendingPay&&<Btn variant="success" onClick={e=>{e.stopPropagation();markBatchPaid(b.id);}} style={{padding:'6px 12px',fontSize:'var(--fs-2xs)'}} sfx=""><CheckCircle size={12}/> Marcar pago</Btn>}
          {b.payment_method==='MERCADO_PAGO'&&!cancelled&&<Btn variant="secondary" onClick={e=>{e.stopPropagation();syncBatchMP(b.id);}} style={{padding:'6px 12px',fontSize:'var(--fs-2xs)'}} sfx=""><RefreshCw size={12}/> Sync MP</Btn>}
          {isIndiv&&nextStage&&nextStage.key!=='LABEL_GENERATED'&&<Btn variant="ghost" onClick={e=>{e.stopPropagation();setFulfillment([b.id],nextStage.key,b.id);}} disabled={busy} style={{padding:'6px 12px',fontSize:'var(--fs-2xs)'}} sfx="">{busy?<Spin size={12}/>:<><ArrowRight size={12}/> {nextStage.label}</>}</Btn>}
          {isIndiv&&['PREPARING','LABEL_GENERATED'].includes(b.fulfillment_status)&&<Btn variant="secondary" onClick={e=>{e.stopPropagation();generateIndividualLabel(b);}} disabled={busy} style={{padding:'6px 12px',fontSize:'var(--fs-2xs)'}} sfx="">{busy?<Spin size={12}/>:b.mandabem_envio_id?<><RefreshCw size={12}/> Atualizar envio</>:<><Truck size={12}/> Gerar etiqueta</>}</Btn>}
          {canMandaBem&&!b.mandabem_envio_id&&<Btn variant="secondary" onClick={e=>{e.stopPropagation();handleMandaBemLabel(b.id,'generate');}} disabled={busy} style={{padding:'6px 12px',fontSize:'var(--fs-2xs)'}} sfx="">{busy?<Spin size={12}/>:<><Truck size={12}/> Gerar etiqueta</>}</Btn>}
          {canMandaBem&&b.mandabem_envio_id&&<Btn variant="secondary" onClick={e=>{e.stopPropagation();handleMandaBemLabel(b.id,'refresh');}} disabled={busy} style={{padding:'6px 12px',fontSize:'var(--fs-2xs)'}} sfx="">{busy?<Spin size={12}/>:<><RefreshCw size={12}/> Atualizar envio</>}</Btn>}
          {!cancelled&&<Btn variant="danger" onClick={e=>{e.stopPropagation();cancelBatch(b.id,paid);}} style={{padding:'6px 12px',fontSize:'var(--fs-2xs)'}} sfx=""><X size={12}/> {paid?'Cancelar (reembolso manual)':'Cancelar'}</Btn>}
        </div>
      </div>}
    </Card>);
  }

  // ─── Seção: Visão geral ────────────────────────────
  function renderOverview(){
    const goTo=(key,extra)=>()=>{SFX.nav();setSection(key);if(extra)extra();};
    return(<div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
        <AdminStat icon={Wallet} label="Receita confirmada" value={brlCompact(stats.all.revenue)} sub={`${stats.all.paidCount} pedidos pagos`} color="var(--ok)" accent="var(--ok)"/>
        <AdminStat icon={TrendingUp} label="Hoje" value={brlCompact(stats.all.revenueToday)} sub={`${stats.all.paidToday} pedido(s) hoje`} color={theme.primary} accent={theme.primary}/>
        <AdminStat icon={Clock} label="Aguardando pgto" value={stats.all.pendingCount} sub={brl(stats.all.pendingRevenue)} color="var(--gold)" accent="var(--gold)"/>
        <AdminStat icon={Layers} label="Cartas vendidas" value={stats.all.cards} sub={`${stats.campaign.cards} coletiva · ${stats.individual.cards} individual`} color="var(--text-strong)"/>
      </div>

      <AdminPanel title="Precisa de você" sub="As pendências abertas nos dois canais de venda" icon={Zap} accent="var(--gold)">
        {awaitingPaymentCount===0&&pendingLabelCount===0&&supplierPendingCount===0&&indivToPrepareCount===0
          ? <div style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)',padding:'8px 0'}}>Tudo em dia. Nenhuma pendência aberta. ✨</div>
          : <>
            {awaitingPaymentCount>0&&<AdminTodo icon={Clock} color="var(--gold)" title={`${awaitingPaymentCount} pedido(s) aguardando pagamento`} detail={`${brl(stats.all.pendingRevenue)} pendentes de confirmação`} actionLabel="Ver pedidos" onAction={goTo('orders',()=>{setOrdStatusFilter('AWAITING_PAYMENT');setChannelFilter('ALL');})}/>}
            {supplierPendingCount>0&&<AdminTodo icon={ShoppingCart} color="var(--indiv)" title={`${supplierPendingCount} pedido(s) individuais para comprar`} detail="Ainda não chegaram ao estágio de preparação" actionLabel="Compras do dia" onAction={goTo('orders',()=>{setOrderView('supplier');setSupplierFilter('PENDING');})}/>}
            {indivToPrepareCount>0&&<AdminTodo icon={Package} color="var(--indiv)" title={`${indivToPrepareCount} individual(is) em preparação`} detail="Prontos para gerar etiqueta" actionLabel="Envios" onAction={goTo('shipping',()=>setShippingTab('INDIVIDUAL'))}/>}
            {pendingLabelCount>0&&<AdminTodo icon={Truck} color="var(--info)" title={`${pendingLabelCount} etiqueta(s) da coletiva pendente(s)`} detail={selectedCampaign?.name||'Encomenda ativa'} actionLabel="Envios" onAction={goTo('shipping',()=>setShippingTab('CAMPAIGN'))}/>}
          </>}
      </AdminPanel>

      {selectedCampaign&&<AdminPanel title={selectedCampaign.name} sub="Encomenda coletiva em contexto" icon={Calendar} accent={theme.primary}
        right={<Tag color={isFinalized?'rgba(var(--ink),calc(0.3*var(--ink-a)))':'var(--ok)'} style={{fontSize:'var(--fs-2xs)'}}>{CAMPAIGN_STATUS_LABELS[selectedCampaign.status]||selectedCampaign.status}</Tag>}>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-xs)',marginBottom:8}}>
          <div><span style={{color:'var(--text-faint)'}}>Cartas pagas</span> <b style={{color:isViableAdmin?'var(--ok)':theme.primary}}>{pool||0}</b><span style={{color:'var(--text-faint)',fontSize:'var(--fs-2xs)'}}> / {minCards}</span></div>
          <div><span style={{color:'var(--text-faint)'}}>Clientes</span> <b style={{color:theme.primary}}>{clientGroups.filter(c=>c.hasOrder).length}</b></div>
          <div>{isViableAdmin?<Tag color="var(--ok)" style={{fontSize:'var(--fs-2xs)'}}>Meta atingida</Tag>:<Tag color="var(--gold)" style={{fontSize:'var(--fs-2xs)'}}>Faltam {minCards-(pool||0)}</Tag>}</div>
        </div>
        <div style={{background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',borderRadius:'var(--r-pill)',height:5,overflow:'hidden'}}>
          <div style={{width:Math.min(100,(pool||0)/minCards*100)+'%',height:'100%',borderRadius:'var(--r-pill)',background:isViableAdmin?'linear-gradient(90deg,var(--ok),var(--ok-2))':'linear-gradient(90deg,'+theme.primary+','+theme.secondary+')',transition:'width .5s'}}/>
        </div>
      </AdminPanel>}

      <AdminPanel title="Atividade recente" sub="Pedidos, pagamentos e acessos ao portal" icon={Activity} accent="var(--info)"
        right={<button onClick={()=>setShowNotifications(true)} style={{background:'none',border:'none',color:'var(--text-faint)',fontSize:'var(--fs-2xs)',cursor:'pointer',fontFamily:"'Outfit',sans-serif",display:'inline-flex',alignItems:'center',gap:3}}>Ver tudo <ChevronRight size={11}/></button>}>
        <AdminNotificationFeed notifications={notifications} loading={notifLoading} unread={notifUnread} compact limit={6} onOpenEvent={openNotification}/>
      </AdminPanel>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
        <AdminStat icon={Store} label="Coletiva" value={brlCompact(stats.campaign.revenue)} sub={`${stats.campaign.paidCount} pagos · ${stats.campaign.pendingCount} pendentes`} color={theme.primary} onClick={()=>{SFX.nav();setSection('orders');setChannelFilter('CAMPAIGN');}}/>
        <AdminStat icon={User} label="Individual" value={brlCompact(stats.individual.revenue)} sub={`${stats.individual.paidCount} pagos`} color="var(--indiv)" accent="var(--indiv)" onClick={()=>{SFX.nav();setSection('orders');setChannelFilter('INDIVIDUAL');}}/>
      </div>
    </div>);
  }

  // ─── Seção: Pedidos ────────────────────────────────
  function renderOrders(){
    const listLoadingNow=(channelFilter!=='INDIVIDUAL'&&ordersLoading)||(channelFilter!=='CAMPAIGN'&&indivLoading);
    return(<div style={{display:'flex',flexDirection:'column',gap:10}}>
      <AdminPills
        options={[{key:'list',label:'Todos os pedidos',icon:ClipboardList},{key:'supplier',label:'Compras do dia',icon:ShoppingCart,count:supplierPendingCount}]}
        value={orderView} onChange={setOrderView}/>

      {orderView==='list'?<>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
          <AdminStat icon={CheckCircle} label="Pagos" value={stats.all.paidCount} sub={`${stats.all.cards} cartas`} color="var(--ok)" accent="var(--ok)"/>
          <AdminStat icon={Wallet} label="Receita" value={brlCompact(stats.all.revenue)} sub="confirmada" color={theme.primary} accent={theme.primary}/>
          <AdminStat icon={Clock} label="Pendentes" value={stats.all.pendingCount} sub={brl(stats.all.pendingRevenue)} color="var(--gold)" accent="var(--gold)"/>
          <AdminStat icon={X} label="Cancelados" value={stats.all.cancelledCount} sub={`${stats.all.total} no total`} color="rgba(var(--ink),calc(0.5*var(--ink-a)))"/>
        </div>

        <AdminPills
          options={[
            {key:'ALL',label:'Todos os canais',count:allBatches.length},
            {key:'CAMPAIGN',label:'Coletiva',icon:Store,count:campaignBatches.length,color:theme.primary},
            {key:'INDIVIDUAL',label:'Individual',icon:User,count:individualBatches.length,color:'var(--indiv)'},
          ]}
          value={channelFilter} onChange={setChannelFilter}/>

        <AdminPills
          options={[
            {key:'ALL',label:'Todos',color:'var(--text-dim)'},
            {key:'PAID',label:'Pagos',color:'var(--ok)'},
            {key:'AWAITING_PAYMENT',label:'Pendentes',color:'var(--gold)'},
            {key:'CANCELLED',label:'Cancelados',color:'var(--danger)'},
          ]}
          value={ordStatusFilter} onChange={setOrdStatusFilter}/>

        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <div style={{flex:1}}><Input icon={Search} placeholder="Buscar pedido, cliente, código MP..." value={searchOrders} onChange={e=>setSearchOrders(e.target.value)}/></div>
          <select value={ordSort} onChange={e=>setOrdSort(e.target.value)} style={{padding:'10px 8px',borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',color:'var(--text-strong)',fontSize:'var(--fs-2xs)',fontFamily:"'Outfit',sans-serif",outline:'none',cursor:'pointer'}}>
            <option value="date_desc">Mais recente</option>
            <option value="date_asc">Mais antigo</option>
            <option value="value_desc">Maior valor</option>
            <option value="value_asc">Menor valor</option>
          </select>
        </div>

        {channelFilter!=='INDIVIDUAL'&&!selectedCampaign&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',padding:'2px 2px 4px',lineHeight:1.5}}>Nenhuma encomenda coletiva selecionada — só aparecem aqui os pedidos individuais. Escolha uma encomenda em <b style={{color:'var(--text-muted)'}}>Encomendas</b>.</div>}

        {listLoadingNow&&filteredBatches.length===0?<div style={{textAlign:'center',padding:30}}><Spin size={24}/></div>:
        filteredBatches.length===0?<EmptyState icon={Package} title="Nenhum pedido" sub={searchOrders||ordStatusFilter!=='ALL'||channelFilter!=='ALL'?'Tente outro filtro':'Ainda não há pedidos por aqui'}/>:
        filteredBatches.map(renderBatchRow)}
      </>:<>
        {/* Compras no fornecedor: pedidos individuais pagos agrupados por dia */}
        <AdminPanel title="Compras no fornecedor" sub="Pedidos individuais pagos agrupados por dia de pagamento — compre tudo do dia de uma vez e avance o grupo inteiro." icon={ShoppingCart} accent="var(--indiv)"
          right={<button onClick={loadIndivOrders} style={{background:'none',border:'none',color:'var(--text-faint)',cursor:'pointer'}}><RefreshCw size={15}/></button>}>
          <AdminPills options={[{key:'PENDING',label:'Em aberto',color:'var(--indiv)'},{key:'ALL',label:'Todos',count:individualBatches.length}]} value={supplierFilter} onChange={setSupplierFilter}/>
        </AdminPanel>

        {indivLoading&&visibleSupplierGroups.length===0?<div style={{textAlign:'center',padding:30}}><Spin size={24}/></div>:
        visibleSupplierGroups.length===0?<EmptyState icon={ShoppingCart} title="Nada para comprar" sub="Nenhum pedido individual pago em aberto"/>:
        visibleSupplierGroups.map(group=>{
          const stageIdxs=group.batches.map(b=>indivStageIndex(b.fulfillment_status));
          const minIdx=Math.min(...stageIdxs);
          const nextStage=INDIV_FULFILLMENT_STAGES[minIdx+1];
          const bulkTargets=group.batches.filter(b=>indivStageIndex(b.fulfillment_status)===minIdx).map(b=>b.id);
          return(<Card key={group.dayKey} style={{padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:8}}>
              <div>
                <div style={{fontSize:'var(--fs-sm)',fontWeight:800}}>{group.dayKey}</div>
                <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{group.batches.length} pedido(s) · {group.batches.reduce((s,b)=>s+Number(b.qty_in_batch||0),0)} cartas · {brl(group.batches.reduce((s,b)=>s+Number(b.total_locked||0),0))}</div>
              </div>
              {nextStage&&nextStage.key!=='LABEL_GENERATED'&&bulkTargets.length>0&&<Btn variant="secondary" onClick={()=>setFulfillment(bulkTargets,nextStage.key,group.dayKey)} disabled={busyBatch===group.dayKey} style={{padding:'6px 10px',fontSize:'var(--fs-2xs)',flexShrink:0}} sfx="">
                {busyBatch===group.dayKey?<Spin size={12}/>:<><ArrowRight size={12}/> {nextStage.label}</>}
              </Btn>}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:2}}>
              {group.batches.map(b=>{
                const idx=indivStageIndex(b.fulfillment_status);
                const stageInfo=INDIV_FULFILLMENT_STAGES[idx];
                const next=INDIV_FULFILLMENT_STAGES[idx+1];
                return(<div key={b.id} style={{borderTop:'1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))',paddingTop:7,paddingBottom:3}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>
                      <span style={{fontSize:'var(--fs-2xs)',fontWeight:800,fontFamily:'monospace',color:'var(--text-dim)'}}>#{shortBatchId(b.id)}</span>
                      <span style={{fontSize:'var(--fs-xs)',fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.clientName}</span>
                      <span style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',flexShrink:0}}>{b.qty_in_batch} cartas</span>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:5,flexShrink:0}}>
                      <Tag color={idx>=5?'var(--ok)':'var(--indiv)'} style={{fontSize:'var(--fs-2xs)',padding:'3px 7px'}}>{stageInfo.short}</Tag>
                      {next&&next.key!=='LABEL_GENERATED'&&<button onClick={()=>setFulfillment([b.id],next.key,b.id)} disabled={busyBatch===b.id} title={next.label} style={{background:'var(--fill)',border:'1px solid var(--line)',borderRadius:'var(--r-control)',padding:'4px 6px',color:'var(--text-dim)',cursor:'pointer',display:'grid',placeItems:'center'}}>{busyBatch===b.id?<Spin size={11}/>:<ArrowRight size={11}/>}</button>}
                    </div>
                  </div>
                  <IndivStageTrack status={b.fulfillment_status}/>
                </div>);
              })}
            </div>
          </Card>);
        })}
      </>}
    </div>);
  }

  // ─── Seção: Envios ─────────────────────────────────
  function renderShipping(){
    return(<div style={{display:'flex',flexDirection:'column',gap:10}}>
      <AdminPills
        options={[
          {key:'CAMPAIGN',label:'Coletiva (agrupada)',icon:Store,count:labelGroups.length,color:theme.primary},
          {key:'INDIVIDUAL',label:'Individual',icon:User,count:individualShipments.length,color:'var(--indiv)'},
        ]}
        value={shippingTab} onChange={setShippingTab}/>

      {shippingTab==='CAMPAIGN'?<>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-dim)'}}>
            <span style={{color:'var(--gold)',fontWeight:700}}>{labelGroups.filter(g=>!g.hasLabel).length}</span> pendentes
            {' · '}<span style={{color:'var(--ok)',fontWeight:700}}>{labelGroups.filter(g=>g.hasLabel).length}</span> com etiqueta
          </div>
          <div style={{display:'flex',gap:6}}>
            {labelGroups.filter(g=>!g.hasLabel).length>0&&<Btn variant="secondary" onClick={handleToggleAllPendingLabels} style={{padding:'6px 10px',fontSize:'var(--fs-2xs)'}} sfx="">{labelGroups.filter(g=>!g.hasLabel).every(g=>labelSelected.has(g.key))?'Desmarcar':'Selecionar pendentes'}</Btn>}
            <Btn variant="success" onClick={handleBulkLabels} disabled={labelSelected.size===0} style={{padding:'6px 12px',fontSize:'var(--fs-2xs)'}} sfx=""><Truck size={12}/> Gerar ({labelSelected.size})</Btn>
          </div>
        </div>

        {ordersLoading&&labelGroups.length===0?<div style={{textAlign:'center',padding:30}}><Spin size={24}/></div>:
        labelGroups.length===0?<EmptyState icon={Truck} title="Nenhum pedido para etiqueta" sub="Pedidos pagos com frete cobrado pelo portal aparecem aqui"/>:
        labelGroups.map(group=>{
          const gs=labelStatus[group.key]||{};
          const isGroupExp=labelExpanded===group.key;
          const isSelected=labelSelected.has(group.key);
          const isGenerating=gs.status==='generating';
          const isDone=gs.status==='done'||group.hasLabel;
          const isError=gs.status==='error';
          const statusColor=isDone?'var(--ok)':isError?'var(--danger)':isGenerating?'var(--gold)':'rgba(var(--ink),calc(0.2*var(--ink-a)))';
          const addr=group.address;
          const addrLine=[addr.rua,addr.numero?'Nº '+addr.numero:'',addr.complemento,addr.bairro,addr.cidade&&addr.uf?addr.cidade+'/'+addr.uf:''].filter(Boolean).join(', ');
          const labeledBatch=group.batches.find(b=>b.mandabem_rastreamento||b.mandabem_etiqueta||b.mandabem_envio_id);

          return(<Card key={group.key} style={{padding:0,marginBottom:4,borderLeft:'3px solid '+wa(statusColor,'60')}}>
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',cursor:'pointer'}} onClick={()=>setLabelExpanded(isGroupExp?null:group.key)}>
              {!group.hasLabel
                ? <input type="checkbox" checked={isSelected} onChange={e=>{e.stopPropagation();setLabelSelected(prev=>{const next=new Set(prev);next.has(group.key)?next.delete(group.key):next.add(group.key);return next;});}} onClick={e=>e.stopPropagation()} style={{width:14,height:14,cursor:'pointer',flexShrink:0}}/>
                : <div style={{width:14,height:14,flexShrink:0}}/>}
              <div style={{width:8,height:8,borderRadius:'50%',background:statusColor,flexShrink:0,boxShadow:isDone?'0 0 6px '+wa(statusColor,'80'):''}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:'var(--fs-sm)',fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{group.clientName}</div>
                <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>
                  {group.batches.length===1?'1 pedido':`${group.batches.length} pedidos agrupados`} · {brl(group.totalValue)}
                  <span style={{color:group.shippingService===SHIPPING_SERVICE_UNKNOWN?'var(--gold)':'rgba(var(--ink),calc(0.5*var(--ink-a)))'}}> · {group.shippingService==='PACMINI'?'PAC Mini':group.shippingService==='SEDEX'?'Sedex':group.shippingService==='PAC'?'PAC':group.shippingService===SHIPPING_SERVICE_UNKNOWN?'Serviço não identificado':'Identificando serviço...'}</span>
                  {addr.cidade&&<span style={{color:'var(--text-faint)'}}> · {addr.cidade}{addr.uf?' / '+addr.uf:''}</span>}
                  {isDone&&!isGenerating&&<span style={{color:'var(--ok)'}}> · Etiqueta gerada ✓</span>}
                  {isError&&<span style={{color:'var(--danger)'}}> · Erro</span>}
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
                {isGenerating&&<Spin size={14}/>}
                {!isDone&&!isGenerating&&<Btn variant="secondary" onClick={e=>{e.stopPropagation();handleGroupLabel(group.key);}} style={{padding:'5px 9px',fontSize:'var(--fs-2xs)'}} sfx=""><Truck size={10}/> Gerar</Btn>}
                {isError&&<Btn variant="secondary" onClick={e=>{e.stopPropagation();handleGroupLabel(group.key);}} style={{padding:'5px 9px',fontSize:'var(--fs-2xs)',background:'rgba(var(--danger-rgb),0.1)',border:'1px solid rgba(var(--danger-rgb),0.2)',color:'var(--danger)'}} sfx=""><RefreshCw size={10}/> Tentar de novo</Btn>}
                {isDone&&!isGenerating&&<Btn variant="secondary" onClick={e=>{e.stopPropagation();handleGroupLabel(group.key,true);}} style={{padding:'5px 9px',fontSize:'var(--fs-2xs)',opacity:0.55}} sfx=""><RefreshCw size={10}/> Regerar</Btn>}
                <ChevronRight size={12} style={{color:'var(--text-faint)',transform:isGroupExp?'rotate(90deg)':'none',transition:'transform .2s'}}/>
              </div>
            </div>

            {isGroupExp&&<div style={{borderTop:'1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))',padding:'10px 14px'}}>
              <div style={{display:'flex',flexDirection:'column',gap:3,marginBottom:10}}>
                {group.email&&<div style={{display:'flex',alignItems:'center',gap:5,fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}><Mail size={10}/>{group.email}</div>}
                {group.whatsapp&&<div style={{display:'flex',alignItems:'center',gap:5,fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}><Phone size={10}/>{group.whatsapp}</div>}
                {addrLine&&<div style={{display:'flex',alignItems:'flex-start',gap:5,fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}><MapPin size={10} style={{marginTop:1,flexShrink:0}}/><span>{addrLine}{addr.cep?<span style={{color:'var(--text-faint)'}}> · CEP {addr.cep}</span>:null}</span></div>}
              </div>
              {isError&&<div style={{padding:'7px 10px',borderRadius:'var(--r-control)',background:'rgba(var(--danger-rgb),0.08)',border:'1px solid rgba(var(--danger-rgb),0.18)',marginBottom:10,fontSize:'var(--fs-2xs)',color:'var(--danger-soft)',lineHeight:1.5}}><b>Erro ao gerar etiqueta:</b> {gs.message}</div>}
              <div style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--text-faint)',marginBottom:5}}>Pedidos incluídos:</div>
              {group.batches.map(b=>(
                <div key={b.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'4px 0',fontSize:'var(--fs-2xs)',borderBottom:'1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))'}}>
                  <span style={{fontFamily:'monospace',color:'var(--text-dim)'}}>#{shortBatchId(b.id)}</span>
                  <span style={{color:'var(--text-faint)'}}>{b.qty_in_batch} cartas</span>
                  <span style={{fontWeight:700,color:isPaidBatch(b.status)?'var(--ok)':'rgba(var(--ink),calc(0.4*var(--ink-a)))'}}>{brl(b.total_locked)}</span>
                  {b.mandabem_envio_id?<Tag color="var(--ok)" style={{fontSize:8,padding:'2px 5px'}}>✓ etiqueta</Tag>:<Tag color="rgba(var(--ink),calc(0.2*var(--ink-a)))" style={{fontSize:8,padding:'2px 5px'}}>sem etiqueta</Tag>}
                </div>
              ))}
              {labeledBatch&&<div style={{marginTop:10,padding:'8px 10px',borderRadius:'var(--r-control)',background:'rgba(var(--ok-rgb),0.06)',border:'1px solid rgba(var(--ok-rgb),0.14)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                <div>
                  <div style={{fontSize:'var(--fs-2xs)',color:'rgba(var(--ok-rgb),0.6)',marginBottom:2}}>MandaBem · Rastreamento</div>
                  {(labeledBatch.mandabem_rastreamento||labeledBatch.mandabem_etiqueta)&&<div style={{fontSize:'var(--fs-xs)',fontFamily:'monospace',fontWeight:800,color:'var(--ok)'}}>{labeledBatch.mandabem_rastreamento||labeledBatch.mandabem_etiqueta}</div>}
                  <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{labeledBatch.mandabem_status||'Envio gerado'}{labeledBatch.mandabem_envio_id&&<span> · ID {labeledBatch.mandabem_envio_id}</span>}</div>
                </div>
                {(labeledBatch.mandabem_rastreamento||labeledBatch.mandabem_etiqueta)&&<div style={{display:'flex',gap:5,flexShrink:0}}>
                  <button title="Copiar rastreamento" onClick={()=>{navigator.clipboard.writeText(labeledBatch.mandabem_rastreamento||labeledBatch.mandabem_etiqueta);SFX.success();}} style={{background:'var(--fill)',border:'1px solid var(--line)',borderRadius:6,padding:'3px 6px',color:'var(--text-dim)',cursor:'pointer'}}><Copy size={10}/></button>
                  {group.whatsapp&&<button title="Enviar rastreamento" onClick={()=>openShipmentWhatsAppFor({...labeledBatch,clientName:group.clientName,clientWhatsapp:group.whatsapp,channel:'CAMPAIGN'})} style={{display:'inline-flex',alignItems:'center',gap:4,background:'rgba(var(--wa-rgb),0.08)',border:'1px solid rgba(var(--wa-rgb),0.18)',borderRadius:6,padding:'3px 6px',color:'var(--wa)',fontSize:'var(--fs-2xs)',cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}><MessageCircle size={10}/> Enviar</button>}
                </div>}
              </div>}
            </div>}
          </Card>);
        })}
      </>:<>
        {indivLoading&&individualShipments.length===0?<div style={{textAlign:'center',padding:30}}><Spin size={24}/></div>:
        individualShipments.length===0?<EmptyState icon={Truck} title="Nada para enviar" sub="Pedidos individuais aparecem aqui quando chegam em 'Em preparação'"/>:
        individualShipments.map(b=>{
          const tracking=getBatchTrackingInfo(b);
          const done=b.fulfillment_status==='LABEL_GENERATED';
          const addr=b.shipping_address||{};
          const addrLine=[addr.rua,addr.numero?'Nº '+addr.numero:'',addr.bairro,addr.cidade&&addr.uf?addr.cidade+'/'+addr.uf:''].filter(Boolean).join(', ');
          return(<Card key={b.id} style={{padding:'12px 14px',marginBottom:4,borderLeft:'3px solid '+wa((done?'var(--ok)':'var(--indiv)'),'60')}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:5}}>
              <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>
                <span style={{fontSize:'var(--fs-2xs)',fontWeight:800,fontFamily:'monospace',color:'var(--text-dim)'}}>#{shortBatchId(b.id)}</span>
                <span style={{fontSize:'var(--fs-sm)',fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.clientName}</span>
              </div>
              <Tag color={done?'var(--ok)':'var(--indiv)'} style={{fontSize:'var(--fs-2xs)',padding:'3px 7px',flexShrink:0}}>{done?'Etiqueta gerada':'Em preparação'}</Tag>
            </div>
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginBottom:6}}>{b.qty_in_batch} cartas · {brl(b.total_locked)}{b.shipping_service?` · ${b.shipping_service}`:''}</div>
            {addrLine&&<div style={{display:'flex',alignItems:'flex-start',gap:5,fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginBottom:8}}><MapPin size={10} style={{marginTop:1,flexShrink:0}}/><span>{addrLine}{addr.cep?` · CEP ${addr.cep}`:''}</span></div>}
            {tracking.code&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--ok)',marginBottom:8,fontFamily:'monospace'}}>{tracking.code}{tracking.status?<span style={{fontFamily:"'Outfit',sans-serif",color:'var(--text-faint)'}}> · {tracking.status}</span>:null}</div>}
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              <Btn variant="secondary" onClick={()=>generateIndividualLabel(b)} disabled={busyBatch===b.id} style={{padding:'6px 11px',fontSize:'var(--fs-2xs)'}} sfx="">{busyBatch===b.id?<Spin size={12}/>:done?<><RefreshCw size={12}/> Atualizar envio</>:<><Truck size={12}/> Gerar etiqueta</>}</Btn>
              {b.clientWhatsapp&&tracking.code&&<button onClick={()=>openShipmentWhatsAppFor(b)} style={{display:'inline-flex',alignItems:'center',gap:4,background:'rgba(var(--wa-rgb),0.08)',border:'1px solid rgba(var(--wa-rgb),0.18)',borderRadius:'var(--r-control)',padding:'6px 11px',color:'var(--wa)',fontSize:'var(--fs-2xs)',cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}><MessageCircle size={12}/> Enviar rastreio</button>}
            </div>
          </Card>);
        })}
      </>}
    </div>);
  }

  // ─── Seção: Clientes ───────────────────────────────
  function renderClients(){
    return(<div style={{display:'flex',flexDirection:'column',gap:10}}>
      <AdminPanel title="Comunicação por WhatsApp" sub="Abra as conversas uma a uma com a mensagem já preenchida" icon={MessageCircle} accent="var(--wa)">
        <AdminPills
          options={[{key:WHATSAPP_AUDIENCES.BUYERS,label:'Compradores pagos',color:'var(--wa)'},{key:WHATSAPP_AUDIENCES.ALL,label:'Todos os clientes',color:'var(--wa)'}]}
          value={whatsappAudience} onChange={setWhatsappAudience} style={{marginBottom:10}}/>
        <textarea value={whatsappMessages[whatsappAudience]} onChange={e=>setWhatsappMessages(messages=>({...messages,[whatsappAudience]:e.target.value}))} rows={5} style={{width:'100%',boxSizing:'border-box',resize:'vertical',padding:'10px 12px',borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'rgba(var(--sunk),calc(0.28*var(--sunk-a)))',color:'var(--text-strong)',fontSize:'var(--fs-xs)',lineHeight:1.5,fontFamily:"'Outfit',sans-serif",outline:'none'}}/>
        <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginTop:5}}>Use <b style={{color:'var(--text-dim)'}}>{'{nome}'}</b> para o primeiro nome e <b style={{color:'var(--text-dim)'}}>{'{encomenda}'}</b> para o nome da encomenda.</div>
        <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',marginTop:10,flexWrap:'wrap'}}>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-dim)'}}><b style={{color:'var(--wa)'}}>{whatsappRecipients.length}</b> contatos com WhatsApp{whatsappMissingCount>0&&<span> · {whatsappMissingCount} sem número</span>}</div>
          <div style={{display:'flex',gap:6}}>
            <Btn variant="secondary" onClick={copyWhatsAppMessage} style={{padding:'7px 10px',fontSize:'var(--fs-2xs)'}} sfx=""><Copy size={11}/> Copiar</Btn>
            <Btn variant="success" onClick={()=>nextWhatsappRecipient&&openWhatsAppFor(nextWhatsappRecipient)} disabled={!nextWhatsappRecipient||!whatsappMessages[whatsappAudience].trim()} style={{padding:'7px 10px',fontSize:'var(--fs-2xs)'}} sfx=""><MessageCircle size={11}/> {nextWhatsappRecipient?'Abrir próximo':'Concluído'}</Btn>
          </div>
        </div>
        {nextWhatsappRecipient&&<div style={{marginTop:8,padding:'7px 9px',borderRadius:'var(--r-control)',background:'rgba(var(--wa-rgb),0.06)',fontSize:'var(--fs-2xs)',color:'var(--text-dim)'}}>Próximo: <b style={{color:'var(--text-muted)'}}>{nextWhatsappRecipient.name}</b>. Ao voltar do WhatsApp, clique de novo para seguir para o próximo contato.</div>}
        <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginTop:8,lineHeight:1.4}}>O portal não envia mensagens automaticamente: cada conversa é aberta para você revisar e enviar, respeitando as regras do WhatsApp.</div>
      </AdminPanel>

      <Input icon={Search} placeholder="Buscar por nome, email ou pedido..." value={searchOrd} onChange={e=>setSearchOrd(e.target.value)}/>
      <AdminPills
        options={[{key:'all',label:'Todos',count:clientGroups.length},{key:'active',label:'Com pedido ativo',count:clientGroups.filter(c=>c.hasActiveOrder).length,color:'var(--ok)'}]}
        value={clientActiveFilter?'active':'all'} onChange={k=>setClientActiveFilter(k==='active')}/>

      {(ordersLoading||indivLoading)&&filteredClients.length===0?<div style={{textAlign:'center',padding:30}}><Spin size={24}/></div>:
      filteredClients.length===0?<EmptyState icon={Users} title="Nenhum cliente" sub={searchOrd||clientActiveFilter?'Tente outro filtro':''}/>:
      filteredClients.map(client=>{
        const isClientExp=expandedClient===client.userId;
        const clientBonus=adminBonusGrants.filter(g=>g.user_id===client.userId&&g.status==='AVAILABLE').reduce((s,g)=>s+g.bonus_qty,0);
        const clientTotal=client.orders.reduce((s,o)=>s+(o.order_batches||[]).filter(b=>isPaidBatch(b.status)).reduce((t,b)=>t+Number(b.total_locked||0),0),0);
        return(<Card key={client.userId} style={{padding:0,marginBottom:4}}>
          <div onClick={()=>{setExpandedClient(isClientExp?null:client.userId);if(!isClientExp&&adminBonusGrants.length===0)loadBonusGrants();}} style={{padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
              {client.hasActiveOrder&&<span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:'var(--ok)',boxShadow:'0 0 6px var(--ok)80',flexShrink:0}}/>}
              <div style={{minWidth:0}}>
                <div style={{fontSize:'var(--fs-sm)',fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{client.name}</div>
                <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{client.whatsapp||client.email||'sem contato'}</div>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
              {clientBonus>0&&<Tag color="var(--ok)" style={{fontSize:'var(--fs-2xs)'}}><Gift size={9}/> {clientBonus}</Tag>}
              {client.hasOrder?<Tag style={{fontSize:'var(--fs-2xs)'}}>{client.totalCards} cartas</Tag>:<Tag color="rgba(var(--ink),calc(0.15*var(--ink-a)))" style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>sem pedido</Tag>}
              <ChevronRight size={12} style={{color:'var(--text-faint)',transform:isClientExp?'rotate(90deg)':'none',transition:'transform .2s'}}/>
            </div>
          </div>
          {isClientExp&&<div style={{borderTop:'1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))'}}>
            <div style={{padding:'8px 14px 0',display:'flex',gap:12,flexWrap:'wrap',fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>
              {client.email&&<span style={{display:'flex',alignItems:'center',gap:4}}><Mail size={10}/>{client.email}</span>}
              <span style={{display:'flex',alignItems:'center',gap:4}}><Wallet size={10}/>{brl(clientTotal)} em compras</span>
            </div>
            {client.orders.map(o=>(o.order_batches||[]).map(b=>{
              const batchExp=expandedBatch===b.id;const paid=isPaidBatch(b.status);
              const ship=Number(b.shipping_locked||0);
              const valNoShip=b.subtotal_locked?Number(b.subtotal_locked):Number(b.total_locked||0)-ship;
              return(<div key={b.id} style={{padding:'8px 14px',borderBottom:'1px solid rgba(var(--ink),calc(0.03*var(--ink-a)))'}}>
                <div onClick={async()=>{const next=batchExp?null:b.id;setExpandedBatch(next);if(next)await loadBatchCards(b.id);}} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',gap:8}}>
                  <div style={{minWidth:0}}>
                    <span style={{fontSize:'var(--fs-xs)',fontWeight:700,fontFamily:'monospace'}}>#{shortBatchId(b.id)}</span>
                    <span style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginLeft:6}}>{b.qty_in_batch} cartas · {new Date(b.confirmed_at||b.created_at||o.created_at).toLocaleDateString('pt-BR')}</span>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                    <Tag color={o.channel==='INDIVIDUAL'?'var(--indiv)':theme.primary} style={{fontSize:8,padding:'2px 6px'}}>{CHANNEL_LABEL[o.channel]}</Tag>
                    <span style={{fontSize:'var(--fs-xs)',fontWeight:700}}>{brl(valNoShip)}</span>
                    <Tag color={paid?'var(--ok)':'var(--gold)'} style={{fontSize:'var(--fs-2xs)'}}>{paid?'Pago':'Pendente'}</Tag>
                  </div>
                </div>
                {batchExp&&<div style={{marginTop:8,padding:'8px 0'}}>
                  <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginBottom:6}}>Valor sem frete: {brl(valNoShip)}{ship>0&&<span> · Frete: {brl(ship)}</span>}</div>
                  {b.shipping_already_paid&&<div style={{fontSize:'var(--fs-2xs)',color:'var(--ok)',marginBottom:8,display:'flex',alignItems:'center',gap:4}}><CheckCircle size={11}/> Frete marcado como já pago pelo cliente</div>}
                  <div style={{marginBottom:8}}>{(batchCards[b.id]||[]).length>0?batchCards[b.id].map((c,ci)=>(
                    <div key={ci} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0',fontSize:'var(--fs-xs)',borderBottom:'1px solid rgba(var(--ink),calc(0.03*var(--ink-a)))'}}>
                      <div onClick={e=>{e.stopPropagation();c.image_url&&setZoomSrc(c.image_url);}} style={{width:26,flexShrink:0,cursor:c.image_url?'zoom-in':'default'}}><CardThumb card={c} radius={5}/></div>
                      <span style={{flex:1,minWidth:0,color:'var(--text-dim)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name} <span style={{color:TC[c.type]||'rgba(var(--ink),calc(0.3*var(--ink-a)))',fontSize:'var(--fs-2xs)',fontWeight:700}}>{c.type||''}</span></span>
                      <span style={{fontWeight:700}}>x{c.qty}</span>
                    </div>
                  )):<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>Carregando itens...</div>}</div>
                  {!isCancelledBatch(b.status)&&<Btn variant="danger" onClick={e=>{e.stopPropagation();cancelBatch(b.id,paid);}} style={{padding:'5px 10px',fontSize:'var(--fs-2xs)'}} sfx=""><X size={11}/> {paid?'Cancelar (reembolso manual MP)':'Cancelar pedido'}</Btn>}
                </div>}
              </div>);
            }))}
            {client.whatsapp&&<button onClick={()=>openWhatsAppFor(client)} style={{display:'inline-flex',alignItems:'center',gap:4,margin:'8px 14px 10px',padding:0,border:'none',background:'none',fontSize:'var(--fs-2xs)',color:'var(--wa)',cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}><MessageCircle size={12}/> WhatsApp com mensagem</button>}
            <div style={{padding:'8px 14px',borderTop:'1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                <span style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--ok)',display:'inline-flex',alignItems:'center',gap:4}}><Gift size={11}/> Bônus{selectedCampaign?` · ${selectedCampaign.name}`:''}</span>
                {clientBonus>0&&<Tag color="var(--ok)" style={{fontSize:'var(--fs-2xs)'}}>{clientBonus} disponível</Tag>}
              </div>
              {!selectedCampaign?<div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>Selecione uma encomenda para conceder bônus.</div>:<>
                {adminBonusGrants.filter(g=>g.user_id===client.userId).map(g=>(
                  <div key={g.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'3px 0',fontSize:'var(--fs-2xs)',borderBottom:'1px solid rgba(var(--ink),calc(0.03*var(--ink-a)))'}}>
                    <span style={{color:g.status==='AVAILABLE'?'var(--ok)':'rgba(var(--ink),calc(0.25*var(--ink-a)))'}}>{g.bonus_qty} carta(s) — {g.status==='AVAILABLE'?'Disponível':g.status==='CONSUMED'||g.status==='USED'?'Usado':'Expirado'}</span>
                    {g.status==='AVAILABLE'&&<button onClick={()=>revokeBonus(g.id)} style={{background:'none',border:'none',color:'var(--danger)',fontSize:'var(--fs-2xs)',cursor:'pointer',padding:'2px 4px'}}>Revogar</button>}
                  </div>
                ))}
                {bonusForm.userId===client.userId?<div style={{display:'flex',gap:4,marginTop:6}}>
                  <input type="number" min="1" value={bonusForm.qty} onChange={e=>setBonusForm(f=>({...f,qty:Math.max(1,parseInt(e.target.value)||1)}))} style={{width:50,padding:'4px 6px',borderRadius:6,border:'1px solid var(--line)',background:'var(--fill)',color:'var(--text-strong)',fontSize:'var(--fs-2xs)',textAlign:'center'}}/>
                  <Btn variant="success" onClick={()=>grantBonus(client.userId,bonusForm.qty)} style={{padding:'4px 10px',fontSize:'var(--fs-2xs)'}} sfx=""><Gift size={10}/> Conceder</Btn>
                  <button onClick={()=>setBonusForm({userId:null,qty:1})} style={{background:'none',border:'none',color:'var(--text-faint)',fontSize:'var(--fs-2xs)',cursor:'pointer'}}>Cancelar</button>
                </div>:<Btn variant="secondary" onClick={()=>{setBonusForm({userId:client.userId,qty:1});if(adminBonusGrants.length===0)loadBonusGrants();}} style={{padding:'4px 10px',fontSize:'var(--fs-2xs)',marginTop:4}} sfx=""><Gift size={10}/> Dar bônus</Btn>}
              </>}
            </div>
          </div>}
        </Card>);
      })}
    </div>);
  }

  // ─── Seção: Catálogo ───────────────────────────────
  function renderCatalog(){
    return(<div style={{display:'flex',flexDirection:'column',gap:10}}>
      <AdminPanel title="Importar catálogo (CSV)" sub="Substitui o catálogo de Magic a partir do CSV do fornecedor" icon={Upload} accent={theme.primary}>
        <div style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)',marginBottom:12,lineHeight:1.5}}>O CSV deve ter as colunas <b>name, price, original_price, category, image_file</b>. As imagens devem estar no bucket <b>cards</b> com o mesmo nome do <b>image_file</b>. Re-enviar o mesmo CSV atualiza preços/imagens (não duplica).</div>
        <label style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:'12px',borderRadius:'var(--r-control)',border:'1px dashed rgba(var(--ink),calc(0.15*var(--ink-a)))',background:'var(--fill-soft)',color:'var(--text-dim)',fontSize:'var(--fs-sm)',fontWeight:600,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>
          <Upload size={15}/>{importFileName||'Escolher arquivo CSV'}
          <input type="file" accept=".csv,text/csv" onChange={onImportFile} style={{display:'none'}}/>
        </label>
        {importPreview&&!importPreview.error&&<div style={{marginTop:12,padding:'10px 12px',borderRadius:'var(--r-control)',background:'var(--fill-soft)',fontSize:'var(--fs-xs)',color:'var(--text-muted)',lineHeight:1.6}}>
          <div><b style={{color:theme.primary}}>{importPreview.valid}</b> cartas válidas de {importPreview.total} linhas{importPreview.skipped>0?<> · <span style={{color:'var(--gold)'}}>{importPreview.skipped} ignoradas</span></>:null}</div>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>Normal: {importPreview.types.Normal||0} · Holo: {importPreview.types.Holo||0} · Foil: {importPreview.types.Foil||0}</div>
        </div>}
        {importPreview&&importPreview.error&&<div style={{marginTop:12,fontSize:'var(--fs-xs)',color:'var(--danger)'}}>Erro ao ler CSV: {importPreview.error}</div>}
        <label style={{display:'flex',alignItems:'center',gap:8,marginTop:12,fontSize:'var(--fs-xs)',color:'var(--text-dim)',cursor:'pointer'}}>
          <input type="checkbox" checked={importDeactivate} onChange={e=>setImportDeactivate(e.target.checked)}/>
          Desativar catálogo Magic anterior (cartas fora deste CSV ficam ocultas)
        </label>
        <Btn full variant="success" onClick={importCards} disabled={importing||!importPreview||!!(importPreview&&importPreview.error)||!(importPreview&&importPreview.valid>0)} style={{marginTop:12}} sfx="">{importing?<Spin size={14}/>:<><Upload size={14}/> Importar catálogo</>}</Btn>
        {importResult&&<div style={{marginTop:10,padding:'10px 12px',borderRadius:'var(--r-control)',background:'rgba(var(--ok-rgb),0.08)',border:'1px solid rgba(var(--ok-rgb),0.2)',fontSize:'var(--fs-xs)',color:'var(--text-muted)',lineHeight:1.6}}>
          <Check size={13} style={{verticalAlign:'middle',color:'var(--ok)'}}/> Importado: <b>{importResult.upserted}</b> cartas{importResult.deactivated>0?<> · {importResult.deactivated} antigas desativadas</>:null}{importResult.skipped>0?<> · {importResult.skipped} ignoradas</>:null}
        </div>}
      </AdminPanel>

      <AdminPanel title="Adicionar cartas por link" sub="Cole nome + link da imagem — o servidor baixa e sobe a imagem" icon={Plus} accent="var(--indiv)">
        <div style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)',marginBottom:12,lineHeight:1.5}}>Uma carta por linha, no formato <b>Nome da carta | link da imagem</b>. Aceita link direto ou resultado do Google Imagens. Máximo de 25 cartas por vez. O TCG e o tipo abaixo valem para toda a lista.</div>
        <div style={{display:'flex',gap:8,marginBottom:10}}>
          <select value={linkTcg} onChange={e=>{const tcg=e.target.value;setLinkTcg(tcg);const opts=(TCG_LIST.find(t=>t.key===tcg)?.types||[]).filter(t=>t!=='Todos');setLinkType(opts[0]||'Normal');}} style={{flex:1,padding:'10px 8px',borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',color:'var(--text-strong)',fontSize:'var(--fs-2xs)',fontFamily:"'Outfit',sans-serif",outline:'none',cursor:'pointer'}}>
            {TCG_LIST.map(t=><option key={t.key} value={t.key}>{t.key}</option>)}
          </select>
          <select value={linkType} onChange={e=>setLinkType(e.target.value)} style={{flex:1,padding:'10px 8px',borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',color:'var(--text-strong)',fontSize:'var(--fs-2xs)',fontFamily:"'Outfit',sans-serif",outline:'none',cursor:'pointer'}}>
            {linkTypeOptions.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <textarea value={linkListText} onChange={e=>onLinkListChange(e.target.value)} placeholder={'Aragorn, King of Gondor | https://exemplo.com/aragorn.jpg'} rows={6} style={{width:'100%',padding:'10px 12px',borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'var(--fill-soft)',color:'var(--text-strong)',fontSize:'var(--fs-xs)',fontFamily:'monospace',resize:'vertical',boxSizing:'border-box'}}/>
        {linkPreview&&<div style={{marginTop:12,padding:'10px 12px',borderRadius:'var(--r-control)',background:'var(--fill-soft)',fontSize:'var(--fs-xs)',color:'var(--text-muted)',lineHeight:1.6}}>
          <div><b style={{color:theme.primary}}>{linkPreview.items.length}</b> carta(s) válida(s) de {linkPreview.total} linha(s){linkPreview.invalid.length>0?<> · <span style={{color:'var(--gold)'}}>{linkPreview.invalid.length} com erro</span></>:null}</div>
          {linkPreview.invalid.length>0&&<div style={{marginTop:4,fontSize:'var(--fs-2xs)',color:'var(--gold)'}}>{linkPreview.invalid.map((inv,i)=><div key={i}>· {inv.raw||'(linha vazia)'}: {inv.error}</div>)}</div>}
        </div>}
        <Btn full variant="success" onClick={addCardsByLink} disabled={linkAdding||!linkPreview||linkPreview.items.length===0||linkPreview.items.length>25} style={{marginTop:12}} sfx="">{linkAdding?<Spin size={14}/>:<><Upload size={14}/> Adicionar cartas</>}</Btn>
        {linkResult&&<div style={{marginTop:10,padding:'10px 12px',borderRadius:'var(--r-control)',background:linkResult.failed>0?'rgba(var(--gold-rgb),0.08)':'rgba(var(--ok-rgb),0.08)',border:'1px solid '+(linkResult.failed>0?'rgba(var(--gold-rgb),0.2)':'rgba(var(--ok-rgb),0.2)'),fontSize:'var(--fs-xs)',color:'var(--text-muted)',lineHeight:1.6}}>
          <Check size={13} style={{verticalAlign:'middle',color:'var(--ok)'}}/> Adicionadas: <b>{linkResult.added}</b> carta(s){linkResult.failed>0?<> · {linkResult.failed} falharam</>:null}
          {linkResult.results.filter(r=>!r.ok).map((r,i)=><div key={i} style={{marginTop:4,fontSize:'var(--fs-2xs)',color:'var(--danger)'}}>· {r.name||r.url}: {r.error}</div>)}
        </div>}
      </AdminPanel>
    </div>);
  }

  // ─── Seção: Encomendas (campanhas coletivas) ───────
  function renderCampaigns(){
    const campaignCard=(c,finalized)=>{
      const isSel=selectedCampaign?.id===c.id;
      return(<Card key={c.id} onClick={()=>{SFX.click();setSelectedCampaign(c);}} style={{padding:'11px 14px',cursor:'pointer',marginBottom:4,opacity:finalized?0.6:1,border:'1px solid '+(isSel?wa(theme.primary,'45'):'rgba(var(--ink),calc(0.06*var(--ink-a)))'),background:isSel?wa(theme.primary,'0d'):undefined}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:700,fontSize:14,display:'flex',alignItems:'center',gap:6}}>{c.name}{isSel&&<Tag color={theme.primary} style={{fontSize:8,padding:'2px 6px'}}>em contexto</Tag>}</div>
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>criada em {new Date(c.created_at).toLocaleDateString('pt-BR')}{c.close_at?` · fecha ${new Date(c.close_at).toLocaleDateString('pt-BR')}`:''}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
            <Tag color={finalized?'rgba(var(--ink),calc(0.3*var(--ink-a)))':'var(--ok)'} style={{fontSize:'var(--fs-2xs)'}}>{CAMPAIGN_STATUS_LABELS[c.status]||c.status}</Tag>
            {finalized&&<button onClick={e=>{e.stopPropagation();deleteCampaign(c.id,c.name);}} style={{background:'rgba(var(--danger-rgb),0.1)',border:'1px solid rgba(var(--danger-rgb),0.15)',borderRadius:'var(--r-control)',padding:'5px 7px',cursor:'pointer',color:'var(--danger)',display:'grid',placeItems:'center',flexShrink:0}}><Trash2 size={13}/></button>}
          </div>
        </div>
      </Card>);
    };

    return(<div style={{display:'flex',flexDirection:'column',gap:10}}>
      <AdminPanel title="Encomendas coletivas" sub="A encomenda selecionada define o contexto de pedidos, envios e bônus" icon={Calendar} accent={theme.primary}
        right={<button onClick={()=>setShowCreateForm(v=>!v)} style={{width:30,height:30,borderRadius:'var(--r-control)',border:'1px solid '+wa(theme.primary,'30'),background:wa(theme.primary,'15'),color:theme.primary,fontSize:'var(--fs-lg)',display:'grid',placeItems:'center',cursor:'pointer'}}>{showCreateForm?'×':'+'}</button>}>
        {showCreateForm&&<div style={{marginBottom:14,padding:'12px',borderRadius:'var(--r-control)',background:'rgba(var(--sunk),calc(0.22*var(--sunk-a)))',border:'1px solid var(--line-soft)'}}>
          <div style={{fontSize:'var(--fs-xs)',fontWeight:700,marginBottom:10}}>Nova encomenda</div>
          <AdminField label="Nome"><input value={newCamp.name} onChange={e=>setNewCamp(c=>({...c,name:e.target.value}))} placeholder="Ex: Encomenda Abril 26" style={adminInputStyle}/></AdminField>
          <AdminField label="Status inicial">
            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{CAMPAIGN_STATUSES.map(s=>(<button key={s} onClick={()=>setNewCamp(c=>({...c,status:s}))} style={{padding:'5px 9px',borderRadius:'var(--r-control)',border:'1px solid '+(newCamp.status===s?wa(theme.primary,'35'):'rgba(var(--ink),calc(0.06*var(--ink-a)))'),background:newCamp.status===s?wa(theme.primary,'15'):'rgba(var(--ink),calc(0.02*var(--ink-a)))',color:newCamp.status===s?theme.primary:'rgba(var(--ink),calc(0.3*var(--ink-a)))',fontSize:'var(--fs-2xs)',fontWeight:600,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>{CAMPAIGN_STATUS_LABELS[s]||s}</button>))}</div>
          </AdminField>
          <AdminField label="Data prevista de fechamento" hint="Não é encerramento automático. A encomenda só fecha quando a meta mínima for atingida.">
            <input type="date" value={newCamp.close_at} onChange={e=>setNewCamp(c=>({...c,close_at:e.target.value}))} style={adminInputStyle}/>
          </AdminField>
          <AdminField label="Meta mínima de cartas pagas" hint="Mínimo de cartas para a encomenda ser confirmada (padrão: 150).">
            <input type="number" value={newCamp.min_cards} onChange={e=>setNewCamp(c=>({...c,min_cards:parseInt(e.target.value)||150}))} style={adminInputStyle}/>
          </AdminField>
          <Btn full variant="success" onClick={createCampaign} disabled={creating} sfx="">{creating?<Spin size={14}/>:<><Check size={14}/> Criar encomenda</>}</Btn>
        </div>}

        {loading?<div style={{textAlign:'center',padding:20}}><Spin size={22}/></div>:<>
          {activeCampaigns.length>0&&<><div style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:theme.primary,marginBottom:5}}>Ativas</div>{activeCampaigns.map(c=>campaignCard(c,false))}</>}
          {finalizedCampaigns.length>0&&<><div style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:'var(--text-faint)',margin:'10px 0 5px'}}>Finalizadas</div>{finalizedCampaigns.map(c=>campaignCard(c,true))}</>}
          {campaigns.length===0&&<EmptyState icon={Calendar} title="Nenhuma encomenda" sub="Crie a primeira encomenda coletiva no + acima"/>}
        </>}
      </AdminPanel>

      {selectedCampaign&&!isFinalized&&<AdminPanel title="Configuração da encomenda" sub={selectedCampaign.name} icon={Settings} accent={theme.primary}>
        <AdminField label="Nome"><input value={editCamp.name||''} onChange={e=>setEditCamp(c=>({...c,name:e.target.value}))} style={adminInputStyle}/></AdminField>
        <AdminField label="Data prevista de fechamento" hint="Não é encerramento automático — a encomenda só fecha quando a meta for atingida.">
          <input type="date" value={editCamp.close_at?String(editCamp.close_at).slice(0,10):''} onChange={e=>setEditCamp(c=>({...c,close_at:e.target.value}))} style={adminInputStyle}/>
        </AdminField>
        <AdminField label="Meta mínima (cartas pagas)" hint="Mínimo de cartas pagas para a encomenda ser confirmada.">
          <input type="number" value={editCamp.min_cards||''} onChange={e=>setEditCamp(c=>({...c,min_cards:parseInt(e.target.value)||0}))} style={adminInputStyle}/>
        </AdminField>
        <AdminField label="Limite máximo (cartas)">
          <input type="number" value={editCamp.max_cards||''} onChange={e=>setEditCamp(c=>({...c,max_cards:parseInt(e.target.value)||0}))} style={adminInputStyle}/>
        </AdminField>
        <AdminField label="Status">
          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{CAMPAIGN_STATUSES.map(s=>(<button key={s} onClick={()=>setEditCamp(c=>({...c,status:s}))} style={{padding:'5px 9px',borderRadius:'var(--r-control)',border:'1px solid '+(editCamp.status===s?wa(theme.primary,'35'):'rgba(var(--ink),calc(0.06*var(--ink-a)))'),background:editCamp.status===s?wa(theme.primary,'15'):'rgba(var(--ink),calc(0.02*var(--ink-a)))',color:editCamp.status===s?theme.primary:'rgba(var(--ink),calc(0.3*var(--ink-a)))',fontSize:'var(--fs-2xs)',fontWeight:600,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>{CAMPAIGN_STATUS_LABELS[s]||s}</button>))}</div>
        </AdminField>
        <Btn full variant="success" onClick={saveCampaign} disabled={saving} sfx="">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar encomenda</>}</Btn>
      </AdminPanel>}

      <AdminPanel title="Lista de compra" sub="Todas as cartas dos pedidos pagos da encomenda selecionada, em sequência" icon={ScrollText} accent="var(--gold)"
        right={<Btn variant="secondary" onClick={loadFinalList} disabled={listLoading||!selectedCampaign} style={{padding:'6px 11px',fontSize:'var(--fs-2xs)'}} sfx="click">{listLoading?<Spin size={12}/>:<><RefreshCw size={12}/> Gerar</>}</Btn>}>
        {!selectedCampaign?<div style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)'}}>Selecione uma encomenda acima para gerar a lista.</div>:
        finalList.length>0?<>
          <div style={{fontSize:14,fontWeight:800,color:theme.primary,marginBottom:8}}>{finalList.reduce((s,c)=>s+c.qty,0)} cartas no total</div>
          <div style={{maxHeight:380,overflowY:'auto',marginBottom:10}}>{finalList.map((c,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',fontSize:'var(--fs-xs)',borderBottom:'1px solid rgba(var(--ink),calc(0.03*var(--ink-a)))'}}>
              <div onClick={()=>c.image_url&&setZoomSrc(c.image_url)} style={{width:26,flexShrink:0,cursor:c.image_url?'zoom-in':'default'}}><CardThumb card={c} radius={5}/></div>
              <span style={{flex:1,minWidth:0,color:'var(--text-dim)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.qty}x {c.name} <span style={{color:TC[c.type]||'rgba(var(--ink),calc(0.3*var(--ink-a)))',fontSize:'var(--fs-2xs)',fontWeight:700}}>{c.type||''}</span></span>
              <span style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',whiteSpace:'nowrap'}}>{c.userName}</span>
            </div>
          ))}</div>
          <Btn full variant="success" onClick={copyFinalList} sfx="">{copied?<><Check size={14}/> Copiado!</>:<><Copy size={14}/> Copiar lista</>}</Btn>
        </>:<div style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)',textAlign:'center',padding:16}}>{listLoading?<Spin size={20}/>:'Clique em "Gerar" para montar a lista de compra'}</div>}
      </AdminPanel>

      {selectedCampaign&&<AdminPanel title="Encerrar encomenda" sub="Arquiva a encomenda e libera espaço para a próxima" icon={Archive} accent="var(--danger)">
        {!isFinalized?(!showArchiveConfirm
          ? <Btn full variant="danger" onClick={()=>setShowArchiveConfirm(true)} sfx=""><Archive size={14}/> Arquivar encomenda</Btn>
          : <>
            <div style={{fontSize:'var(--fs-sm)',color:'var(--text-muted)',marginBottom:12,lineHeight:1.5}}>Isso marcará a encomenda como concluída e excluirá todos os dados de pedidos e bônus dela. <b style={{color:'var(--danger)'}}>Não pode ser desfeito.</b></div>
            <div style={{display:'flex',gap:8}}>
              <Btn variant="secondary" onClick={()=>setShowArchiveConfirm(false)} style={{flex:1}} sfx="">Cancelar</Btn>
              <Btn variant="danger" onClick={archiveCampaign} disabled={archiving} style={{flex:1}} sfx="">{archiving?<Spin size={14}/>:'Sim, finalizar'}</Btn>
            </div>
          </>)
        : <Btn full variant="danger" onClick={()=>deleteCampaign(selectedCampaign.id,selectedCampaign.name)} sfx=""><Trash2 size={14}/> Excluir encomenda permanentemente</Btn>}
      </AdminPanel>}
    </div>);
  }

  // ─── Seção: Ajustes ────────────────────────────────
  function renderSettings(){
    return(<div style={{display:'flex',flexDirection:'column',gap:10}}>
      <AdminPills
        options={[{key:'prices',label:'Preços',icon:DollarSign},{key:'notifications',label:'Notificações',icon:Bell},{key:'about',label:'Sobre',icon:HelpCircle}]}
        value={settingsTab} onChange={setSettingsTab}/>

      {settingsTab==='prices'&&<>
        <AdminPanel title="Preços da Encomenda Coletiva" sub={`Preço fixo em R$ por tipo de carta. Mínimo de ${MIN_ORDER_CARDS} cartas por pedido.`} icon={Store} accent={theme.primary}>
          {[
            {k:'normal_price_brl',l:'Carta Normal',desc:'Cartas comuns, não-foil',color:'var(--text-muted)',def:16},
            {k:'ouro_price_brl',l:'Carta Ouro / Holo',desc:'Cartas especiais (Holo)',color:'var(--gold)',def:16},
            {k:'foil_price_brl',l:'Carta Foil',desc:'Cartas foil de qualquer tipo',color:'#d94452',def:18},
          ].map(({k,l,desc,color,def})=>(<div key={k} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid rgba(var(--ink),calc(0.04*var(--ink-a)))'}}>
            <div><div style={{fontSize:'var(--fs-sm)',fontWeight:600,color}}>{l}</div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>{desc}</div></div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)'}}>R$</span>
              <input type="number" step="0.50" min="0" value={editPricing[k]??def} onChange={e=>setEditPricing(p=>({...p,[k]:parseFloat(e.target.value)||0}))} style={{width:74,padding:'7px 8px',borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',color:'var(--text-strong)',fontSize:14,fontWeight:800,fontFamily:"'Outfit',sans-serif",textAlign:'right',outline:'none'}}/>
            </div>
          </div>))}
          <Btn full variant="success" onClick={savePricing} disabled={saving} style={{marginTop:12}} sfx="">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar preços</>}</Btn>
        </AdminPanel>

        {indivCfg&&<AdminPanel title="Preços do Pedido Individual" sub="Desconto por volume — preço/carta = custo × multiplicador × dólar, com piso por tipo" icon={User} accent="var(--indiv)">
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',marginBottom:12}}>Dólar do dia em uso: <b style={{color:theme.primary}}>R$ {indivFx?Number(indivFx.rate).toFixed(2):'—'}</b>{indivFx?<span style={{opacity:0.6}}> ({indivFx.source})</span>:null}</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
            {[
              {k:'multiplier',l:'Multiplicador',step:'0.1'},
              {k:'min_cards',l:'Mínimo de cartas',step:'1'},
              {k:'normal_floor_brl',l:'Piso Normal (R$)',step:'0.5'},
              {k:'holo_floor_brl',l:'Piso Holo (R$)',step:'0.5'},
              {k:'foil_floor_brl',l:'Piso Foil (R$)',step:'0.5'},
              {k:'fx_fallback_rate',l:'Dólar fallback',step:'0.01'},
            ].map(({k,l,step})=>(<div key={k}>
              <label style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',display:'block',marginBottom:3}}>{l}</label>
              <input type="number" step={step} min="0" value={indivCfg[k]??''} onChange={e=>setIndivCfg(c=>({...c,[k]:e.target.value===''?'':Number(e.target.value)}))} style={{...adminInputStyle,fontSize:14,fontWeight:700,padding:'8px 10px'}}/>
            </div>))}
          </div>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-dim)',fontWeight:700,margin:'6px 0 4px'}}>Faixas de volume (custo USD/carta)</div>
          <div style={{display:'flex',flexDirection:'column',gap:4}}>
            <div style={{display:'flex',gap:6,fontSize:'var(--fs-2xs)',color:'var(--text-faint)',padding:'0 2px'}}><span style={{flex:1}}>Mín</span><span style={{flex:1}}>Máx (vazio=∞)</span><span style={{flex:1}}>USD/carta</span><span style={{width:28}}/></div>
            {indivTiers.map((t,idx)=>(<div key={idx} style={{display:'flex',gap:6,alignItems:'center'}}>
              {['min_qty','max_qty','usd_per_card'].map(field=>(
                <input key={field} type="number" step={field==='usd_per_card'?'0.01':'1'} value={t[field]??''} onChange={e=>{const v=e.target.value;setIndivTiers(ts=>ts.map((x,i)=>i===idx?{...x,[field]:v===''?(field==='max_qty'?null:''):Number(v)}:x));}} style={{flex:1,minWidth:0,padding:'6px 8px',borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',color:'var(--text-strong)',fontSize:'var(--fs-xs)',fontFamily:"'Outfit',sans-serif",outline:'none',boxSizing:'border-box'}}/>
              ))}
              <button onClick={()=>setIndivTiers(ts=>ts.filter((_,i)=>i!==idx))} title="Remover" style={{width:28,height:28,flexShrink:0,borderRadius:'var(--r-control)',border:'1px solid rgba(var(--danger-rgb),0.15)',background:'rgba(var(--danger-rgb),0.08)',color:'var(--danger)',cursor:'pointer',display:'grid',placeItems:'center'}}><Trash2 size={12}/></button>
            </div>))}
          </div>
          <Btn full variant="ghost" onClick={()=>setIndivTiers(ts=>[...ts,{min_qty:'',max_qty:null,usd_per_card:''}])} style={{marginTop:8}} sfx=""><Plus size={13}/> Adicionar faixa</Btn>
          <Btn full variant="success" onClick={saveIndividualPricing} disabled={savingIndiv} style={{marginTop:8}} sfx="">{savingIndiv?<Spin size={14}/>:<><Check size={14}/> Salvar pedido individual</>}</Btn>
        </AdminPanel>}
      </>}

      {settingsTab==='notifications'&&<>
        <AdminPanel title="Notificações no celular" sub="Receba pedidos novos e logins direto no aparelho, mesmo com o app fechado" icon={Bell} accent="var(--ok)">
          <AdminPushSettings token={token} toast={toastFn}/>
        </AdminPanel>
        <AdminPanel title="Histórico de eventos" sub="Tudo que aconteceu no portal, mesmo sem push ativado" icon={Activity} accent="var(--info)">
          <AdminNotificationFeed notifications={notifications} loading={notifLoading} unread={notifUnread} onRefresh={()=>loadNotifications()} onMarkAll={markAllNotificationsRead} onClear={clearReadNotifications} onOpenEvent={openNotification}/>
        </AdminPanel>
      </>}

      {settingsTab==='about'&&<AdminPanel title="Como o console está organizado" sub="Um mapa rápido do painel" icon={HelpCircle} accent="rgba(var(--ink),calc(0.4*var(--ink-a)))">
        <div style={{display:'flex',flexDirection:'column',gap:9}}>
          {ADMIN_SECTIONS.map(s=>(
            <div key={s.key} style={{display:'flex',gap:9,alignItems:'flex-start'}}>
              <div style={{width:26,height:26,borderRadius:'var(--r-control)',flexShrink:0,display:'grid',placeItems:'center',background:'var(--fill-soft)',color:'var(--text-dim)'}}><s.icon size={13}/></div>
              <div><div style={{fontSize:'var(--fs-xs)',fontWeight:700}}>{s.label}</div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',lineHeight:1.45}}>{s.sub}</div></div>
            </div>
          ))}
        </div>
        <div style={{marginTop:12,paddingTop:10,borderTop:'1px solid rgba(var(--ink),calc(0.05*var(--ink-a)))',fontSize:'var(--fs-2xs)',color:'var(--text-faint)',lineHeight:1.6}}>
          A <b style={{color:'var(--text-dim)'}}>encomenda em contexto</b> aparece no topo e vale para Pedidos (canal Coletiva), Envios, Bônus e Lista de compra. Pedidos Individuais não dependem de encomenda e aparecem sempre.
        </div>
      </AdminPanel>}
    </div>);
  }

  // ─── Shell do console ──────────────────────────────
  const currentSection=ADMIN_SECTIONS.find(s=>s.key===section)||ADMIN_SECTIONS[0];
  const showCampaignContext=['overview','orders','shipping','clients','campaigns'].includes(section);

  return(<div className="portal-page portal-admin" style={{display:'flex',flexDirection:'column',gap:12}}>
    {/* Cabeçalho */}
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
      <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
        <button onClick={()=>nav('profile')} style={{background:'none',border:'none',color:'var(--text-strong)',cursor:'pointer',padding:2}}><ChevronLeft size={18}/></button>
        <Shield size={18} style={{color:theme.primary,flexShrink:0}}/>
        <div style={{minWidth:0}}>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:'var(--fs-md)',fontWeight:700,lineHeight:1.1}}>Console</div>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{currentSection.sub}</div>
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
        <button onClick={()=>{SFX.click();setShowNotifications(v=>!v);if(!showNotifications)loadNotifications();}} title="Notificações" style={{position:'relative',background:showNotifications?wa(theme.primary,'18'):'rgba(var(--ink),calc(0.04*var(--ink-a)))',border:'1px solid '+(showNotifications?wa(theme.primary,'40'):'rgba(var(--ink),calc(0.07*var(--ink-a)))'),borderRadius:'var(--r-control)',padding:'7px 9px',color:showNotifications?theme.primary:'rgba(var(--ink),calc(0.45*var(--ink-a)))',cursor:'pointer',display:'grid',placeItems:'center'}}>
          <Bell size={15}/>
          {notifUnread>0&&<span style={{position:'absolute',top:-4,right:-4,minWidth:16,height:16,padding:'0 4px',borderRadius:'var(--r-control)',background:'var(--danger)',color:'#fff',fontSize:'var(--fs-2xs)',fontWeight:800,display:'grid',placeItems:'center',fontFamily:"'Outfit',sans-serif"}}>{notifUnread>9?'9+':notifUnread}</span>}
        </button>
        <button onClick={()=>{SFX.click();reloadAll();}} title="Recarregar" style={{background:'var(--fill-soft)',border:'1px solid var(--line)',borderRadius:'var(--r-control)',padding:'7px 9px',color:'var(--text-dim)',cursor:'pointer',display:'grid',placeItems:'center'}}><RefreshCw size={15}/></button>
      </div>
    </div>

    {/* Navegação entre seções */}
    <div style={{display:'flex',gap:4,overflowX:'auto',paddingBottom:2,margin:'0 -2px',WebkitOverflowScrolling:'touch'}}>
      {ADMIN_SECTIONS.map(s=>{
        const active=section===s.key;
        const badge=s.key==='orders'?awaitingPaymentCount:s.key==='shipping'?pendingLabelCount:0;
        return(<button key={s.key} onClick={()=>{SFX.toggle();setSection(s.key);setShowNotifications(false);}} style={{display:'inline-flex',alignItems:'center',gap:5,flexShrink:0,padding:'8px 12px',borderRadius:'var(--r-control)',border:'1px solid '+(active?wa(theme.primary,'45'):'rgba(var(--ink),calc(0.05*var(--ink-a)))'),background:active?wa(theme.primary,'16'):'rgba(var(--ink),calc(0.022*var(--ink-a)))',color:active?theme.primary:'rgba(var(--ink),calc(0.35*var(--ink-a)))',fontWeight:700,fontSize:11.5,cursor:'pointer',fontFamily:"'Outfit',sans-serif",whiteSpace:'nowrap',position:'relative'}}>
          <s.icon size={13}/>{s.label}
          {badge>0&&<span style={{marginLeft:1,minWidth:15,height:15,padding:'0 4px',borderRadius:'var(--r-control)',background:active?wa(theme.primary,'30'):'rgba(var(--ink),calc(0.07*var(--ink-a)))',color:active?theme.primary:'rgba(var(--ink),calc(0.4*var(--ink-a)))',fontSize:'var(--fs-2xs)',fontWeight:800,display:'grid',placeItems:'center'}}>{badge}</span>}
        </button>);
      })}
    </div>

    {/* Encomenda em contexto */}
    {showCampaignContext&&campaigns.length>0&&<div style={{display:'flex',alignItems:'center',gap:7,padding:'8px 11px',borderRadius:'var(--r-control)',background:'var(--fill-soft)',border:'1px solid var(--line-soft)'}}>
      <Store size={13} style={{color:'var(--text-faint)',flexShrink:0}}/>
      <span style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',flexShrink:0}}>Encomenda</span>
      <select value={selectedCampaign?.id||''} onChange={e=>{const c=campaigns.find(x=>String(x.id)===e.target.value);setSelectedCampaign(c||null);}} style={{flex:1,minWidth:0,padding:'4px 6px',borderRadius:'var(--r-control)',border:'1px solid var(--line)',background:'rgba(var(--sunk),calc(0.3*var(--sunk-a)))',color:'var(--text-strong)',fontSize:'var(--fs-2xs)',fontWeight:700,fontFamily:"'Outfit',sans-serif",outline:'none',cursor:'pointer'}}>
        <option value="">Nenhuma (só individuais)</option>
        {activeCampaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        {finalizedCampaigns.length>0&&<optgroup label="Finalizadas">{finalizedCampaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
      </select>
      {selectedCampaign&&<Tag color={isFinalized?'rgba(var(--ink),calc(0.3*var(--ink-a)))':'var(--ok)'} style={{fontSize:'var(--fs-2xs)',flexShrink:0}}>{CAMPAIGN_STATUS_LABELS[selectedCampaign.status]||selectedCampaign.status}</Tag>}
    </div>}

    {/* Painel de notificações */}
    {showNotifications&&<Card style={{padding:16,border:'1px solid '+wa(theme.primary,'25')}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <Bell size={15} style={{color:theme.primary}}/>
          <span style={{fontSize:14,fontFamily:"'Cinzel',serif",fontWeight:700}}>Notificações</span>
          {notifUnread>0&&<Tag color="var(--danger)" style={{fontSize:'var(--fs-2xs)'}}>{notifUnread} nova(s)</Tag>}
        </div>
        <button onClick={()=>setShowNotifications(false)} style={{background:'none',border:'none',color:'var(--text-faint)',cursor:'pointer',padding:2}}><X size={16}/></button>
      </div>
      <AdminNotificationFeed notifications={notifications} loading={notifLoading} unread={notifUnread} onRefresh={()=>loadNotifications()} onMarkAll={markAllNotificationsRead} onClear={clearReadNotifications} onOpenEvent={openNotification} limit={30}/>
      <button onClick={()=>{setSection('settings');setSettingsTab('notifications');setShowNotifications(false);}} style={{marginTop:10,width:'100%',background:'var(--fill-soft)',border:'1px solid var(--line)',borderRadius:'var(--r-control)',padding:'8px 0',color:'var(--text-dim)',fontSize:'var(--fs-2xs)',fontWeight:700,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>Configurar notificações do celular</button>
    </Card>}

    {/* Conteúdo da seção */}
    {section==='overview'&&renderOverview()}
    {section==='orders'&&renderOrders()}
    {section==='shipping'&&renderShipping()}
    {section==='clients'&&renderClients()}
    {section==='catalog'&&renderCatalog()}
    {section==='campaigns'&&renderCampaigns()}
    {section==='settings'&&renderSettings()}

    <ImageLightbox src={zoomSrc} onClose={()=>setZoomSrc(null)}/>
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
  // Lista de desejos: linhas de wishlist_items, por usuário — não por pedido.
  // Sobrevive à compra (acquired_qty) e atravessa campanhas.
  const [wishlist,setWishlist]=useState([]);
  // Carrinho: order_items com in_cart=true no pedido da campanha em contexto.
  const [cartItems,setCartItems]=useState([]);
  const [bonusGrants,setBonusGrants]=useState([]);
  const [lastOrder,setLastOrder]=useState(null);
  const [myOrders,setMyOrders]=useState([]);
  // Pedido individual: modo escolhido na Início + dados de preço (faixas/config/dólar)
  const [orderMode,setOrderMode]=useState('CAMPAIGN'); // 'CAMPAIGN' | 'INDIVIDUAL'
  const [indivPricing,setIndivPricing]=useState(null); // { tiers, pricing, fx }
  const [statusOverrides,setStatusOverrides]=useState({});

  // Sem encomenda coletiva ativa: força o modo individual (a aba de Coletiva fica oculta).
  useEffect(()=>{if(!campaign&&orderMode==='CAMPAIGN')setOrderMode('INDIVIDUAL');},[campaign,orderMode]);

  // UI state
  const [page,setPage]=useState('home');
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
        const rows = await sbGet('wishlist_items', `user_id=eq.${userId}&select=id,card_id,quantity,acquired_qty,acquired_at,cards(name,type,image_url)&order=created_at.desc`, tkn);
        setWishlist((rows || [])
          .filter(w => w && w.id && w.card_id)
          .map(w => ({ ...w, card_name: w.cards?.name || '?', card_type: w.cards?.type || 'Normal', card_image_url: w.cards?.image_url || null })));
      } catch(e) {
        // Banco sem a migração wishlist.sql ainda: a lista fica vazia em vez
        // de derrubar o resto do carregamento.
        console.warn('[loadAppData] Falha ao carregar a lista de desejos (rodou supabase/migrations/wishlist.sql?):', e);
      }

      // Campaign
      let camp = null;
      try {
        const campRes = await fetch('/api/campaigns', { method: 'GET' });
        const allCampaigns = await campRes.json().catch(() => []);
        if (!campRes.ok) throw new Error(allCampaigns?.error || `HTTP ${campRes.status}`);
        const openCampaigns = (Array.isArray(allCampaigns) ? allCampaigns : [])
          .filter(c => c.status !== 'CANCELLED' && c.status !== 'DONE')
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        camp = openCampaigns[0] || null;
        setCampaign(camp);
      } catch(eCamp) {
        if (isAuthFailure(eCamp)) throw eCamp;
        console.warn('Campaign load failed:', eCamp);
      }

      // Tiers: removidos do novo modelo — preços são diretos por tipo de carta

      // Pricing
      try {
        const [pc] = await sbGet('pricing_config', `is_active=eq.true&limit=1`, tkn);
        setPricing(pc);
      } catch(ePrice) {
        if (isAuthFailure(ePrice)) throw ePrice;
        console.warn('Pricing load failed:', ePrice);
      }

      // Order (get or create DRAFT) — works with or without active campaign
      try {
        // ── Step 1: Find existing DRAFT order ──────────────────────────────────
        let ord = null;
        if (camp) {
          try {
            const ords = await sbGet('orders', `campaign_id=eq.${camp.id}&user_id=eq.${userId}&status=eq.DRAFT`, tkn);
            ord = ords[0] || null;
          } catch(e) { console.warn('[loadAppData] campaign DRAFT order query failed:', e); }
        }

        // ── Step 2: Fallback — find any non-cancelled order for this campaign ──
        // Handles legacy orders that may have status=PAID/PAID_CONFIRMED due to old bugs
        if (!ord && camp) {
          try {
            const anyOrds = await sbGet('orders', `campaign_id=eq.${camp.id}&user_id=eq.${userId}&status=not.in.(CANCELLED)&order=created_at.desc&limit=1`, tkn);
            if (anyOrds && anyOrds[0]) {
              console.log('[loadAppData] Found non-DRAFT order for campaign:', anyOrds[0].id, 'status:', anyOrds[0].status, '— attempting recovery to DRAFT');
              // Try to reset the order status back to DRAFT so new items can be added
              await sbPatch('orders', `id=eq.${anyOrds[0].id}`, { status: 'DRAFT' }, tkn).catch(e => {
                console.warn('[loadAppData] Could not reset order to DRAFT:', e);
              });
              ord = anyOrds[0];
            }
          } catch(e) { console.warn('[loadAppData] any-order fallback query failed:', e); }
        }

        // ── Step 3: Null-campaign order (wishlist mode) ─────────────────────────
        if (!ord) {
          try {
            const nullOrds = await sbGet('orders', `campaign_id=is.null&user_id=eq.${userId}&status=eq.DRAFT&select=id,created_at&order=created_at.desc&limit=1`, tkn);
            ord = nullOrds[0] || null;
          } catch(e) { console.warn('[loadAppData] null-campaign order query failed:', e); }
        }

        // ── Step 4: Create a new DRAFT order ────────────────────────────────────
        if (!ord) {
          try {
            const payload = camp ? { campaign_id: camp.id, user_id: userId, status: 'DRAFT' } : { user_id: userId, status: 'DRAFT' };
            const created = await sbPost('orders', payload, tkn);
            // Defensive: sbPost may return an array or a single object
            ord = Array.isArray(created) ? (created[0] ?? null) : (created ?? null);

          } catch(e) {
            // Race condition: another tab/request may have created the order simultaneously
            console.warn('[loadAppData] Order creation failed, trying race-condition fallback:', e);
            try {
              const fallback = camp
                ? await sbGet('orders', `campaign_id=eq.${camp.id}&user_id=eq.${userId}&status=eq.DRAFT`, tkn)
                : await sbGet('orders', `campaign_id=is.null&user_id=eq.${userId}&status=eq.DRAFT&order=created_at.desc&limit=1`, tkn);
              if (fallback && fallback[0]) {
                ord = fallback[0];
              } else {
                console.error('[loadAppData] All order creation/recovery attempts failed. userId:', userId, 'campaignId:', camp?.id, 'error:', e);
                throw e;
              }
            } catch(fallbackErr) {
              console.error('[loadAppData] Race-condition fallback failed:', fallbackErr);
              throw e;
            }
          }
        } else if (camp && !ord.campaign_id) {
          // Migrate null-campaign order to this campaign
          await sbPatch('orders', `id=eq.${ord.id}`, { campaign_id: camp.id }, tkn).catch(()=>{});
        }

        // ── Final validation before using ord ──────────────────────────────────
        if (!ord || !ord.id) {
          console.error('[loadAppData] ord is null/invalid after all recovery attempts. userId:', userId, 'ord:', ord);
          throw new Error('Não foi possível carregar ou criar seu pedido.');
        }

        setOrderId(ord.id);

        // ── Carrinho: order_items do pedido em contexto, ainda sem batch ──────
        // is_bonus=not.eq.true cobre false E NULL (linhas antigas).
        try {
          const items = await sbGet('order_items', `order_id=eq.${ord.id}&batch_id=is.null&is_bonus=not.eq.true&in_cart=is.true&select=id,card_id,quantity,cards(name,type,image_url)`, tkn);
          setCartItems((items || [])
            .filter(i => i && i.id && i.card_id)
            .map(i=>({...i, card_name:i.cards?.name||'?', card_type:i.cards?.type||'Normal', card_image_url:i.cards?.image_url||null})));
        } catch(e) { console.warn('[loadAppData] Falha ao carregar o carrinho:', e); }
      } catch(eOrder) {
        if (isAuthFailure(eOrder)) throw eOrder;
        console.error('[loadAppData] Order block failed — orderId will be null:', eOrder);
      }

        // Order history — all paid batches across all campaigns
        try {
          const allOrds = await sbGet('orders', `user_id=eq.${userId}&select=id,campaign_id,kind,campaigns(status)`, tkn);
          if (allOrds && allOrds.length > 0) {
            const ordCampStatus = {};
            const ordKind = {};
            allOrds.forEach(o => { ordCampStatus[o.id] = o.campaigns?.status || null; ordKind[o.id] = o.kind || (o.campaign_id ? 'CAMPAIGN' : 'INDIVIDUAL'); });
            const ordIds = allOrds.map(o=>o.id).join(',');
            const batches = await sbGet('order_batches', `order_id=in.(${ordIds})&select=id,status,payment_status,total_locked,payment_method,created_at,qty_in_batch,shipping_locked,shipping_service,shipping_already_paid,shipping_group_id,mandabem_envio_id,mandabem_rastreamento,mandabem_status,fulfillment_status,mp_link,brl_unit_price_locked,subtotal_locked,order_id,order_items(quantity,cards(name,type))`, tkn);
            setMyOrders((batches||[]).map(b=>({ ...b, campaignStatus: ordCampStatus[b.order_id] || null, orderKind: ordKind[b.order_id] || 'CAMPAIGN', cards: Array.isArray(b.order_items) ? b.order_items.map(i=>({ name:i.cards?.name||'Carta', type:i.cards?.type||'', qty:Number(i.quantity||1) })) : undefined })));
          }
        } catch(e) {
          if (isAuthFailure(e)) throw e;
          console.warn('Failed to load order batches:', e);
        }

        // Bonus grants (only if active campaign) — tier-bonus API removido, só bônus manuais
        if (camp) {
          try {
            const bg = await sbGet('bonus_grants', `user_id=eq.${userId}&campaign_id=eq.${camp.id}&status=eq.AVAILABLE`, tkn);
            setBonusGrants(bg);
          } catch(e) {
            if (isAuthFailure(e)) throw e;
            console.warn('Failed to load bonus grants:', e);
          }
        }
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
      setPage('home');
    }
  }

  function handleLogout(){
    localStorage.removeItem('cpj_session');
    setSession(null);setProfile(null);setCampaign(null);setPricing(null);
    setOrderId(null);setWishlist([]);setCartItems([]);setBonusGrants([]);setMyOrders([]);
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

  // ─── Lista de desejos → carrinho ──────────────────
  // COPIA, não move. O desejo continua na lista, agora marcado como "no
  // carrinho" — era o "mover" antigo que esvaziava a lista de desejos assim
  // que a pessoa decidia comprar.
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

  // ─── Lista inteira → carrinho ─────────────────────
  // Sequencial de propósito: handleAddToCart lê cartItems para decidir entre
  // criar e somar, e em paralelo duas cartas iguais criariam linhas duplicadas.
  async function handleAddAllToCart() {
    if (!token || pendingWishlist.length === 0) return;
    for (const w of pendingWishlist) {
      if (cartItems.some(c => c.card_id === w.card_id)) continue;
      await handleAddToCart(w, w.quantity);
    }
    SFX.confirm();
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

    // Comprar NÃO tira a carta da lista de desejos — registra que ela foi
    // adquirida. Querer uma carta e já tê-la comprado são dois estados, não
    // opostos; era apagar aqui que transformava a lista numa caixa de entrada.
    const bought = cartItems.map(c => ({ card_id: c.card_id, qty: c.quantity }));
    setCartItems([]);
    if (bought.length > 0) {
      const now = new Date().toISOString();
      const userId = session?.user?.id;
      const novas = [];
      const patches = [];
      for (const b of bought) {
        const w = wishlist.find(x => x.card_id === b.card_id);
        if (w) {
          patches.push(sbPatch('wishlist_items', 'id=eq.'+(w.id), { acquired_qty: (w.acquired_qty || 0) + b.qty, acquired_at: now }, token)
            .catch(e => console.warn('[handleOrderDone] falha ao marcar como adquirida:', e)));
        } else if (userId) {
          // Comprada direto, sem passar pela lista: entra já quitada, para o
          // catálogo conseguir avisar "você já comprou esta" nas próximas vezes.
          const item = cartItems.find(c => c.card_id === b.card_id);
          novas.push({ user_id: userId, card_id: b.card_id, quantity: b.qty, acquired_qty: b.qty, acquired_at: now, _meta: item });
        }
      }
      setWishlist(prev => {
        const atualizadas = prev.map(w => {
          const hit = bought.find(b => b.card_id === w.card_id);
          return hit ? { ...w, acquired_qty: (w.acquired_qty || 0) + hit.qty, acquired_at: now } : w;
        });
        return [...novas.map(n => ({ ...n, card_name: n._meta?.card_name || '?', card_type: n._meta?.card_type || 'Normal', card_image_url: n._meta?.card_image_url || null })), ...atualizadas];
      });
      if (novas.length > 0) {
        patches.push(sbUpsert('wishlist_items', novas.map(({ _meta, ...linha }) => linha), token, 'user_id,card_id')
          .catch(e => console.warn('[handleOrderDone] falha ao registrar compra fora da lista:', e)));
      }
      await Promise.all(patches);
    }
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

  // Um desejo "pendente" é o que ainda falta comprar. Cartas já adquiridas
  // continuam na lista — só saem da contagem e do "adicionar tudo".
  const pendingWishlist = wishlist.filter(w => (w.acquired_qty || 0) < w.quantity);
  const wishlistCount = pendingWishlist.reduce((s, w) => s + (w.quantity - (w.acquired_qty || 0)), 0);
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
  const bottomTabs = [{ key: 'home', icon: Home, label: 'Início' }, { key: 'catalog', icon: BookOpen, label: 'Catálogo' }, { key: 'wants', icon: ScrollText, label: 'Desejos' }, { key: 'cart', icon: ShoppingCart, label: 'Carrinho' }, { key: 'profile', icon: User, label: 'Perfil' }];

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
          {(page === 'success' || page === 'admin' || page === 'checkout') && <button onClick={() => nav(page === 'admin' ? 'profile' : page === 'checkout' ? 'cart' : 'home')} className="mp-tap" aria-label="Voltar" style={{ background: 'none', border: 'none', color: 'var(--text-strong)', cursor: 'pointer' }}><ChevronLeft size={20} /></button>}
          <span style={{ fontFamily: "'Cinzel',serif", fontSize: 'var(--fs-md)', fontWeight: 700, letterSpacing: .3 }}>{({ home: 'Cartas para Jogar', catalog: 'Catálogo', wants: 'Lista de desejos', cart: 'Carrinho', checkout: 'Checkout', success: '', profile: 'Perfil', admin: 'Admin', onboarding: '' })[page] || ''}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Em que modo estou comprando. Clicável: leva à Home, onde se troca. */}
          {['catalog','wants','cart','checkout'].includes(page) && (campaign || orderMode === 'INDIVIDUAL') && (
            <button onClick={() => { SFX.nav(); nav('home'); }} title="Modo de pedido — toque para trocar" aria-label={`Modo de pedido: ${orderMode === 'INDIVIDUAL' ? 'Individual' : 'Encomenda coletiva'}. Toque para trocar.`} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 'var(--r-pill)', cursor: 'pointer', border: '1px solid ' + (orderMode === 'INDIVIDUAL' ? 'rgba(var(--ink),calc(0.12*var(--ink-a)))' : wa(theme.primary, '55')), background: orderMode === 'INDIVIDUAL' ? 'var(--fill-soft)' : wa(theme.primary, '1f'), color: orderMode === 'INDIVIDUAL' ? 'var(--indiv)' : theme.primary, fontSize: 'var(--fs-2xs)', fontWeight: 700, fontFamily: "'Outfit',sans-serif", whiteSpace: 'nowrap' }}>
              {orderMode === 'INDIVIDUAL' ? <User size={11}/> : <Store size={11}/>}
              {orderMode === 'INDIVIDUAL' ? 'Individual' : 'Coletiva'}
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
        {page === 'home' && <>
          {/* Seletor de modo de pedido — a aba de Encomenda Coletiva só aparece quando há campanha ativa */}
          <div style={{display:'flex',gap:8,marginBottom:14}}>
            {campaign&&<button onClick={()=>{SFX.toggle();setOrderMode('CAMPAIGN');}} style={{flex:1,padding:'12px 10px',borderRadius:'var(--r-card)',border:'1px solid '+(orderMode==='CAMPAIGN'?wa(theme.primary,'55'):'rgba(var(--ink),calc(0.06*var(--ink-a)))'),background:orderMode==='CAMPAIGN'?wa(theme.primary,'18'):'rgba(var(--ink),calc(0.02*var(--ink-a)))',color:orderMode==='CAMPAIGN'?theme.primary:'rgba(var(--ink),calc(0.5*var(--ink-a)))',cursor:'pointer',fontFamily:"'Outfit',sans-serif",textAlign:'left'}}>
              <div style={{fontSize:'var(--fs-sm)',fontWeight:700}}>🛒 Encomenda Coletiva</div>
              <div style={{fontSize:'var(--fs-2xs)',opacity:0.7,marginTop:2}}>Preço fixo por tipo</div>
            </button>}
            <button onClick={()=>{SFX.toggle();setOrderMode('INDIVIDUAL');}} style={{flex:1,padding:'12px 10px',borderRadius:'var(--r-card)',border:'1px solid '+(!campaign||orderMode==='INDIVIDUAL'?wa(theme.primary,'55'):'rgba(var(--ink),calc(0.06*var(--ink-a)))'),background:!campaign||orderMode==='INDIVIDUAL'?wa(theme.primary,'18'):'rgba(var(--ink),calc(0.02*var(--ink-a)))',color:!campaign||orderMode==='INDIVIDUAL'?theme.primary:'rgba(var(--ink),calc(0.5*var(--ink-a)))',cursor:'pointer',fontFamily:"'Outfit',sans-serif",textAlign:'left'}}>
              <div style={{fontSize:'var(--fs-sm)',fontWeight:700}}>👤 Pedido Individual</div>
              <div style={{fontSize:'var(--fs-2xs)',opacity:0.7,marginTop:2}}>Desconto por volume</div>
            </button>
          </div>
          {orderMode==='INDIVIDUAL'
            ? <div style={{display:'flex',flexDirection:'column',gap:14}}>
                <Card style={{padding:20}}>
                  <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',letterSpacing:2.5,textTransform:'uppercase',fontFamily:"'Cinzel',serif",textAlign:'center'}}>Pedido Individual</div>
                  <h1 className="mp-gradient-text" style={{margin:'5px 0 10px',fontSize:'var(--fs-xl)',fontFamily:"'Cinzel',serif",textAlign:'center',background:'linear-gradient(135deg,'+theme.primary+','+theme.secondary+')',color:theme.primary}}>Quanto mais cartas, menor o preço</h1>
                  <Btn full onClick={()=>nav('catalog')} sfx="nav" style={{marginTop:14}}><BookOpen size={16}/> Montar meu pedido</Btn>
                </Card>
              </div>
            : (campaign ? <HomePage pool={pool} minCards={campaign?.min_cards||150} pricing={pricing} closeDate={campaign?.close_at} theme={theme} nav={nav} wishlistCount={wishlistCount} cartCount={cartCount} bonusAvail={bonusAvail} campaign_status={campaign?.status} /> : <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div style={{textAlign:'center',padding:'6px 0 0'}}>
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text-faint)',letterSpacing:2.5,textTransform:'uppercase',fontFamily:"'Cinzel',serif"}}>Encomenda em Grupo</div>
            <h1 className="mp-gradient-text" style={{margin:'5px 0 0',fontSize:'var(--fs-2xl)',fontFamily:"'Cinzel',serif",background:'linear-gradient(135deg,'+theme.primary+','+theme.secondary+')',color:theme.primary}}>Cartas para Jogar</h1>
          </div>
          {appLoading
            ? <Card style={{padding:20,textAlign:'center'}}><Spin size={24}/><div style={{marginTop:8,fontSize:'var(--fs-sm)',color:'var(--text-faint)'}}>Carregando campanha...</div></Card>
            : <Card style={{padding:20,textAlign:'center'}}><div style={{fontSize:32,marginBottom:8}}>🔮</div><div style={{fontSize:14,fontWeight:700,marginBottom:4}}>Nenhuma encomenda ativa</div><div style={{fontSize:'var(--fs-xs)',color:'var(--text-faint)'}}>Aguarde a próxima encomenda ser aberta.</div></Card>
          }
          <Btn full variant="secondary" onClick={()=>{loadAppData(token,session?.user?.id);}} sfx="click"><RefreshCw size={16}/> Recarregar</Btn>
        </div>)}</>}
        {page === 'catalog' && <CatalogPage token={token} wishlist={wishlist} cartItems={cartItems} onAddToWishlist={handleAddToWishlist} priceBRL={priceBRL} theme={theme} campaignStatus={campaign?.status} orderMode={orderMode} tutStep={showTutorial?tutStep:-1} onTutNext={tutNext} />}
        {page === 'wants' && <WishlistPage wishlist={wishlist} cartItems={cartItems} onAddToCart={handleAddToCart} onAddAllToCart={handleAddAllToCart} onRemove={handleRemoveFromWishlist} onUpdateQty={handleUpdateWishlistQty} cartCount={cartCount} bonusAvail={bonusAvail} theme={theme} nav={nav} />}
        {page === 'cart' && <CartPage cartItems={cartItems} pricing={pricing} bonusAvail={bonusAvail} campaignStatus={campaign?.status} theme={theme} nav={nav} onRemoveFromCart={handleRemoveFromCart} onUpdateCartQty={handleUpdateCartQty} token={token} orderId={orderId} campaignId={campaign?.id} onOrderDone={handleOrderDone} toast={toast} profile={profile} previousPaidBatches={previousPaidBatches} orderMode={orderMode} indiv={indivPricing} />}
        {page === 'checkout' && (orderMode==='INDIVIDUAL' || campaignCanOrder(campaign?.status)) && <CheckoutPage cartItems={cartItems} pricing={pricing} bonusAvail={bonusAvail} theme={theme} nav={nav} profile={profile} token={token} orderId={orderId} campaignId={campaign?.id} campaignStatus={campaign?.status} onOrderDone={handleOrderDone} toast={toast} previousPaidBatches={previousPaidBatches} onRemoveFromCart={handleRemoveFromCart} onUpdateCartQty={handleUpdateCartQty} orderMode={orderMode} indiv={indivPricing} />}
        {page === 'checkout' && orderMode!=='INDIVIDUAL' && !campaignCanOrder(campaign?.status) && <CartPage cartItems={cartItems} pricing={pricing} bonusAvail={bonusAvail} campaignStatus={campaign?.status} theme={theme} nav={nav} onRemoveFromCart={handleRemoveFromCart} onUpdateCartQty={handleUpdateCartQty} token={token} orderId={orderId} campaignId={campaign?.id} onOrderDone={handleOrderDone} toast={toast} profile={profile} previousPaidBatches={previousPaidBatches} orderMode={orderMode} indiv={indivPricing} />}
        {page === 'success' && <SuccessPage lastOrder={lastOrder} theme={theme} nav={nav} />}
        {page === 'profile' && !profile && <div style={{padding:20,color:'var(--danger)',fontSize:'var(--fs-xs)'}}><div>profile: null</div><div>token: {token?'ok':'null'}</div><div>appLoading: {String(appLoading)}</div><Btn onClick={()=>loadAppData(token,session?.user?.id)} sfx="click"><RefreshCw size={14}/> Recarregar</Btn></div>}
        {page === 'profile' && profile && (() => { try { return <ProfileView profile={profile} token={token} theme={theme} nav={nav} isAdmin={isAdmin} setShowTutorial={setShowTutorial} onSaveProfile={handleSaveProfile} onLogout={handleLogout} myOrders={myOrders} onReloadOrders={()=>loadAppData(token,session?.user?.id)} toast={toast} campaign={campaign} colorMode={colorMode} onColorModeChange={setColorMode} />; } catch(e) { return <div style={{padding:20,color:'var(--danger)',fontSize:'var(--fs-xs)'}}>Crash: {e.message}</div>; } })()}
        {page === 'admin' && <AdminPage pool={pool} pricing={pricing} campaign={campaign} theme={theme} token={token} nav={nav} onReload={()=>loadAppData(token,session?.user?.id)} toast={toast} initialSection={adminTarget} />}
        {page === 'onboarding' && <OnboardingPage onComplete={handleOnboardingComplete} theme={theme} />}
      </main>
    </>}
  </div>);
}
