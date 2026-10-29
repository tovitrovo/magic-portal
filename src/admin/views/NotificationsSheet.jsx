// Central de notificações: o mesmo histórico que chega por push no celular.
import { useState } from 'react';
import { AlertTriangle, Ban, Bell, CheckCircle, Gift, LogIn, MapPin, Package, RefreshCw, ShoppingBag, Sun, Tag as TagIcon, Trash2, Truck, UserPlus, Wallet, XCircle } from 'lucide-react';
import { NOTIFICATION_CATEGORIES, categoryOfType } from '../../../shared/notificationTypes';
import { Chips, Empty, Loading, Sheet, timeAgo } from '../ui';

export const NOTIF_META={
  NEW_ORDER:{icon:ShoppingBag,color:'var(--gold)'},
  ORDER_PAID:{icon:Wallet,color:'var(--ok)'},
  BONUS_ORDER:{icon:Gift,color:'var(--ok)'},
  SHIPMENT_LABEL:{icon:TagIcon,color:'var(--info)'},
  SHIPMENT_POSTED:{icon:Truck,color:'var(--indiv)'},
  SHIPMENT_DELIVERED:{icon:Package,color:'var(--ok)'},
  ADDRESS_CHANGED:{icon:MapPin,color:'var(--info)'},
  ORDER_CANCELLED:{icon:Ban,color:'var(--text-dim)'},
  PAYMENT_FAILED:{icon:XCircle,color:'var(--danger)'},
  SHIPMENT_PROBLEM:{icon:AlertTriangle,color:'var(--danger)'},
  SYSTEM_ERROR:{icon:AlertTriangle,color:'var(--danger)'},
  DAILY_DIGEST:{icon:Sun,color:'var(--gold)'},
  LOGIN:{icon:LogIn,color:'var(--info)'},
  SIGNUP:{icon:UserPlus,color:'var(--info)'},
};

export function FeedList({notifications,loading,onOpen}){
  if(loading&&!notifications.length)return <Loading/>;
  if(!notifications.length)return <Empty icon={Bell} title="Nada por aqui" sub="Pedidos, envios e alertas aparecem nesta lista"/>;
  return(<div className="adm-list">
    {notifications.map(n=>{
      const meta=NOTIF_META[n.type]||{icon:Bell,color:'var(--text-dim)'};
      return(<button key={n.id} className={'adm-feed-item'+(n.read_at?' is-read':'')} onClick={()=>onOpen&&onOpen(n)}>
        <span className="adm-avatar" style={{'--c':meta.color}}><meta.icon size={15}/></span>
        <span style={{flex:1,minWidth:0}}>
          <span className="adm-feed-title"><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{n.title}</span>{!n.read_at&&<span style={{width:7,height:7,borderRadius:4,background:meta.color,flexShrink:0}}/>}</span>
          {n.body&&<span className="adm-feed-body" style={{display:'block'}}>{n.body}</span>}
        </span>
        <span className="adm-feed-time">{timeAgo(n.created_at)}</span>
      </button>);
    })}
  </div>);
}

export default function NotificationsSheet({open,onClose,ctx,onMarkAll,onClear,onRefresh,onSettings}){
  const [cat,setCat]=useState('all');
  const {notifications,notifUnread,notifLoading}=ctx;
  const list=cat==='all'?notifications:cat==='unread'?notifications.filter(n=>!n.read_at):notifications.filter(n=>categoryOfType(n.type)?.key===cat);
  const options=[
    {key:'all',label:'Tudo',count:notifications.length},
    {key:'unread',label:'Não lidas',count:notifUnread,color:'var(--danger)'},
    ...NOTIFICATION_CATEGORIES.map(c=>({key:c.key,label:c.label.split(' e ')[0],count:notifications.filter(n=>categoryOfType(n.type)?.key===c.key).length})).filter(o=>o.count>0),
  ];
  return(<Sheet open={open} onClose={onClose} title="Notificações" sub={notifUnread?`${notifUnread} não lida(s)`:'Tudo lido'}
    right={<button className="adm-icon-btn" onClick={onRefresh} aria-label="Atualizar"><RefreshCw size={16}/></button>}>
    <Chips options={options} value={cat} onChange={setCat}/>
    <div className="adm-row-actions">
      <button className="adm-btn is-sm" onClick={onMarkAll} disabled={!notifUnread}><CheckCircle size={13}/> Marcar tudo lido</button>
      <button className="adm-btn is-sm is-ghost" onClick={onClear}><Trash2 size={13}/> Limpar lidas</button>
      <button className="adm-btn is-sm is-ghost" onClick={onSettings} style={{marginLeft:'auto'}}><Bell size={13}/> Push</button>
    </div>
    <div className="adm-card"><FeedList notifications={list} loading={notifLoading} onOpen={ctx.openNotification}/></div>
  </Sheet>);
}
