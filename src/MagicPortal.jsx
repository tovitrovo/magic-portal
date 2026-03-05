import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Home, ScrollText, ShoppingCart, User, Shield, Plus, Minus, Trash2, ChevronRight, ChevronLeft, Sparkles, LogOut, Check, Search, BookOpen, Eye, EyeOff, Mail, Lock, ArrowRight, X, Gift, Truck, CreditCard, Circle, CheckCircle, ArrowDown, Upload, Copy, Calendar, DollarSign, Settings, Camera, Phone, MessageCircle, Bell, Package, MapPin, Edit3, RefreshCw, Volume2, VolumeX, HelpCircle, Loader, AlertTriangle, Wifi, WifiOff } from 'lucide-react';

// ══════════════════════════════════════════════════════
// SUPABASE REST CLIENT
// ══════════════════════════════════════════════════════

const SB_URL = 'https://kjyqnlpiohoewmqmsuxp.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXFubHBpb2hvZXdtcW1zdXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNTA5NDAsImV4cCI6MjA4NzgyNjk0MH0.1BjTAFgv7yfJ00uY6WNlwUOYd4c4YOqFTV78CLvLBk0';


const supabase = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

// Edge Functions (garante apikey + Authorization corretos)
async function sbInvoke(fnName, body, token) {
  const { data, error } = await supabase.functions.invoke(fnName, {
    body: body || {},
    headers: { Authorization: `Bearer ${token || SB_KEY}` },
  });
  if (error) throw new Error(error.message || `Erro na função ${fnName}`);
  return data;
}


function sbH(token) {
  return { 'apikey': SB_KEY, 'Authorization': `Bearer ${token || SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
}

async function sbGet(table, query = '', token) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers: sbH(token) });
  if (!r.ok) { const t = await r.text(); throw new Error(`GET ${table}: ${t}`); }
  return r.json();
}

async function sbPost(table, data, token) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: 'POST', headers: sbH(token), body: JSON.stringify(data) });
  if (!r.ok) { const t = await r.text(); throw new Error(`POST ${table}: ${t}`); }
  return r.json();
}

async function sbUpsert(table, data, token) {
  const h = { ...sbH(token), 'Prefer': 'return=representation,resolution=merge-duplicates' };
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: 'POST', headers: h, body: JSON.stringify(data) });
  if (!r.ok) { const t = await r.text(); throw new Error('Erro ao criar conta. Tente novamente.'); }
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
  if (!r.ok) { const t = await r.text(); if (t.includes('already registered') || t.includes('already been registered')) throw new Error('Este usuário já está cadastrado'); throw new Error('Erro ao criar conta. Tente novamente.'); }
  const d = await r.json();
  if (d.error || d.msg) { const m = d.error?.message || d.msg || ''; if (m.includes('already registered') || m.includes('already been registered')) throw new Error('Este usuário já está cadastrado'); throw new Error('Erro ao criar conta. Tente novamente.'); }
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
const TC={Normal:'rgba(255,255,255,0.4)',Holo:'#c9a96e',Foil:'#d94452'};

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

function VirtualKeyboard({onKey,onBackspace,onDone,maxLen=6,currentLen=0}){
  const rows=[['1','2','3'],['4','5','6'],['7','8','9'],['⌫','0','OK']];
  return(<div style={{background:'rgba(0,0,0,0.6)',backdropFilter:'blur(10px)',borderRadius:16,padding:10,border:'1px solid rgba(255,255,255,0.06)',maxWidth:220,margin:'0 auto'}}>
    {rows.map((row,ri)=>(<div key={ri} style={{display:'flex',justifyContent:'center',gap:4,marginBottom:4}}>
      {row.map(k=>{
        const isBack=k==='⌫';const isOk=k==='OK';const isNum=!isBack&&!isOk;
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
  useEffect(()=>{const findEl=()=>{if(!s.spotlightId){setRect(null);return;}const el=document.getElementById(s.spotlightId);if(el){if(s.scrollTo)el.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>{const r=el.getBoundingClientRect();setRect({top:r.top-6,left:r.left-6,width:r.width+12,height:r.height+12});},s.scrollTo?300:0);}else{setRect(null);}};const t=setTimeout(findEl,200);return()=>clearTimeout(t);},[step,s.spotlightId]);
  const msgTop=rect?(rect.top>window.innerHeight/2?Math.max(60,rect.top-180):rect.top+rect.height+16):null;
  return(<div style={{position:'fixed',inset:0,zIndex:100,pointerEvents:'auto'}}>
    <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.78)'}} onClick={isFirstTime?undefined:onSkip}/>
    {rect&&<div style={{position:'absolute',top:rect.top,left:rect.left,width:rect.width,height:rect.height,borderRadius:14,border:'2.5px solid '+theme.primary,boxShadow:'0 0 0 9999px rgba(0,0,0,0.78), 0 0 30px '+theme.glow+', inset 0 0 20px '+theme.glow,background:'transparent',zIndex:101,pointerEvents:'none',animation:'tutPulse 1.5s ease-in-out infinite'}}/>}
    <div style={{position:rect?'absolute':'fixed',top:msgTop||'50%',left:'50%',transform:rect?'translateX(-50%)':'translate(-50%,-50%)',width:'calc(100% - 40px)',maxWidth:420,zIndex:102}}>
      <Card glow={theme.glow} style={{padding:18,background:'rgba(12,12,20,0.97)',border:'1px solid '+theme.primary+'30'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
          <div style={{width:32,height:32,borderRadius:10,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',display:'grid',placeItems:'center',fontSize:16}}>🧙</div>
          <div><div style={{fontWeight:800,fontSize:12}}>Goblin Guia</div><div style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>Passo {step+1} de {steps.length}</div></div>
        </div>
        <div style={{fontSize:14,fontWeight:700,color:theme.primary,marginBottom:4}}>{s.title}</div>
        <div style={{fontSize:13,lineHeight:1.6,color:'rgba(255,255,255,0.6)',marginBottom:14}}>{s.body}</div>
        <div style={{display:'flex',gap:5,justifyContent:'center',marginBottom:12}}>{steps.map((_,i)=><div key={i} style={{width:i===step?18:6,height:5,borderRadius:3,background:i===step?theme.primary:'rgba(255,255,255,0.08)',transition:'all .3s'}}/>)}</div>
        <div style={{display:'flex',gap:8}}>
          {!isFirstTime&&<Btn variant="ghost" onClick={onSkip} style={{flex:1,fontSize:12}} sfx="nav">Pular</Btn>}
          {isLast?<Btn onClick={onNext} style={{flex:2,fontSize:13}} sfx="confirm"><BookOpen size={15}/> Ver cartas!</Btn>:
          <Btn onClick={onNext} style={{flex:isFirstTime?1:2,fontSize:13}} sfx="click">Entendi <ArrowRight size={14}/></Btn>}
        </div>
      </Card>
    </div>
  </div>);
}

const TUTORIAL_STEPS=[
  {title:'Catálogo',body:'Aqui ficam todas as cartas. Busque pelo nome e filtre por tipo.',navTo:'catalog',tabIndex:1,spotlightId:null},
  {title:'Busca e filtros',body:'Use a barra de busca e os botões Normal, Holo e Foil.',navTo:'catalog',tabIndex:1,spotlightId:'tut-search-area',scrollTo:true},
  {title:'Adicionar à lista',body:'Clique no + para adicionar a carta na sua lista de wants.',navTo:'catalog',tabIndex:1,spotlightId:'tut-add-btn',scrollTo:true},
  {title:'Lista de Wants',body:'Suas cartas ficam aqui. Arraste para a direita para mover pro carrinho, ou para a esquerda para excluir.',navTo:'wants',tabIndex:2,spotlightId:null},
  {title:'Carrinho',body:'As cartas do carrinho são as que você vai comprar. Use o botão "Tudo pro carrinho" para selecionar todas de uma vez.',navTo:'wants',tabIndex:2,spotlightId:'tut-wants-tags',scrollTo:true},
  {title:'Bônus',body:'Se o grupo crescer e o preço cair, você ganha cartas extras de graça! Elas aparecem em destaque no carrinho.',navTo:'wants',tabIndex:2,spotlightId:'tut-bonus-card',scrollTo:true},
  {title:'Checkout',body:'Revise o pedido, preencha o endereço e calcule o frete.',navTo:'checkout',tabIndex:3,spotlightId:'tut-checkout-summary'},
  {title:'Pagamento',body:'Pague com segurança via Mercado Pago — cartão, boleto ou saldo.',navTo:'checkout',tabIndex:3,spotlightId:'tut-payment'},
  {title:'Perfil',body:'Veja seus pedidos, altere endereço, mude a senha e reabra este tutorial.',navTo:'profile',tabIndex:4,spotlightId:null},
];

// ══════════════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════════════

function HomePage({pool,tiers,priceBRL,closeDate,theme,nav,wantsCount,cartCount,bonusAvail,credit,campaign_status}){
  const tier=getTier(pool,tiers);const next=getNextTier(pool,tiers);
  const progress=next?Math.min(100,((pool-tier.min)/(next.min-tier.min))*100):100;
  const daysLeft=closeDate?Math.max(0,Math.ceil((new Date(closeDate)-new Date())/864e5)):null;
  return(<div style={{display:'flex',flexDirection:'column',gap:14}}>
    <div style={{textAlign:'center',padding:'6px 0 0'}}>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.28)',letterSpacing:2.5,textTransform:'uppercase',fontFamily:"'Cinzel',serif"}}>Encomenda em Grupo</div>
      <h1 style={{margin:'5px 0 0',fontSize:26,fontFamily:"'Cinzel',serif",background:'linear-gradient(135deg,'+theme.primary+','+theme.secondary+')',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Cartas para Jogar</h1>
    </div>
    {campaign_status&&campaign_status!=='ACTIVE'&&<Card style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:8,background:'rgba(217,68,82,0.06)',borderColor:'rgba(217,68,82,0.15)'}}>
      <AlertTriangle size={16} style={{color:'#d94452'}}/><div><div style={{fontSize:13,fontWeight:700,color:'#ff6b7a'}}>Campanha {campaign_status}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.3)'}}>Compras disponíveis apenas quando ativa</div></div>
    </Card>}
    {daysLeft!==null&&<Card style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:8,background:daysLeft<=3?'rgba(217,68,82,0.06)':undefined,borderColor:daysLeft<=3?'rgba(217,68,82,0.15)':undefined}}>
      <Calendar size={16} style={{color:daysLeft<=3?'#d94452':theme.primary}}/><div><div style={{fontSize:13,fontWeight:700,color:daysLeft<=3?'#ff6b7a':'#fff'}}>{daysLeft===0?'Último dia!':daysLeft+' dia'+(daysLeft>1?'s':'')}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.3)'}}>Fecha em {new Date(closeDate).toLocaleDateString('pt-BR')}</div></div>
    </Card>}
    <Card style={{padding:18}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:14}}>
        <div><div style={{fontSize:11,color:'rgba(255,255,255,0.3)',textTransform:'uppercase',letterSpacing:1,marginBottom:3,fontWeight:600}}>Quest Ativa</div><div style={{fontSize:20,fontWeight:800,fontFamily:"'Cinzel',serif",color:theme.primary}}>{tier.label}</div></div>
        <div style={{textAlign:'right'}}><div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:3}}>Preço/carta</div><div style={{fontSize:26,fontWeight:800,color:'#fff',lineHeight:1}}>R$ {priceBRL.toFixed(2)}</div></div>
      </div>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.25)',marginBottom:8,fontStyle:'italic'}}>{tier.quest||''}</div>
      <div style={{background:'rgba(0,0,0,0.35)',borderRadius:99,height:6,overflow:'hidden',marginBottom:8}}><div style={{width:progress+'%',height:'100%',borderRadius:99,background:'linear-gradient(90deg,'+theme.primary+','+theme.secondary+')',transition:'width .5s',boxShadow:'0 0 10px '+theme.glow}}/></div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'rgba(255,255,255,0.3)'}}><span>{pool} na pool</span>{next?<span>{next.min-pool} para {next.label} (R${next.brl.toFixed(2)})</span>:<span>Máximo!</span>}</div>
    </Card>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
      {[{icon:ScrollText,val:wantsCount,lbl:'Wants',c:theme.primary},{icon:ShoppingCart,val:cartCount,lbl:'Carrinho',c:'#c9a96e'},{icon:Gift,val:bonusAvail,lbl:'Bônus',c:'#2ee59d'}].map(s=>(<Card key={s.lbl} style={{textAlign:'center',padding:12}}><s.icon size={16} style={{color:s.c,marginBottom:3}}/><div style={{fontSize:18,fontWeight:800}}>{s.val}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{s.lbl}</div></Card>))}
    </div>
    {credit>0&&<Card style={{padding:'10px 14px',display:'flex',alignItems:'center',gap:8}}><DollarSign size={14} style={{color:'#c9a96e'}}/><div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>Crédito acumulado: <b style={{color:'#c9a96e'}}>R$ {credit.toFixed(2)}</b></div></Card>}
    <Card style={{padding:16}}>
      <SectionTitle sub="Complete quests coletivas para desbloquear preços menores">Quests</SectionTitle>
      {tiers.map((t,i)=>{const active=getTier(pool,tiers)===t;return(<div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',borderRadius:10,background:active?theme.primary+'12':'transparent',border:active?'1px solid '+theme.primary+'28':'1px solid transparent',marginBottom:2}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>{active&&<Sparkles size={12} style={{color:theme.primary}}/>}<span style={{fontWeight:active?700:400,color:active?'#fff':'rgba(255,255,255,0.35)',fontSize:13}}>{t.label}</span><span style={{fontSize:10,color:'rgba(255,255,255,0.18)'}}>{t.max>999999?t.min+'+':t.min+'-'+t.max}</span></div>
        <span style={{fontWeight:800,color:active?theme.primary:'rgba(255,255,255,0.45)',fontSize:14}}>R$ {t.brl.toFixed(2)}</span>
      </div>);})}
    </Card>
    <Btn full onClick={()=>{SFX.nav();nav('catalog');}} sfx="nav"><BookOpen size={18}/> Ver catálogo</Btn>
    {cartCount>0&&<Btn full variant="secondary" onClick={()=>nav('checkout')} sfx="nav"><ShoppingCart size={18}/> Checkout ({cartCount})</Btn>}
  </div>);
}

// ══════════════════════════════════════════════════════
// CATALOG — Supabase powered, server-side search/filter
// ══════════════════════════════════════════════════════

function CatalogPage({token,wants,onAddWant,priceBRL,theme}){
  const [search,setSearch]=useState('');const [typeF,setTypeF]=useState('Todos');const [cards,setCards]=useState([]);const [total,setTotal]=useState(0);
  const [page,setPage]=useState(0);const [loading,setLoading]=useState(false);const [addQty,setAddQty]=useState({});
  const [flyAnim,setFlyAnim]=useState(false);const PAGE_SIZE=20;const wantsCount=wants.reduce((s,w)=>s+w.quantity,0);

  const fetchCards = useCallback(async()=>{
    setLoading(true);
    try {
      let q = `select=id,name,type,image_url&is_active=eq.true&order=name`;
      if (search) q += `&name=ilike.*${encodeURIComponent(search)}*`;
      if (typeF !== 'Todos') q += `&type=eq.${typeF}`;
      q += `&limit=${PAGE_SIZE}&offset=${page*PAGE_SIZE}`;
      const data = await sbGet('cards', q, token);
      setCards(data);
      // Get count
      const countQ = `select=id&is_active=eq.true${search?'&name=ilike.*'+encodeURIComponent(search)+'*':''}${typeF!=='Todos'?'&type=eq.'+typeF:''}`;
      const countData = await sbGet('cards', countQ, token);
      setTotal(countData.length);
    } catch(e) { console.error(e); }
    setLoading(false);
  },[search,typeF,page,token]);

  useEffect(()=>{setPage(0);},[search,typeF]);
  useEffect(()=>{const t=setTimeout(fetchCards,300);return()=>clearTimeout(t);},[fetchCards,page]);

  const getQ=id=>addQty[id]||1;const setQ=(id,v)=>setAddQty(q=>({...q,[id]:Math.max(1,v)}));
  function add(card,qty){SFX.addCard();setFlyAnim(true);onAddWant(card,qty);setQ(card.id,1);}

  return(<div style={{display:'flex',flexDirection:'column',gap:12}}>
    <FlyingCard show={flyAnim} onDone={()=>setFlyAnim(false)}/>
    <div style={{display:'flex',gap:6}}><Tag><ScrollText size={11}/> {wantsCount} na lista</Tag></div>
    <div id="tut-search-area" style={{display:'flex',flexDirection:'column',gap:8}}>
      <Input icon={Search} placeholder="Buscar carta..." value={search} onChange={e=>setSearch(e.target.value)}/>
      <div style={{display:'flex',gap:5}}>
        {['Todos','Normal','Holo','Foil'].map(t=>(<button key={t} onClick={()=>{SFX.toggle();setTypeF(t);}} style={{flex:1,padding:'7px 0',borderRadius:10,border:'none',background:typeF===t?'var(--gp)':'rgba(255,255,255,0.04)',color:typeF===t?'#fff':'rgba(255,255,255,0.3)',fontWeight:600,fontSize:11,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}>{t}</button>))}
      </div>
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
                  {existsInWants&&<Tag color="#2ee59d" style={{fontSize:9,padding:'1px 6px'}}>na lista</Tag>}
                </div>
              </div>
              <button id={i===0?'tut-add-btn':undefined} onClick={()=>add(c,1)} style={{background:existsInWants?'rgba(46,229,157,0.15)':'var(--gp)',border:'none',borderRadius:10,padding:'8px 14px',cursor:'pointer',color:existsInWants?'#2ee59d':'#fff',display:'flex',alignItems:'center',gap:4,fontSize:12,fontWeight:600,fontFamily:"'Outfit',sans-serif"}}><Plus size={14}/></button>
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
  </div>);
}

// ══════════════════════════════════════════════════════
// WANTS — reads order_items, cart is local toggle
// ══════════════════════════════════════════════════════

function WantsPage({wants,cartIds,setCartIds,onRemoveWant,onUpdateWantQty,priceBRL,bonusAvail,theme,nav}){
  const [searchW,setSearchW]=useState('');
  const notInCart=wants.filter(w=>!cartIds.includes(w.id));
  const inCart=wants.filter(w=>cartIds.includes(w.id));
  const bonus=bonusAvail||0;
  function moveToCart(id){SFX.addCard();setCartIds(prev=>[...prev,id]);}
  function removeFromCart(id){SFX.toggle();setCartIds(prev=>prev.filter(x=>x!==id));}
  const fW=searchW?notInCart.filter(w=>w.card_name.toLowerCase().includes(searchW.toLowerCase())):notInCart;

  let bLeft=bonus;
  const cartBD=inCart.map(c=>{const bq=Math.min(c.quantity,bLeft);bLeft-=bq;return{...c,bonusQty:bq,paidQty:c.quantity-bq};});
  const totalB=cartBD.reduce((s,c)=>s+c.bonusQty,0);const totalP=cartBD.reduce((s,c)=>s+c.paidQty,0);

  return(<div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div id="tut-wants-tags" style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
      <Tag color={theme.primary}><ScrollText size={11}/> {notInCart.length} wants</Tag>
      <Tag color="#c9a96e"><ShoppingCart size={11}/> {inCart.length} no carrinho</Tag>
      {bonus>0&&<Tag color="#2ee59d"><Gift size={11}/> {bonus} bônus</Tag>}
      {notInCart.length>0&&<button onClick={()=>{SFX.confirm();setCartIds(wants.map(w=>w.id));}} style={{background:theme.primary+'15',border:'1px solid '+theme.primary+'30',borderRadius:99,padding:'4px 10px',color:theme.primary,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:"'Outfit',sans-serif",display:'flex',alignItems:'center',gap:4}}><CheckCircle size={11}/> Tudo pro carrinho</button>}
    </div>
    {bonus>0&&<Card id="tut-bonus-card" glow="rgba(46,229,157,0.12)" style={{padding:12,background:'rgba(46,229,157,0.03)'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}><Gift size={16} style={{color:'#2ee59d'}}/><div style={{fontSize:13}}><span style={{fontWeight:700,color:'#2ee59d'}}>{bonus} carta(s) bônus</span><div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:2}}>Primeiras do carrinho saem grátis!</div></div></div>
    </Card>}

    {/* WANTS LIST */}
    {notInCart.length>0&&<>
      <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.3)',textTransform:'uppercase',letterSpacing:1}}>Lista de Wants</div>
      <div style={{fontSize:10,color:'rgba(255,255,255,0.2)',marginTop:-8,fontStyle:'italic'}}>Arraste → carrinho | ← excluir</div>
      {notInCart.length>3&&<Input icon={Search} placeholder="Buscar..." value={searchW} onChange={e=>setSearchW(e.target.value)}/>}
      {fW.map((w,i)=>(<SwipeableCard key={w.id} onSwipeRight={()=>moveToCart(w.id)} onSwipeLeft={()=>onRemoveWant(w.id)} rightColor={theme.primary}>
        <Card style={{padding:'10px 12px'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{w.card_name}</div>
              <div style={{display:'flex',gap:6,alignItems:'center',marginTop:1}}>
                <span style={{fontSize:10,color:TC[w.card_type],fontWeight:700}}>{w.card_type}</span>
                <span style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>x{w.quantity}</span>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',background:'rgba(0,0,0,0.3)',borderRadius:10,border:'1px solid rgba(255,255,255,0.05)'}}>
              <button onClick={()=>onUpdateWantQty(w.id,w.quantity-1)} style={{background:'none',border:'none',color:'#fff',padding:'6px 9px',cursor:'pointer'}}><Minus size={12}/></button>
              <span style={{minWidth:20,textAlign:'center',fontSize:13,fontWeight:700}}>{w.quantity}</span>
              <button onClick={()=>onUpdateWantQty(w.id,w.quantity+1)} style={{background:'none',border:'none',color:'#fff',padding:'6px 9px',cursor:'pointer'}}><Plus size={12}/></button>
            </div>
          </div>
        </Card>
      </SwipeableCard>))}
    </>}

    {/* CART */}
    {inCart.length>0&&<>
      <div style={{fontSize:11,fontWeight:700,color:'#c9a96e',textTransform:'uppercase',letterSpacing:1,marginTop:4}}><ShoppingCart size={11}/> Carrinho ({inCart.length})</div>
      {cartBD.map((w,i)=>{
        return(<SwipeableCard key={w.id} onSwipeLeft={()=>removeFromCart(w.id)} leftLabel="Voltar" leftColor="#c9a96e" rightColor={null}>
          <Card style={{padding:'10px 12px',borderColor:w.bonusQty>0?'rgba(46,229,157,0.15)':theme.primary+'22'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{w.card_name}</div>
                <div style={{display:'flex',gap:6,alignItems:'center',marginTop:1}}>
                  <span style={{fontSize:10,color:TC[w.card_type],fontWeight:700}}>{w.card_type}</span>
                  <span style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>x{w.quantity}</span>
                  {w.bonusQty>0&&<Tag color="#2ee59d" style={{fontSize:9,padding:'1px 6px'}}>🎁 {w.bonusQty}</Tag>}
                  {w.paidQty>0&&<span style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>R$ {(w.paidQty*priceBRL).toFixed(2)}</span>}
                </div>
              </div>
            </div>
          </Card>
        </SwipeableCard>);
      })}
      <Card id="tut-cart-summary" style={{padding:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            {totalB>0&&<div style={{fontSize:12,color:'#2ee59d',fontWeight:600}}>🎁 {totalB} bônus (grátis)</div>}
            {totalP>0&&<div style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>💳 {totalP} pagas = R$ {(totalP*priceBRL).toFixed(2)}</div>}
            {totalP===0&&totalB>0&&<div style={{fontSize:12,color:'#2ee59d',fontWeight:700}}>Pedido 100% bônus!</div>}
          </div>
          <Btn onClick={()=>nav('checkout')} style={{padding:'10px 16px',fontSize:13}} sfx="nav"><ShoppingCart size={15}/> Checkout</Btn>
        </div>
      </Card>
    </>}

    {notInCart.length===0&&inCart.length===0&&<EmptyState icon={ScrollText} title="Lista vazia" sub="Adicione cartas pelo catálogo"/>}
  </div>);
}


// ══════════════════════════════════════════════════════
// ADDRESS FORM
// ══════════════════════════════════════════════════════

function AddressForm({address,setAddress,onCalcFrete,frete,loadingFrete}){
  const a=address||{};const upd=(k,v)=>setAddress({...a,[k]:v});
  const [cepLoading,setCepLoading]=useState(false);
  async function handleCep(raw){
    const clean=raw.replace(/\D/g,'').slice(0,8);
    upd('cep',clean);
    if(clean.length===8){
      setCepLoading(true);
      try{
        const r=await fetch(`https://viacep.com.br/ws/${clean}/json/`);
        const d=await r.json();
        if(!d.erro){
          setAddress(prev=>({...prev,cep:clean,rua:d.logradouro||prev.rua||'',bairro:d.bairro||prev.bairro||'',cidade:d.localidade||prev.cidade||'',uf:d.uf||prev.uf||''}));
        }
      }catch(e){console.error('ViaCEP',e);}
      setCepLoading(false);
    }
  }
  return(<div id="tut-address" style={{display:'flex',flexDirection:'column',gap:8}}>
    <div><label style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:3,display:'block'}}>CEP</label><div style={{position:'relative'}}><Input placeholder="00000-000" value={a.cep||''} onChange={e=>handleCep(e.target.value)}/>{cepLoading&&<div style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)'}}><Spin size={14}/></div>}</div></div>
    <div><label style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:3,display:'block'}}>Rua / Avenida</label><Input icon={MapPin} placeholder="Ex: Rua das Flores" value={a.rua||''} onChange={e=>upd('rua',e.target.value)}/></div>
    <div style={{display:'flex',gap:8}}>
      <div style={{flex:1}}><label style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:3,display:'block'}}>Número</label><Input placeholder="123" value={a.numero||''} onChange={e=>upd('numero',e.target.value)}/></div>
      <div style={{flex:2}}><label style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:3,display:'block'}}>Complemento</label><Input placeholder="Apto, bloco..." value={a.complemento||''} onChange={e=>upd('complemento',e.target.value)}/></div>
    </div>
    <div><label style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:3,display:'block'}}>Bairro</label><Input placeholder="Bairro" value={a.bairro||''} onChange={e=>upd('bairro',e.target.value)}/></div>
    <div style={{display:'flex',gap:8}}>
      <div style={{flex:3}}><label style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:3,display:'block'}}>Cidade</label><Input placeholder="Cidade" value={a.cidade||''} onChange={e=>upd('cidade',e.target.value)}/></div>
      <div style={{flex:1}}><label style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:3,display:'block'}}>UF</label><Input placeholder="SP" value={a.uf||''} onChange={e=>upd('uf',e.target.value.toUpperCase().slice(0,2))}/></div>
    </div>
    {frete&&frete.ok&&<div style={{marginTop:4,display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 12px',borderRadius:12,background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.05)'}}><div><div style={{fontWeight:600,fontSize:13}}>{frete.carrier}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.3)'}}>{frete.deadline_days} dias úteis</div></div><div style={{fontWeight:800}}>R$ {frete.price.toFixed(2)}</div></div>}
  </div>);
}

function AddressDisplay({address,onEdit}){
  const a=address||{};const hasAddr=a.rua;
  return(<Card style={{padding:16}}>
    <SectionTitle sub="Editável a qualquer momento">Endereço</SectionTitle>
    {hasAddr?<div style={{fontSize:13,color:'rgba(255,255,255,0.5)',lineHeight:1.6}}>
      <div>{a.rua}, {a.numero}{a.complemento?' - '+a.complemento:''}</div>
      <div>{a.bairro} - {a.cidade}/{a.uf}</div>
      <div style={{color:'rgba(255,255,255,0.3)'}}>CEP {a.cep}</div>
    </div>:<div style={{fontSize:13,color:'rgba(255,255,255,0.2)'}}>Nenhum endereço cadastrado</div>}
    <div style={{marginTop:8}}><Btn variant="secondary" onClick={()=>{SFX.click();onEdit();}} style={{padding:'8px 14px',fontSize:12}} sfx=""><Edit3 size={13}/> {hasAddr?'Editar':'Cadastrar'}</Btn></div>
  </Card>);
}

// ══════════════════════════════════════════════════════
// CHECKOUT
// ══════════════════════════════════════════════════════

function CheckoutPage({wants,cartIds,priceBRL,bonusAvail,theme,nav,profile,token,orderId,campaignId,onOrderDone,toast}){
  const [freteOptions,setFreteOptions]=useState([]);const [selectedFrete,setSelectedFrete]=useState(null);
  const [lF,setLF]=useState(false);const [submitting,setSubmitting]=useState(false);
  const [addr,setAddr]=useState({cep:profile?.cep||'',rua:profile?.rua||'',numero:profile?.numero||'',complemento:profile?.complemento||'',bairro:profile?.bairro||'',cidade:profile?.cidade||'',uf:profile?.uf||''});

  const cart=wants.filter(w=>cartIds.includes(w.id));
  const totalQty=cart.reduce((s,c)=>s+c.quantity,0);const bonus=bonusAvail||0;
  let bL=bonus;
  const bd=cart.map(c=>{const bq=Math.min(c.quantity,bL);bL-=bq;return{...c,bonusQty:bq,paidQty:c.quantity-bq};});
  const totalBonus=bd.reduce((s,c)=>s+c.bonusQty,0);const totalPaid=bd.reduce((s,c)=>s+c.paidQty,0);
  const isFullBonus=totalPaid===0&&totalBonus>0;
  const sub=totalPaid*priceBRL;const fV=selectedFrete?selectedFrete.price:0;const total=sub+fV;
  const cepClean=(addr.cep||'').replace(/\D/g,'');

  async function calcFrete(){
    if(cepClean.length<8){toast('CEP inválido','error');return;}
    setLF(true);setFreteOptions([]);setSelectedFrete(null);
    try{
      const d = await sbInvoke('frete', { cepDestino: cepClean, quantidade: totalQty }, token);

