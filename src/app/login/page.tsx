"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import BrandLogo from "@/components/BrandLogo";

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
        <BrandLogo height={150} />
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
