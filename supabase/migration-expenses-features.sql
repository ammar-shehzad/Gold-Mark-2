-- =====================================================================
-- MallPay: Expenses module + collection audit log + advance-payment support
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Purely additive - safe on a live project. No existing table is altered
-- except invoices gaining a nullable "collected for a specific day" is NOT
-- needed (paid_at already carries the collection timestamp).
-- =====================================================================

-- ---------- 1. mallpay_expenses ----------
-- Category is free text (the app suggests a list but allows any value, per
-- "including but not limited to"). Financial data - admin only.
create table if not exists public.mallpay_expenses (
  id bigint generated always as identity primary key,
  spent_on date not null default current_date,
  category text not null,
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  notes text,
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Salary payments link to the staff member they were paid to, and to the
-- month they cover, so that staff member can see their own salary history.
alter table public.mallpay_expenses add column if not exists paid_to uuid references public.profiles(id) on delete set null;
alter table public.mallpay_expenses add column if not exists salary_period text; -- 'YYYY-MM' for salary rows

create index if not exists idx_expenses_spent_on on public.mallpay_expenses(spent_on desc);
create index if not exists idx_expenses_category on public.mallpay_expenses(category);
create index if not exists idx_expenses_paid_to on public.mallpay_expenses(paid_to);

alter table public.mallpay_expenses enable row level security;
-- Admin: full control over every expense.
drop policy if exists expenses_admin_all on public.mallpay_expenses;
create policy expenses_admin_all on public.mallpay_expenses for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
-- Staff: read-only, and ONLY their own salary rows (paid_to = themselves).
drop policy if exists expenses_staff_own_salary on public.mallpay_expenses;
create policy expenses_staff_own_salary on public.mallpay_expenses for select to authenticated
  using (paid_to = auth.uid());

-- ---------- 2. mallpay_collection_audit ----------
-- One row per edit / undo / collect action on an invoice, so admins have a
-- "who changed what, and when" trail (Features 7 & 8).
create table if not exists public.mallpay_collection_audit (
  id bigint generated always as identity primary key,
  invoice_id bigint references public.invoices(id) on delete set null,
  shop_number text,
  period text,
  action text not null check (action in ('collect','edit','undo','bulk_collect','advance_collect')),
  old_status text,
  new_status text,
  old_amount numeric(12,2),
  new_amount numeric(12,2),
  old_paid_at timestamptz,
  new_paid_at timestamptz,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  note text
);
create index if not exists idx_collection_audit_invoice on public.mallpay_collection_audit(invoice_id);
create index if not exists idx_collection_audit_changed_at on public.mallpay_collection_audit(changed_at desc);

alter table public.mallpay_collection_audit enable row level security;
drop policy if exists collection_audit_admin_read on public.mallpay_collection_audit;
create policy collection_audit_admin_read on public.mallpay_collection_audit for select to authenticated
  using (public.my_role() = 'admin');
-- Inserts happen through the app's server actions (service-role client), so
-- no insert policy for regular sessions is needed.

-- ---------- 3. advance payments: allow marking a future/any month paid ----------
-- No schema change required - invoices already key on (shop_id, period) for
-- any 'YYYY-MM'. The app upserts the invoice for the chosen month and marks
-- it paid. This function creates-or-returns one invoice on demand at the
-- shop's current fee, used when collecting a month that has no invoice yet.
create or replace function public.ensure_one_invoice(p_shop_id bigint, p_period text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_fee numeric(12,2);
begin
  select id into v_id from public.invoices where shop_id = p_shop_id and period = p_period;
  if v_id is not null then
    return v_id;
  end if;
  select custom_fee into v_fee from public.shops where id = p_shop_id;
  insert into public.invoices (shop_id, period, amount, status)
  values (p_shop_id, p_period, coalesce(v_fee, 0), 'unpaid')
  on conflict (shop_id, period) do update set period = excluded.period
  returning id into v_id;
  return v_id;
end $$;
