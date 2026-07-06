-- ================================================================
-- ONLY for databases created with the OLD schema (that had tiers).
-- Fresh installs using the current schema.sql do NOT need this.
-- Run once in Supabase SQL Editor.
-- ================================================================

-- Copy each shop's tier fee into its own fee field (where not set)
update public.shops s
set custom_fee = t.monthly_fee
from public.tiers t
where s.tier_id = t.id and s.custom_fee is null;

update public.shops set custom_fee = 0 where custom_fee is null;

-- Invoice generation now reads the shop's own fee only
create or replace function public.ensure_invoices(p_period text)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into public.invoices (shop_id, period, amount)
  select s.id, p_period, s.custom_fee
  from public.shops s
  where s.active and coalesce(s.custom_fee, 0) > 0
  on conflict (shop_id, period) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- The tiers table is no longer used by the app; keeping it is
-- harmless, but you can remove it if you want:
-- alter table public.shops drop column if exists tier_id;
-- drop table if exists public.tiers;
