-- =====================================================================
-- MallPay: Google Sheets two-way ledger sync
--   - mallpay_google_sheets_settings: OAuth connection state (singleton,
--     like mall_settings), including a sync lock (sync_running/
--     sync_started_at) claimed the same way the WhatsApp bot claims
--     outbox rows before sending.
--   - mallpay_sheet_sync_log: audit trail of each sync run.
--   - invoices gets three nullable "last synced fingerprint" columns
--     used for three-way conflict detection (DB vs Sheet vs last sync).
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Purely additive/idempotent — safe to run on a live project.
-- =====================================================================

-- ---------- 1. mallpay_google_sheets_settings (singleton) ----------
create table if not exists public.mallpay_google_sheets_settings (
  id boolean primary key default true check (id),
  connected boolean not null default false,
  google_email text,
  refresh_token text,              -- encrypted (AES-256-GCM) by the app before storage, never plaintext
  spreadsheet_id text,
  spreadsheet_url text,
  sync_enabled boolean not null default true,
  sync_running boolean not null default false,
  sync_started_at timestamptz,
  last_synced_at timestamptz,
  last_sync_status text,           -- 'ok' | 'error'
  last_sync_error text,
  updated_at timestamptz not null default now()
);
insert into public.mallpay_google_sheets_settings (id) values (true) on conflict do nothing;

alter table public.mallpay_google_sheets_settings enable row level security;
drop policy if exists gsheets_settings_admin_all on public.mallpay_google_sheets_settings;
create policy gsheets_settings_admin_all on public.mallpay_google_sheets_settings for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ---------- 2. mallpay_sheet_sync_log (audit trail) ----------
create table if not exists public.mallpay_sheet_sync_log (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  direction text not null check (direction in ('export','import','full')),
  invoices_exported int not null default 0,
  invoices_imported int not null default 0,
  conflicts int not null default 0,
  error text
);
create index if not exists idx_sheet_sync_log_ran_at on public.mallpay_sheet_sync_log(ran_at desc);

alter table public.mallpay_sheet_sync_log enable row level security;
drop policy if exists sheet_sync_log_admin_read on public.mallpay_sheet_sync_log;
create policy sheet_sync_log_admin_read on public.mallpay_sheet_sync_log for select to authenticated
  using (public.my_role() = 'admin');
-- No insert/update/delete policy for 'authenticated' — only the app's
-- server-side sync code (service-role client) writes here.

-- ---------- 3. invoices: last-synced fingerprint columns ----------
-- Internal bookkeeping only (not shown to end users) — lets the sync
-- distinguish "only the Sheet changed" / "only the DB changed" / "both
-- changed since the last successful sync" for the same invoice.
alter table public.invoices add column if not exists sheet_synced_status text;
alter table public.invoices add column if not exists sheet_synced_note text;
alter table public.invoices add column if not exists sheet_synced_at timestamptz;
