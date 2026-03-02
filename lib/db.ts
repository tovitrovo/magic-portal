import { supabase } from "./supabase";
import type { PortalState, WantItem } from "./storage";

const LS_PORTAL_ID = "mp_portal_id";

export function getPortalId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(LS_PORTAL_ID);
  if (!id) {
    id = crypto?.randomUUID?.() ?? String(Date.now());
    localStorage.setItem(LS_PORTAL_ID, id);
  }
  return id;
}

export async function loadWantsFromDb(): Promise<WantItem[] | null> {
  if (!supabase) return null;
  const portal_id = getPortalId();
  const { data, error } = await supabase
    .from("wants")
    .select("card_name, qty")
    .eq("portal_id", portal_id)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("loadWantsFromDb error", error);
    return null;
  }
  return (data ?? []).map((r: any) => ({ name: r.card_name, qty: r.qty }));
}

export async function saveWantsToDb(wants: WantItem[]): Promise<boolean> {
  if (!supabase) return false;
  const portal_id = getPortalId();

  // estratégia simples: apaga tudo e insere de novo
  const del = await supabase.from("wants").delete().eq("portal_id", portal_id);
  if (del.error) {
    console.warn("delete wants error", del.error);
    return false;
  }

  if (wants.length === 0) return true;

  const rows = wants
    .filter((w) => w.name.trim() && w.qty > 0)
    .map((w) => ({ portal_id, card_name: w.name.trim(), qty: w.qty }));

  const ins = await supabase.from("wants").insert(rows);
  if (ins.error) {
    console.warn("insert wants error", ins.error);
    return false;
  }
  return true;
}

export async function saveOrderToDb(params: {
  state: PortalState;
  shipping: any;
  mp_preference_id?: string;
  total_brl: number;
  unit_price_brl: number;
  bonus_cards: number;
}): Promise<string | null> {
  if (!supabase) return null;
  const portal_id = getPortalId();

  const { data, error } = await supabase
    .from("orders")
    .insert({
      portal_id,
      guild: params.state.guild,
      wants: params.state.wants,
      total_qty: params.state.wants.reduce((a, w) => a + (w.qty || 0), 0),
      unit_price_brl: params.unit_price_brl,
      total_brl: params.total_brl,
      bonus_cards: params.bonus_cards,
      shipping: params.shipping,
      mp_preference_id: params.mp_preference_id ?? null,
      status: "draft",
    })
    .select("id")
    .single();

  if (error) {
    console.warn("saveOrderToDb error", error);
    return null;
  }

  return data?.id ?? null;
}
