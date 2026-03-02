export type LocalUser = {
  email: string;
};

const KEY = "mp_portal_user";
const PENDING_KEY = "mp_portal_pending_signup";

export function getUser(): LocalUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalUser;
  } catch {
    return null;
  }
}

export function setUser(user: LocalUser) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(user));
}

export function clearUser() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

// ===== Signup flow (Goblin onboarding) =====
export function setPendingSignup(email: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PENDING_KEY, JSON.stringify({ email }));
}

export function getPendingSignup(): { email: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { email: string };
  } catch {
    return null;
  }
}

export function clearPendingSignup() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PENDING_KEY);
}
