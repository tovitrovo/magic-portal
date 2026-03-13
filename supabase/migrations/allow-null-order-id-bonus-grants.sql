-- Allow order_id to be NULL in bonus_grants for manual grants
-- where the user may not have an existing order for the campaign.
ALTER TABLE public.bonus_grants ALTER COLUMN order_id DROP NOT NULL;
