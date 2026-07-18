-- =====================================================================
-- MallPay: staff departments (route complaints to the right staff member)
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Purely additive except for a targeted rewrite of the whatsapp_outbox
-- 'kind' check constraint (to allow a new notification kind) — done
-- defensively below so it works regardless of the constraint's actual name.
-- =====================================================================

-- ---------- 1. profiles.department (only meaningful for staff) ----------
alter table public.profiles add column if not exists department text;

alter table public.profiles drop constraint if exists profiles_department_check;
alter table public.profiles add constraint profiles_department_check
  check (department is null or department in
    ('water_leakage','electrical','generator','plumbing','cleaning','security','other'));

-- helper: current user's department (mirrors the existing my_role() pattern)
create or replace function public.my_department()
returns text language sql stable security definer set search_path = public as $$
  select department from public.profiles where id = auth.uid()
$$;

-- ---------- 2. widen whatsapp_outbox.kind to allow 'complaint_new' ----------
-- Finds and drops whatever the existing check constraint on "kind" is
-- actually named (avoids guessing wrong and silently leaving the old,
-- too-narrow constraint in place).
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

-- ---------- 3. staff can update complaints in their own department ----------
drop policy if exists complaints_staff_update on public.mallpay_complaints;
create policy complaints_staff_update on public.mallpay_complaints for update to authenticated
  using (public.my_role() = 'staff' and category = public.my_department())
  with check (public.my_role() = 'staff' and category = public.my_department());

-- ---------- 4. staff can also enqueue WhatsApp notifications ----------
-- (previously admin-only; staff now trigger notifications too when they
-- update a complaint's status). Owner-triggered notifications (new
-- complaint submitted) go through the service-role client in the app
-- instead, since owners should not get a general insert policy here.
drop policy if exists whatsapp_outbox_admin_insert on public.mallpay_whatsapp_outbox;
drop policy if exists whatsapp_outbox_staff_insert on public.mallpay_whatsapp_outbox;
create policy whatsapp_outbox_staff_insert on public.mallpay_whatsapp_outbox for insert to authenticated
  with check (public.my_role() in ('admin','staff'));
