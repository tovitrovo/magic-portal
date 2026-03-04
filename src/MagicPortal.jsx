import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Home, ScrollText, ShoppingCart, User, Shield, Plus, Minus, Trash2, ChevronRight, ChevronLeft, Sparkles, LogOut, Check, Search, BookOpen, Eye, EyeOff, Mail, Lock, ArrowRight, X, Gift, Truck, CreditCard, Circle, CheckCircle, ArrowDown, Upload, Copy, Calendar, DollarSign, Settings, Camera, Phone, MessageCircle, Bell, Package, MapPin, Edit3, RefreshCw, Volume2, VolumeX, HelpCircle, Loader, AlertTriangle, Wifi, WifiOff } from 'lucide-react';

// ══════════════════════════════════════════════════════
// SUPABASE REST CLIENT
// ══════════════════════════════════════════════════════

const SB_URL = 'https://kjyqnlpiohoewmqmsuxp.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqeXFubHBpb2hvZXdtcW1zdXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNTA5NDAsImV4cCI6MjA4NzgyNjk0MH0.1BjTAFgv7yfJ00uY6WNlwUOYd4c4YOqFTV78CLvLBk0';

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
  {title:'Catálogo',body:'Aqui ficam todas as cartas disponíveis. Use busca e filtros para encontrar o que precisa.',navTo:'catalog',tabIndex:1,spotlightId:null},
  {title:'Busca e filtros',body:'Digite o nome da carta na busca. Use os botões Normal, Holo e Foil para filtrar por tipo.',navTo:'catalog',tabIndex:1,spotlightId:'tut-search-area',scrollTo:true},
  {title:'Adicionar à lista',body:'Escolha a quantidade e clique na seta → para enviar a carta para seus Wants.',navTo:'catalog',tabIndex:1,spotlightId:'tut-add-btn',scrollTo:true},
  {title:'Sua lista de Wants',body:'Todas as cartas adicionadas ficam aqui organizadas.',navTo:'wants',tabIndex:2,spotlightId:null},
  {title:'Selecionar para o carrinho',body:'Toque no ○ círculo ao lado da carta para selecioná-la (fica ✓). As cartas selecionadas vão para o checkout.',navTo:'wants',tabIndex:2,spotlightId:'tut-cart-toggle',scrollTo:true},
  {title:'Bônus grátis',body:'Se o grupo cresceu e o preço caiu, as primeiras cartas selecionadas saem de graça! O contador de bônus aparece aqui no topo em destaque.',navTo:'wants',tabIndex:2,spotlightId:'tut-wants-tags',scrollTo:true},
  {title:'Checkout',body:'Revise seu pedido. Cartas bônus (grátis) aparecem separadas das pagas.',navTo:'checkout',tabIndex:3,spotlightId:'tut-checkout-summary'},
  {title:'Endereço e frete',body:'Preencha o CEP e o endereço será preenchido automaticamente.',navTo:'checkout',tabIndex:3,spotlightId:'tut-address'},
  {title:'Pagamento',body:'Finalize o pedido e pague com segurança via Mercado Pago. Cartão, boleto ou saldo.',navTo:'checkout',tabIndex:3,spotlightId:'tut-payment'},
  {title:'Perfil',body:'Veja pedidos, edite endereço, mude suas cores de mana e reabra este tutorial a qualquer momento.',navTo:'profile',tabIndex:4,spotlightId:null},
];

// ══════════════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════════════

function HomePage({pool,tiers,priceBRL,closeDate,theme,nav,wantsCount,cartCount,bonusAvail,credit}){
  const tier=getTier(pool,tiers);const next=getNextTier(pool,tiers);
  const progress=next?Math.min(100,((pool-tier.min)/(next.min-tier.min))*100):100;
  const daysLeft=closeDate?Math.max(0,Math.ceil((new Date(closeDate)-new Date())/864e5)):null;
  return(<div style={{display:'flex',flexDirection:'column',gap:14}}>
    <div style={{textAlign:'center',padding:'6px 0 0'}}>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.28)',letterSpacing:2.5,textTransform:'uppercase',fontFamily:"'Cinzel',serif"}}>Encomenda em Grupo</div>
      <h1 style={{margin:'5px 0 0',fontSize:26,fontFamily:"'Cinzel',serif",background:'linear-gradient(135deg,'+theme.primary+','+theme.secondary+')',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Cartas para Jogar</h1>
    </div>
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
    <div style={{display:'flex',gap:6}}><Tag color={theme.primary}><BookOpen size={11}/> {total}</Tag><Tag><ScrollText size={11}/> {wantsCount} wants</Tag></div>
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
                  {existsInWants&&<Tag color="#2ee59d" style={{fontSize:9,padding:'1px 6px'}}>✓ {existsInWants.quantity}</Tag>}
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',background:'rgba(0,0,0,0.3)',borderRadius:10,border:'1px solid rgba(255,255,255,0.05)'}}>
                <button onClick={()=>setQ(c.id,getQ(c.id)-1)} style={{background:'none',border:'none',color:'#fff',padding:'6px 8px',cursor:'pointer'}}><Minus size={12}/></button>
                <span style={{minWidth:18,textAlign:'center',fontSize:13,fontWeight:700}}>{getQ(c.id)}</span>
                <button onClick={()=>setQ(c.id,getQ(c.id)+1)} style={{background:'none',border:'none',color:'#fff',padding:'6px 8px',cursor:'pointer'}}><Plus size={12}/></button>
              </div>
              <button id={i===0?'tut-add-btn':undefined} onClick={()=>add(c,getQ(c.id))} style={{background:'var(--gp)',border:'none',borderRadius:10,padding:'8px 12px',cursor:'pointer',color:'#fff',display:'grid',placeItems:'center'}}><ArrowRight size={16}/></button>
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
  const cQty=wants.filter(w=>cartIds.includes(w.id)).reduce((s,w)=>s+w.quantity,0);
  const bonus=bonusAvail||0;
  function toggleCart(itemId){setCartIds(prev=>prev.includes(itemId)?prev.filter(x=>x!==itemId):[...prev,itemId]);SFX.toggle();}
  const fW=searchW?wants.filter(w=>w.card_name.toLowerCase().includes(searchW.toLowerCase())):wants;

  // Build cart breakdown
  const cartItems=wants.filter(w=>cartIds.includes(w.id));
  let bLeft=bonus;
  const cartBD=cartItems.map(c=>{const bq=Math.min(c.quantity,bLeft);bLeft-=bq;return{...c,bonusQty:bq,paidQty:c.quantity-bq};});
  const totalB=cartBD.reduce((s,c)=>s+c.bonusQty,0);const totalP=cartBD.reduce((s,c)=>s+c.paidQty,0);

  return(<div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div id="tut-wants-tags" style={{display:'flex',gap:6,flexWrap:'wrap'}}>
      <Tag color={theme.primary}><ScrollText size={11}/> {wants.reduce((s,w)=>s+w.quantity,0)} wants</Tag>
      <Tag color="#c9a96e"><ShoppingCart size={11}/> {cQty} selecionadas</Tag>
      {bonus>0&&<Tag color="#2ee59d"><Gift size={11}/> {bonus} bônus</Tag>}
    </div>
    {bonus>0&&<Card id="tut-bonus-card" glow="rgba(46,229,157,0.12)" style={{padding:12,background:'rgba(46,229,157,0.03)'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}><Gift size={16} style={{color:'#2ee59d'}}/><div style={{fontSize:13}}><span style={{fontWeight:700,color:'#2ee59d'}}>{bonus} carta(s) bônus</span><div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:2}}>Primeiras {bonus} selecionadas saem grátis. Use ou perca!</div></div></div>
    </Card>}
    {wants.length>3&&<Input icon={Search} placeholder="Buscar nos wants..." value={searchW} onChange={e=>setSearchW(e.target.value)}/>}
    {fW.length===0?<EmptyState icon={ScrollText} title="Lista vazia" sub="Adicione cartas pelo catálogo"/>:(
      <div style={{display:'flex',flexDirection:'column',gap:5}}>
        {fW.map((w,i)=>{
          const inC=cartIds.includes(w.id);
          const cb=inC?cartBD.find(c=>c.id===w.id):null;
          return(<Card key={w.id} style={{padding:'10px 12px',borderColor:inC?(cb&&cb.bonusQty>0?'rgba(46,229,157,0.15)':theme.primary+'22'):undefined}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <button id={i===0?'tut-cart-toggle':undefined} onClick={()=>toggleCart(w.id)} style={{background:'none',border:'none',cursor:'pointer',padding:2,flexShrink:0,color:inC?theme.primary:'rgba(255,255,255,0.12)'}}>{inC?<CheckCircle size={20}/>:<Circle size={20}/>}</button>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{w.card_name}</div>
                <div style={{display:'flex',gap:6,alignItems:'center',marginTop:1}}>
                  <span style={{fontSize:10,color:TC[w.card_type],fontWeight:700}}>{w.card_type}</span>
                  {inC&&cb&&cb.bonusQty>0&&<Tag color="#2ee59d" style={{fontSize:9,padding:'1px 6px'}}>🎁 {cb.bonusQty}</Tag>}
                  {inC&&cb&&cb.paidQty>0&&<span style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>R$ {(cb.paidQty*priceBRL).toFixed(2)}</span>}
                  {!inC&&<span style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>R$ {(w.quantity*priceBRL).toFixed(2)}</span>}
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',background:'rgba(0,0,0,0.3)',borderRadius:10,border:'1px solid rgba(255,255,255,0.05)'}}>
                <button onClick={()=>onUpdateWantQty(w.id,w.quantity-1)} style={{background:'none',border:'none',color:'#fff',padding:'6px 9px',cursor:'pointer'}}><Minus size={12}/></button>
                <span style={{minWidth:20,textAlign:'center',fontSize:13,fontWeight:700}}>{w.quantity}</span>
                <button onClick={()=>onUpdateWantQty(w.id,w.quantity+1)} style={{background:'none',border:'none',color:'#fff',padding:'6px 9px',cursor:'pointer'}}><Plus size={12}/></button>
              </div>
              <button onClick={()=>onRemoveWant(w.id)} style={{background:'none',border:'none',color:'rgba(255,70,70,0.35)',padding:3,cursor:'pointer'}}><Trash2 size={14}/></button>
            </div>
          </Card>);
        })}
      </div>
    )}
    {cQty>0&&<Card id="tut-cart-summary" style={{padding:14}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          {totalB>0&&<div style={{fontSize:12,color:'#2ee59d',fontWeight:600}}>🎁 {totalB} bônus (grátis)</div>}
          {totalP>0&&<div style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>💳 {totalP} pagas = R$ {(totalP*priceBRL).toFixed(2)}</div>}
          {totalP===0&&totalB>0&&<div style={{fontSize:12,color:'#2ee59d',fontWeight:700}}>Pedido 100% bônus!</div>}
        </div>
        <Btn onClick={()=>nav('checkout')} style={{padding:'10px 16px',fontSize:13}} sfx="nav"><ShoppingCart size={15}/> Checkout</Btn>
      </div>
    </Card>}
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
  const [frete,setFrete]=useState(null);const [lF,setLF]=useState(false);const [submitting,setSubmitting]=useState(false);
  const [addr,setAddr]=useState({cep:profile?.cep||'',rua:profile?.rua||'',numero:profile?.numero||'',complemento:profile?.complemento||'',bairro:profile?.bairro||'',cidade:profile?.cidade||'',uf:profile?.uf||''});

  const cart=wants.filter(w=>cartIds.includes(w.id));
  const totalQty=cart.reduce((s,c)=>s+c.quantity,0);const bonus=bonusAvail||0;
  let bL=bonus;
  const bd=cart.map(c=>{const bq=Math.min(c.quantity,bL);bL-=bq;return{...c,bonusQty:bq,paidQty:c.quantity-bq};});
  const totalBonus=bd.reduce((s,c)=>s+c.bonusQty,0);const totalPaid=bd.reduce((s,c)=>s+c.paidQty,0);
  const isFullBonus=totalPaid===0&&totalBonus>0;
  const sub=totalPaid*priceBRL;const fV=frete?frete.price:0;const total=sub+fV;

  async function finalize(){
    setSubmitting(true);
    try {
      // 1. Create order_batch
      const batchData = {
        order_id: orderId, status: 'DRAFT', brl_unit_price_locked: priceBRL,
        qty_in_batch: totalQty, subtotal_locked: sub, shipping_locked: fV,
        total_locked: isFullBonus ? 0 : total, payment_method: 'MERCADO_PAGO',
      };
      const [batch] = await sbPost('order_batches', batchData, token);

      // 2. Assign batch_id to cart items
      for (const item of cart) {
        await sbPatch('order_items', `id=eq.${item.id}`, { batch_id: batch.id, unit_price_brl: priceBRL }, token);
      }

      // 3. Update order totals
      await sbPatch('orders', `id=eq.${orderId}`, {
        qty_paid: totalPaid, qty_bonus: totalBonus, shipping_price_brl_locked: fV,
      }, token);

      // 4. Save address to profile
      if (addr.rua) {
        await sbPatch('profiles', `id=eq.${profile.id}`, {
          cep: addr.cep, rua: addr.rua, numero: addr.numero,
          complemento: addr.complemento, bairro: addr.bairro, cidade: addr.cidade, uf: addr.uf
        }, token);
      }

      // 5. Call Mercado Pago Edge Function (if not full bonus)
      if (!isFullBonus) {
        try {
          const mpRes = await fetch(`${SB_URL}/functions/v1/create-mp-link`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch_id: batch.id, order_id: orderId, total_brl: total, description: `Cartas para Jogar - ${totalPaid} cartas` })
          });
          const mpData = await mpRes.json();
          if (mpData.payment_url) {
            window.open(mpData.payment_url, '_blank');
          }
        } catch(mpErr) {
          console.warn('MP link:', mpErr);
          toast('Pedido salvo! Link de pagamento será enviado por WhatsApp.', 'info');
        }
      }

      SFX.confirm();
      onOrderDone({ method: isFullBonus ? 'bonus' : 'mp', totalPaid, totalBonus, priceBRL, isFullBonus, batchId: batch.id, cards: cart.map(c=>({name:c.card_name,type:c.card_type,qty:c.quantity})) });
      nav('success');
    } catch(e) {
      console.error(e);
      toast('Erro ao finalizar: ' + e.message, 'error');
    }
    setSubmitting(false);
  }

  if(totalQty===0)return(<div style={{paddingTop:40}}><EmptyState icon={ShoppingCart} title="Carrinho vazio" sub="Selecione cartas nos wants"/><div style={{textAlign:'center',marginTop:16}}><Btn onClick={()=>nav('wants')} sfx="nav"><ScrollText size={16}/> Wants</Btn></div></div>);

  return(<div style={{display:'flex',flexDirection:'column',gap:14}}>
    <Card id="tut-checkout-summary" style={{padding:18}}>
      <SectionTitle sub={totalQty+' cartas ('+totalBonus+' bônus + '+totalPaid+' pagas)'}>Resumo</SectionTitle>
      {totalBonus>0&&<><div style={{fontSize:11,fontWeight:700,color:'#2ee59d',marginBottom:6,display:'flex',alignItems:'center',gap:5}}><Gift size={12}/> Bônus (grátis)</div>
        {bd.filter(c=>c.bonusQty>0).map((c,i)=>(<div key={'b'+i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',fontSize:13,borderBottom:'1px solid rgba(46,229,157,0.08)'}}><span style={{color:'rgba(255,255,255,0.6)'}}>{c.card_name} <span style={{color:TC[c.card_type],fontSize:10,fontWeight:700}}>{c.card_type}</span> x{c.bonusQty}</span><span style={{fontWeight:700,color:'#2ee59d'}}>R$ 0,00</span></div>))}</>}
      {totalPaid>0&&<><div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',marginTop:totalBonus>0?12:0,marginBottom:6,display:'flex',alignItems:'center',gap:5}}><CreditCard size={12}/> Pagas</div>
        {bd.filter(c=>c.paidQty>0).map((c,i)=>(<div key={'p'+i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',fontSize:13,borderBottom:'1px solid rgba(255,255,255,0.03)'}}><span style={{color:'rgba(255,255,255,0.6)'}}>{c.card_name} <span style={{color:TC[c.card_type],fontSize:10,fontWeight:700}}>{c.card_type}</span> x{c.paidQty}</span><span style={{fontWeight:700}}>R$ {(c.paidQty*priceBRL).toFixed(2)}</span></div>))}</>}
      <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:5}}>
        {totalPaid>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'rgba(255,255,255,0.4)'}}><span>Subtotal</span><span style={{color:'#fff',fontWeight:600}}>R$ {sub.toFixed(2)}</span></div>}
        {!isFullBonus&&<div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'rgba(255,255,255,0.4)'}}><span>Frete</span><span style={{color:'#fff',fontWeight:600}}>{frete?'R$ '+fV.toFixed(2):'—'}</span></div>}
        <div style={{height:1,background:'rgba(255,255,255,0.06)',margin:'3px 0'}}/>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:18,fontWeight:800}}><span>Total</span><span style={{color:isFullBonus?'#2ee59d':theme.primary}}>{isFullBonus?'R$ 0,00 (bônus!)':'R$ '+total.toFixed(2)}</span></div>
      </div>
    </Card>

    {!isFullBonus&&<Card style={{padding:16}}>
      <SectionTitle>Endereço de entrega</SectionTitle>
      <AddressForm address={addr} setAddress={setAddr} onCalcFrete={()=>{}} frete={frete} loadingFrete={lF}/>
    </Card>}

    <Card id="tut-payment" style={{padding:16}}>
      {isFullBonus?<Btn full variant="success" onClick={finalize} disabled={submitting} sfx="">{submitting?<Spin size={16}/>:<><Gift size={18}/> Finalizar pedido bônus</>}</Btn>:
      <><SectionTitle sub="Pagamento seguro via Mercado Pago">Pagamento</SectionTitle>
      <Btn full onClick={finalize} disabled={submitting} sfx="">{submitting?<Spin size={16}/>:<><CreditCard size={18}/> Pagar R$ {total.toFixed(2)}</>}</Btn></>}
    </Card>
  </div>);
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

function ProfileView({profile,token,theme,nav,isAdmin,setShowTutorial,onSaveProfile,onLogout,myOrders=[]}){
  const [colors,setColors]=useState(profile?.mana_color_1&&profile?.mana_color_2?[profile.mana_color_1,profile.mana_color_2]:['U','R']);
  const [editAddr,setEditAddr]=useState(false);
  const [addr,setAddr]=useState({cep:profile?.cep||'',rua:profile?.rua||'',numero:profile?.numero||'',complemento:profile?.complemento||'',bairro:profile?.bairro||'',cidade:profile?.cidade||'',uf:profile?.uf||''});
  const [saving,setSaving]=useState(false);
  function toggleC(k){setColors(p=>{if(p.includes(k))return p.filter(c=>c!==k);if(p.length>=2)return[p[1],k];return[...p,k];});}
  const guild=colors.length===2?getGuild(colors[0],colors[1]):null;const gT=guild?GT[guild]:null;
  const origColors=[profile?.mana_color_1,profile?.mana_color_2].filter(Boolean);
  const changed=JSON.stringify(colors)!==JSON.stringify(origColors);

  async function saveGuild(){
    setSaving(true);
    await onSaveProfile({mana_color_1:colors[0],mana_color_2:colors[1],guild:guild||''});
    setSaving(false);
  }
  async function saveAddr(){
    setSaving(true);
    await onSaveProfile(addr);
    setEditAddr(false);
    setSaving(false);
  }

  return(<div style={{display:'flex',flexDirection:'column',gap:14}}>
    <Card style={{padding:18,textAlign:'center'}}>{guild&&<GuildBadge guild={guild} size={44}/>}<div style={{marginTop:8,fontWeight:700,fontSize:16}}>{profile?.name||profile?.email||'—'}</div>{profile?.whatsapp&&<div style={{fontSize:12,color:'rgba(255,255,255,0.3)',marginTop:2,display:'flex',alignItems:'center',justifyContent:'center',gap:4}}><Phone size={11}/>{profile.whatsapp}</div>}<div style={{fontSize:12,color:'rgba(255,255,255,0.3)',marginTop:2}}>{guild?'Guilda '+guild:'Escolha 2 cores'}</div></Card>

    <Card style={{padding:16}}>
      <SectionTitle sub="Histórico de pedidos">Meus Pedidos</SectionTitle>
      {myOrders.length===0?<div style={{fontSize:13,color:'rgba(255,255,255,0.25)',textAlign:'center',padding:12}}>Nenhum pedido ainda</div>:
      myOrders.map((o,i)=>(<div key={o.id||i} style={{padding:'10px 0',borderBottom:i<myOrders.length-1?'1px solid rgba(255,255,255,0.04)':'none'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <Tag style={{fontSize:9,padding:'2px 6px'}}>{o.payment_method==='MERCADO_PAGO'?'MP':'Bônus'}</Tag>
            <span style={{fontSize:12,fontWeight:700}}>{Number(o.total_locked)>0?'R$ '+Number(o.total_locked).toFixed(2):'Bônus'}</span>
          </div>
          <Tag color={o.status==='DRAFT'?'#c9a96e':o.status==='CONFIRMED'?'#2ee59d':'#4a90d9'} style={{fontSize:10}}>{o.status==='DRAFT'?'Pendente':o.status==='CONFIRMED'?'Pago':o.status}</Tag>
        </div>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.3)'}}>
          {o.qty_in_batch} cartas | {new Date(o.created_at).toLocaleDateString('pt-BR')}
          {o.cards&&<span> | {o.cards.map(c=>c.name+' x'+c.qty).join(', ')}</span>}
        </div>
      </div>))}
    </Card>

    {editAddr?<Card style={{padding:16}}>
      <SectionTitle>Editar endereço</SectionTitle>
      <AddressForm address={addr} setAddress={setAddr} onCalcFrete={()=>{}} frete={null} loadingFrete={false}/>
      <div style={{display:'flex',gap:8,marginTop:10}}>
        <Btn variant="success" onClick={saveAddr} disabled={saving} style={{flex:1}} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar</>}</Btn>
        <Btn variant="ghost" onClick={()=>setEditAddr(false)} style={{flex:1}} sfx="click">Cancelar</Btn>
      </div>
    </Card>:<AddressDisplay address={addr} onEdit={()=>setEditAddr(true)}/>}

    <Card style={{padding:16}}>
      <SectionTitle sub="2 cores = guilda">Mana</SectionTitle>
      <div style={{display:'flex',justifyContent:'center',gap:12,margin:'14px 0'}}>{MANA_COLORS.map(m=><ManaOrb key={m.key} mana={m.key} selected={colors.includes(m.key)} onClick={()=>toggleC(m.key)} size={46}/>)}</div>
      {guild&&<div style={{textAlign:'center',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}><GuildBadge guild={guild} size={18}/><span style={{fontWeight:700,fontSize:15,color:gT?gT.primary:'#fff'}}>{guild}</span></div>}
      {changed&&guild&&<Btn full variant="success" onClick={saveGuild} disabled={saving} sfx="success">{saving?<Spin size={14}/>:<><Check size={14}/> Salvar guilda</>}</Btn>}
    </Card>

    <Btn full variant="secondary" onClick={()=>{SFX.nav();setShowTutorial(true);}} sfx=""><HelpCircle size={16}/> Ver tutorial</Btn>
    {isAdmin&&<Btn full variant="warn" onClick={()=>nav('admin')} sfx="nav"><Shield size={16}/> Painel Admin</Btn>}
    <Btn full variant="danger" onClick={onLogout} sfx="click"><LogOut size={14}/> Sair</Btn>
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
        await sbUpsert('profiles', { id: userId, name, whatsapp, is_admin: false }, token);
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
    {showVK&&<div style={{marginTop:4}}><VirtualKeyboard onKey={vkKey} onBackspace={vkBack} onDone={()=>setShowVK(false)} maxLen={6} currentLen={currentVKLen}/></div>}
    {err&&<div style={{fontSize:12,color:'#ff6b7a',textAlign:'center',padding:4}}><AlertTriangle size={12}/> {err}</div>}
    <Btn full onClick={submit} disabled={!canSubmit} sfx="">{loading?<Spin size={16}/>:<>{mode==='login'?'Entrar':'Criar conta'} <ArrowRight size={16}/></>}</Btn>
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
    {mood:'🧙',title:'A Convocação',body:'"Sozinho você paga caro. Quando a guilda se une, o mana flui e os preços caem."'},
    {mood:'⚡',title:'O Encantamento do Bônus',body:'"Se o preço do tier cair depois, a diferença vira cartas extras. Mas se não escolher antes do fechamento, o encantamento se dissipa."'},
    {mood:'🔮',title:'Escolha sua Guilda',body:'"Duas cores de mana definem sua essência. Cada combinação invoca uma guilda diferente."',hasColors:true},
  ];
  const s=steps[step];

  if(askTutorial)return(<div style={{display:'flex',flexDirection:'column',gap:16,paddingTop:40,alignItems:'center',textAlign:'center'}}>
    <div style={{width:56,height:56,borderRadius:14,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',display:'grid',placeItems:'center',fontSize:28}}>🧙</div>
    <h2 style={{fontFamily:"'Cinzel',serif",fontSize:20}}>"Agora vou guiar seus primeiros passos!"</h2>
    <p style={{fontSize:13,color:'rgba(255,255,255,0.4)',maxWidth:300,fontStyle:'italic'}}>Um grimório rápido sobre o ritual da encomenda</p>
    <div style={{display:'flex',gap:10,width:'100%',maxWidth:300}}>
      <Btn onClick={()=>onComplete(colors,guild,true)} style={{flex:1}} sfx="confirm">Vamos lá! 🔮</Btn>
    </div>
  </div>);

  return(<div style={{display:'flex',flexDirection:'column',gap:16,paddingTop:16,minHeight:'70vh',justifyContent:'space-between'}}>
    <div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18}}><div style={{width:44,height:44,borderRadius:12,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',display:'grid',placeItems:'center',fontSize:22}}>{s.mood}</div><div><div style={{fontWeight:800,fontSize:14}}>Goblin Guia</div><div style={{fontSize:11,color:'rgba(255,255,255,0.28)'}}>Guardião do Portal</div></div></div>
      <h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:23}}>{s.title}</h1>
      <p style={{fontSize:14,lineHeight:1.7,color:'rgba(255,255,255,0.55)',marginTop:10,fontStyle:'italic'}}>{s.body}</p>
      {s.hasColors&&<div style={{marginTop:18}}><div style={{display:'flex',justifyContent:'center',gap:14,marginBottom:14}}>{MANA_COLORS.map(m=><ManaOrb key={m.key} mana={m.key} selected={colors.includes(m.key)} onClick={()=>toggleC(m.key)} size={50}/>)}</div>{guild&&<div style={{textAlign:'center'}}><GuildBadge guild={guild} size={24}/><span style={{fontFamily:"'Cinzel',serif",fontSize:18,fontWeight:700,color:gT.primary,marginLeft:8}}>{guild}</span></div>}</div>}
    </div>
    <div>
      <div style={{display:'flex',gap:5,justifyContent:'center',marginBottom:12}}>{steps.map((_,i)=><div key={i} style={{width:i===step?20:6,height:6,borderRadius:3,background:i===step?gT.primary:'rgba(255,255,255,0.1)'}}/>)}</div>
      <div style={{display:'flex',gap:10}}>{step>0&&<Btn variant="secondary" onClick={()=>setStep(s=>s-1)} style={{flex:1}} sfx="nav"><ChevronLeft size={15}/></Btn>}{step<steps.length-1?<Btn onClick={()=>setStep(s=>s+1)} style={{flex:1}} sfx="click">Próximo <ChevronRight size={15}/></Btn>:<Btn onClick={()=>{if(!guild)return;SFX.confirm();setAskTutorial(true);}} disabled={!guild} style={{flex:1}} sfx=""><Sparkles size={15}/> Continuar</Btn>}</div>
    </div>
  </div>);
}

// ══════════════════════════════════════════════════════
// ADMIN (reads from Supabase)
// ══════════════════════════════════════════════════════

function AdminPage({pool,tiers,priceBRL,pricing,campaign,theme,token,nav}){
  const [tab,setTab]=useState('orders');const [orders,setOrders]=useState([]);const [loading,setLoading]=useState(true);
  const tier=getTier(pool,tiers);

  useEffect(()=>{
    (async()=>{
      try {
        const data = await sbGet('orders', `select=id,user_id,status,qty_paid,qty_bonus,created_at,profiles(name,whatsapp,guild),order_batches(id,status,total_locked,payment_method,confirmed_at)&campaign_id=eq.${campaign?.id}&order=created_at.desc`, token);
        setOrders(data);
      } catch(e) { console.error(e); }
      setLoading(false);
    })();
  },[token,campaign?.id]);

  const tabs=[{key:'orders',icon:Package,label:'Pedidos'},{key:'config',icon:Settings,label:'Config'}];
  return(<div style={{display:'flex',flexDirection:'column',gap:12}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}><Shield size={18} style={{color:theme.primary}}/><span style={{fontFamily:"'Cinzel',serif",fontSize:18,fontWeight:700}}>Admin</span></div>
      <Btn variant="ghost" onClick={()=>nav('profile')} style={{padding:'6px 10px',fontSize:12}} sfx="nav"><ChevronLeft size={14}/></Btn>
    </div>
    <Card style={{padding:12}}><div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
      <div><span style={{color:'rgba(255,255,255,0.3)'}}>Pool</span> <b style={{color:theme.primary}}>{pool}</b></div>
      <div><span style={{color:'rgba(255,255,255,0.3)'}}>Tier</span> <b style={{color:theme.primary}}>{tier.label} R${priceBRL.toFixed(2)}</b></div>
      <div><span style={{color:'rgba(255,255,255,0.3)'}}>Câmbio</span> <b>R$ {(pricing?.usd_brl_rate||0).toFixed(2)}</b></div>
    </div></Card>
    <div style={{display:'flex',gap:4}}>{tabs.map(t=>(<button key={t.key} onClick={()=>{SFX.toggle();setTab(t.key);}} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:4,padding:'7px 0',borderRadius:10,border:'none',background:tab===t.key?theme.primary+'15':'rgba(255,255,255,0.025)',color:tab===t.key?theme.primary:'rgba(255,255,255,0.3)',fontWeight:600,fontSize:11,cursor:'pointer',fontFamily:"'Outfit',sans-serif"}}><t.icon size={13}/>{t.label}</button>))}</div>

    {tab==='orders'&&<>{loading?<div style={{textAlign:'center',padding:30}}><Spin size={24}/></div>:orders.length===0?<EmptyState icon={Package} title="Nenhum pedido" sub=""/>:orders.map(o=>(<Card key={o.id} style={{padding:12}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontWeight:800,fontSize:12}}>{o.profiles?.name||'—'}</span>
          {o.profiles?.guild&&<GuildBadge guild={o.profiles.guild} size={16}/>}
        </div>
        <Tag color={o.status==='DRAFT'?'#c9a96e':'#2ee59d'} style={{fontSize:10}}>{o.status}</Tag>
      </div>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.35)'}}>
        {o.qty_paid} pagas | {o.qty_bonus} bônus
        {o.order_batches?.map((b,i)=><span key={i}> | {b.payment_method} {b.status} R${Number(b.total_locked).toFixed(2)}</span>)}
      </div>
    </Card>))}</>}

    {tab==='config'&&<>
      <Card style={{padding:16}}>
        <SectionTitle>Campanha</SectionTitle>
        <div style={{fontSize:13,color:'rgba(255,255,255,0.5)'}}>{campaign?.name||'—'}</div>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:4}}>Fecha: {campaign?.close_at?new Date(campaign.close_at).toLocaleDateString('pt-BR'):'—'}</div>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.3)'}}>Status: {campaign?.status}</div>
      </Card>
      <Card style={{padding:16}}>
        <SectionTitle>Tiers</SectionTitle>
        {tiers.map((t,i)=>(<div key={i} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid rgba(255,255,255,0.04)',fontSize:13}}>
          <span style={{color:'rgba(255,255,255,0.5)'}}>{t.label} ({t.min}-{t.max>999999?'∞':t.max})</span>
          <span style={{fontWeight:700}}>US${t.usd.toFixed(2)} → R$ {t.brl.toFixed(2)}</span>
        </div>))}
      </Card>
      <Card style={{padding:16}}>
        <SectionTitle>Pricing</SectionTitle>
        {pricing&&Object.entries(pricing).filter(([k])=>!['id','is_active','created_at','updated_at'].includes(k)).map(([k,v])=>(<div key={k} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:12,color:'rgba(255,255,255,0.4)'}}><span>{k}</span><span style={{fontWeight:600,color:'#fff'}}>{typeof v==='number'?v.toFixed(2):String(v)}</span></div>))}
      </Card>
    </>}
  </div>);
}

// ══════════════════════════════════════════════════════
// MAIN — Supabase state management
// ══════════════════════════════════════════════════════

export default function MagicPortal(){
  // Auth state
  const [session,setSession]=useState(null); // {access_token, user}
  const [profile,setProfile]=useState(null);
  const [isNew,setIsNew]=useState(false);

  // Data state
  const [campaign,setCampaign]=useState(null);
  const [tiers,setTiers]=useState([]);
  const [pricing,setPricing]=useState(null);
  const [orderId,setOrderId]=useState(null);
  const [wants,setWants]=useState([]); // order_items with card info
  const [cartIds,setCartIds]=useState([]);
  const [bonusGrants,setBonusGrants]=useState([]);
  const [lastOrder,setLastOrder]=useState(null);
  const [myOrders,setMyOrders]=useState([]);

  // UI state
  const [page,setPage]=useState('home');
  const [showTutorial,setShowTutorial]=useState(false);
  const [tutStep,setTutStep]=useState(0);
  const [isFirstTimeTut,setIsFirstTimeTut]=useState(false);
  const [soundOn,setSoundOn]=useState(true);
  const [appLoading,setAppLoading]=useState(false);
  const [toastMsg,setToastMsg]=useState(null);

  const token = session?.access_token;
  const guild = profile?.guild || 'Izzet';
  const theme = GT[guild] || GT.Izzet;
  const isAdmin = profile?.is_admin || false;
  const nav = useCallback(p=>{SFX.nav();setPage(p);},[]);

  function toast(msg,type='info'){setToastMsg({msg,type});setTimeout(()=>setToastMsg(null),4000);}

  // Compute tiers with BRL prices
  const computedTiers = useMemo(()=>{
    return tiers.map(t=>({
      ...t,
      min: t.min_qty,
      max: t.max_qty || 9999999,
      usd: Number(t.usd_per_card),
      brl: calcBrlPrice(Number(t.usd_per_card), pricing),
      quest: t.quest_text || '',
    }));
  },[tiers,pricing]);

  const pool = campaign?.pool_qty_confirmed || 0;
  const tier = computedTiers.length>0 ? getTier(pool, computedTiers) : null;
  const priceBRL = tier?.brl || 0;
  const bonusAvail = bonusGrants.filter(b=>b.status==='AVAILABLE').reduce((s,b)=>s+b.bonus_qty,0);

  // ─── Load data after login ─────────────────────────
  async function loadAppData(tkn, userId) {
    setAppLoading(true);
    try {
      // Profile
      const [prof] = await sbGet('profiles', `id=eq.${userId}`, tkn);
      setProfile(prof);

      // Campaign
      const camps = await sbGet('campaigns', `status=eq.ACTIVE&limit=1`, tkn);
      const camp = camps[0] || null;
      setCampaign(camp);

      // Tiers
      if (camp) {
        const t = await sbGet('tiers', `campaign_id=eq.${camp.id}&order=rank`, tkn);
        setTiers(t);
      }

      // Pricing
      const [pc] = await sbGet('pricing_config', `is_active=eq.true&limit=1`, tkn);
      setPricing(pc);

      // Order (get or create DRAFT)
      if (camp) {
        let ords = await sbGet('orders', `campaign_id=eq.${camp.id}&user_id=eq.${userId}&status=eq.DRAFT`, tkn);
        let ord = ords[0];
        if (!ord) {
          const [newOrd] = await sbPost('orders', { campaign_id: camp.id, user_id: userId, status: 'DRAFT' }, tkn);
          ord = newOrd;
        }
        setOrderId(ord.id);

        // Wants (order_items without batch_id)
        const items = await sbGet('order_items', `order_id=eq.${ord.id}&batch_id=is.null&is_bonus=eq.false&select=id,card_id,quantity,cards(name,type)`, tkn);
        setWants(items.map(i=>({...i,card_name:i.cards?.name||'?',card_type:i.cards?.type||'Normal'})));

        // Bonus grants
        const bg = await sbGet('bonus_grants', `user_id=eq.${userId}&campaign_id=eq.${camp.id}`, tkn);
        setBonusGrants(bg);

        // Order history (batches with items)
        const batches = await sbGet('order_batches', `order_id=eq.${ord.id}&select=id,status,total_locked,payment_method,created_at,qty_in_batch`, tkn);
        setMyOrders(batches);
      }
    } catch(e) {
      console.error('loadAppData', e);
      toast('Erro ao carregar dados: '+e.message, 'error');
    }
    setAppLoading(false);
  }

  // ─── Auth handler ──────────────────────────────────
  async function handleLogin(res, type) {
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
    setSession(null);setProfile(null);setCampaign(null);setTiers([]);setPricing(null);
    setOrderId(null);setWants([]);setCartIds([]);setBonusGrants([]);setMyOrders([]);
    setPage('home');setIsNew(false);
  }

  // ─── Onboarding complete ──────────────────────────
  async function handleOnboardingComplete(colors, guild, showTut) {
    if (token && profile) {
      await sbPatch('profiles', `id=eq.${profile.id}`, { mana_color_1: colors[0], mana_color_2: colors[1], guild: guild || '' }, token);
      setProfile(p => ({ ...p, mana_color_1: colors[0], mana_color_2: colors[1], guild }));
    }
    setIsNew(false);
    if (showTut) { setIsFirstTimeTut(true); setShowTutorial(true); }
    setPage('home');
  }

  // ─── Save profile ─────────────────────────────────
  async function handleSaveProfile(data) {
    if (!token || !profile) return;
    await sbPatch('profiles', `id=eq.${profile.id}`, data, token);
    setProfile(p => ({ ...p, ...data }));
    SFX.success();
    toast('Perfil salvo!', 'success');
  }

  // ─── Add want ─────────────────────────────────────
  async function handleAddWant(card, qty) {
    if (!token || !orderId) { toast('Faça login primeiro','error'); return; }
    try {
      const existing = wants.find(w => w.card_id === card.id);
      if (existing) {
        const newQty = existing.quantity + qty;
        await sbPatch('order_items', `id=eq.${existing.id}`, { quantity: newQty }, token);
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

  // ─── Remove want ──────────────────────────────────
  async function handleRemoveWant(itemId) {
    if (!token) return;
    await sbDelete('order_items', `id=eq.${itemId}`, token);
    setWants(prev => prev.filter(w => w.id !== itemId));
    setCartIds(prev => prev.filter(x => x !== itemId));
    SFX.click();
  }

  // ─── Update want qty ─────────────────────────────
  async function handleUpdateWantQty(itemId, newQty) {
    if (!token) return;
    if (newQty <= 0) { handleRemoveWant(itemId); return; }
    await sbPatch('order_items', `id=eq.${itemId}`, { quantity: newQty }, token);
    setWants(prev => prev.map(w => w.id === itemId ? { ...w, quantity: newQty } : w));
  }

  // ─── Order done ───────────────────────────────────
  async function handleOrderDone(order) {
    setLastOrder(order);
    setWants(prev => prev.filter(w => !cartIds.includes(w.id)));
    setCartIds([]);
    setMyOrders(prev => [{ id: order.batchId, status: 'DRAFT', total_locked: order.isFullBonus ? 0 : order.totalPaid * order.priceBRL, payment_method: order.method === 'bonus' ? 'BONUS' : 'MERCADO_PAGO', qty_in_batch: order.totalPaid + order.totalBonus, created_at: new Date().toISOString(), cards: order.cards }, ...prev]);
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

  const wantsCount = wants.reduce((s, w) => s + w.quantity, 0);
  const cartCount = wants.filter(w => cartIds.includes(w.id)).reduce((s, w) => s + w.quantity, 0);
  const bottomTabs = [{ key: 'home', icon: Home, label: 'Início' }, { key: 'catalog', icon: BookOpen, label: 'Catálogo' }, { key: 'wants', icon: ScrollText, label: 'Wants' }, { key: 'checkout', icon: ShoppingCart, label: 'Checkout' }, { key: 'profile', icon: User, label: 'Perfil' }];

  return (<div style={{ '--gp': theme.primary, '--gs': theme.secondary, '--gg': theme.glow, minHeight: '100vh', background: `radial-gradient(ellipse at 50% -20%,${theme.primary}12 0%,transparent 50%),radial-gradient(ellipse at 80% 100%,${theme.secondary}08 0%,transparent 40%),#08080f`, color: '#e9edf7', fontFamily: "'Outfit',sans-serif", maxWidth: 480, margin: '0 auto', position: 'relative', paddingBottom: 78 }}>
    <FloatingMana theme={theme}/>
    <style>{"@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Outfit:wght@300;400;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:#08080f;margin:0}input:focus{border-color:var(--gp)!important;outline:none}button:active:not(:disabled){transform:scale(.97)}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.07);border-radius:3px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes tutPulse{0%,100%{opacity:1;box-shadow:0 0 0 9999px rgba(0,0,0,0.78),0 0 30px var(--gg)}50%{opacity:.85;box-shadow:0 0 0 9999px rgba(0,0,0,0.78),0 0 50px var(--gg)}}@keyframes manaFloat{0%{transform:translateY(0) translateX(0) rotate(0deg);opacity:0}10%{opacity:0.06}90%{opacity:0.03}100%{transform:translateY(-110vh) translateX(var(--drift,20px)) rotate(360deg);opacity:0}}@keyframes flyToWants{0%{transform:translate(-50%,-50%) scale(1);opacity:1}50%{transform:translate(calc(-50vw + 160px),-60vh) scale(0.6);opacity:0.8}100%{transform:translate(calc(-50vw + 160px),-80vh) scale(0.2);opacity:0}}"}</style>

    {toastMsg && <Toast msg={toastMsg.msg} type={toastMsg.type} onClose={() => setToastMsg(null)} />}
    {showTutorial && <TutorialOverlay step={tutStep} steps={TUTORIAL_STEPS} onNext={tutNext} onSkip={tutSkip} theme={theme} onNavTo={p => setPage(p)} isFirstTime={isFirstTimeTut} />}

    {/* Not logged in */}
    {!session && <div style={{ padding: '14px 20px' }}><AuthPage onLogin={handleLogin} theme={theme} /></div>}

    {/* Logged in */}
    {session && <>
      {/* Loading overlay */}
      {appLoading && <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(8,8,15,0.92)', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}><Spin size={36} /><div style={{ marginTop: 12, fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>Carregando dados...</div></div>
      </div>}

      {/* Header */}
      {page !== 'onboarding' && <div style={{ padding: '13px 20px 11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.035)', position: 'sticky', top: 0, zIndex: 10, background: 'rgba(8,8,15,0.88)', backdropFilter: 'blur(20px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(page === 'success' || page === 'admin') && <button onClick={() => nav(page === 'admin' ? 'profile' : 'home')} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 2 }}><ChevronLeft size={20} /></button>}
          <span style={{ fontFamily: "'Cinzel',serif", fontSize: 15, fontWeight: 700, letterSpacing: .3 }}>{({ home: 'Cartas para Jogar', catalog: 'Catálogo', wants: 'Wants', checkout: 'Checkout', success: '', profile: 'Perfil', admin: 'Admin', onboarding: '' })[page] || ''}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setSoundOn(s => !s)} style={{ background: 'none', border: 'none', color: soundOn ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)', cursor: 'pointer', padding: 2 }}>{soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
          {tier && <Tag style={{ fontSize: 10, padding: '3px 8px' }}>{tier.label} | {pool}</Tag>}
          <GuildBadge guild={guild} size={20} />
        </div>
      </div>}

      {/* Bottom tabs */}
      {page !== 'onboarding' && page !== 'success' && page !== 'admin' && <div id="tut-bottom-tabs" style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 480, background: 'rgba(8,8,15,0.94)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-around', padding: '5px 0 10px', zIndex: 20 }}>
        {bottomTabs.map((t, ti) => {
          const active = page === t.key; const badge = t.key === 'checkout' && cartCount > 0;
          return (<button key={t.key} id={'tut-tab-' + ti} onClick={() => nav(t.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '4px 10px', borderRadius: 10, position: 'relative', color: active ? theme.primary : 'rgba(255,255,255,0.22)', transition: 'all .2s' }}>
            <t.icon size={20} />{badge && <div style={{ position: 'absolute', top: 0, right: 3, width: 15, height: 15, borderRadius: 8, background: theme.primary, fontSize: 9, fontWeight: 800, color: '#fff', display: 'grid', placeItems: 'center' }}>{cartCount}</div>}
            <span style={{ fontSize: 9, fontWeight: active ? 700 : 400 }}>{t.label}</span>{active && <div style={{ width: 4, height: 4, borderRadius: 2, background: theme.primary }} />}
          </button>);
        })}
      </div>}

      {/* Pages */}
      <div style={{ padding: page === 'onboarding' ? '0 20px' : '14px 20px' }}>
        {page === 'home' && (computedTiers.length > 0 ? <HomePage pool={pool} tiers={computedTiers} priceBRL={priceBRL} closeDate={campaign?.close_at} theme={theme} nav={nav} wantsCount={wantsCount} cartCount={cartCount} bonusAvail={bonusAvail} credit={0} /> : !appLoading && <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div style={{textAlign:'center',padding:'6px 0 0'}}>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.28)',letterSpacing:2.5,textTransform:'uppercase',fontFamily:"'Cinzel',serif"}}>Encomenda em Grupo</div>
            <h1 style={{margin:'5px 0 0',fontSize:26,fontFamily:"'Cinzel',serif",background:'linear-gradient(135deg,'+theme.primary+','+theme.secondary+')',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Cartas para Jogar</h1>
          </div>
          <Card style={{padding:20,textAlign:'center'}}><Spin size={24}/><div style={{marginTop:8,fontSize:13,color:'rgba(255,255,255,0.35)'}}>Carregando campanha...</div></Card>
          <Btn full variant="secondary" onClick={()=>{loadAppData(token,session?.user?.id);}} sfx="click"><RefreshCw size={16}/> Recarregar</Btn>
        </div>)}
        {page === 'catalog' && <CatalogPage token={token} wants={wants} onAddWant={handleAddWant} priceBRL={priceBRL} theme={theme} />}
        {page === 'wants' && <WantsPage wants={wants} cartIds={cartIds} setCartIds={setCartIds} onRemoveWant={handleRemoveWant} onUpdateWantQty={handleUpdateWantQty} priceBRL={priceBRL} bonusAvail={bonusAvail} theme={theme} nav={nav} />}
        {page === 'checkout' && <CheckoutPage wants={wants} cartIds={cartIds} priceBRL={priceBRL} bonusAvail={bonusAvail} theme={theme} nav={nav} profile={profile} token={token} orderId={orderId} campaignId={campaign?.id} onOrderDone={handleOrderDone} toast={toast} />}
        {page === 'success' && <SuccessPage lastOrder={lastOrder} theme={theme} nav={nav} />}
        {page === 'profile' && <ProfileView profile={profile} token={token} theme={theme} nav={nav} isAdmin={isAdmin} setShowTutorial={setShowTutorial} onSaveProfile={handleSaveProfile} onLogout={handleLogout} myOrders={myOrders} />}
        {page === 'admin' && <AdminPage pool={pool} tiers={computedTiers} priceBRL={priceBRL} pricing={pricing} campaign={campaign} theme={theme} token={token} nav={nav} />}
        {page === 'onboarding' && <OnboardingPage onComplete={handleOnboardingComplete} theme={theme} />}
      </div>
    </>}
  </div>);
}
