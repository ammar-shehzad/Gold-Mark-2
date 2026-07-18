# Gold Mark 2 — Next.js + Supabase

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

## Google Sheets ledger sync (optional)
Lets the admin connect their own Google account and keep the invoice
ledger mirrored in a Google Sheet, synced daily (or on demand). Editing
**Status** or **Note** in the sheet updates the app back — shop, period,
and amount are export-only and can never be changed from the sheet.

### 1. Run the migration
SQL Editor -> paste `supabase/migration-google-sheets-sync.sql` -> Run.

### 2. Create a Google OAuth client
1. In [Google Cloud Console](https://console.cloud.google.com), create a
   project (or use an existing one) and enable the **Google Sheets API**.
2. **APIs & Services -> OAuth consent screen** -> configure it, then set
   publishing status to **In production** (a warning screen is fine — no
   formal review is needed at this scope). **If you leave it in
   "Testing," Google expires the connection after 7 days and the daily
   sync will silently stop working a week after you set it up.**
3. **APIs & Services -> Credentials -> Create OAuth client ID** ->
   type **Web application** -> add
   `<your app URL>/api/google/oauth/callback` as an authorized redirect
   URI (e.g. `http://localhost:3000/api/google/oauth/callback` for local
   dev, or your real domain in production).

### 3. Configure the app
Add to `.env.local` (and your deployment's environment variables):
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from the OAuth client above
- `APP_URL` — the app's base URL, e.g. `http://localhost:3000`
- `GOOGLE_TOKEN_ENC_KEY` — a random 32-byte key, generate once with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- `CRON_SECRET` — any random string, used to authorize the daily sync trigger

### 4. Connect and trigger the daily sync
1. Log in as admin -> **Google Sheets** in the sidebar -> **Connect
   Google account**. A new spreadsheet is created automatically on first
   connect.
2. Something needs to call `GET /api/google/sync` with header
   `Authorization: Bearer <CRON_SECRET>` once a day:
   - **Deployed on Vercel:** already set up via `vercel.json`'s cron entry
     — just make sure `CRON_SECRET` is set in the Vercel project's
     environment variables (Vercel then attaches it automatically).
   - **Anywhere else** (e.g. the same VPS running `whatsapp-bot`): add a
     single system-cron line, e.g.
     `curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain.com/api/google/sync`.
   The **Sync now** button on the Google Sheets page always works
   regardless of which trigger you use.
