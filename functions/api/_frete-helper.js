// Cotação de frete no MandaBem — a mesma usada no checkout (/api/frete).
// Credenciais lidas das variáveis de ambiente do Cloudflare Pages
// (MANDA_BEM_API_ID / MANDA_BEM_API_TOKEN).
export const QUOTE_SERVICES = ["PAC", "SEDEX", "PACMINI"];
const ORIGIN_CEP = "05410010";

const arred = (n) => Math.round(n * 100) / 100;

// → { opcoes:[{ nome, preco, prazo }] } (mais barata primeiro) ou { error, status }
export async function quoteShipping(env, cepDestino, quantidade) {
  const cep = String(cepDestino ?? "").replace(/\D/g, "");
  const qtd = Number(quantidade ?? 0);
  if (cep.length !== 8 || !Number.isFinite(qtd) || qtd <= 0) return { opcoes: [], error: "Parâmetros inválidos", status: 400 };

  const plataforma_id = env?.MANDA_BEM_API_ID;
  const plataforma_chave = env?.MANDA_BEM_API_TOKEN;
  if (!plataforma_id || !plataforma_chave) return { opcoes: [], error: "Credenciais do MandaBem não configuradas", status: 500 };

  const pesoKg = Math.max((qtd * 2 + 50) / 1000, 0.3);
  const altura = Math.min(Math.max(Math.ceil(qtd / 50), 2), 4);

  async function consulta(servico) {
    const payload =
      "plataforma_id=" + plataforma_id +
      "&plataforma_chave=" + encodeURIComponent(plataforma_chave) +
      "&cep_origem=" + ORIGIN_CEP +
      "&cep_destino=" + cep +
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

  const results = await Promise.allSettled(QUOTE_SERVICES.map(consulta));
  const opcoes = results.filter(r => r.status === "fulfilled" && r.value).map(r => r.value);
  opcoes.sort((a, b) => a.preco - b.preco);
  return { opcoes };
}
