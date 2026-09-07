# Cartas para Jogar — portal de encomendas de Magic

Portal onde o cliente monta uma **encomenda individual** de cartas de Magic,
paga pelo Mercado Pago e acompanha cada etapa até a entrega. O admin controla
tudo por um console: pedidos, compra no fornecedor, etiquetas e catálogo.

## Como funciona

1. **Catálogo** — só cartas de Magic. Cada carta tem duas ações: 🛒 põe no
   carrinho agora, 📜 guarda na lista de desejos para depois.
2. **Carrinho** — quanto mais cartas, menor o preço de cada uma (faixas de
   volume). Mínimo de 15 cartas por pedido.
3. **Checkout** — endereço, frete (MandaBem) e pagamento (Mercado Pago).
4. **Minha conta** — o cliente acompanha o status de cada pedido, vê o álbum de
   coleção e ajusta seus dados.
5. **Console do admin** — pedidos com status, compras do dia agrupadas,
   etiquetas por remessa, clientes e catálogo.

## As quatro decisões que definem o produto

| Decisão | Onde vive | Por quê |
|---|---|---|
| **Só encomenda individual** | não há mais campanha no app | cada pedido anda no próprio ritmo; a encomenda coletiva prendia todo mundo ao status de uma campanha |
| **A lista de desejos é só desejo** | `wishlist_items` | ela responde "o que eu quero", não "o que vou comprar agora" — ver [Lista de desejos](#-lista-de-desejos) |
| **Um status por pedido** | `shared/orderStatus.js` | dinheiro e logística viram uma trilha só, igual para cliente e admin — ver [Status do pedido](#-status-do-pedido) |
| **Só Magic à venda** | `CATALOG_TCG` | um catálogo, um jogo; a coluna `cards.tcg` continua no banco para as cartas antigas de outros jogos |

## Rodando

```bash
npm install
npm run dev      # Vite em modo dev
npm test         # 138 testes (node:test), sem rede
npm run build    # bundle de produção
```

Antes do primeiro uso, execute no **SQL Editor** do Supabase:
`supabase/schema.sql` e depois `supabase/migrations/minimal-portal.sql`.

## 🗄️ Setup do Banco de Dados (Supabase)

O arquivo `supabase/schema.sql` contém **todo** o schema necessário para o funcionamento do app e do painel admin. Execute-o no **SQL Editor** do Supabase antes de usar o sistema.

### Tabelas criadas:

| Tabela | Descrição |
|--------|-----------|
| `profiles` | Perfis de usuário (estende `auth.users`) |
| `cards` | Catálogo de cartas |
| `orders` | Pedidos. O pedido sem nenhum lote é o **carrinho** do cliente |
| `order_batches` | Lotes de pagamento dentro de um pedido |
| `order_items` | Itens (cartas) dentro de um lote |
| `wishlist_items` | Lista de desejos (por usuário, independente de pedido) |
| `collection_items` | Ajuste manual do álbum de coleção (só o que veio de fora do portal) |
| `individual_tiers` / `individual_pricing` | Faixas de preço por volume e config |
| `fx_cache` | Dólar do dia |

**Tabelas legadas**, mantidas com os dados históricos mas sem uso no app:
`campaigns`, `tiers`, `bonus_grants`, `pricing_config`. A encomenda coletiva
saiu do produto; nada foi apagado do banco.

### Foreign keys (obrigatórias para o painel admin):

As foreign keys são **essenciais** para as queries com nested select do PostgREST:

- `orders.user_id → profiles.id` — permite `orders?select=...,profiles(name,whatsapp)`
- `order_batches.order_id → orders.id` — permite `orders?select=...,order_batches(...)`
- `order_items.batch_id → order_batches.id` — permite o álbum ler só o que veio de lote pago
- `order_items.card_id → cards.id` — permite `order_items?select=...,cards(name,type)`
- `collection_items.card_id → cards.id`

**Sem essas FKs, `/api/admin-individual-orders` e o álbum de coleção retornam
erro ou dados incompletos.**

## 🚦 Status do pedido

O banco guarda **dois** status por lote: `order_batches.status` (o dinheiro) e
`order_batches.fulfillment_status` (a logística). Ler os dois separados
espalhava a mesma regra pela tela do cliente e pelo console, com rótulos que
discordavam entre si. `shared/orderStatus.js` junta os dois numa trilha só:

| # | Estágio | De onde vem | Quem move |
|---|---|---|---|
| 1 | Aguardando pagamento | `status` | — |
| 2 | Pagamento confirmado | `status` | Mercado Pago, sync ou "marcar pago" |
| 3 | Encomendado | `fulfillment_status` | admin |
| 4 | A caminho do Brasil | `fulfillment_status` | admin |
| 5 | Chegou no Brasil | `fulfillment_status` | admin |
| 6 | Em preparação | `fulfillment_status` | admin |
| 7 | Enviado | `fulfillment_status` | admin (ao gerar a etiqueta) |
| 8 | Entregue | `fulfillment_status` | admin |

Fora da trilha ficam os terminais: **Cancelado**, **Pagamento recusado**,
**Reembolsado** e **Estornado**.

As três regras que o módulo trava (`test/orderStatus.test.js`):

1. **A logística só conta depois do pagamento.** Um lote não pago está sempre
   em "Aguardando pagamento", não importa o que o `fulfillment_status` diga.
2. **A unidade é o pedido, não o lote.** `groupBatchesIntoOrders()` agrupa os
   lotes; o pedido anda no ritmo do **mais atrasado** — dizer "enviado" com um
   lote ainda no fornecedor seria mentira. Lotes cancelados não seguram o
   pedido.
3. **Cancelado vence pagamento aprovado.** O dinheiro voltou.

- **Cliente**: em *Minha conta → Pedidos*, cada pedido mostra a trilha inteira
  com o estágio atual, a explicação do que está acontecendo e o rastreio.
- **Admin**: em *Pedidos*, as pílulas de filtro falam a mesma língua, e
  avançar/voltar move **todos os lotes pagos do pedido juntos** (eles viajam na
  mesma remessa). Avançar e voltar sempre pedem confirmação — o cliente enxerga
  essa trilha. Voltar um pedido que já tem etiqueta MandaBem **não** cancela o
  envio; o aviso na confirmação lembra disso.
- **Compras do dia**: pedidos pagos agrupados por dia de pagamento, para
  comprar tudo do dia de uma vez no fornecedor e avançar o grupo inteiro.
- **API**: `/api/admin-individual-orders` lista os pedidos (pagos e pendentes);
  `/api/admin-update-fulfillment` grava o estágio de um ou mais lotes.

**Banco já existente?** `supabase/migrations/minimal-portal.sql` adiciona o
estágio `DELIVERED` ao CHECK de `fulfillment_status`.

### Adicionar cartas a um pedido individual

Enquanto a compra no fornecedor **não foi feita** (o pedido ainda está em
`Aguardando compra`), o cliente pode mandar mais cartas para o **mesmo**
pedido: em "Meus Pedidos" aparece **Adicionar cartas a este pedido**, e o que
for fechado no checkout entra ali em vez de virar um pedido novo.

| | Pedido individual | Adição |
|---|---|---|
| Mínimo de cartas | `min_cards` (15) | não se aplica — o pedido já cumpriu |
| Frete | cobrado | R$ 0,00, mesma remessa |
| Faixa de preço | volume do carrinho | volume **somado** (pago + novo) |
| No banco | pedido + lote novos | **lote novo no mesmo pedido** |

As três consequências que definem o modelo:

1. **A janela é do pedido, não do lote.** Basta um lote ter saído de
   `AWAITING_SUPPLIER_ORDER` (ou ter etiqueta) para o pedido inteiro parar de
   aceitar cartas — senão a caixa fecharia sem elas.
2. **Adicionar nunca encarece.** A faixa é escolhida pelo volume somado, então
   somar 5 cartas a 40 já pagas cobra as novas na faixa de 45.
3. **Uma remessa, uma etiqueta.** A adição herda endereço, serviço e
   `shipping_group_id` do lote que pagou o frete, e o **Envios → Individual**
   passou a listar por remessa: o botão de etiqueta cobre todos os lotes do
   pedido de uma vez, e fica bloqueado enquanto algum deles não chegou em
   "Em preparação".

`shared/individualAddCards.js` guarda essa regra — a UI usa para mostrar o
botão e `individual-checkout.js` para recusar o que chegar fora da janela
(HTTP 409, `code: ADD_WINDOW_CLOSED`). `test/individualAddCards.test.js` trava
os três pontos acima.

O pagamento é um lote separado (Mercado Pago, como qualquer outro), então a
adição aparece em "Meus Pedidos" como uma linha própria — com "Pagar" e
"Cancelar" enquanto não for paga — e em **Pedidos → Compras do dia** no dia em
que foi paga, marcada com `+ adição ao #XXXX`. Nenhuma migração de banco é
necessária: o modelo de `order_batches` já previa vários lotes por pedido.

## 💚 Lista de desejos

A lista de desejos é **do usuário** e é **só desejo**: ela responde "quais
cartas eu quero e quantas ainda me faltam", não "o que eu vou comprar agora".
Isso a separa do carrinho, que é do pedido e se esvazia.

| | Lista de desejos | Carrinho |
|---|---|---|
| Tabela | `wishlist_items` | `order_items` (`in_cart = true`, `batch_id IS NULL`) |
| Escopo | por usuário | por pedido |
| Some quando compra? | não | sim |
| "Já tenho" vem de… | do [álbum de coleção](#-álbum-de-coleção) | — |

### As três regras que definem o modelo

1. **Nada vai para o carrinho sozinho.** Não existe "mandar tudo pro carrinho";
   cada linha tem um botão discreto de 🛒 para quem já decidiu comprar aquela
   carta.
2. **Comprar não mexe na lista.** Querer uma carta e já tê-la são estados, não
   opostos. Quem responde "já tenho" é o álbum, alimentado pelos lotes pagos.
3. **Desejar não depende de pedido aberto.** A carta entra na lista mesmo com o
   carrinho vazio.

Antes, a lista era uma pré-seleção do carrinho: o "mandar tudo" e o
`acquired_qty` na própria linha faziam dela uma caixa de entrada de compras.
`test/wishlist.test.js` trava as três regras acima.

A página separa **Falta comprar** de **Já tenho**, e o catálogo usa a mesma
informação nos selos — dá para ver do catálogo que uma carta já está na coleção
antes de pedir de novo.

### Migração

Banco novo: `supabase/schema.sql` já inclui a tabela. Banco existente: rode
`supabase/migrations/wishlist.sql` no SQL Editor. A coluna `acquired_qty`
continua no banco (o backfill histórico está lá), mas o app não a lê mais —
quem conta o que a pessoa tem é o álbum.

## 📔 Álbum de coleção

Em *Minha conta → Coleção*, o cliente percorre o catálogo inteiro vendo
quantas cópias de cada carta ele tem. Duas fontes que **não se misturam**
(`shared/collection.js`):

| Fonte | De onde vem | Editável? |
|---|---|---|
| **Comprado** | soma dos `order_items` de lotes **pagos** dele | não — é fato |
| **Extra** | `collection_items.extra_qty` | sim, o "+ / −" do álbum |

O total é a soma das duas. Separar importa: a compra não pode sumir quando ele
mexe no ajuste manual, e o ajuste não pode ser sobrescrito quando chega uma
compra nova. O ajuste serve para o que ele conseguiu **fora** do portal —
comprou em loja, ganhou, trocou.

`collection_items` tem RLS presa ao dono (`auth.uid() = user_id`) e um
`UNIQUE (user_id, card_id)` que o upsert do app usa. Chegar a zero apaga a
linha em vez de guardar um zero por carta do catálogo.

**Banco já existente?** Execute `supabase/migrations/minimal-portal.sql`.

## 🔒 Endurecimento do banco

`supabase/migrations/harden-exposed-tables.sql` fecha achados do database
linter que **não vieram** do sistema de lista de desejos — são anteriores.

| Achado | O que foi feito |
|---|---|
| `user_roles`, `tattoo_artists`, `cards_magic_backup` legíveis por anon | RLS ligada (sem policy = só service role) |
| `handle_new_user` com `search_path` solto e exposta como RPC | `SET search_path` + `REVOKE EXECUTE` |
| `set_updated_at` com `search_path` solto | `SET search_path` |

Sem policy, RLS significa "só a service role acessa". Antes de ligar,
conferi que `user_roles` e `tattoo_artists` estavam **vazias** e que
`cards_magic_backup` (7833 linhas) não é lido por nenhum código deste
repositório. Se algum app precisar de leitura anônima em alguma delas, o certo
é criar a policy — não desligar a RLS.

`handle_new_user` é gatilho `AFTER INSERT` em `auth.users`. Revogar `EXECUTE`
tira ela de `/rest/v1/rpc` sem afetar o disparo: o Postgres não exige esse
privilégio de quem faz o INSERT.

**Fora do alcance**: `has_role()` e `auto_generate_quote_stub()` têm os mesmos
problemas mas pertencem a outro produto que divide este projeto Supabase — não
dá para corrigir sem ver o código que as chama. E a proteção contra senha
vazada do Auth não se liga por SQL: Dashboard → Authentication → Policies.

## 🎛️ Console de Administração

Seis seções fixas. A unidade de trabalho é o **pedido** — é ele que vira uma
compra no fornecedor e uma caixa no correio. Lote é só como o dinheiro entrou;
um pedido com cartas adicionadas depois tem vários lotes e uma remessa só.

| Seção | O que tem lá |
|-------|--------------|
| **Visão geral** | KPIs (receita, hoje, aguardando pagamento, cartas vendidas), pendências acionáveis e atividade recente |
| **Pedidos** | Lista de pedidos com filtro por estágio da trilha, busca e ordenação. A aba **Compras do dia** agrupa os pagos por dia para a compra no fornecedor |
| **Envios** | Etiquetas MandaBem, uma por remessa, com endereço e rastreio |
| **Clientes** | Contatos, histórico de compras e disparo assistido de WhatsApp |
| **Catálogo** | Importação por CSV e adição de cartas avulsas por link de imagem (ver [Adicionar cartas por link](#-adicionar-cartas-por-link)) |
| **Ajustes** | Preços por volume, notificações e o mapa dos [status do pedido](#-status-do-pedido) |

## 🔗 Adicionar cartas por link

Em **Admin → Catálogo → Adicionar cartas por link** você cola uma carta por
linha no formato `Nome da carta | link da imagem`. O servidor baixa cada
imagem, sobe para o bucket `cards` do Supabase e grava a carta com o TCG e o
tipo escolhidos nos dois seletores — que valem para a lista inteira, então
cole junto só o que for do mesmo tipo (ex: só Foil).

O endpoint `/api/admin-add-cards-by-link` aceita no máximo **25 cartas por
chamada** (ele baixa e sobe uma imagem por carta). O painel divide listas
maiores em lotes de 25 automaticamente e envia um de cada vez, mostrando o
progresso — dá para colar as 136 linhas de uma vez.

Cada carta é gravada com `import_ref = slug-do-nome + hash-do-link`, e o
`INSERT` usa `on_conflict=import_ref`. Ou seja: **reenviar a mesma lista não
duplica nada** — as cartas já existentes são atualizadas (inclusive o tipo, se
você errou na primeira vez). Só gera linha nova quando o link da imagem muda.

Listas prontas ficam em `scripts/cards/`:

| Arquivo | Conteúdo |
|---------|----------|
| `foil-2026-08.txt` | 136 cartas Magic tipo **Foil** (agosto/2026) |

Linhas em branco e começadas com `#` são ignoradas, então dá para copiar o
arquivo inteiro e colar no painel.

## 🌗 Tema claro e escuro

O portal abre no tema que o sistema do aparelho pede e lembra a escolha do
usuário (`localStorage`, chave `cpj_color_mode`). Dá para trocar no ícone
☀️/🌙 do cabeçalho ou em **Perfil → Aparência**. O modo claro usa um
off-white quente (`#f6f1e6`) com tinta marrom, não branco/cinza.

### Como as cores funcionam

O app é quase todo estilo inline, então as cores vivem em variáveis CSS
definidas em `src/theme.css` e trocadas pelo atributo `data-theme` no `<html>`
(aplicado antes do primeiro paint por um script em `index.html`, para o claro
não piscar escuro).

Duas convenções valem para qualquer código novo:

| Precisa de… | Use |
|---|---|
| Texto/borda/fundo neutro | `rgba(var(--ink), calc(0.3 * var(--ink-a)))` |
| Superfície rebaixada (campo, sombra) | `rgba(var(--sunk), calc(0.3 * var(--sunk-a)))` |
| Texto principal | `var(--text)` · `var(--text-strong)` |
| Cartão, campo, cabeçalho | `var(--card-bg)`, `var(--field-bg)`, `var(--chrome-bg)` |
| Acento sólido | `var(--ok)`, `var(--gold)`, `var(--danger)`, `var(--info)`, `var(--indiv)`, `var(--wa)` |
| Acento translúcido | `rgba(var(--ok-rgb), 0.08)` |
| Opacidade sobre cor variável | `wa(theme.primary, '30')` |

O multiplicador `--ink-a` compensa contraste: a mesma opacidade que funciona
sobre preto some sobre um fundo creme, então no claro ela é escalada.

`--ink`/`--sunk` guardam **tripletes RGB** (`255, 255, 255`), não cores — é o
que permite reaproveitar as dezenas de opacidades diferentes do layout.

Cores de acento com opacidade não podem ser concatenadas (`var(--ok)+'14'`
não é CSS válido): use `wa(cor, '14')`, que aceita tanto hex quanto `var()`.
A paleta de guilda (`GT`/`GT_LIGHT`) continua em hex justamente porque
`theme.primary` é concatenado em vários lugares.

`test/theme.test.js` trava esse contrato: os dois modos precisam definir os
mesmos tokens, e um `rgba(255,255,255,…)` novo no JSX quebra o teste antes de
quebrar o modo claro silenciosamente. O mesmo teste também barra **hex escuro
cravado** (foi assim que a folha de detalhe da carta e a barra sticky do admin
ficaram pretas sobre o creme) — superfície escura sempre vira token.

## 🎨 Tokens de design

Além das cores, `src/theme.css` define tokens independentes de tema, num
bloco `:root` próprio. Código novo deve consumir estes em vez de cravar
números:

| Papel | Tokens |
|---|---|
| Tipo | `--fs-2xs` 11 · `--fs-xs` 12 · `--fs-sm` 13 · `--fs-md` 15 · `--fs-lg` 18 · `--fs-xl` 22 · `--fs-2xl` 28 |
| Texto | `--text-strong` · `--text` · `--text-muted` · `--text-dim` · `--text-faint` |
| Traço/fundo neutro | `--line` · `--line-soft` · `--fill` · `--fill-soft` |
| Raio | `--r-control` 10 · `--r-card` 16 · `--r-sheet` 24 · `--r-pill` |
| Espaço | `--sp-1` 4 → `--sp-6` 32 |

O piso de tipo é 11px, e só para rótulo de aba e badge — texto corrido começa
em `--fs-sm`. Os tokens de texto substituem os 14 níveis de opacidade que
existiam espalhados pelo JSX; o olho lê três, não catorze.

Cliente e admin estão convertidos: tipo, cor, borda, fundo, raio e
espaçamento. Sobram 9 `rgba(var(--ink),…)` crus em ternários — corretos no
tema, só não consolidados na hierarquia.

### Catálogo

Busca e filtro trocam a grade por *skeletons* de mesma altura, em vez do
spinner que substituía tudo e fazia a página saltar a cada tecla. A paginação
anterior/próxima virou **carregar mais**, que acumula os resultados e mostra
"N de M cartas".

Cada carta tem **duas** ações, e é isso que mantém desejar separado de comprar:
🛒 põe no carrinho, 📜 guarda na lista de desejos. Um botão só forçava a lista
a virar caminho obrigatório para a compra.

### Mínimo do pedido

O mínimo de cartas aparece como barra de progresso no carrinho enquanto a
pessoa monta o pedido, com `role="progressbar"` — antes só era descoberto no
checkout, depois de tudo escolhido.

### Modo de adição

Quando o cliente está mandando cartas para um pedido já pago, um chip aparece
no cabeçalho do catálogo, lista, carrinho e checkout com o código do pedido de
destino; tocar nele sai do modo. Sem esse chip dava para montar um carrinho
inteiro sem perceber que ele iria parar noutro pedido.

### Tinta sobre a cor da guilda

`--gp` (cor primária da guilda do usuário) pinta superfícies sólidas, e a cor
do texto por cima **não pode ser fixa**: em Orzhov, `--gp` é um creme
(`#f0e6b2`) e branco nele dá 1.2:1.

`src/guildTheme.js` resolve isso — `inkOn(cor)` devolve, entre branco e uma
tinta escura, a de maior contraste. O shell publica o resultado como
`--gp-ink`, e todo preenchimento sólido consome essa variável:

```jsx
{ background: 'var(--gp)', color: 'var(--gp-ink)' }
```

`test/guildTheme.test.js` verifica que as 10 guildas × 2 modos alcançam 4.5:1
(WCAG AA para texto normal). O mesmo vale para `--ok-ink`, a tinta sobre o
verde de sucesso, que inverte junto com o tema.

## ♿ Acessibilidade

`src/ui.css` é a camada de estado. Ela existe porque estilo inline não
consegue expressar `:hover`, `:focus-visible` nem `@media` — antes dela o
portal não tinha nenhum foco visível e a navegação por teclado era invisível.
As regras são genéricas de propósito (elemento, não classe) para cobrir os
~60 botões do app sem tocar em cada um.

Convenções para código novo:

- **Botão só de ícone precisa de `aria-label`.** `title` não substitui.
- **Alvo de toque de 44px**: a classe `.mp-tap` já entrega isso.
- **Modal** usa `useDialogA11y(onClose)` — o hook cuida de Escape, trap de
  Tab, trava do scroll de fundo e devolução do foco. Some com `role="dialog"`
  + `aria-modal="true"` + `aria-labelledby`.
- **Toggle** é `role="switch"` + `aria-checked`, não um `<button>` mudo.
- **Aba ativa** marca `aria-current="page"`; cor sozinha não comunica estado.
- O `<meta name="viewport">` **não** pode voltar a ter `maximum-scale` ou
  `user-scalable=no` — travar o zoom reprova a WCAG 1.4.4.

Quem pede `prefers-reduced-motion` recebe o app parado (mana flutuante, pulso
do tutorial, carta voando); só o spinner continua girando, porque sem giro ele
vira um ícone sem significado.

## 🔔 Notificações (Web Push + PWA)

O admin recebe no celular: **pedido novo**, **pagamento confirmado**, **login**
e **nova conta**. Tudo também fica no histórico em **Ajustes → Notificações**,
mesmo sem push ativado.

### 1. Banco

Execute `supabase/migrations/notifications-and-push.sql` no SQL Editor do
Supabase. Cria `app_notifications` (histórico) e `push_subscriptions`
(aparelhos inscritos). Ambas ficam com RLS ligado e sem policies — só as
Functions, com a service role, acessam.

### 2. Chaves VAPID

```bash
node scripts/generate-vapid-keys.mjs
```

Cadastre a saída nas variáveis de ambiente do Cloudflare Pages:

| Variável | Observação |
|----------|------------|
| `VAPID_PUBLIC_KEY` | Também é servida ao navegador via `/api/push-config` |
| `VAPID_PRIVATE_KEY` | **Segredo** — nunca commitar |
| `VAPID_SUBJECT` | `mailto:seu@email.com` |

Trocar as chaves invalida as inscrições: cada aparelho precisa ativar de novo.

### 3. Ativar no aparelho

Abra **Admin → Ajustes → Notificações → Ativar neste aparelho**. Cada
aparelho é inscrito separadamente e escolhe quais eventos recebe (pedidos
e/ou logins). O botão **Enviar teste** confirma a entrega ponta a ponta.

> **iPhone/iPad**: o Safari só entrega push quando o site está **instalado na
> tela de início** (iOS 16.4+). Abra pelo app instalado antes de ativar.

### Como funciona

- `functions/api/_webpush.js` — VAPID (RFC 8292, JWT ES256) e criptografia do
  payload (RFC 8291, ECDH P-256 + HKDF + AES-128-GCM) só com WebCrypto, sem
  dependências. Coberto por `test/webpush.test.js`, que faz o round-trip de
  cifrar/decifrar e verifica a assinatura do JWT.
- `functions/api/_notify.js` — grava o evento e dispara push para os admins.
  Endpoints expirados (404/410) são removidos do banco automaticamente.
- Gatilhos no servidor: `mp-create.js` (pedido novo) e `mp-webhook.js`
  (pagamento confirmado). São idempotentes por lote — repetir a chamada não
  gera notificação duplicada.
- Logins vêm de `/api/notify-event`, chamado pelo app após o login. O usuário
  é identificado pelo token (não dá para forjar), logins de admin são
  ignorados e o mesmo cliente só gera um evento a cada 30 minutos.
- `public/sw.js` — service worker que mostra a notificação e, no clique, abre
  o console direto na seção certa (`/?admin=orders`).

### Ícones do PWA

`public/icons/*` é gerado por `node scripts/generate-icons.mjs` (sem
dependências de imagem). Rode de novo se mudar a identidade visual.

### Como executar:

1. Abra o [Supabase Dashboard](https://supabase.com/dashboard)
2. Acesse seu projeto → **SQL Editor**
3. Cole o conteúdo de `supabase/schema.sql`
4. Clique **Run**

O script é idempotente — pode ser executado múltiplas vezes com segurança.
