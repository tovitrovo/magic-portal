-- Frete do fornecedor por compra, em reais.
--
-- O fornecedor envia pelo AliExpress: a cada pedido, o admin compra um item
-- de ~US$ 7–8 que serve de frete, pago no Pix já convertido e com o imposto
-- incluído — normalmente ~R$ 50. É um custo FIXO por compra (cada pedido de
-- cliente é comprado separado), então entra no custo de cada pedido no painel
-- de lucro do console. Não muda o preço das cartas.
ALTER TABLE public.individual_pricing
  ADD COLUMN IF NOT EXISTS supplier_freight_brl numeric(10,2) DEFAULT 50;

UPDATE public.individual_pricing SET supplier_freight_brl = 50 WHERE supplier_freight_brl IS NULL;
