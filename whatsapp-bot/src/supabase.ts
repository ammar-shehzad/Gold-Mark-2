import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required — copy .env.example to .env and fill them in.");
}

export const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
