/**
 * Resolve o usuário autenticado a partir do token Bearer (sem exigir admin).
 * Retorna { ok, userId } ou { ok:false, status, error }.
 */
export async function verifyUser(context, SB_URL, SB_SERVICE_ROLE_KEY) {
  const authHeader = context.request.headers.get("Authorization") || "";
  const userToken = authHeader.replace("Bearer ", "").trim();
  if (!userToken) return { ok: false, status: 401, error: "Token de autenticação ausente" };

  try {
    const meRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${userToken}` },
    });
    if (!meRes.ok) return { ok: false, status: 401, error: "Token inválido" };
    const me = await meRes.json();
    if (!me?.id) return { ok: false, status: 401, error: "Token inválido" };
    return { ok: true, userId: me.id };
  } catch (e) {
    return { ok: false, status: 500, error: String(e?.message || e) };
  }
}

export async function verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY) {
  const authHeader = context.request.headers.get("Authorization") || "";
  const userToken = authHeader.replace("Bearer ", "").trim();
  if (!userToken) return { ok: false, status: 401, error: "Token de autenticação ausente" };

  try {
    const meRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${userToken}` },
    });
    if (!meRes.ok) return { ok: false, status: 401, error: "Token inválido" };
    const me = await meRes.json();
    const userId = me.id;
    if (!userId) return { ok: false, status: 401, error: "Token inválido" };

    const profileRes = await fetch(
      `${SB_URL}/rest/v1/profiles?id=eq.${userId}&is_admin=eq.true&select=id`,
      { headers: { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` } }
    );
    const profiles = await profileRes.json().catch(() => []);
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return { ok: false, status: 403, error: "Acesso negado: usuário não é admin" };
    }
    return { ok: true, userId };
  } catch (e) {
    return { ok: false, status: 500, error: String(e?.message || e) };
  }
}
