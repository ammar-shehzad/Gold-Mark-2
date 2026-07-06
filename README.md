# MallPay — Next.js + Supabase

Mall maintenance collection system: register shops by floor and size,
auto-generate monthly invoices from fee tiers, staff record collections,
admin sees who has paid at month end.

## Stack
- Next.js (App Router, TypeScript, server actions)
- Supabase (Postgres database + authentication + row level security)

## Setup — 10 minutes

### 1. Create the Supabase project
1. Go to supabase.com -> New project (free tier is fine).
2. Open **SQL Editor** -> New query -> paste the whole contents of
   `supabase/schema.sql` -> **Run**.
   This creates all tables, security policies, the invoice generator,
   and seeds default floors and fee tiers.

### 2. Create your admin account
1. **Authentication -> Users -> Add user** -> enter your email and a
   password, tick **Auto Confirm User** -> create.
2. Back in **SQL Editor**, run (with your email):
   ```sql
   update public.profiles set role='admin', name='Your Name'
   where id = (select id from auth.users where email='you@example.com');
   ```

### 3. Configure the app
1. Copy `.env.example` to `.env.local`.
2. Fill in from **Project Settings -> API**:
   - `NEXT_PUBLIC_SUPABASE_URL` — the Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the `anon` `public` key
   - `SUPABASE_SERVICE_ROLE_KEY` — the `service_role` key
     (secret — needed so you can create staff accounts from Setup)
3. Set your mall name and currency in the same file.

### 4. Run it
```bash
npm install
npm run dev        # local development on http://localhost:3000
```

### 5. Deploy (recommended: Vercel)
Push the folder to a GitHub repo -> import it on vercel.com ->
add the four environment variables -> deploy. Free tier works.

## How roles work
- **Admin** (you): dashboard with totals, shops, reports, CSV export, setup.
- **Staff** (your collectors): only the Collect page — mark payments as
  collected. They never see totals, dashboards, or reports. This is
  enforced both in the app AND in the database itself (row level
  security), so even a technical staff member cannot bypass it.

## Where is the database?
Supabase dashboard -> **Table Editor**. You can browse and edit
`shops`, `floors`, `tiers`, `invoices`, and `profiles` visually there,
run SQL queries in the SQL Editor, and download backups from
Database -> Backups.

## Monthly flow
Invoices for the current month generate automatically for all active
shops whenever anyone opens the app — nothing to click. At month end,
open **Reports**, pick the month, and download the CSV.
