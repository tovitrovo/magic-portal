export type WantItem = { name: string; qty: number };

const KEY = "magic_portal_state_v1";

export type PortalState = {
  guild: string;
  wants: WantItem[];
  tierUnitPrice: number; // current unit
  lockedOrder?: {
    createdAt: string;
    lockedUnitPrice: number;
    totalQty: number;
    totalPaid: number;
  };
};

export const defaultState: PortalState = {
  guild: "Izzet",
  wants: [],
  tierUnitPrice: 23
};

export function loadState(): PortalState {
  if (typeof window === "undefined") return defaultState;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw);
    return { ...defaultState, ...parsed };
  } catch {
    return defaultState;
  }
}

export function saveState(state: PortalState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function calcTotalQty(wants: WantItem[]) {
  return wants.reduce((sum, w) => sum + (Number.isFinite(w.qty) ? w.qty : 0), 0);
}

export function calcTierPrice(totalQty: number) {
  // Tiers simples (exemplo):
  // 0-9: 23
  // 10-19: 21
  // 20-49: 19
  // 50+: 17
  if (totalQty >= 50) return 17;
  if (totalQty >= 20) return 19;
  if (totalQty >= 10) return 21;
  return 23;
}

export function calcBonusCards(lockedUnitPrice: number, currentUnitPrice: number, totalQty: number) {
  // regra: se preço caiu, diferença total vira crédito; se crédito >= preço atual, vira cartas bônus
  const diffPerUnit = Math.max(0, lockedUnitPrice - currentUnitPrice);
  const credit = diffPerUnit * totalQty;
  const bonus = Math.floor(credit / currentUnitPrice);
  return { credit, bonus };
}
