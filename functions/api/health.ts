import type { PagesFunction } from "@cloudflare/workers-types";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// GET /api/health
export const onRequestGet: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  return json({
    ok: true,
    service: "magic-portal",
    path: url.pathname,
    message:
      "Functions online. Se /api/mp/* der 404 no clique, é porque era POST-only antes.",
  });
};
