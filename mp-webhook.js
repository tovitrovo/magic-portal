export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (context.request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await context.request.json().catch(() => ({}));
    const cepDestino = String(body.cepDestino ?? "").replace(/\D/g, "");
    const quantidade = Number(body.quantidade ?? 0);

    if (cepDestino.length !== 8 || !Number.isFinite(quantidade) || quantidade <= 0) {
      return new Response(JSON.stringify({ opcoes: [], error: "Parâmetros inválidos" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const cepOri = "05410010";
    const pesoKg = Math.max((quantidade * 2 + 50) / 1000, 0.3);
    const altura = Math.min(Math.max(Math.ceil(quantidade / 50), 2), 4);

    const plataforma_id = "68245";
    const plataforma_chave = "$2y$10$yrre6QlN25SlbnYtyNIHSOBA5jDsKe9nRixugJnYCQSmFZOztuS7.";

    const arred = (n) => Math.round(n * 100) / 100;

    async function consulta(servico) {
      const payload =
        "plataforma_id=" + plataforma_id +
        "&plataforma_chave=" + encodeURIComponent(plataforma_chave) +
        "&cep_origem=" + cepOri +
        "&cep_destino=" + cepDestino +
        "&servico=" + servico +
        "&peso=" + String(pesoKg) +
        "&altura=" + String(altura) +
        "&largura=16&comprimento=24&valor_seguro=0";

      const res = await fetch("https://mandabem.com.br/ws/valor_envio", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: payload,
      });

      const text = await res.text();
      const idx = text.indexOf("{");
      if (!res.ok || idx < 0) return null;

      let j;
      try { j = JSON.parse(text.slice(idx)); } catch { return null; }

      const r = j?.resultado;
      if (!r || String(r.sucesso).toLowerCase() !== "true") return null;

      const bucket = r?.[servico];
      const valorRaw = bucket?.valor;
      const prazoRaw = bucket?.prazo ?? 0;

      if (!valorRaw) return null;
      let preco = Number(String(valorRaw).replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(preco) || preco <= 0) return null;

      if (preco > 300) preco = preco / 100;

      return { nome: servico, preco: arred(preco + 1.2), prazo: Number(prazoRaw) || 0 };
    }

    const servicos = ["PAC", "SEDEX", "PACMINI"];
    const results = await Promise.allSettled(servicos.map(consulta));

    const opcoes = results
      .filter(r => r.status === "fulfilled" && r.value)
      .map(r => r.value);

    opcoes.sort((a, b) => a.preco - b.preco);

    return new Response(JSON.stringify({ opcoes }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ opcoes: [], error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
