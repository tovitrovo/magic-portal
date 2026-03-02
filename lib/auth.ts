export type LocalUser = {
  email: string;
};

const KEY = "mp_portal_user";

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
