// Peças visuais do console admin. Estilo em ./admin.css (classes `adm-*`).
import { ChevronRight, Inbox, Search, X } from 'lucide-react';
import { ORDER_STAGES } from '../../shared/orderStatus';
import { SFX, Spin, useDialogA11y } from '../kit';

export const brl=v=>'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
export const brlCompact=v=>{const n=Number(v||0);return n>=1000?'R$ '+(n/1000).toFixed(n>=10000?0:1).replace('.',',')+'k':'R$ '+n.toFixed(0);};
export const shortBatchId=id=>String(id||'').slice(0,8).toUpperCase();
export const initials=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(p=>p[0]||'').join('').toUpperCase()||'?';

export function timeAgo(iso){
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

// Mesmo dia civil? Usado nos indicadores de "hoje".
export function isToday(iso){
  if(!iso)return false;
  const d=new Date(iso);const now=new Date();
  return d.getDate()===now.getDate()&&d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
}

export const daysAgo=(iso,days)=>iso&&Date.now()-new Date(iso).getTime()<=days*86400000;

export function greeting(){
  const h=new Date().getHours();
  return h<12?'Bom dia':h<18?'Boa tarde':'Boa noite';
}

export const Badge=({color,children,style})=><span className="adm-badge" style={{'--c':color,...style}}>{children}</span>;

export const Loading=()=><div className="adm-loading"><Spin size={22}/></div>;

export const Empty=({icon:Icon=Inbox,title,sub})=>(
  <div className="adm-empty"><Icon size={30}/><b>{title}</b>{sub&&<div style={{fontSize:'var(--fs-xs)'}}>{sub}</div>}</div>
);

export const SectionTitle=({children,action,onAction})=>(
  <div className="adm-section-title"><h2>{children}</h2>{onAction&&<button onClick={onAction}>{action} <ChevronRight size={11} style={{verticalAlign:'-1px'}}/></button>}</div>
);

export function Segmented({options,value,onChange}){
  return(<div className="adm-seg" role="tablist">
    {options.map(o=>(
      <button key={o.key} role="tab" aria-selected={value===o.key} className={value===o.key?'is-active':''} onClick={()=>{SFX.toggle();onChange(o.key);}}>
        {o.icon&&<o.icon size={13}/>}{o.label}{o.count>0&&<em>{o.count}</em>}
      </button>
    ))}
  </div>);
}

export function Chips({options,value,onChange}){
  return(<div className="adm-chips">
    {options.map(o=>(
      <button key={o.key} className={'adm-chip'+(value===o.key?' is-active':'')} style={o.color?{'--c':o.color}:undefined} onClick={()=>{SFX.toggle();onChange(o.key);}}>
        {o.label}{o.count!==undefined&&<small>{o.count}</small>}
      </button>
    ))}
  </div>);
}

export const SearchBox=({value,onChange,placeholder})=>(
  <div className="adm-search"><Search size={16}/><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} type="search"/></div>
);

export function Toggle({on,onChange,title,hint,disabled}){
  return(<label className="adm-switch" style={disabled?{opacity:.5,cursor:'default'}:undefined}>
    <div className="adm-switch-text"><b>{title}</b>{hint&&<span>{hint}</span>}</div>
    <input type="checkbox" checked={!!on} disabled={disabled} onChange={()=>onChange(!on)} style={{position:'absolute',opacity:0,pointerEvents:'none'}}/>
    <span className={'adm-toggle'+(on?' is-on':'')} aria-hidden="true"/>
  </label>);
}

// Barrinha de progresso do pedido: a mesma trilha que o cliente vê.
export const StageBar=({stage})=>(
  <div className="adm-progress" style={{'--c':stage.color}}>
    {ORDER_STAGES.map((s,i)=><i key={s.key} className={i<=stage.index?'is-on':''}/>)}
  </div>
);

export function StageSteps({stage}){
  return(<div className="adm-steps">
    {ORDER_STAGES.map((s,i)=>{
      const cls=stage.terminal?'':i<stage.index?'is-done':i===stage.index?'is-now':'';
      return(<div key={s.key} className={'adm-step '+cls}>
        <i>{i<stage.index&&!stage.terminal?'✓':i+1}</i>
        <div><b>{s.label}</b>{i===stage.index&&!stage.terminal&&<span>{s.hint}</span>}</div>
      </div>);
    })}
  </div>);
}

// Folha que sobe de baixo no celular; painel centralizado no desktop.
export function Sheet({open,onClose,title,sub,right,children}){
  if(!open)return null;
  return <SheetOpen onClose={onClose} title={title} sub={sub} right={right}>{children}</SheetOpen>;
}

function SheetOpen({onClose,title,sub,right,children}){
  const ref=useDialogA11y(onClose);
  return(<div className="adm-sheet-wrap" role="dialog" aria-modal="true" aria-label={typeof title==='string'?title:undefined} ref={ref}>
    <div className="adm-sheet-scrim" onClick={onClose}/>
    <div className="adm-sheet">
      <div className="adm-sheet-grip"/>
      <div className="adm-sheet-head">
        <div style={{minWidth:0}}><h3>{title}</h3>{sub&&<p>{sub}</p>}</div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0}}>{right}<button className="adm-icon-btn" onClick={onClose} aria-label="Fechar"><X size={17}/></button></div>
      </div>
      <div className="adm-sheet-body">{children}</div>
    </div>
  </div>);
}
