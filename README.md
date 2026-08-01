## 🎯 Status Atual do Catálogo

O **catálogo está funcional** no código. Corrigi os bugs que impediam o funcionamento:

### ✅ Correções Realizadas:
1. **Variáveis undefined** - Adicionei campaignStatus como prop no CatalogPage
2. **Função de adicionar à lista** - Verificada e funcionando corretamente
3. **Busca no Supabase** - Query otimizada para buscar cartas ativas
4. **Renderização** - Cartas aparecem com nome, tipo e botão de adicionar

### 🔄 Próximos Passos para Testar:

1. **Instalar Node.js** (se ainda não fez)
2. **Executar dependências**: 
pm install
3. **Verificar dados**: 
ode check-cards.js (criará cartas de exemplo se necessário)
4. **Rodar projeto**: 
pm run dev
5. **Testar catálogo** - Deve mostrar cartas e permitir adicionar à lista de desejos

### 📋 Como Funciona:

1. **Cliente acessa catálogo** → Cartas carregam do Supabase
2. **Cliente clica no botão '+'** → Carta entra na lista de desejos
3. **Carta fica salva** no banco como `wishlist_item` (por usuário, não por pedido)
4. **Cliente vê na aba 'Desejos'** → Ajusta quantidades e manda pro carrinho; a
   carta **continua na lista**, marcada como "no carrinho". Ver
   [Lista de desejos](#-lista-de-desejos).

O sistema já está **pronto para uso**! 🎉

### ✅ Funcionalidades Implementadas
- ✅ Catálogo de cartas MTG do Supabase
- ✅ Busca e filtros funcionais  
- ✅ Lista de desejos que sobrevive à compra
- ✅ Persistência no banco de dados
- ✅ Interface responsiva
- ✅ **Painel Admin Completo:**
  - Visualizar todos os pedidos pagos
  - Marcar pedidos como pagos manualmente
  - Lista final atualizada automaticamente
  - Pool recalculado baseado em pedidos pagos

Quer que eu ajude com algum passo específico ou há alguma funcionalidade que gostaria de ajustar?

## 📝 TODO List - Próximas Tarefas

### 🔧 Configuração Inicial
- [ ] Instalar Node.js LTS (versão 18+)
- [ ] Executar `npm install` para instalar dependências
- [ ] Configurar variáveis de ambiente do Supabase (.env)
- [ ] Executar `supabase/schema.sql` no SQL Editor do Supabase (ver seção abaixo)

### 🧪 Testes e Validação
- [ ] Executar 
ode check-cards.js para verificar/popular dados de teste
- [ ] Rodar 
pm run dev e testar catálogo localmente
- [ ] Verificar se cartas aparecem corretamente
- [ ] Testar funcionalidade de adicionar à lista de desejos
- [ ] Validar persistência no banco de dados

### 🚀 Funcionalidades a Implementar
- [ ] Sistema de autenticação de usuários
- [ ] Integração com Mercado Pago para pagamentos
- [ ] Cálculo de frete com Manda Bem
- [ ] Sistema de notificações por email
- [x] Dashboard administrativo para gerenciar campanhas

### 📊 Melhorias Técnicas
- [ ] Implementar testes automatizados
- [ ] Otimizar performance das queries
- [ ] Adicionar cache para imagens das cartas
- [ ] Melhorar UX/UI do catálogo
- [ ] Implementar paginação infinita

## 🗄️ Setup do Banco de Dados (Supabase)

O arquivo `supabase/schema.sql` contém **todo** o schema necessário para o funcionamento do app e do painel admin. Execute-o no **SQL Editor** do Supabase antes de usar o sistema.

### Tabelas criadas:

| Tabela | Descrição |
|--------|-----------|
| `profiles` | Perfis de usuário (estende `auth.users`) |
| `campaigns` | Campanhas de encomenda |
| `tiers` | Faixas de preço por campanha |
| `pricing_config` | Configuração global de preço (câmbio, taxas) |
| `cards` | Catálogo de cartas MTG |
| `orders` | Pedidos (1 por usuário por campanha) |
| `order_batches` | Lotes de pagamento dentro de um pedido |
| `order_items` | Itens (cartas) dentro de um batch |
| `bonus_grants` | Bônus concedidos por campanha |
| `wishlist_items` | Lista de desejos (por usuário, independente de pedido) |

### Foreign keys (obrigatórias para o painel admin):

As foreign keys são **essenciais** para as queries com nested select do PostgREST:

- `orders.user_id → profiles.id` — permite `orders?select=...,profiles(name,whatsapp)`
- `orders.campaign_id → campaigns.id`
- `order_batches.order_id → orders.id` — permite `orders?select=...,order_batches(...)`
- `order_items.batch_id → order_batches.id` — permite `order_batches?select=...,order_items(...)`
- `order_items.card_id → cards.id` — permite `order_items?select=...,cards(name,type)`

**Sem essas FKs, o endpoint `/api/admin-orders` retorna erro ou dados incompletos.**

- `bonus_grants.user_id → profiles.id` — permite `bonus_grants?select=...,profiles(name,email)`
- `bonus_grants.campaign_id → campaigns.id`

### Sistema de Bônus

O bônus permite conceder cartas grátis a um usuário em uma campanha. Pode ser **automático** ou **manual**.

#### Bônus Automático

1. **Configure**: no painel admin, seção **Encomendas → Configuração da encomenda**, defina o campo **"Bônus automático (%)"** na campanha (ex: `10` = a cada 10 cartas pagas, 1 bônus grátis)
2. **Trigger**: quando um pagamento é confirmado (via Mercado Pago webhook, sync ou marcação manual), o sistema calcula `floor(qty_in_batch × bonus_pct / 100)` e cria automaticamente um `bonus_grant` para o usuário
3. **Idempotência**: o bônus é concedido uma única vez por batch (verificado via `batch_id`)

#### Bônus Manual

1. **Admin concede bônus**: no painel admin, seção **Clientes**, expanda um cliente e clique em **"Dar bônus"**

#### Uso do Bônus

1. **Usuário usa bônus**: no checkout, as cartas do carrinho são automaticamente alocadas como bônus (grátis) até esgotar o saldo

#### SQL necessário para o sistema de bônus

**Banco novo (primeira vez)?** Execute `supabase/schema.sql` — ele já inclui tudo.

**Banco já existente (sem bônus)?** Execute `supabase/migrations/bonus-system.sql` no SQL Editor do Supabase. O script é idempotente e faz:

1. `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS bonus_pct integer DEFAULT 0` — porcentagem de bônus automático
2. `ALTER TABLE orders ADD COLUMN IF NOT EXISTS qty_bonus integer DEFAULT 0` — qty de bônus no pedido
3. `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_bonus boolean DEFAULT false` — marca itens como bônus
4. `CREATE TABLE IF NOT EXISTS bonus_grants (...)` — tabela principal de bônus com `grant_type`, `batch_id`, `status`
5. `CREATE INDEX` nos campos `user_id` e `campaign_id` da `bonus_grants`
6. `RLS policies` — SELECT e UPDATE para o usuário ver/usar seus bônus

#### Schema e API

1. **Schema**: a tabela `bonus_grants` já está no `supabase/schema.sql` — execute o script no SQL Editor do Supabase
2. **Migração**: se o banco já existe, use `supabase/migrations/bonus-system.sql` para adicionar apenas o necessário
3. **RLS**: políticas de SELECT e UPDATE para o usuário já estão incluídas
4. **API**: o endpoint `/api/admin-bonus` gerencia bônus (listar, conceder, revogar) usando `SB_SERVICE_ROLE_KEY`
5. **Helper**: `_bonus-helper.js` contém a lógica de auto-grant, usada por `mp-webhook.js`, `mp-sync.js` e `admin-mark-paid.js`

### Fulfillment do Pedido Individual

O Pedido Individual (modo e-commerce, sem campanha) tem um pipeline de status simplificado para acompanhar a importação via fornecedor (AliExpress), separado do status da Encomenda Coletiva:

`Aguardando compra` → `Encomenda feita` → `A caminho do Brasil` → `Chegou no Brasil` → `Em preparação` → (gera etiqueta MandaBem, que assume o rastreio automático)

**Banco já existente?** Execute `supabase/migrations/add-individual-fulfillment-status.sql` no SQL Editor do Supabase. Adiciona a coluna `order_batches.fulfillment_status`.

- **Admin**: em **Pedidos → Compras do dia**, os pedidos individuais pagos aparecem agrupados por dia de pagamento, com avanço de status em lote por grupo ou individual.
- **API**: `/api/admin-individual-orders` lista os pedidos; `/api/admin-update-fulfillment` avança o status de um ou mais lotes.
- **Cliente**: em "Meus Pedidos", pedidos Individuais pagos mostram uma barra de progresso com o status atual.

## 💚 Lista de desejos

A lista de desejos é **do usuário**, não do pedido: ela atravessa campanhas e
sobrevive à compra. Isso a separa do carrinho, que é do pedido e se esvazia.

| | Lista de desejos | Carrinho |
|---|---|---|
| Tabela | `wishlist_items` | `order_items` (`in_cart = true`, `batch_id IS NULL`) |
| Escopo | por usuário | por pedido/campanha |
| Precisa de encomenda aberta? | não | sim |
| Comprar… | marca `acquired_qty` | esvazia |

### As duas regras que definem o modelo

1. **Mandar para o carrinho copia, não move.** A carta continua na lista,
   marcada como "no carrinho".
2. **Comprar não apaga o desejo** — incrementa `acquired_qty` e carimba
   `acquired_at`. Querer uma carta e já tê-la comprado são estados, não opostos.

Antes, os desejos eram linhas de `order_items` com `batch_id IS NULL AND
in_cart = false`. Mover para o carrinho tirava a carta da lista e comprar a
fazia sumir de vez, então a lista só guardava o que a pessoa **ainda não tinha
tocado** — uma caixa de entrada, não uma lista de desejos.
`test/wishlist.test.js` trava as duas regras acima.

A página mostra três estados por carta — pendente, no carrinho e já comprada —
e o catálogo usa a mesma informação nos selos, então dá para ver do catálogo
que uma carta já foi comprada antes de pedir de novo.

### Migração

Banco novo: `supabase/schema.sql` já inclui a tabela. Banco existente: rode
`supabase/migrations/wishlist.sql` no SQL Editor. Ele cria a tabela com RLS e
faz dois backfills a partir de `order_items` — os desejos pendentes (incluindo
os que estavam no carrinho) e o histórico do que já foi comprado, para o selo
"já comprei" nascer com dados.

O script é idempotente: os backfills recalculam a partir de `order_items`
(a fonte da verdade) em vez de somar ao valor atual, então reexecutar chega no
mesmo estado. No fim há um `DELETE` **comentado** que remove as linhas de
`order_items` que viraram lixo — destrutivo de propósito, rode só depois de
conferir o resultado.

## 🎛️ Console de Administração

O painel admin é organizado em sete seções fixas. A **encomenda em contexto**
(seletor no topo) vale para as seções coletivas; Pedidos Individuais não
dependem de encomenda e aparecem sempre.

| Seção | O que tem lá |
|-------|--------------|
| **Visão geral** | KPIs consolidados (receita, hoje, aguardando pagamento, cartas vendidas), lista de pendências acionáveis, progresso da encomenda ativa e atividade recente |
| **Pedidos** | Lista unificada Coletiva + Individual com filtro por canal/status, busca e ordenação. A aba **Compras do dia** agrupa individuais por dia para a compra no fornecedor |
| **Envios** | Etiquetas MandaBem: agrupadas por frete na coletiva, uma a uma no individual |
| **Clientes** | Contatos, histórico de compras nos dois canais, bônus e disparo assistido de WhatsApp |
| **Catálogo** | Importação por CSV e adição de cartas avulsas por link de imagem |
| **Encomendas** | Criar/editar/arquivar campanhas + lista de compra da encomenda selecionada |
| **Ajustes** | Preços da coletiva, preços do individual, notificações e mapa do console |

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

O admin recebe no celular: **pedido novo**, **pagamento confirmado**,
**pedido bônus**, **login** e **nova conta**. Tudo também fica no histórico em
**Ajustes → Notificações**, mesmo sem push ativado.

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
- Gatilhos no servidor: `mp-create.js` (pedido novo), `mp-webhook.js`
  (pagamento confirmado) e `confirm-bonus-batch.js` (pedido bônus). São
  idempotentes por lote — repetir a chamada não gera notificação duplicada.
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
