-- =====================================================================
-- MallPay schema for Supabase
-- Run this ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- =====================================================================

-- ---------- profiles (extends Supabase auth users with a role) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'New user',
  role text not null default 'staff' check (role in ('admin','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user is created
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- core tables ----------
create table if not exists public.floors (
  id bigint generated always as identity primary key,
  name text not null,
  sort int not null default 0
);

create table if not exists public.shops (
  id bigint generated always as identity primary key,
  shop_number text not null unique,
  name text not null,
  owner_name text,
  owner_phone text,
  floor_id bigint not null references public.floors(id),
  size_sqft int,
  custom_fee numeric(12,2) not null default 0,  -- monthly maintenance fee
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id bigint generated always as identity primary key,
  shop_id bigint not null references public.shops(id),
  period text not null,                      -- 'YYYY-MM'
  amount numeric(12,2) not null,
  status text not null default 'unpaid' check (status in ('unpaid','paid')),
  paid_at timestamptz,
  collected_by uuid references public.profiles(id),
  note text,
  unique (shop_id, period)
);
create index if not exists idx_invoices_period on public.invoices(period);

-- ---------- invoice generation (call via RPC) ----------
create or replace function public.ensure_invoices(p_period text)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into public.invoices (shop_id, period, amount)
  select s.id, p_period, s.custom_fee
  from public.shops s
  where s.active and s.custom_fee > 0
  on conflict (shop_id, period) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------- helper: current user's role ----------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.floors   enable row level security;
alter table public.shops    enable row level security;
alter table public.invoices enable row level security;

-- profiles: everyone signed in can read names (needed to show collector);
-- only admins can change roles/others
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for update to authenticated using (public.my_role() = 'admin');

-- floors: read for all signed-in, write for admins
drop policy if exists floors_read on public.floors;
create policy floors_read on public.floors for select to authenticated using (true);
drop policy if exists floors_admin on public.floors;
create policy floors_admin on public.floors for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- shops: read for all signed-in (staff need the list), write for admins
drop policy if exists shops_read on public.shops;
create policy shops_read on public.shops for select to authenticated using (true);
drop policy if exists shops_admin on public.shops;
create policy shops_admin on public.shops for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- invoices: read for all signed-in; staff may mark unpaid -> paid;
-- admins may do anything
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated using (true);

drop policy if exists invoices_staff_collect on public.invoices;
create policy invoices_staff_collect on public.invoices
  for update to authenticated
  using (public.my_role() in ('admin','staff') and status = 'unpaid')
  with check (
    public.my_role() = 'admin'
    or (status = 'paid' and collected_by = auth.uid())
  );

drop policy if exists invoices_admin_all on public.invoices;
create policy invoices_admin_all on public.invoices
  for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ---------- seed data ----------
insert into public.floors (name, sort)
select * from (values ('Ground floor',0),('First floor',1),('Second floor',2)) v(n,s)
where not exists (select 1 from public.floors);

-- =====================================================================
-- AFTER RUNNING THIS:
-- 1. Authentication -> Users -> Add user -> create your own admin login
--    (email + password, check "auto confirm").
-- 2. Come back to SQL Editor and promote yourself to admin:
--      update public.profiles set role='admin', name='Your Name'
--      where id = (select id from auth.users where email='you@example.com');
-- =====================================================================
