# MallPay WhatsApp bot

Sends the WhatsApp notifications MallPay queues in the `whatsapp_outbox`
table (payment approved/rejected, complaint status updates, new notices).

This connects to a **real WhatsApp account** via QR code — the same way
WhatsApp Web works — not the official (paid) WhatsApp Business API. It
must run as its own always-on process; it is **not** part of the Next.js
app and cannot be deployed to Vercel or any other serverless host,
because it needs to keep a persistent connection/session alive.

**Recommended:** use a separate WhatsApp number for this (a spare SIM or
a second WhatsApp Business number), not the admin's personal daily-driver
number — this is an unofficial integration and there's a small but real
risk WhatsApp could restrict a number that looks automated.

## Setup

1. `cd whatsapp-bot`
2. `npm install`
3. `cp .env.example .env` and fill in:
   - `SUPABASE_URL` — same as `NEXT_PUBLIC_SUPABASE_URL` in the main app's `.env.local`
   - `SUPABASE_SERVICE_ROLE_KEY` — same as `SUPABASE_SERVICE_ROLE_KEY` in the main app's `.env.local` (this bypasses RLS — keep it secret, never commit `.env`)
4. `npm run dev` (or `npm run build && npm start` for the compiled version)
5. A QR code prints in the terminal. On the WhatsApp account you want to send from: **Settings → Linked Devices → Link a device**, scan it.
6. Once connected you'll see `WhatsApp connected.` in the terminal. Leave it running — the bot polls `whatsapp_outbox` every 5 seconds (`POLL_MS` in `.env`) and sends any pending messages.

Your session is saved to `auth/` (gitignored) so you don't need to re-scan on every restart — WhatsApp can occasionally force a device to re-link, in which case just delete `auth/` and scan again.

## Deploying (small VPS)

Any always-on Linux box works (a $5-6/mo droplet is plenty for a single mall):

```bash
npm install -g pm2
cd whatsapp-bot
npm install
npm run build
pm2 start dist/index.js --name mallpay-whatsapp
pm2 save
pm2 startup   # follow the printed instructions so it survives reboots
```

Watch logs with `pm2 logs mallpay-whatsapp`. If the app itself (the Next.js
deployment) is up but this bot is down, MallPay keeps working normally —
messages just queue in `whatsapp_outbox` with `status='pending'` until the
bot is back online and catches up.
