"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function PasskeyEnrollment() {
  const [supported, setSupported] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const available = typeof window !== "undefined" && "PublicKeyCredential" in window;
    setSupported(available);
    if (!available) return;

    const supabase = supabaseBrowser();
    void supabase.auth.passkey.list().then(({ data }) => setEnrolled((data ?? []).length > 0));
  }, []);

  if (!supported || enrolled) return null;

  async function enroll() {
    setBusy(true);
    const { error } = await supabaseBrowser().auth.registerPasskey();
    setBusy(false);
    if (error) {
      window.alert(error.message.includes("disabled")
        ? "Fingerprint/passkey login must first be enabled in Supabase Authentication settings."
        : `Fingerprint/passkey registration was not completed: ${error.message}`);
      return;
    }
    setEnrolled(true);
    window.alert("Fingerprint/passkey login is now registered for this account.");
  }

  return (
    <button type="button" className="btn ghost small passkey-enroll" onClick={enroll} disabled={busy}>
      {busy ? "Registering…" : "Enable fingerprint"}
    </button>
  );
}
