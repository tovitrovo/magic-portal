-- Add in_cart column to order_items for persistent cart support
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS in_cart boolean DEFAULT false;
