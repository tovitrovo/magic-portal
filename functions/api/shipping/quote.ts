export const onRequestPost: PagesFunction = async (context) => {
  try {
    // ✅ Suporta 2 jeitos comuns de autenticar:
    // 1) Bearer token: MANDABEM_TOKEN
    // 2) api_id + api_token (muito comum em integrações tipo Yampi): MANDABEM_API_ID + MANDABEM_API_TOKEN
    // ✅ Aceita dois padrões de nomes (você pode ter criado com ou sem underscore):
    // - MANDABEM_* (padrão do nosso código)
    // - MANDA_BEM_* (padrão mais "legível" no painel)
    const bearer =
      (context.env.MANDABEM_TOKEN as string | undefined) ||
      (context.env.MANDA_BEM_TOKEN as string | undefined) ||
      undefined;

    const apiId =
      (context.env.MANDABEM_API_ID as string | undefined) ||
      (context.env.MANDA_BEM_API_ID as string | undefined) ||
      undefined;

    const apiToken =
      (context.env.MANDABEM_API_TOKEN as string | undefined) ||
      (context.env.MANDA_BEM_API_TOKEN as string | undefined) ||
      undefined;

    // ✅ IMPORTANTE: seu erro "error code: 1016" é Cloudflare dizendo que o host não existe/resolve.
    // O default abaixo usa um endpoint REAL que aparece em docs públicas de integração.
    // Se o seu endpoint for outro, só troque a variável no Cloudflare e pronto.
    const freightUrl =
      (context.env.MANDABEM_FREIGHT_URL as string | undefined) ||
      (context.env.MANDA_BEM_FREIGHT_URL as string | undefined) ||
      "https://mandabem.com.br/yampi/calcula_frete";

    if (!bearer && !(apiId && apiToken)) {
      return json(
        {
          ok: false,
          error: "Credenciais do Manda Bem não configuradas no Cloudflare",
          needed: [
            "Opção A: MANDABEM_TOKEN",
            "Opção B: MANDABEM_API_ID + MANDABEM_API_TOKEN",
          ],
        },
        500
      );
    }

    const body = await context.request.json<any>();

    // ⚠️ Endpoint exato varia conforme o produto/conta no Manda Bem.
    // Aqui deixei um "adapter" bem fácil de ajustar: você só troca a URL e o payload.
    // ✅ Payload "compatível": mandamos chaves com nomes diferentes pra cobrir variações de API.
    const cep = String(body?.cep_destino || body?.cep || "").replace(/\D/g, "");
    const peso = Number(body?.peso_kg || body?.peso || 0.2);
    const largura = Number(body?.largura_cm || body?.largura || 16);
    const altura = Number(body?.altura_cm || body?.altura || 3);
    const comprimento = Number(body?.comprimento_cm || body?.comprimento || 22);
    const valor = Number(body?.valor_declarado || body?.valor || 0);

    const payload = {
      // comuns
      cep_destino: cep,
      peso_kg: peso,
      largura_cm: largura,
      altura_cm: altura,
      comprimento_cm: comprimento,
      valor_declarado: valor,

      // variantes (algumas integrações usam esses nomes)
      cep,
      peso,
      largura,
      altura,
      comprimento,
      valor,
    };

    if (cep.length !== 8) {
      return json({ ok:false, error: "CEP inválido (precisa 8 dígitos)" }, 400);
    }

    // ⚠️ IMPORTANTE: aqui chamamos UMA URL completa (freightUrl). Assim você não fica preso
    // a subdomínio inexistente (tipo api.mandabem.com.br) e resolve o 1016.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
    if (apiId && apiToken) {
      headers["api_id"] = apiId;
      headers["api_token"] = apiToken;
    }

    const resp = await fetch(freightUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    // ✅ NUNCA assume JSON. Se a API (ou Cloudflare) devolver HTML/texto, devolvemos JSON mesmo assim.
    const rawText = await resp.text();
    const data = safeJson(rawText);
    if (!resp.ok) {
      return json(
        {
          ok: false,
          error: (data && (data.message || data.error)) || `Erro no frete (HTTP ${resp.status})`,
          status: resp.status,
          // ajuda debug sem quebrar o front
          raw: data || rawText?.slice(0, 400),
        },
        400
      );
    }

    // Normaliza retorno (ajuste conforme a resposta real)
    const best = pickBestQuote(data || rawText);
    if (!best) return json({ ok:false, error: "Sem cotações disponíveis", raw: data }, 200);

    return json({
      ok:true,
      price: Number(best.price),
      deadline_days: Number(best.deadline_days ?? best.deadline ?? 0),
      carrier: String(best.carrier ?? best.service ?? "Manda Bem"),
      raw: data
    }, 200);

  } catch (e:any) {
    return json({ ok:false, error: e?.message || "Erro inesperado" }, 500);
  }
};

// ✅ Pra você conseguir "clicar e testar" no browser.
export const onRequestGet: PagesFunction = async () => {
  return json(
    {
      ok: true,
      message: "Shipping endpoint está online. Use POST para calcular frete.",
      howToTest: "Abra /api/health (GET). O cálculo real roda via POST pelo site.",
    },
    200
  );
};

function pickBestQuote(data: any) {
  // Aceita formatos comuns: {quotes:[...]} ou [...]
  const list = Array.isArray(data) ? data : Array.isArray(data?.quotes) ? data.quotes : Array.isArray(data?.data) ? data.data : null;
  if (!list?.length) return null;

  // pega o mais barato
  let best = list[0];
  for (const q of list) {
    if (Number(q.price ?? q.valor ?? Infinity) < Number(best.price ?? best.valor ?? Infinity)) best = q;
  }
  return {
    price: Number(best.price ?? best.valor),
    deadline_days: best.deadline_days ?? best.prazo,
    carrier: best.carrier ?? best.transportadora ?? best.servico,
    service: best.service ?? best.servico
  };
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
