"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MALL_NAME } from "@/lib/util";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setErr("Wrong email or password.");
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="login">
      <div className="login-head">
        <span className="mark">{MALL_NAME.charAt(0).toUpperCase()}</span>
        <h1 style={{ margin: "6px 0 2px" }}>{MALL_NAME}</h1>
        <p className="muted" style={{ margin: 0 }}>Maintenance collection</p>
      </div>
      <div className="card">
        {err && <div className="flash err" style={{ margin: "0 0 12px" }}>{err}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="e">Email</label>
            <input id="e" type="email" value={email} autoFocus
              onChange={(ev) => setEmail(ev.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="p">Password</label>
            <input id="p" type="password" value={password}
              onChange={(ev) => setPassword(ev.target.value)} autoComplete="current-password" />
          </div>
          <button className="btn" style={{ width: "100%" }} disabled={busy}>
            {busy ? "Signing in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
