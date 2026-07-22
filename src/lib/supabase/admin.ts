import { createClient } from "@supabase/supabase-js";

/** Server-only client with the service role key. Never import in client code. */
export function supabaseAdmin() {
  // Explicit checks so a missing/misnamed env var on the host (e.g. Vercel)
  // produces a clear, named error in the function logs instead of
  // supabase-js's generic "supabaseKey is required" crash.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set in this environment");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set in this environment — on Vercel: Settings → Environment Variables, then redeploy"
    );
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
