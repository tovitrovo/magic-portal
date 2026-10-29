// Aba "Mais": catálogo, notificações no celular, automações, preços e o mapa do console.
import { useEffect, useState } from 'react';
import { Activity, BellOff, BellRing, BookOpen, Check, ChevronLeft, ChevronRight, DollarSign, HelpCircle, Plus, RefreshCw, Sun, Trash2, Truck, Upload, Zap } from 'lucide-react';
import { buildCardsFromCsv, parseCardLinkList, chunkCardItems, mergeAddCardsResults, LINK_BATCH_SIZE } from '../../../shared/cardImport';
import { NOTIFICATION_CATEGORIES } from '../../../shared/notificationTypes';
import { ORDER_STAGES } from '../../../shared/orderStatus';
import { PUSH_NEEDS_INSTALL, disablePush, enablePush, sendTestPush, updatePushPrefs } from '../../push';
import { SFX, Spin, CATALOG_TCG, CATALOG_TYPES } from '../../kit';
import { SB_URL, SB_KEY } from '../../config';
import { Badge, Loading, Toggle, timeAgo } from '../ui';

const TRACKING_STALE_MS=3*3600*1000;

/** Saúde do rastreio automático, para a faixa de status das telas. */
export function automationHealth(cfg){
  if(!cfg)return {level:'off',text:'Carregando…'};
  if(cfg.error)return {level:'bad',text:'Banco sem a migração admin-automation.sql'};
  if(!cfg.site_url)return {level:'off',text:'Aguardando o domínio do site para agendar'};
  const r=cfg.tracking_last_result||{};
  if(!cfg.tracking_last_run_at)return {level:'off',text:'Agendado de hora em hora · ainda não rodou'};
  const age=Date.now()-new Date(cfg.tracking_last_run_at).getTime();
  if(r.fatal||(r.checked>0&&r.errors===r.checked))return {level:'bad',text:`Falhou ${timeAgo(cfg.tracking_last_run_at)}: ${r.fatal||r.firstError||'erro no MandaBem'}`};
  const tail=r.pending>0?` · ${r.pending} remessa(s) acompanhada(s)`:' · nada em trânsito';
  if(age>TRACKING_STALE_MS)return {level:'off',text:`Última verificação ${timeAgo(cfg.tracking_last_run_at)} atrás — o cron está rodando?`};
  return {level:'ok',text:`Verificado ${timeAgo(cfg.tracking_last_run_at)}${timeAgo(cfg.tracking_last_run_at)==='agora'?'':' atrás'}${tail}`};
}

// ── Notificações no celular ───────────────────────────
function PushPage({ctx}){
  const {token,toast,pushState:state,refreshPushState}=ctx;
  const [busy,setBusy]=useState('');
  const say=(msg,type='success')=>toast&&toast(msg,type);

  async function handleEnable(){
    setBusy('enable');
    try{await enablePush(token,state?.prefs);SFX.success();say('Notificações ativadas neste aparelho');await refreshPushState();}
    catch(e){say(e.message||String(e),'error');}
    setBusy('');
  }
  async function handleDisable(){
    setBusy('disable');
    try{await disablePush(token);say('Notificações desligadas neste aparelho');await refreshPushState();}
    catch(e){say(e.message||String(e),'error');}
    setBusy('');
  }
  async function toggle(key,value){
    const next={...state.prefs,[key]:value};
    try{await updatePushPrefs(token,state.endpoint,next);await refreshPushState();}
    catch(e){say('Não foi possível salvar a preferência','error');}
  }
  async function handleTest(){
    setBusy('test');
    try{await sendTestPush(token,state.endpoint);say('Push de teste enviado');}
    catch(e){say(e.message||String(e),'error');}
    setBusy('');
  }

  if(!state)return <Loading/>;
  if(!state.supported)return(<div className="adm-card adm-pad adm-muted" style={{fontSize:'var(--fs-sm)'}}>
    {state.reason===PUSH_NEEDS_INSTALL
      ?<>No iPhone/iPad o push só funciona com o portal <b>instalado na tela de início</b>: no Safari, toque em <b>Compartilhar → Adicionar à Tela de Início</b>, abra pelo ícone e volte aqui.</>
      :<>Este navegador não suporta push. Use o Chrome (Android/desktop) ou o app instalado no iPhone.</>}
  </div>);
  if(!state.serverConfigured)return(<div className="adm-info is-warn">O servidor ainda não tem as chaves VAPID. Rode <b className="adm-mono">node scripts/generate-vapid-keys.mjs</b> e cadastre <b className="adm-mono">VAPID_PUBLIC_KEY</b>, <b className="adm-mono">VAPID_PRIVATE_KEY</b> e <b className="adm-mono">VAPID_SUBJECT</b> no Cloudflare Pages.</div>);

  return(<>
    <div className="adm-card adm-pad" style={{display:'flex',alignItems:'center',gap:12}}>
      <span className="adm-avatar" style={{'--c':state.subscribed?'var(--ok)':'var(--text-dim)'}}>{state.subscribed?<BellRing size={17}/>:<BellOff size={17}/>}</span>
      <div style={{flex:1,minWidth:0}}>
        <b style={{color:state.subscribed?'var(--ok)':'var(--text-strong)'}}>{state.subscribed?'Este aparelho recebe push':'Push desligado neste aparelho'}</b>
        <div className="adm-muted">{state.permission==='denied'?'Permissão bloqueada nas configurações do navegador':'Cada celular/computador é ativado separadamente'}</div>
      </div>
    </div>
    {!state.subscribed
      ?<button className="adm-btn is-block is-primary" disabled={busy==='enable'||state.permission==='denied'} onClick={handleEnable}>{busy==='enable'?<Spin size={15}/>:<><BellRing size={16}/> Ativar neste aparelho</>}</button>
      :<>
        <div className="adm-card">
          {NOTIFICATION_CATEGORIES.map(c=><Toggle key={c.key} on={state.prefs[c.key]} onChange={v=>toggle(c.key,v)} title={c.label} hint={c.hint}/>)}
        </div>
        <div className="adm-row-actions">
          <button className="adm-btn" style={{flex:1}} disabled={busy==='test'} onClick={handleTest}>{busy==='test'?<Spin size={14}/>:<><Zap size={14}/> Enviar teste</>}</button>
          <button className="adm-btn is-ghost" disabled={busy==='disable'} onClick={handleDisable}><BellOff size={14}/> Desligar</button>
        </div>
      </>}
    {state.permission==='denied'&&<div className="adm-info is-warn">A permissão foi negada. Libere as notificações do site nas configurações do aparelho e volte aqui.</div>}
  </>);
}

// ── Automações ────────────────────────────────────────
function AutomationPage({ctx}){
  const {automation:cfg,runAutomation,automationBusy,registerSiteUrl}=ctx;
  if(!cfg)return <Loading/>;
  if(cfg.error)return(<div className="adm-info is-bad">
    <b>As automações ainda não estão no banco.</b><br/>Rode <b className="adm-mono">supabase/migrations/admin-automation.sql</b> no SQL Editor do Supabase. Detalhe: {cfg.error}
  </div>);
  const health=automationHealth(cfg);
  const tr=cfg.tracking_last_result||{};
  const dg=cfg.digest_last_result||{};
  const origin=typeof window!=='undefined'?window.location.origin:'';
  return(<>
    <div className="adm-card adm-pad" style={{display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'flex',gap:10,alignItems:'center'}}>
        <span className="adm-avatar" style={{'--c':'var(--indiv)'}}><Truck size={16}/></span>
        <div style={{flex:1}}><b>Rastreio MandaBem</b><div className="adm-muted">De hora em hora · status, código e "Entregue" automáticos</div></div>
        <span className={'adm-pulse'+(health.level==='ok'?'':health.level==='bad'?' is-bad':' is-off')}/>
      </div>
      <div className={'adm-info'+(health.level==='bad'?' is-bad':health.level==='off'?' is-warn':'')}>{health.text}</div>
      {cfg.tracking_last_run_at&&<div className="adm-muted">Última execução: {tr.checked||0} consultada(s) · {tr.updated||0} atualizada(s) · {tr.delivered||0} entregue(s) · {tr.problems||0} problema(s){tr.errors?` · ${tr.errors} erro(s)`:''}</div>}
      <button className="adm-btn" disabled={automationBusy==='tracking'} onClick={()=>runAutomation('tracking')}>{automationBusy==='tracking'?<Spin size={14}/>:<><RefreshCw size={14}/> Verificar rastreios agora</>}</button>
    </div>

    <div className="adm-card adm-pad" style={{display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'flex',gap:10,alignItems:'center'}}>
        <span className="adm-avatar" style={{'--c':'var(--gold)'}}><Sun size={16}/></span>
        <div style={{flex:1}}><b>Resumo diário</b><div className="adm-muted">Push às 08:07 com vendas de ontem e a fila do dia</div></div>
      </div>
      <div className="adm-muted">{cfg.digest_last_run_at?`Último envio ${timeAgo(cfg.digest_last_run_at)} atrás${dg.fatal?` · erro: ${dg.fatal}`:''}`:'Ainda não foi enviado'}</div>
      <button className="adm-btn" disabled={automationBusy==='digest'} onClick={()=>runAutomation('digest')}>{automationBusy==='digest'?<Spin size={14}/>:<><Sun size={14}/> Enviar resumo agora</>}</button>
    </div>

    <div className="adm-card adm-pad" style={{display:'flex',flexDirection:'column',gap:8}}>
      <b style={{fontSize:'var(--fs-xs)'}}>Domínio chamado pelo agendador</b>
      <div className="adm-info adm-mono" style={{wordBreak:'break-all'}}>{cfg.site_url||'— não definido —'}</div>
      {origin.startsWith('https://')&&origin!==cfg.site_url&&<button className="adm-btn is-sm" onClick={registerSiteUrl}>Usar {origin}</button>}
      <div className="adm-muted">O pg_cron do Supabase chama <span className="adm-mono">/api/cron</span> neste domínio. Ele é preenchido sozinho na primeira vez que você abre o console.</div>
    </div>
  </>);
}

// ── Preços ────────────────────────────────────────────
function PricesPage({ctx}){
  const {apiPost,toast,onReload}=ctx;
  const [cfg,setCfg]=useState(null);
  const [tiers,setTiers]=useState([]);
  const [fx,setFx]=useState(null);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    let alive=true;
    fetch('/api/pricing-individual').then(r=>r.json()).then(d=>{
      if(!alive||!d?.ok)return;
      setCfg(d.pricing||{});setTiers((d.tiers||[]).slice().sort((a,b)=>Number(a.min_qty)-Number(b.min_qty)));setFx(d.fx||null);
    }).catch(e=>console.warn('pricing-individual:',e));
    return ()=>{alive=false;};
  },[]);
  async function save(){
    setSaving(true);
    try{
      await apiPost('/api/admin-save-individual-pricing',{pricing:cfg,tiers:tiers.map(t=>({min_qty:t.min_qty,max_qty:t.max_qty,usd_per_card:t.usd_per_card}))});
      SFX.success();toast&&toast('Preços salvos!','success');onReload&&onReload();
    }catch(e){toast&&toast('Erro ao salvar: '+(e.message||String(e)),'error');}
    setSaving(false);
  }
  if(!cfg)return <Loading/>;
  return(<>
    <div className="adm-info">Preço/carta = custo da faixa × multiplicador × dólar, com piso por tipo. Dólar em uso: <b style={{color:'var(--gp)'}}>R$ {fx?Number(fx.rate).toFixed(2):'—'}</b>{fx?` (${fx.source})`:''}</div>
    <div className="adm-card adm-pad" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
      {[['multiplier','Multiplicador','0.1'],['min_cards','Mínimo de cartas','1'],['normal_floor_brl','Piso Normal (R$)','0.5'],['holo_floor_brl','Piso Holo (R$)','0.5'],['foil_floor_brl','Piso Foil (R$)','0.5'],['fx_fallback_rate','Dólar reserva','0.01']].map(([k,l,step])=>(
        <div key={k}><label className="adm-label">{l}</label><input className="adm-input" type="number" inputMode="decimal" step={step} min="0" value={cfg[k]??''} onChange={e=>setCfg(c=>({...c,[k]:e.target.value===''?'':Number(e.target.value)}))} style={{fontWeight:700}}/></div>
      ))}
    </div>
    <div className="adm-card adm-pad" style={{display:'flex',flexDirection:'column',gap:6}}>
      <b style={{fontSize:'var(--fs-xs)'}}>Faixas de volume (custo USD/carta)</b>
      <div style={{display:'flex',gap:6}} className="adm-label"><span style={{flex:1}}>De</span><span style={{flex:1}}>Até (vazio = ∞)</span><span style={{flex:1}}>USD</span><span style={{width:38}}/></div>
      {tiers.map((t,idx)=>(<div key={idx} style={{display:'flex',gap:6,alignItems:'center'}}>
        {['min_qty','max_qty','usd_per_card'].map(f=><input key={f} className="adm-input" style={{flex:1,minWidth:0,padding:'10px'}} type="number" inputMode="decimal" step={f==='usd_per_card'?'0.01':'1'} value={t[f]??''} onChange={e=>{const v=e.target.value;setTiers(ts=>ts.map((x,i)=>i===idx?{...x,[f]:v===''?(f==='max_qty'?null:''):Number(v)}:x));}}/>)}
        <button className="adm-btn is-sm is-danger" style={{width:38,height:38,padding:0}} onClick={()=>setTiers(ts=>ts.filter((_,i)=>i!==idx))} aria-label="Remover faixa"><Trash2 size={14}/></button>
      </div>))}
      <button className="adm-btn is-ghost" onClick={()=>setTiers(ts=>[...ts,{min_qty:'',max_qty:null,usd_per_card:''}])}><Plus size={14}/> Adicionar faixa</button>
    </div>
    <button className="adm-btn is-block is-primary" disabled={saving} onClick={save}>{saving?<Spin size={15}/>:<><Check size={16}/> Salvar preços</>}</button>
  </>);
}

// ── Catálogo ──────────────────────────────────────────
function CatalogPage({ctx}){
  const {apiPost,token,toast,onReload}=ctx;
  const say=(m,t='success')=>toast&&toast(m,t);
  const [sheet,setSheet]=useState(null);
  const [sheetUrl,setSheetUrl]=useState('');
  const [sheetSaving,setSheetSaving]=useState(false);
  const [csv,setCsv]=useState('');const [csvName,setCsvName]=useState('');const [csvPreview,setCsvPreview]=useState(null);
  const [deactivate,setDeactivate]=useState(true);const [importing,setImporting]=useState(false);const [importResult,setImportResult]=useState(null);
  const [linkText,setLinkText]=useState('');const [linkPreview,setLinkPreview]=useState(null);const [linkType,setLinkType]=useState('Normal');
  const [linkAdding,setLinkAdding]=useState(false);const [linkProgress,setLinkProgress]=useState(null);const [linkResult,setLinkResult]=useState(null);
  const [tool,setTool]=useState(null); // 'csv' | 'link'

  async function loadSheet(){
    try{const {config}=await apiPost('/api/admin-catalog-sync',{action:'get'});setSheet(config);setSheetUrl(u=>u||config?.sheet_url||'');return config;}
    catch(e){console.warn('catalog-sync:',e);return null;}
  }
  useEffect(()=>{loadSheet();},[]);
  // Enquanto a Edge Function roda em segundo plano, acompanha o status.
  useEffect(()=>{
    if(!sheet?.running_since)return;
    const id=setInterval(async()=>{const c=await loadSheet();if(c&&!c.running_since&&onReload)onReload();},5000);
    return ()=>clearInterval(id);
  },[sheet?.running_since]);

  async function saveSheet(){
    setSheetSaving(true);
    try{const {config}=await apiPost('/api/admin-catalog-sync',{action:'save',sheet_url:sheetUrl,sheet_tab:sheet?.sheet_tab||'SINGLES'});setSheet(config);SFX.success();say('Planilha salva!');}
    catch(e){say('Erro ao salvar planilha: '+(e.message||String(e)),'error');}
    setSheetSaving(false);
  }
  async function runSheet(){
    try{
      const r=await fetch(`${SB_URL}/functions/v1/sync-supplier-sheet`,{method:'POST',headers:{'Content-Type':'application/json',apikey:SB_KEY,Authorization:`Bearer ${token}`},body:'{}'});
      const json=await r.json().catch(()=>({}));
      if(!r.ok||json.ok===false)throw new Error(json.error||`HTTP ${r.status}`);
      SFX.success();await loadSheet();
    }catch(e){say('Erro ao sincronizar: '+(e.message||String(e)),'error');}
  }

  function onCsvFile(e){
    const file=e.target.files&&e.target.files[0];
    setImportResult(null);
    if(!file){setCsv('');setCsvName('');setCsvPreview(null);return;}
    const reader=new FileReader();
    reader.onload=()=>{
      const text=String(reader.result||'');setCsv(text);setCsvName(file.name);
      try{const {cards,skipped,total}=buildCardsFromCsv(text);const types=cards.reduce((a,c)=>{a[c.type]=(a[c.type]||0)+1;return a;},{});setCsvPreview({valid:cards.length,skipped,total,types});}
      catch(err){setCsvPreview({error:String(err?.message||err)});}
    };
    reader.readAsText(file);
  }
  async function importCsv(){
    if(!csv.trim())return;
    setImporting(true);setImportResult(null);
    try{const json=await apiPost('/api/admin-import-cards',{csv,deactivatePrevious:deactivate});setImportResult(json);SFX.success();onReload&&onReload();}
    catch(e){say('Erro ao importar catálogo: '+(e.message||String(e)),'error');}
    setImporting(false);
  }

  // O endpoint aceita no máximo LINK_BATCH_SIZE cartas por chamada; listas
  // maiores vão em lotes sequenciais.
  async function addByLink(){
    if(!linkPreview?.items.length)return;
    const batches=chunkCardItems(linkPreview.items,LINK_BATCH_SIZE);
    setLinkAdding(true);setLinkResult(null);setLinkProgress({done:0,total:linkPreview.items.length});
    const responses=[];let erro=null;
    for(const batch of batches){
      try{responses.push(await apiPost('/api/admin-add-cards-by-link',{items:batch,tcg:CATALOG_TCG,type:linkType}));}
      catch(e){erro=e;break;} // mantém o que já subiu e mostra o parcial
      setLinkProgress(p=>({done:(p?.done||0)+batch.length,total:linkPreview.items.length}));
    }
    const merged=mergeAddCardsResults(responses);
    setLinkResult(responses.length?merged:null);setLinkProgress(null);
    if(erro)say('Erro ao adicionar cartas: '+(erro.message||String(erro)),'error');
    if(merged.added>0){SFX.success();onReload&&onReload();}
    setLinkAdding(false);
  }

  const lr=sheet?.last_result;const bad=lr&&(lr.fatal||lr.failed>0);
  return(<>
    <div className="adm-card adm-pad" style={{display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'flex',gap:10,alignItems:'center'}}>
        <span className="adm-avatar" style={{'--c':'var(--gp)'}}><RefreshCw size={16}/></span>
        <div style={{flex:1}}><b>Planilha do fornecedor</b><div className="adm-muted">Cartas novas da aba SINGLES entram sozinhas, 1x por dia</div></div>
      </div>
      <input className="adm-input" value={sheetUrl} onChange={e=>setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..."/>
      <div className="adm-row-actions">
        <button className="adm-btn" style={{flex:1}} disabled={sheetSaving||!sheetUrl.trim()||sheetUrl.trim()===sheet?.sheet_url} onClick={saveSheet}>{sheetSaving?<Spin size={14}/>:<><Check size={14}/> Salvar link</>}</button>
        <button className="adm-btn is-ok" style={{flex:1}} disabled={!sheet?.sheet_url||!!sheet?.running_since} onClick={runSheet}>{sheet?.running_since?<><Spin size={14}/> Sincronizando…</>:<><RefreshCw size={14}/> Sincronizar</>}</button>
      </div>
      {lr&&<div className={'adm-info '+(bad?'is-warn':'is-ok')}>
        <div className="adm-muted">Última: {sheet.last_run_at?new Date(sheet.last_run_at).toLocaleString('pt-BR'):'—'}</div>
        {lr.fatal?<div style={{color:'var(--danger)'}}>{lr.fatal}</div>:<div>Novas <b>{lr.added||0}</b> · já existiam <b>{lr.linked||0}</b> · já importadas <b>{lr.already||0}</b>{lr.failed>0?<> · <span style={{color:'var(--gold)'}}>{lr.failed} falharam</span></>:null}{lr.remaining>0?<> · {lr.remaining} na fila</>:null}</div>}
        {(lr.errors||[]).slice(0,8).map((e,i)=><div key={i} style={{fontSize:'var(--fs-2xs)',color:'var(--danger)'}}>· [{e.type}] {e.name}: {e.error}</div>)}
      </div>}
    </div>

    <div className="adm-card adm-list adm-menu">
      <button className="adm-item" style={{'--c':'var(--indiv)'}} onClick={()=>setTool(tool==='link'?null:'link')}><span className="adm-avatar"><Plus size={16}/></span><span className="adm-item-main"><span className="adm-item-title"><span>Adicionar cartas por link</span></span><span className="adm-item-sub" style={{display:'block'}}>Nome | link da imagem, uma por linha</span></span><ChevronRight size={16} style={{transform:tool==='link'?'rotate(90deg)':'none'}}/></button>
      {tool==='link'&&<div className="adm-pad" style={{display:'flex',flexDirection:'column',gap:10}}>
        <select className="adm-select" value={linkType} onChange={e=>setLinkType(e.target.value)}>{CATALOG_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select>
        <textarea className="adm-textarea adm-mono" rows={6} value={linkText} placeholder="Sol Ring | https://exemplo.com/sol-ring.jpg" onChange={e=>{setLinkText(e.target.value);setLinkResult(null);setLinkPreview(e.target.value.trim()?parseCardLinkList(e.target.value):null);}}/>
        {linkPreview&&<div className="adm-info"><b>{linkPreview.items.length}</b> válida(s) de {linkPreview.total}{linkPreview.invalid.length>0&&<> · <span style={{color:'var(--gold)'}}>{linkPreview.invalid.length} com erro</span>{linkPreview.invalid.map((inv,i)=><div key={i} style={{fontSize:'var(--fs-2xs)',color:'var(--gold)'}}>· {inv.raw||'(vazia)'}: {inv.error}</div>)}</>}</div>}
        <button className="adm-btn is-primary" disabled={linkAdding||!linkPreview?.items.length} onClick={addByLink}>{linkAdding?<Spin size={14}/>:<><Upload size={14}/> Adicionar cartas</>}</button>
        {linkProgress&&<div className="adm-muted" style={{textAlign:'center'}}>{linkProgress.done}/{linkProgress.total} cartas enviadas</div>}
        {linkResult&&<div className={'adm-info '+(linkResult.failed?'is-warn':'is-ok')}>Adicionadas <b>{linkResult.added}</b>{linkResult.failed>0?` · ${linkResult.failed} falharam`:''}{linkResult.results.filter(r=>!r.ok).slice(0,10).map((r,i)=><div key={i} style={{fontSize:'var(--fs-2xs)',color:'var(--danger)'}}>· {r.name||r.url}: {r.error}</div>)}</div>}
      </div>}
      <button className="adm-item" style={{'--c':'var(--gp)'}} onClick={()=>setTool(tool==='csv'?null:'csv')}><span className="adm-avatar"><Upload size={16}/></span><span className="adm-item-main"><span className="adm-item-title"><span>Importar CSV do fornecedor</span></span><span className="adm-item-sub" style={{display:'block'}}>Substitui o catálogo de Magic</span></span><ChevronRight size={16} style={{transform:tool==='csv'?'rotate(90deg)':'none'}}/></button>
      {tool==='csv'&&<div className="adm-pad" style={{display:'flex',flexDirection:'column',gap:10}}>
        <div className="adm-muted">Colunas <b>name, price, original_price, category, image_file</b>. As imagens ficam no bucket <b>cards</b> com o mesmo nome do <b>image_file</b>. Reenviar o mesmo CSV atualiza, não duplica.</div>
        <label className="adm-btn" style={{borderStyle:'dashed'}}><Upload size={14}/> {csvName||'Escolher arquivo CSV'}<input type="file" accept=".csv,text/csv" onChange={onCsvFile} style={{display:'none'}}/></label>
        {csvPreview&&(csvPreview.error?<div className="adm-info is-bad">Erro ao ler CSV: {csvPreview.error}</div>:<div className="adm-info"><b>{csvPreview.valid}</b> válidas de {csvPreview.total}{csvPreview.skipped?` · ${csvPreview.skipped} ignoradas`:''}<div className="adm-muted">Normal {csvPreview.types.Normal||0} · Holo {csvPreview.types.Holo||0} · Foil {csvPreview.types.Foil||0}</div></div>)}
        <Toggle on={deactivate} onChange={setDeactivate} title="Desativar catálogo anterior" hint="Cartas fora deste CSV ficam ocultas"/>
        <button className="adm-btn is-primary" disabled={importing||!csvPreview||!!csvPreview.error||!(csvPreview.valid>0)} onClick={importCsv}>{importing?<Spin size={14}/>:<><Upload size={14}/> Importar catálogo</>}</button>
        {importResult&&<div className="adm-info is-ok">Importadas <b>{importResult.upserted}</b>{importResult.deactivated>0?` · ${importResult.deactivated} desativadas`:''}{importResult.skipped>0?` · ${importResult.skipped} ignoradas`:''}</div>}
      </div>}
    </div>
  </>);
}

function AboutPage(){
  return(<>
    <div className="adm-card adm-pad">
      <b>A trilha do pedido</b>
      <div className="adm-muted" style={{marginBottom:10}}>A mesma que o cliente vê na conta dele</div>
      {ORDER_STAGES.map((s,i)=>(<div key={s.key} style={{display:'flex',gap:10,padding:'6px 0'}}>
        <Badge color={s.color}>{i+1}</Badge>
        <div><div style={{fontSize:'var(--fs-xs)',fontWeight:700,color:s.color}}>{s.label}</div><div className="adm-muted">{s.hint}</div></div>
      </div>))}
    </div>
    <div className="adm-info">Os dois primeiros degraus são do <b>dinheiro</b> e andam sozinhos (Mercado Pago ou "marcar pago"). Encomendado → Em preparação é <b>logística</b>, e quem avança é você. "Enviado" acontece ao gerar a etiqueta, e "Entregue" o rastreio automático marca sozinho.</div>
  </>);
}

const PAGES=[
  {key:'catalog',icon:BookOpen,color:'var(--gp)',label:'Catálogo',sub:'Planilha do fornecedor, CSV e cartas por link',Comp:CatalogPage},
  {key:'push',icon:BellRing,color:'var(--ok)',label:'Notificações no celular',sub:'Escolha o que chega por push',Comp:PushPage},
  {key:'automation',icon:Activity,color:'var(--indiv)',label:'Automações',sub:'Rastreio MandaBem e resumo diário',Comp:AutomationPage},
  {key:'prices',icon:DollarSign,color:'var(--gold)',label:'Preços',sub:'Faixas de volume, pisos e dólar',Comp:PricesPage},
  {key:'about',icon:HelpCircle,color:'var(--text-dim)',label:'Como funciona',sub:'Os status do pedido',Comp:AboutPage},
];

export default function MoreView({ctx}){
  const {morePage,setMorePage,pushState,automation}=ctx;
  const page=PAGES.find(p=>p.key===morePage);
  if(page){
    const Comp=page.Comp;
    return(<>
      <button className="adm-btn is-ghost" style={{alignSelf:'flex-start',padding:'4px 2px'}} onClick={()=>{SFX.nav();setMorePage(null);}}><ChevronLeft size={16}/> Mais</button>
      <div style={{display:'flex',alignItems:'center',gap:10}}><span className="adm-avatar" style={{'--c':page.color}}><page.icon size={17}/></span><div><b style={{fontSize:'var(--fs-lg)',color:'var(--text-strong)'}}>{page.label}</b><div className="adm-muted">{page.sub}</div></div></div>
      <Comp ctx={ctx}/>
    </>);
  }
  const health=automationHealth(automation);
  const status={
    push:pushState?.subscribed?<Badge color="var(--ok)">ativo</Badge>:<Badge color="var(--gold)">desligado</Badge>,
    automation:<Badge color={health.level==='ok'?'var(--ok)':health.level==='bad'?'var(--danger)':'var(--gold)'}>{health.level==='ok'?'ativo':health.level==='bad'?'erro':'pendente'}</Badge>,
  };
  return(<div className="adm-card adm-list adm-menu">
    {PAGES.map(p=>(
      <button key={p.key} className="adm-item" style={{'--c':p.color}} onClick={()=>{SFX.nav();setMorePage(p.key);}}>
        <span className="adm-avatar"><p.icon size={17}/></span>
        <span className="adm-item-main"><span className="adm-item-title"><span>{p.label}</span>{status[p.key]}</span><span className="adm-item-sub" style={{display:'block'}}>{p.sub}</span></span>
        <ChevronRight size={16}/>
      </button>
    ))}
  </div>);
}
