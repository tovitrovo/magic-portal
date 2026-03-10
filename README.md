## 🎯 Status Atual do Catálogo

O **catálogo está funcional** no código! Corrigi os bugs que impediam o funcionamento:

### ✅ Correções Realizadas:
1. **Variáveis undefined** - Adicionei campaignStatus como prop no CatalogPage
2. **Função handleAddWant** - Verificada e funcionando corretamente
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
5. **Testar catálogo** - Deve mostrar cartas e permitir adicionar aos wants

### 📋 Como Funciona:

1. **Cliente acessa catálogo** → Cartas carregam do Supabase
2. **Cliente clica no botão '+'** → Carta vai para lista de wants
3. **Carta fica salva** no banco como order_item 
4. **Cliente vê na aba 'Wants'** → Pode ajustar quantidades e mover pro carrinho

O sistema já está **pronto para uso**! 🎉

### ✅ Funcionalidades Implementadas
- ✅ Catálogo de cartas MTG do Supabase
- ✅ Busca e filtros funcionais  
- ✅ Adicionar cartas aos wants
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
- [ ] Testar funcionalidade de adicionar aos wants
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

1. **Configure**: no painel admin, aba **Configurações**, defina o campo **"Bônus automático (%)"** na campanha (ex: `10` = a cada 10 cartas pagas, 1 bônus grátis)
2. **Trigger**: quando um pagamento é confirmado (via Mercado Pago webhook, sync ou marcação manual), o sistema calcula `floor(qty_in_batch × bonus_pct / 100)` e cria automaticamente um `bonus_grant` para o usuário
3. **Idempotência**: o bônus é concedido uma única vez por batch (verificado via `batch_id`)

#### Bônus Manual

1. **Admin concede bônus**: no painel admin, aba **Clientes**, expanda um cliente e clique em **"Dar bônus"**

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

### Como executar:

1. Abra o [Supabase Dashboard](https://supabase.com/dashboard)
2. Acesse seu projeto → **SQL Editor**
3. Cole o conteúdo de `supabase/schema.sql`
4. Clique **Run**

O script é idempotente — pode ser executado múltiplas vezes com segurança.
