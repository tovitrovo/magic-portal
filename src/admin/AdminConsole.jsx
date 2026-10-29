// ══════════════════════════════════════════════════════
// CONSOLE ADMIN — controle e gestão
//
// Pensado para o celular. Cinco abas no polegar: Hoje (a fila de trabalho),
// Pedidos, Envios, Clientes e Mais (catálogo, notificações, automações,
// preços). A unidade de trabalho é o PEDIDO — é ele que vira uma compra no
// fornecedor e uma caixa no correio. Lote é só como o dinheiro entrou; um
// pedido com cartas adicionadas depois tem vários lotes e uma remessa só.
//
// Este arquivo guarda os dados e as ações; as telas moram em ./views/*.
// ══════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react';
import { Bell, LayoutDashboard, MoreHorizontal, RefreshCw, ShoppingBag, Truck, Users } from 'lucide-react';
import { buildShippingGroups, SHIPPING_SERVICE_UNKNOWN } from '../../shared/shipping-groups';
import { isShippingAdjustment } from '../../shared/shippingAddressChange';
import { aggregateOrderCards, formatSupplierCardList, totalCardQty } from '../../shared/supplierCardList';
import { ORDER_STAGES, groupBatchesIntoOrders, isPaid as isPaidBatchStatus, resolveOrderStage, resolveOrderStageFromBatches } from '../../shared/orderStatus';
import { shipmentPhase } from '../../shared/mandabemStatus';
import { buildShipmentWhatsAppUrl } from '../whatsappCommunication';
import { getPushState } from '../push';
import { SFX, ImageLightbox } from '../kit';
import { mpSync } from '../config';
import { daysAgo, isToday, shortBatchId } from './ui';
import HomeView from './views/HomeView';
import OrdersView from './views/OrdersView';
import ShippingView from './views/ShippingView';
import ClientsView from './views/ClientsView';
import MoreView from './views/MoreView';
import NotificationsSheet from './views/NotificationsSheet';
import './admin.css';

const SECTIONS=[
  {key:'overview',icon:LayoutDashboard,label:'Hoje',title:'Hoje'},
  {key:'orders',icon:ShoppingBag,label:'Pedidos',title:'Pedidos'},
  {key:'shipping',icon:Truck,label:'Envios',title:'Envios'},
  {key:'clients',icon:Users,label:'Clientes',title:'Clientes'},
  {key:'more',icon:MoreHorizontal,label:'Mais',title:'Mais'},
];
const MORE_PAGES=['catalog','automation','push','prices','about'];
const SHIPPABLE=['PREPARING','LABEL_GENERATED','DELIVERED'];

// Deep link (push) → { section, morePage, notifications }.
function resolveTarget(raw){
  const key=typeof raw==='object'&&raw?raw.section:raw;
  if(!key)return null;
  if(key==='notifications')return {notifications:true};
  if(SECTIONS.some(s=>s.key===key))return {section:key};
  if(key==='settings')return {section:'more',morePage:'automation'};
  if(MORE_PAGES.includes(key))return {section:'more',morePage:key};
  return null;
}

export default function AdminConsole({theme,token,nav,onReload,toast:toastFn,initialSection}){
  const initial=resolveTarget(initialSection)||{};
  const [section,setSection]=useState(initial.section||'overview');
  const [morePage,setMorePage]=useState(initial.morePage||null);
  const [showNotifications,setShowNotifications]=useState(!!initial.notifications);
  useEffect(()=>{
    const t=resolveTarget(initialSection);
    if(!t)return;
    if(t.notifications){setShowNotifications(true);return;}
    setSection(t.section);setMorePage(t.morePage||null);setShowNotifications(false);
  },[initialSection]);

  // ── Dados ───────────────────────────────────────────
  const [indivOrders,setIndivOrders]=useState([]);
  const [allProfiles,setAllProfiles]=useState([]);
  const [loading,setLoading]=useState(true);
  const [notifications,setNotifications]=useState([]);
  const [notifUnread,setNotifUnread]=useState(0);
  const [notifLoading,setNotifLoading]=useState(false);
  const [automation,setAutomation]=useState(null);
  const [automationBusy,setAutomationBusy]=useState('');
  const [pushState,setPushState]=useState(null);

  // ── Estado de interface compartilhado entre telas ───
  const [orderFilter,setOrderFilter]=useState('ALL');
  const [orderMode,setOrderMode]=useState('list'); // 'list' | 'supplier'
  const [searchOrders,setSearchOrders]=useState('');
  const [shipTab,setShipTab]=useState('label');
  const [searchClients,setSearchClients]=useState('');
  const [openOrderId,setOpenOrderId]=useState(null);
  const [batchCards,setBatchCards]=useState({});
  const [busy,setBusy]=useState(null);
  const [copiedOrder,setCopiedOrder]=useState(null);
  const [zoomSrc,setZoomSrc]=useState(null);

  async function apiPost(path,body){
    const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(body||{})});
    const json=await r.json().catch(()=>({}));
    if(!r.ok||json.ok===false)throw new Error(json.error||`HTTP ${r.status}`);
    return json;
  }
  const fail=(prefix,e)=>{console.error(e);SFX.error();if(toastFn)toastFn(prefix+(e?.message||String(e)),'error');};
  const ok=msg=>{SFX.success();if(toastFn&&msg)toastFn(msg,'success');};

  async function loadOrders(){
    setLoading(true);
    try{setIndivOrders((await apiPost('/api/admin-individual-orders')).orders||[]);}
    catch(e){fail('Erro ao carregar pedidos: ',e);}
    setLoading(false);
  }
  async function loadProfiles(){
    try{setAllProfiles((await apiPost('/api/admin-profiles')).profiles||[]);}
    catch(e){console.warn('admin-profiles:',e);}
  }
  async function loadNotifications(silent=false){
    if(!silent)setNotifLoading(true);
    try{
      const json=await apiPost('/api/admin-notifications',{action:'list',limit:80});
      setNotifications(json.notifications||[]);setNotifUnread(json.unread||0);
    }catch(e){if(!silent)console.warn('admin-notifications:',e);}
    if(!silent)setNotifLoading(false);
  }
  async function refreshPushState(){
    try{setPushState(await getPushState(token));}
    catch(e){setPushState(s=>s||{supported:false,reason:'unsupported'});}
  }

  // Automações: lê o status e, se o cron ainda não sabe para onde chamar,
  // registra o domínio em que o console está aberto agora.
  async function loadAutomation(){
    try{
      let {config}=await apiPost('/api/admin-automation',{action:'get'});
      const origin=typeof window!=='undefined'?window.location.origin:'';
      if(config&&!config.site_url&&origin.startsWith('https://')){
        ({config}=await apiPost('/api/admin-automation',{action:'register',siteUrl:origin}).catch(()=>({config})));
      }
      setAutomation(config||{});
    }catch(e){setAutomation({error:e.message||String(e)});}
  }
  async function registerSiteUrl(){
    try{const {config}=await apiPost('/api/admin-automation',{action:'register',siteUrl:window.location.origin});setAutomation(config);ok('Domínio salvo para as automações');}
    catch(e){fail('Erro: ',e);}
  }
  async function runAutomation(job){
    setAutomationBusy(job);
    try{
      const {result,config}=await apiPost('/api/admin-automation',{action:'run',job});
      setAutomation(config);
      if(job==='tracking'){
        ok(result.fatal?null:`${result.checked} remessa(s) consultada(s) · ${result.updated} atualizada(s)`);
        if(result.fatal&&toastFn)toastFn('Rastreio: '+result.fatal,'error');
        await loadOrders();
      }else ok('Resumo enviado');
      loadNotifications(true);
    }catch(e){fail('Erro ao rodar: ',e);}
    setAutomationBusy('');
  }

  useEffect(()=>{loadOrders();loadNotifications();loadProfiles();loadAutomation();refreshPushState();},[]);
  // O push avisa no celular; aqui a tela de quem está com o console aberto acompanha.
  useEffect(()=>{const id=setInterval(()=>loadNotifications(true),60000);return ()=>clearInterval(id);},[]);

  async function reloadAll(){
    await Promise.all([loadOrders(),loadNotifications(),loadProfiles(),loadAutomation()]);
    if(onReload)onReload();
  }

  // ─── Dados derivados ───────────────────────────────
  // Todos os lotes, com os dados do cliente pendurados. Um pedido pode ter
  // mais de um lote: o cliente adicionou cartas antes da compra no fornecedor.
  const allBatches=useMemo(()=>{
    const list=[];
    indivOrders.forEach(o=>{
      const ordered=[...(o.order_batches||[])].sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0));
      const rootId=ordered[0]?.id;
      ordered.forEach((b,i)=>{
        list.push({...b,order_id:b.order_id||o.id,orderId:o.id,userId:o.user_id,clientName:o.profiles?.name||'—',clientWhatsapp:o.profiles?.whatsapp||'',clientEmail:o.profiles?.email||'',orderCreatedAt:o.created_at,isAddition:i>0,addedToShortId:i>0&&rootId?shortBatchId(rootId):null});
      });
    });
    return list;
  },[indivOrders]);

  const orders=useMemo(()=>groupBatchesIntoOrders(allBatches).map(o=>{
    const root=o.batches[0]||{};
    const paidBatches=o.batches.filter(isPaidBatchStatus);
    return {...o,
      userId:root.userId,
      clientName:root.clientName||'—',
      clientWhatsapp:root.clientWhatsapp||'',
      clientEmail:root.clientEmail||'',
      paidBatches,
      pendingBatches:o.batches.filter(b=>!isPaidBatchStatus(b)&&!resolveOrderStage(b).terminal),
      paidQty:paidBatches.reduce((s,b)=>s+Number(b.qty_in_batch||0),0),
      paidTotal:paidBatches.reduce((s,b)=>s+Number(b.total_locked||0),0),
      paidAt:paidBatches.map(b=>b.confirmed_at||b.created_at).sort()[0]||null,
      hasLabel:o.batches.some(b=>b.mandabem_envio_id),
    };
  }),[allBatches]);

  // Envio: uma etiqueta por REMESSA, não por lote — o pedido e as cartas
  // adicionadas depois saem na mesma caixa.
  const shipGroups=useMemo(()=>{
    const paidBatches=allBatches.filter(isPaidBatchStatus);
    const grouped=buildShippingGroups(paidBatches);
    const seen=new Set(grouped.flatMap(g=>g.batches.map(b=>String(b.id))));
    // Lote pago fora de qualquer grupo (frete zerado) não pode sumir: vira um grupo de um.
    const soltos=paidBatches.filter(b=>!seen.has(String(b.id))).map(b=>({
      key:String(b.id),rootId:String(b.shipping_group_id||b.id),rootBatch:b,batches:[b],
      shippingService:b.shipping_service||'',totalValue:Number(b.total_locked||0),totalQuantity:Number(b.qty_in_batch||0),
      hasLabel:!!b.mandabem_envio_id,hasCompleteLabel:!!b.mandabem_envio_id,
    }));
    return [...grouped,...soltos].map(group=>{
      const root=group.rootBatch||{};
      const tracked=group.batches.find(b=>b.mandabem_rastreamento||b.mandabem_etiqueta)||root;
      const trackingStatus=tracked.mandabem_status||'';
      return {...group,
        clientName:root.clientName||'—',
        clientWhatsapp:root.clientWhatsapp||'',
        userId:root.userId,
        // Só está pronta quando TODOS os lotes chegaram na preparação: senão a
        // etiqueta sairia sem as cartas que ainda estão vindo do fornecedor.
        ready:group.batches.filter(b=>!isShippingAdjustment(b)).every(b=>SHIPPABLE.includes(b.fulfillment_status)),
        stage:resolveOrderStageFromBatches(group.batches),
        trackingCode:tracked.mandabem_rastreamento||tracked.mandabem_etiqueta||'',
        trackingStatus,
        phase:shipmentPhase(trackingStatus),
        trackingUpdatedAt:tracked.mandabem_updated_at||null,
      };
    });
  },[allBatches]);

  const shipments=useMemo(()=>shipGroups
    .filter(g=>g.batches.some(b=>SHIPPABLE.includes(b.fulfillment_status)))
    .sort((a,b)=>a.stage.index-b.stage.index||a.clientName.localeCompare(b.clientName)),[shipGroups]);

  const shipBuckets=useMemo(()=>({
    label:shipments.filter(g=>!g.hasLabel),
    transit:shipments.filter(g=>g.hasLabel&&g.stage.key!=='DELIVERED'&&g.phase!=='PROBLEM'),
    problem:shipments.filter(g=>g.hasLabel&&g.stage.key!=='DELIVERED'&&g.phase==='PROBLEM'),
    delivered:shipments.filter(g=>g.stage.key==='DELIVERED'),
  }),[shipments]);

  const stats=useMemo(()=>{
    const paid=allBatches.filter(isPaidBatchStatus);
    const pending=allBatches.filter(b=>!isPaidBatchStatus(b)&&!resolveOrderStage(b).terminal);
    const dateOf=b=>b.confirmed_at||b.created_at||b.orderCreatedAt;
    const sum=list=>list.reduce((s,b)=>s+Number(b.total_locked||0),0);
    return{
      orders:orders.length,
      paidCount:paid.length,
      revenue:sum(paid),
      cards:paid.reduce((s,b)=>s+Number(b.qty_in_batch||0),0),
      pendingCount:pending.length,
      pendingRevenue:sum(pending),
      cancelledCount:allBatches.filter(b=>resolveOrderStage(b).terminal).length,
      todayCount:paid.filter(b=>isToday(dateOf(b))).length,
      todayRevenue:sum(paid.filter(b=>isToday(dateOf(b)))),
      weekRevenue:sum(paid.filter(b=>daysAgo(dateOf(b),7))),
      weekCount:paid.filter(b=>daysAgo(dateOf(b),7)).length,
    };
  },[allBatches,orders]);

  // A fila de trabalho: o que a Visão "Hoje" cobra do admin.
  const queue=useMemo(()=>({
    awaitingPayment:orders.filter(o=>o.stage.key==='AWAITING_PAYMENT').length,
    toBuy:orders.filter(o=>o.paidBatches.length>0&&o.stage.key==='PAID').length,
    inbound:orders.filter(o=>['ORDERED_FROM_SUPPLIER','SHIPPED_TO_BR','ARRIVED_BR'].includes(o.stage.key)).length,
    toLabel:shipBuckets.label.length,
    problems:shipBuckets.problem.length,
    inTransit:shipBuckets.transit.length,
  }),[orders,shipBuckets]);

  const clients=useMemo(()=>{
    const groups={};
    orders.forEach(o=>{
      const key=o.userId||o.orderId;
      if(!groups[key])groups[key]={userId:key,name:o.clientName,whatsapp:o.clientWhatsapp,email:o.clientEmail,orders:[],totalCards:0,totalSpent:0,hasOrder:true,hasActiveOrder:false,hasPaidOrder:false,lastOrderAt:null};
      const g=groups[key];
      g.orders.push(o);g.totalCards+=o.paidQty;g.totalSpent+=o.paidTotal;
      if(!o.stage.terminal&&o.stage.key!=='DELIVERED')g.hasActiveOrder=true;
      if(o.paidBatches.length>0)g.hasPaidOrder=true;
      if(!g.lastOrderAt||new Date(o.createdAt)>new Date(g.lastOrderAt))g.lastOrderAt=o.createdAt;
    });
    allProfiles.forEach(p=>{
      if(!groups[p.id]&&!p.is_admin)groups[p.id]={userId:p.id,name:p.name||'—',whatsapp:p.whatsapp||'',email:p.email||'',orders:[],totalCards:0,totalSpent:0,hasOrder:false,hasActiveOrder:false,hasPaidOrder:false,lastOrderAt:null};
    });
    return Object.values(groups).sort((a,b)=>b.hasActiveOrder-a.hasActiveOrder||b.hasOrder-a.hasOrder||a.name.localeCompare(b.name));
  },[orders,allProfiles]);

  // ─── Ações de pedido ───────────────────────────────
  async function loadBatchCards(batchIds){
    const missing=batchIds.filter(id=>!batchCards[id]);
    if(!missing.length)return;
    try{
      const json=await apiPost('/api/admin-batch-items',{batchIds:missing});
      const byBatch={};missing.forEach(id=>{byBatch[id]=[];});
      (json.items||[]).forEach(i=>{(byBatch[i.batch_id]||(byBatch[i.batch_id]=[])).push({name:i.cards?.name||'Carta',type:i.cards?.type||'',qty:Number(i.quantity||1),image_url:i.cards?.image_url||null});});
      setBatchCards(prev=>({...prev,...byBatch}));
    }catch(e){fail('Erro ao carregar itens: ',e);}
  }

  function openOrder(order){
    SFX.click();
    setOpenOrderId(order.orderId);
    loadBatchCards(order.batches.map(b=>b.id));
  }

  // Copia a lista de compra do PEDIDO inteiro — lotes juntos, repetidas somadas.
  async function copyOrderCards(order){
    const batchIds=order.batches.map(b=>b.id);
    if(!batchIds.length)return;
    setBusy('copy:'+order.orderId);
    try{
      const json=await apiPost('/api/admin-batch-items',{batchIds});
      const cards=aggregateOrderCards(json.items||[]);
      if(!cards.length){if(toastFn)toastFn('Este pedido não tem cartas','error');return;}
      await navigator.clipboard.writeText(formatSupplierCardList(cards));
      setCopiedOrder(order.orderId);setTimeout(()=>setCopiedOrder(c=>c===order.orderId?null:c),2000);
      ok(`${totalCardQty(cards)} cartas copiadas`);
    }catch(e){fail('Erro ao copiar lista: ',e);}
    finally{setBusy(null);}
  }

  async function cancelBatch(batchId,paid){
    const msg=paid?'Cancelar pedido pago? O reembolso deve ser feito manualmente no Mercado Pago.':'Cancelar este pedido pendente?';
    if(!confirm(msg))return;
    try{await apiPost('/api/admin-cancel-batch',{batchId});ok('Pedido cancelado');await loadOrders();}
    catch(e){fail('Erro ao cancelar: ',e);}
  }

  async function markBatchPaid(batchId){
    if(!confirm('Marcar este pedido como PAGO manualmente?'))return;
    try{await apiPost('/api/admin-mark-paid',{batchId});ok('Pedido marcado como pago');await loadOrders();}
    catch(e){fail('Erro ao marcar como pago: ',e);}
  }

  async function syncBatchMP(batchId){
    setBusy('mp:'+batchId);
    try{await mpSync(batchId);ok('Pagamento conferido no Mercado Pago');await loadOrders();}
    catch(e){fail('Erro ao sincronizar com o Mercado Pago: ',e);}
    setBusy(null);
  }

  // Move o estágio de um ou mais PEDIDOS — sempre com confirmação: o cliente
  // vê essa trilha na conta dele. Todos os lotes pagos andam juntos.
  async function moveStage(list,stage,busyId,opts={}){
    const targets=list.flatMap(o=>o.paidBatches.map(b=>b.id));
    if(!targets.length){if(toastFn)toastFn('Nenhum lote pago para mover','error');return;}
    const alvo=list.length>1?`os ${list.length} pedidos`:'o pedido';
    const aviso=opts.back&&list.some(o=>o.hasLabel)?'\n\nA etiqueta do MandaBem já foi gerada e continua valendo — voltar o status não cancela o envio.':'';
    if(!confirm(`${opts.back?'Voltar':'Avançar'} ${alvo} para "${stage.label}"?${aviso}`))return;
    setBusy(busyId);
    try{
      await apiPost('/api/admin-update-fulfillment',{batchIds:targets,fulfillmentStatus:stage.key});
      ok(`${list.length>1?`${list.length} pedidos`:'Pedido'} em "${stage.label}"`);
      await loadOrders();
    }catch(e){fail('Erro ao atualizar status: ',e);}
    setBusy(null);
  }

  // Etiqueta: uma por remessa. Com etiqueta já gerada, o botão só reconsulta.
  async function generateLabel(group){
    const root=group.rootBatch||group.batches[0];
    const batchIds=group.batches.map(b=>b.id);
    const action=group.batches.some(b=>b.mandabem_envio_id)?'refresh':'generate';
    let formaEnvio=root.shipping_service&&root.shipping_service!==SHIPPING_SERVICE_UNKNOWN?root.shipping_service:'';
    if(action==='generate'){
      if(group.ready===false){if(toastFn)toastFn('Há cartas deste pedido que ainda não chegaram em "Em preparação".','error');return;}
      if(!formaEnvio){
        const svc=prompt('Serviço não identificado. Digite PAC, SEDEX ou PACMINI:','PACMINI');
        if(svc===null)return;
        formaEnvio=svc.trim().toUpperCase().replace(/[\s_-]+/g,'');
        if(!['PAC','SEDEX','PACMINI'].includes(formaEnvio)){if(toastFn)toastFn('Serviço inválido. Use PAC, SEDEX ou PACMINI.','error');return;}
      }
      const extra=batchIds.length>1?`\n\nSão ${batchIds.length} lotes deste pedido numa etiqueta só.`:'';
      if(!confirm(`Gerar etiqueta no MandaBem (${formaEnvio}) para ${group.clientName}?${extra}`))return;
    }
    setBusy('label:'+group.key);
    try{
      await apiPost('/api/admin-mandabem-label',{batchIds,rootBatchId:group.rootId,action,formaEnvio});
      ok(action==='refresh'?'Rastreio atualizado':'Etiqueta gerada no MandaBem');
      await loadOrders();
    }catch(e){fail('Erro MandaBem: ',e);}
    setBusy(null);
  }

  function markDelivered(group){
    const list=orders.filter(o=>o.batches.some(b=>group.batches.some(gb=>String(gb.id)===String(b.id))));
    if(list.length)moveStage(list,ORDER_STAGES[ORDER_STAGES.length-1],'deliver:'+group.key);
  }

  function sendTrackingWhatsApp({clientName,clientWhatsapp,trackingCode,trackingStatus}){
    const url=buildShipmentWhatsAppUrl({name:clientName,whatsapp:clientWhatsapp},'',trackingCode,trackingStatus);
    if(!url){if(toastFn)toastFn('Cliente sem WhatsApp válido','error');return;}
    window.open(url,'_blank','noopener,noreferrer');
  }

  async function copyText(text,msg='Copiado!'){
    try{await navigator.clipboard.writeText(text);ok(msg);}catch{if(toastFn)toastFn('Não foi possível copiar','error');}
  }

  // ─── Notificações ──────────────────────────────────
  async function markAllRead(){
    try{await apiPost('/api/admin-notifications',{action:'readAll'});await loadNotifications();}
    catch(e){fail('Erro ao marcar como lido: ',e);}
  }
  async function clearRead(){
    try{await apiPost('/api/admin-notifications',{action:'clear'});await loadNotifications();}
    catch(e){fail('Erro ao limpar: ',e);}
  }

  // Tocar num evento leva para o lugar certo.
  function openNotification(n){
    if(!n.read_at)apiPost('/api/admin-notifications',{action:'read',ids:[n.id]}).then(()=>loadNotifications(true)).catch(()=>{});
    setShowNotifications(false);
    const t=n.type;
    if(t==='LOGIN'||t==='SIGNUP'){go('clients');setSearchClients(n.data?.name||n.data?.clientName||'');return;}
    if(t==='DAILY_DIGEST'){go('overview');return;}
    if(t==='SYSTEM_ERROR'){go('more',n.data?.job==='sheet-sync'?'catalog':'automation');return;}
    if(t.startsWith('SHIPMENT_')||t==='ADDRESS_CHANGED'){
      go('shipping');setShipTab(t==='SHIPMENT_PROBLEM'?'problem':t==='SHIPMENT_DELIVERED'?'delivered':t==='SHIPMENT_LABEL'||t==='SHIPMENT_POSTED'?'transit':'label');
      return;
    }
    go('orders');setOrderMode('list');setOrderFilter('ALL');setSearchOrders(n.data?.shortId||'');
  }

  function go(key,page=null){
    SFX.nav();setSection(key);setMorePage(page);setShowNotifications(false);
    if(typeof window!=='undefined')window.scrollTo({top:0,behavior:'smooth'});
  }

  const ctx={
    theme,token,toast:toastFn,apiPost,
    loading,orders,shipments,shipBuckets,stats,queue,clients,
    notifications,notifUnread,notifLoading,
    automation,automationBusy,runAutomation,registerSiteUrl,
    pushState,refreshPushState,
    orderFilter,setOrderFilter,orderMode,setOrderMode,searchOrders,setSearchOrders,
    shipTab,setShipTab,searchClients,setSearchClients,
    openOrderId,setOpenOrderId,openOrder,batchCards,busy,copiedOrder,setZoomSrc,
    copyOrderCards,cancelBatch,markBatchPaid,syncBatchMP,moveStage,generateLabel,markDelivered,sendTrackingWhatsApp,copyText,
    openNotification,openNotifications:()=>{setShowNotifications(true);loadNotifications();},
    go,morePage,setMorePage,onReload,reloadOrders:loadOrders,
  };

  const current=SECTIONS.find(s=>s.key===section)||SECTIONS[0];
  const navBadge={orders:queue.awaitingPayment+queue.toBuy,shipping:queue.toLabel+queue.problems};

  return(<div className="portal-page portal-admin adm">
    <header className="adm-top">
      <div style={{minWidth:0}}>
        <h1>{current.title}</h1>
        <p>Console · {new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})}</p>
      </div>
      <div className="adm-top-actions">
        <button className={'adm-icon-btn'+(showNotifications?' is-on':'')} onClick={()=>{SFX.click();ctx.openNotifications();}} aria-label={`Notificações${notifUnread?`, ${notifUnread} novas`:''}`}>
          <Bell size={18}/>{notifUnread>0&&<span className="adm-dot">{notifUnread>9?'9+':notifUnread}</span>}
        </button>
        <button className="adm-icon-btn" onClick={()=>{SFX.click();reloadAll();}} aria-label="Recarregar"><RefreshCw size={17} style={loading?{animation:'spin 1s linear infinite'}:undefined}/></button>
      </div>
    </header>

    <nav className="adm-nav" aria-label="Seções do console">
      {SECTIONS.map(s=>(
        <button key={s.key} className={section===s.key?'is-active':''} aria-current={section===s.key?'page':undefined} onClick={()=>go(s.key)}>
          <s.icon size={19}/>{s.label}
          {navBadge[s.key]>0&&<span className="adm-dot">{navBadge[s.key]>9?'9+':navBadge[s.key]}</span>}
        </button>
      ))}
    </nav>

    {section==='overview'&&<HomeView ctx={ctx}/>}
    {section==='orders'&&<OrdersView ctx={ctx}/>}
    {section==='shipping'&&<ShippingView ctx={ctx}/>}
    {section==='clients'&&<ClientsView ctx={ctx}/>}
    {section==='more'&&<MoreView ctx={ctx}/>}

    <NotificationsSheet open={showNotifications} onClose={()=>setShowNotifications(false)} ctx={ctx} onMarkAll={markAllRead} onClear={clearRead} onRefresh={()=>loadNotifications()} onSettings={()=>go('more','push')}/>
    <ImageLightbox src={zoomSrc} onClose={()=>setZoomSrc(null)}/>
  </div>);
}
