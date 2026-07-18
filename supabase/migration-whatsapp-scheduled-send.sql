-- =====================================================================
-- MallPay: scheduled WhatsApp sends (admin picks a delay for notices so
-- every recipient becomes eligible to send at the exact same instant,
-- instead of being staggered by whenever the outbox rows happened to be
-- inserted).
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Purely additive — safe to run whether or not this has been applied
-- before, and safe on a live project with existing outbox rows (they all
-- default to scheduled_at = now(), i.e. "send immediately", unchanged
-- behavior).
-- =====================================================================

alter table public.mallpay_whatsapp_outbox
  add column if not exists scheduled_at timestamptz not null default now();

create index if not exists idx_whatsapp_outbox_scheduled
  on public.mallpay_whatsapp_outbox(status, scheduled_at);
