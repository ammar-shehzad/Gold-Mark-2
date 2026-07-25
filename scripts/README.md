# Maintenance scripts

One-off admin scripts. Run from this folder with Node, using the same Supabase
service-role credentials as the WhatsApp bot.

```bash
cd scripts
cp ../whatsapp-bot/.env .env      # provides SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install @supabase/supabase-js dotenv
```

## seed-history.mjs
Fills the last 6 full months (before the current month) with **collected**
invoices for every active shop, so reports/filters have historical data to
show. Every seeded invoice is tagged `note = 'SEED'`.

```bash
node seed-history.mjs
```

## unseed-history.mjs
Deletes every `note = 'SEED'` invoice — use this to remove all test history
before handing the system to the client, leaving only real collections.

```bash
node unseed-history.mjs
```

> Keep the `.env` you copy here out of version control (it holds the
> service-role key). It is already covered by the repo's .gitignore patterns.
