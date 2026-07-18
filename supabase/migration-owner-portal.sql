-- =====================================================================
-- MallPay Phase 2: Owner portal, mallpay_complaints, mallpay_notices, manual payment
-- verification, WhatsApp outbox.
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- Safe to run on a live project with existing data: every new object is
-- additive (create table/column if not exists). The only edits to
-- existing objects are:
--   1. widening profiles.role to allow 'owner'
--   2. redefining profiles_read / shops_read / invoices_read so an
--      'owner' only sees their own data (admin/staff keep full access)
--   3. adding a trigger so a non-admin can't self-elevate role/active
-- =====================================================================

-- ---------- 1. profiles: owner role + WhatsApp fields ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','staff','owner'));

alter table public.profiles add column if not exists whatsapp_number text;
alter table public.profiles add column if not exists notify_whatsapp boolean not null default true;

-- allow a user to update their own row (e.g. whatsapp_number), but never
-- let a non-admin change their own role or active flag
create or replace function public.prevent_self_privilege_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = new.id and public.my_role() <> 'admin' then
    if new.role <> old.role or new.active <> old.active then
      raise exception 'Cannot change your own role or active status';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_prevent_self_privilege_escalation on public.profiles;
create trigger trg_prevent_self_privilege_escalation
  before update on public.profiles
  for each row execute function public.prevent_self_privilege_escalation();

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------- 2. mallpay_shop_owners: many-to-many (one owner, many shops) ----------
create table if not exists public.mallpay_shop_owners (
  shop_id bigint not null references public.shops(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (shop_id, owner_id)
);

-- ---------- 3. mallpay_complaints ----------
create table if not exists public.mallpay_complaints (
  id bigint generated always as identity primary key,
  shop_id bigint not null references public.shops(id),
  owner_id uuid not null references public.profiles(id),
  category text not null check (category in
    ('water_leakage','electrical','generator','plumbing','cleaning','security','other')),
  description text not null,
  photo_url text,
  status text not null default 'submitted' check (status in
    ('submitted','assigned','in_progress','completed','closed','rejected')),
  admin_note text,
  assigned_to uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_complaints_shop on public.mallpay_complaints(shop_id);
create index if not exists idx_complaints_status on public.mallpay_complaints(status);

-- ---------- 4. mallpay_notices (announcements) ----------
create table if not exists public.mallpay_notices (
  id bigint generated always as identity primary key,
  title text not null,
  body text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- 5. mallpay_payment_submissions (manual proof-of-payment) ----------
-- Does NOT touch invoices.status ('unpaid'/'paid' only, unchanged).
-- "Pending verification" = an unresolved row here for that invoice_id.
create table if not exists public.mallpay_payment_submissions (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.invoices(id),
  owner_id uuid not null references public.profiles(id),
  screenshot_url text not null,
  transaction_id text,
  amount numeric(12,2) not null,
  paid_on date not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_payment_submissions_invoice on public.mallpay_payment_submissions(invoice_id);
create index if not exists idx_payment_submissions_status on public.mallpay_payment_submissions(status);

-- ---------- 6. mall_settings: singleton row for mall bank account ----------
create table if not exists public.mall_settings (
  id boolean primary key default true check (id),
  bank_name text,
  bank_account_title text,
  bank_account_number text,
  updated_at timestamptz not null default now()
);
insert into public.mall_settings (id) values (true) on conflict do nothing;

-- ---------- 7. mallpay_whatsapp_outbox: decouples the app from the bot process ----------
create table if not exists public.mallpay_whatsapp_outbox (
  id bigint generated always as identity primary key,
  to_number text not null,
  to_profile_id uuid references public.profiles(id),
  message text not null,
  kind text not null check (kind in
    ('payment_approved','payment_rejected','complaint_status','notice')),
  related_table text,
  related_id bigint,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists idx_whatsapp_outbox_pending on public.mallpay_whatsapp_outbox(status, created_at);

-- =====================================================================
-- Row level security
-- =====================================================================
alter table public.mallpay_shop_owners        enable row level security;
alter table public.mallpay_complaints         enable row level security;
alter table public.mallpay_notices            enable row level security;
alter table public.mallpay_payment_submissions enable row level security;
alter table public.mall_settings       enable row level security;
alter table public.mallpay_whatsapp_outbox    enable row level security;

-- mallpay_shop_owners
drop policy if exists shop_owners_read on public.mallpay_shop_owners;
create policy shop_owners_read on public.mallpay_shop_owners for select to authenticated
  using (public.my_role() in ('admin','staff') or owner_id = auth.uid());
drop policy if exists shop_owners_admin on public.mallpay_shop_owners;
create policy shop_owners_admin on public.mallpay_shop_owners for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- mallpay_complaints
drop policy if exists complaints_read on public.mallpay_complaints;
create policy complaints_read on public.mallpay_complaints for select to authenticated
  using (public.my_role() in ('admin','staff') or owner_id = auth.uid());
drop policy if exists complaints_owner_insert on public.mallpay_complaints;
create policy complaints_owner_insert on public.mallpay_complaints for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.mallpay_shop_owners so
                where so.shop_id = mallpay_complaints.shop_id and so.owner_id = auth.uid())
  );
drop policy if exists complaints_admin_all on public.mallpay_complaints;
create policy complaints_admin_all on public.mallpay_complaints for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- mallpay_notices: everyone signed in can read; only admin can create
drop policy if exists notices_read on public.mallpay_notices;
create policy notices_read on public.mallpay_notices for select to authenticated using (true);
drop policy if exists notices_admin_insert on public.mallpay_notices;
create policy notices_admin_insert on public.mallpay_notices for insert to authenticated
  with check (public.my_role() = 'admin');

-- mallpay_payment_submissions
drop policy if exists payment_submissions_read on public.mallpay_payment_submissions;
create policy payment_submissions_read on public.mallpay_payment_submissions for select to authenticated
  using (public.my_role() in ('admin','staff') or owner_id = auth.uid());
drop policy if exists payment_submissions_owner_insert on public.mallpay_payment_submissions;
create policy payment_submissions_owner_insert on public.mallpay_payment_submissions for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.invoices i
      join public.mallpay_shop_owners so on so.shop_id = i.shop_id
      where i.id = mallpay_payment_submissions.invoice_id
        and so.owner_id = auth.uid() and i.status = 'unpaid'
    )
  );
drop policy if exists payment_submissions_admin_update on public.mallpay_payment_submissions;
create policy payment_submissions_admin_update on public.mallpay_payment_submissions for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- mall_settings: everyone signed in can read (owners need bank details), admin writes
drop policy if exists mall_settings_read on public.mall_settings;
create policy mall_settings_read on public.mall_settings for select to authenticated using (true);
drop policy if exists mall_settings_admin_write on public.mall_settings;
create policy mall_settings_admin_write on public.mall_settings for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- mallpay_whatsapp_outbox: only admin can enqueue via the app; the bot process uses
-- the service_role key, which bypasses RLS entirely, so no policy is added
-- for it to read/update rows.
drop policy if exists whatsapp_outbox_admin_insert on public.mallpay_whatsapp_outbox;
create policy whatsapp_outbox_admin_insert on public.mallpay_whatsapp_outbox for insert to authenticated
  with check (public.my_role() = 'admin');

-- ---------- redefine existing wide-open read policies ----------
-- Admin/staff behavior is unchanged (still unrestricted). Only 'owner' is
-- now scoped to their own data via mallpay_shop_owners.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (public.my_role() in ('admin','staff') or id = auth.uid());

drop policy if exists shops_read on public.shops;
create policy shops_read on public.shops for select to authenticated
  using (
    public.my_role() in ('admin','staff')
    or exists (select 1 from public.mallpay_shop_owners so where so.shop_id = shops.id and so.owner_id = auth.uid())
  );

drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated
  using (
    public.my_role() in ('admin','staff')
    or exists (select 1 from public.mallpay_shop_owners so where so.shop_id = invoices.shop_id and so.owner_id = auth.uid())
  );
-- invoices write policies (invoices_staff_collect / invoices_admin_all) are
-- untouched: both key off my_role() in ('admin','staff')/'admin', so an
-- 'owner' role is automatically excluded from writing invoices directly.
-- floors_read (using (true)) is left as-is too — floor names aren't
-- sensitive and owners need them to display their shop.

-- =====================================================================
-- Storage buckets for payment screenshots + complaint photos
-- =====================================================================
insert into storage.buckets (id, name, public)
  values ('payment-screenshots','payment-screenshots', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('complaint-photos','complaint-photos', false)
  on conflict (id) do nothing;

drop policy if exists payment_screenshots_owner_upload on storage.objects;
create policy payment_screenshots_owner_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists payment_screenshots_read on storage.objects;
create policy payment_screenshots_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-screenshots'
    and (public.my_role() in ('admin','staff') or (storage.foldername(name))[1] = auth.uid()::text));

drop policy if exists complaint_photos_owner_upload on storage.objects;
create policy complaint_photos_owner_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'complaint-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists complaint_photos_read on storage.objects;
create policy complaint_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'complaint-photos'
    and (public.my_role() in ('admin','staff') or (storage.foldername(name))[1] = auth.uid()::text));

-- =====================================================================
-- AFTER RUNNING THIS:
-- 1. Log in as your existing admin and confirm Dashboard/Shops/Collect/
--    Setup/Report still work exactly as before (RLS read policies on
--    profiles/shops/invoices were redefined above).
-- 2. Go to Setup and fill in the mall's bank account details (Owners
--    can't submit a payment proof usefully until this is set).
-- 3. Create your first owner account from the new Owners page and link
--    it to a shop, then log in as that owner to confirm they only see
--    their own shop/invoices.
-- =====================================================================
