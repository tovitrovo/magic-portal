// Primitivas de UI compartilhadas entre a loja (MagicPortal) e o console admin.
import { useState, useEffect, useRef } from "react";
import { Loader, X } from "lucide-react";

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

export const SFX = {
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

// Opacidade sobre uma cor arbitrária (hex OU var() do tema). O sufixo é o
// mesmo par hexadecimal que o CSS usa em #rrggbbaa, para manter os call sites
// legíveis: wa(theme.primary,'30') ≈ 19% de opacidade.
export function wa(color,hexAlpha){
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
export function useDialogA11y(onClose){
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

export const TC={Normal:'var(--text-dim)',Holo:'var(--gold)',Foil:'var(--tc-foil)',English:'var(--tc-blue)',Chinese:'var(--tc-red)',Japanese:'var(--tc-amber)',Promo:'var(--tc-pink)','Showcase Foil':'var(--tc-violet)',Regular:'var(--text-dim)','Enchanted Foil':'var(--tc-purple)','Cold Foil':'var(--tc-sky)'};

export const Card=({children,style,glow,onClick,id})=><div id={id} onClick={onClick} style={{background:'var(--card-bg)',border:'1px solid '+(glow||'var(--card-border)'),borderRadius:'var(--r-card)',padding:'var(--sp-4)',boxShadow:glow?'0 0 20px '+glow:'var(--card-shadow)',...(onClick?{cursor:'pointer'}:{}),...style}}>{children}</div>;
export const Btn=({children,variant='primary',disabled,onClick,style,full,sfx='click',id,title})=>{const v={primary:{background:'var(--gp)',color:'var(--gp-ink)',boxShadow:'0 4px 18px var(--gg)'},secondary:{background:'var(--fill)',color:'var(--text-strong)',border:'1px solid var(--line)'},ghost:{background:'transparent',color:'var(--gp)',padding:'12px'},danger:{background:'rgba(var(--danger-rgb),0.1)',color:'var(--danger)',border:'1px solid rgba(var(--danger-rgb),0.15)'},success:{background:'rgba(var(--ok-rgb),0.1)',color:'var(--ok)',border:'1px solid rgba(var(--ok-rgb),0.15)'},pix:{background:'rgba(var(--pix-rgb),0.12)',color:'var(--pix)',border:'1px solid rgba(var(--pix-rgb),0.2)'},warn:{background:'rgba(var(--gold-rgb),0.1)',color:'var(--gold)',border:'1px solid rgba(var(--gold-rgb),0.15)'}};return <button id={id} title={title} onClick={e=>{if(!disabled&&sfx&&SFX[sfx])SFX[sfx]();if(onClick)onClick(e);}} disabled={disabled} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:'var(--sp-2)',border:'none',borderRadius:'var(--r-card)',padding:'13px 20px',fontWeight:700,fontSize:14,cursor:disabled?'not-allowed':'pointer',opacity:disabled?.4:1,transition:'all .15s',fontFamily:"'Outfit',sans-serif",...(full?{width:'100%'}:{}),...v[variant],...style}}>{children}</button>;};
export const Input=({icon:Icon,...p})=><div style={{position:'relative'}}>{Icon&&<Icon size={18} style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',color:'var(--text-faint)',pointerEvents:'none'}}/>}<input {...p} style={{width:'100%',padding:Icon?'13px 14px 13px 42px':'13px 14px',borderRadius:'var(--r-card)',border:'1px solid var(--line)',background:'var(--field-bg)',color:'var(--text)',fontSize:'var(--fs-md)',fontFamily:"'Outfit',sans-serif",outline:'none',boxSizing:'border-box',...p.style}}/></div>;
export const Tag=({children,color,style})=><span style={{display:'inline-flex',alignItems:'center',gap:'var(--sp-1)',padding:'5px 11px',borderRadius:'var(--r-pill)',background:color?wa(color,'14'):'var(--fill-soft)',border:'1px solid '+(color?wa(color,'22'):'var(--line-soft)'),fontSize:'var(--fs-xs)',color:color||'var(--text-muted)',fontWeight:600,whiteSpace:'nowrap',...style}}>{children}</span>;
export const EmptyState=({icon:Icon,title,sub,action})=><div style={{textAlign:'center',padding:'var(--sp-6) var(--sp-5)'}}><Icon size={34} style={{marginBottom:'var(--sp-2)',color:'var(--text-faint)'}}/><div style={{fontSize:'var(--fs-md)',fontWeight:700,marginBottom:'var(--sp-1)',color:'var(--text-strong)'}}>{title}</div><div style={{fontSize:'var(--fs-sm)',color:'var(--text-dim)'}}>{sub}</div>{action&&<div style={{marginTop:'var(--sp-4)',display:'flex',justifyContent:'center'}}>{action}</div>}</div>;
export const Spin=({size=18,color})=><Loader size={size} style={{color:color||'var(--gp)',animation:'spin 1s linear infinite'}}/>;

// Card image with graceful fallback. Accepts both catalog cards
// (name/type/image_url) and order items (card_name/card_type/card_image_url).
export function CardThumb({card,radius=12,style}){
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
export function ImageLightbox({src,alt,onClose}){
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

// Só Magic à venda. O seletor de TCG saiu: o catálogo inteiro é um jogo só,
// e um filtro com uma opção só é ruído.
export const CATALOG_TCG='Magic';
export const CATALOG_TYPES=['Normal','Holo','Foil'];
