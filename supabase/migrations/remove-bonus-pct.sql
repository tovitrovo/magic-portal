-- Remove bonus_pct feature (BONUS_PCT grant type)
-- Run this against production to clean up

-- 1. Remove column bonus_pct from campaigns
ALTER TABLE public.campaigns DROP COLUMN IF EXISTS bonus_pct;

-- 2. Remove (or expire) any existing BONUS_PCT grants
UPDATE public.bonus_grants SET status = 'EXPIRED' WHERE grant_type = 'TIER_CHANGE'; -- no-op, just a safeguard
DELETE FROM public.bonus_grants WHERE grant_type = 'BONUS_PCT';

-- 3. Update grant_type CHECK constraint
ALTER TABLE public.bonus_grants DROP CONSTRAINT IF EXISTS bonus_grants_grant_type_check;
ALTER TABLE public.bonus_grants ADD CONSTRAINT bonus_grants_grant_type_check
  CHECK (grant_type IN ('MANUAL', 'TIER_CHANGE'));
