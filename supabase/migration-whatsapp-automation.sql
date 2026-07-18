-- =====================================================================
-- MallPay: WhatsApp reminder automation + admin controls
--   - mallpay_whatsapp_settings: reminder schedule, sending window,
--     rate/batch limits, queue state (singleton, like mall_settings)
--   - mallpay_whatsapp_templates: editable message wording per kind
--   - mallpay_reminder_log: dedup + per-invoice cap + history for the
--     automated due-date reminder scanner
--   - widen mallpay_whatsapp_outbox.kind (+'reminder') and .status
--     (+'cancelled')
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Purely additive/idempotent — safe to run on a live project.
-- =====================================================================

-- ---------- 1. mallpay_whatsapp_settings (singleton) ----------
create table if not exists public.mallpay_whatsapp_settings (
  id boolean primary key default true check (id),
  due_day_of_month int not null default 5 check (due_day_of_month between 1 and 28),
  reminder_days_before int[] not null default '{7,3,1}',
  remind_on_due_date boolean not null default true,
  reminder_days_after int[] not null default '{3,7,14}',
  repeat_after_interval_days int not null default 7 check (repeat_after_interval_days > 0),
  max_reminders_per_invoice int not null default 6 check (max_reminders_per_invoice > 0),
  sending_days int[] not null default '{1,2,3,4,5,6}',      -- ISO weekday, 1=Mon..7=Sun; default Mon-Sat
  sending_hour_start int not null default 9 check (sending_hour_start between 0 and 23),
  sending_hour_end int not null default 20 check (sending_hour_end between 0 and 23),
  delay_min_seconds int not null default 10 check (delay_min_seconds >= 0),
  delay_max_seconds int not null default 15 check (delay_max_seconds >= delay_min_seconds),
  max_messages_per_minute int not null default 5 check (max_messages_per_minute > 0),
  batch_size int not null default 20 check (batch_size > 0),
  batch_pause_seconds int not null default 120 check (batch_pause_seconds >= 0),
  queue_state text not null default 'running' check (queue_state in ('running','paused','disabled')),
  updated_at timestamptz not null default now()
);
insert into public.mallpay_whatsapp_settings (id) values (true) on conflict do nothing;

alter table public.mallpay_whatsapp_settings enable row level security;
drop policy if exists whatsapp_settings_admin_all on public.mallpay_whatsapp_settings;
create policy whatsapp_settings_admin_all on public.mallpay_whatsapp_settings for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ---------- 2. mallpay_whatsapp_templates ----------
create table if not exists public.mallpay_whatsapp_templates (
  key text primary key,
  label text not null,
  body text not null,
  updated_at timestamptz not null default now()
);

insert into public.mallpay_whatsapp_templates (key, label, body) values
  ('payment_approved', 'Payment approved',
   'Your payment has been received and verified successfully. Shop {{shop_number}}, {{period_label}}, {{amount}}. Thank you.'),
  ('payment_rejected', 'Payment rejected',
   'We could not verify your submitted payment. Please contact the management office or upload a valid payment proof.{{reason_suffix}}'),
  ('complaint_new', 'New complaint (to staff)',
   'New {{category}} complaint — Shop {{shop_number}}: {{description}}'),
  ('complaint_status', 'Complaint status update (to owner)',
   'Update on your {{category}} complaint (Shop {{shop_number}}): {{status_label}}.'),
  ('notice', 'Notice / announcement',
   '{{title}}' || chr(10) || chr(10) || '{{body}}'),
  ('reminder_before', 'Maintenance reminder — before due date',
   'Reminder: your maintenance fee for {{period_label}} (Shop {{shop_number}}) of {{amount}} is due on {{due_date}}. Please pay on time to avoid late charges.'),
  ('reminder_due', 'Maintenance reminder — on due date',
   'Your maintenance fee for {{period_label}} (Shop {{shop_number}}) of {{amount}} is due today ({{due_date}}). Please make your payment.'),
  ('reminder_after', 'Maintenance reminder — overdue',
   'Your maintenance fee for {{period_label}} (Shop {{shop_number}}) of {{amount}} was due on {{due_date}} and is now {{days_overdue}} day(s) overdue. Please settle this as soon as possible.')
on conflict (key) do nothing;

alter table public.mallpay_whatsapp_templates enable row level security;
drop policy if exists whatsapp_templates_admin_all on public.mallpay_whatsapp_templates;
-- Staff (not just admin) trigger template-based notifications too (e.g.
-- Collect's payment-received message, Complaints' status-update message),
-- so staff need read access; only admin can edit template wording.
drop policy if exists whatsapp_templates_read on public.mallpay_whatsapp_templates;
create policy whatsapp_templates_read on public.mallpay_whatsapp_templates for select to authenticated
  using (public.my_role() in ('admin','staff'));
drop policy if exists whatsapp_templates_admin_write on public.mallpay_whatsapp_templates;
create policy whatsapp_templates_admin_write on public.mallpay_whatsapp_templates for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ---------- 3. mallpay_reminder_log ----------
-- Dedup + per-invoice reminder cap + history, all in one table. The
-- unique constraint is keyed on (invoice_id, owner_id, reminder_stage)
-- rather than just (invoice_id, reminder_stage) because a shop can have
-- more than one linked owner (mallpay_shop_owners is many-to-many) — one
-- owner's reminder being logged must not block another owner's.
create table if not exists public.mallpay_reminder_log (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.invoices(id),
  owner_id uuid not null references public.profiles(id),
  reminder_stage text not null,
  sent_at timestamptz not null default now(),
  outbox_id bigint references public.mallpay_whatsapp_outbox(id),
  unique (invoice_id, owner_id, reminder_stage)
);
create index if not exists idx_reminder_log_invoice on public.mallpay_reminder_log(invoice_id);

alter table public.mallpay_reminder_log enable row level security;
drop policy if exists reminder_log_admin_read on public.mallpay_reminder_log;
create policy reminder_log_admin_read on public.mallpay_reminder_log for select to authenticated
  using (public.my_role() = 'admin');
-- No insert/update/delete policy for 'authenticated' — only the bot's
-- service-role client writes here (same pattern as mallpay_whatsapp_status).

-- ---------- 4. widen mallpay_whatsapp_outbox.kind to allow 'reminder' ----------
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.mallpay_whatsapp_outbox'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.mallpay_whatsapp_outbox drop constraint %I', con.conname);
  end loop;
end $$;
alter table public.mallpay_whatsapp_outbox add constraint mallpay_whatsapp_outbox_kind_check
  check (kind in ('payment_approved','payment_rejected','complaint_status','complaint_new','notice','reminder'));

-- ---------- 5. widen mallpay_whatsapp_outbox.status to allow 'cancelled' ----------
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.mallpay_whatsapp_outbox'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.mallpay_whatsapp_outbox drop constraint %I', con.conname);
  end loop;
end $$;
alter table public.mallpay_whatsapp_outbox add constraint mallpay_whatsapp_outbox_status_check
  check (status in ('pending','sent','failed','cancelled'));
