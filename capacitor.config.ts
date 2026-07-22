import type { CapacitorConfig } from "@capacitor/cli";

// This wraps the live deployed site (server.url) rather than bundling a
// local static build — the app is server-rendered with dynamic data
// (Supabase-backed, per-user auth), so there's nothing meaningful to bundle
// statically. The native shell just points its WebView at the real domain.
const config: CapacitorConfig = {
  appId: "com.goldmark.maintenance",
  appName: "Gold Mark 2",
  webDir: "public",
  server: {
    url: "https://gold-mark-2.vercel.app",
    cleartext: false,
  },
};

export default config;
