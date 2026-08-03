-- ══════════════════════════════════════════════════════════════
-- ENDURECIMENTO — tabelas expostas e handle_new_user
-- ══════════════════════════════════════════════════════════════
--
-- Achados do database linter do Supabase em produção. Nenhum deles veio do
-- sistema de lista de desejos; são anteriores. Idempotente.
--
-- Sem policy, RLS significa "só a service role acessa". É o padrão correto
-- para as três tabelas abaixo, e a checagem de segurança antes de aplicar foi:
--
--   user_roles         0 linhas  — scaffolding, nada a perder
--   tattoo_artists     0 linhas  — scaffolding de outro produto
--   cards_magic_backup 7833      — backup do catálogo; nenhum código o lê
--
-- Se algum app precisar de leitura anônima em alguma delas, o certo é criar a
-- policy correspondente — não desligar a RLS.
ALTER TABLE public.user_roles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tattoo_artists     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards_magic_backup ENABLE ROW LEVEL SECURITY;

-- handle_new_user é gatilho SECURITY DEFINER. Faltava search_path fixo (o
-- caller decidia quais objetos o corpo enxerga) e ela estava exposta como RPC.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;

-- set_updated_at é gatilho compartilhado (campaigns, pricing_config e wants
-- deste app; tattoo_artists de outro). Não é SECURITY DEFINER e o corpo é só
-- `new.updated_at = now()`, então fixar o search_path é neutro — `now()` vive
-- em pg_catalog.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- ── Fora do alcance deste script ─────────────────────────────────────
-- has_role() e auto_generate_quote_stub() têm os mesmos problemas
-- (search_path solto, SECURITY DEFINER chamável por anon), mas pertencem a
-- outro produto que divide este projeto Supabase. Corrigir sem enxergar o
-- código que as chama pode quebrar aquele app.
--
-- A proteção contra senha vazada do Auth está desligada e não se liga por SQL:
-- Dashboard → Authentication → Policies → Leaked password protection.
