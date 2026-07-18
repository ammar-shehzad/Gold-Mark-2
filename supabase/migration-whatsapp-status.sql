-- =====================================================================
-- MallPay: WhatsApp connection status (for the in-app QR connect screen)
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Purely additive — does not touch any existing table/policy.
-- =====================================================================

create table if not exists public.mallpay_whatsapp_status (
  id boolean primary key default true check (id),
  connected boolean not null default false,
  qr_data text,
  connected_number text,
  updated_at timestamptz not null default now()
);
insert into public.mallpay_whatsapp_status (id) values (true) on conflict do nothing;

alter table public.mallpay_whatsapp_status enable row level security;

-- Only admins can read connection status/QR data from the app.
-- No insert/update policy for 'authenticated' — only the bot (using the
-- service_role key, which bypasses RLS) is allowed to write to this table.
drop policy if exists mallpay_whatsapp_status_read on public.mallpay_whatsapp_status;
create policy mallpay_whatsapp_status_read on public.mallpay_whatsapp_status for select to authenticated
  using (public.my_role() = 'admin');
