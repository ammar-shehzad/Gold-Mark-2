-- =====================================================================
-- MallPay: dynamic departments, staff type split, WhatsApp log + images
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- Fully idempotent and self-contained — safe to run whether or not the
-- earlier migration-staff-departments.sql was ever applied. Supersedes it.
-- =====================================================================

-- ---------- 1. mallpay_departments: admin-managed list (replaces the old fixed enum) ----------
create table if not exists public.mallpay_departments (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);
insert into public.mallpay_departments (name)
select * from (values
  ('Water Leakage'),('Electrical'),('Generator'),('Plumbing'),('Cleaning'),('Security'),('Other')
) v(name)
where not exists (select 1 from public.mallpay_departments);

alter table public.mallpay_departments enable row level security;
drop policy if exists mallpay_departments_read on public.mallpay_departments;
create policy mallpay_departments_read on public.mallpay_departments for select to authenticated using (true);
drop policy if exists mallpay_departments_admin_write on public.mallpay_departments;
create policy mallpay_departments_admin_write on public.mallpay_departments for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ---------- 2. profiles.department: drop the old fixed-enum check ----------
alter table public.profiles add column if not exists department text;
alter table public.profiles drop constraint if exists profiles_department_check;

-- ---------- 3. mallpay_complaints.category: drop its old fixed-enum check ----------
-- (unnamed inline constraint from the original migration — find it dynamically)
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.mallpay_complaints'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%category%'
  loop
    execute format('alter table public.mallpay_complaints drop constraint %I', con.conname);
  end loop;
end $$;

-- ---------- 4. remap any old slug-style values to the new friendly names ----------
update public.profiles set department = 'Water Leakage' where department = 'water_leakage';
update public.profiles set department = 'Electrical'    where department = 'electrical';
update public.profiles set department = 'Generator'     where department = 'generator';
update public.profiles set department = 'Plumbing'      where department = 'plumbing';
update public.profiles set department = 'Cleaning'      where department = 'cleaning';
update public.profiles set department = 'Security'      where department = 'security';
update public.profiles set department = 'Other'         where department = 'other';

update public.mallpay_complaints set category = 'Water Leakage' where category = 'water_leakage';
update public.mallpay_complaints set category = 'Electrical'    where category = 'electrical';
update public.mallpay_complaints set category = 'Generator'     where category = 'generator';
update public.mallpay_complaints set category = 'Plumbing'      where category = 'plumbing';
update public.mallpay_complaints set category = 'Cleaning'      where category = 'cleaning';
update public.mallpay_complaints set category = 'Security'      where category = 'security';
update public.mallpay_complaints set category = 'Other'         where category = 'other';

-- ---------- 5. profiles.staff_type: collector vs department staff ----------
alter table public.profiles add column if not exists staff_type text;
alter table public.profiles drop constraint if exists profiles_staff_type_check;
alter table public.profiles add constraint profiles_staff_type_check
  check (staff_type is null or staff_type in ('collector','department'));

-- fixes the real problem right now: any staff who already has a department
-- set becomes department-type (and stops seeing Collect); everyone else
-- defaults to collector-type (today's only behavior).
update public.profiles set staff_type = 'department'
  where role = 'staff' and department is not null and staff_type is null;
update public.profiles set staff_type = 'collector'
  where role = 'staff' and department is null and staff_type is null;

-- helper: current user's department (mirrors the existing my_role() pattern)
create or replace function public.my_department()
returns text language sql stable security definer set search_path = public as $$
  select department from public.profiles where id = auth.uid()
$$;

-- ---------- 6. staff can update complaints in their own department ----------
drop policy if exists complaints_staff_update on public.mallpay_complaints;
create policy complaints_staff_update on public.mallpay_complaints for update to authenticated
  using (public.my_role() = 'staff' and category = public.my_department())
  with check (public.my_role() = 'staff' and category = public.my_department());

-- ---------- 7. staff can also enqueue WhatsApp notifications ----------
drop policy if exists whatsapp_outbox_admin_insert on public.mallpay_whatsapp_outbox;
drop policy if exists whatsapp_outbox_staff_insert on public.mallpay_whatsapp_outbox;
create policy whatsapp_outbox_staff_insert on public.mallpay_whatsapp_outbox for insert to authenticated
  with check (public.my_role() in ('admin','staff'));

-- ---------- 8. admin can read the outbox (needed for the message-log page) ----------
drop policy if exists whatsapp_outbox_admin_read on public.mallpay_whatsapp_outbox;
create policy whatsapp_outbox_admin_read on public.mallpay_whatsapp_outbox for select to authenticated
  using (public.my_role() = 'admin');

-- ---------- 9. widen whatsapp_outbox.kind to include 'complaint_new' ----------
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
  check (kind in ('payment_approved','payment_rejected','complaint_status','complaint_new','notice'));

-- ---------- 10. whatsapp_outbox.image_path: attach a complaint photo to a message ----------
alter table public.mallpay_whatsapp_outbox add column if not exists image_path text;
