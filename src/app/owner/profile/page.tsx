import AppShell from "@/components/AppShell";
import { requireOwner } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function saveProfile(formData: FormData) {
  "use server";
  const user = await requireOwner();
  const supabase = await supabaseServer();
  const whatsapp = String(formData.get("whatsapp_number") || "").trim() || null;
  const notify = formData.get("notify_whatsapp") === "on";
  const { error } = await supabase
    .from("profiles")
    .update({ whatsapp_number: whatsapp, notify_whatsapp: notify })
    .eq("id", user.id);
  if (error) redirect("/owner/profile?err=1");
  redirect("/owner/profile?ok=1");
}

export default async function OwnerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const user = await requireOwner();
  const sp = await searchParams;
  const supabase = await supabaseServer();
  const { data: profile } = await supabase
    .from("profiles")
    .select("name,whatsapp_number,notify_whatsapp")
    .eq("id", user.id)
    .single();

  return (
    <AppShell user={user} active="/owner/profile">
      <h1>Profile</h1>
      {sp.err && <div className="flash err">Could not save - try again.</div>}
      {sp.ok && <div className="flash ok">Saved.</div>}

      <div className="card" style={{ maxWidth: 480, marginTop: 14 }}>
        <form action={saveProfile}>
          <div className="field">
            <label>Name</label>
            <input type="text" value={profile?.name ?? user.name} disabled />
          </div>
          <div className="field">
            <label>WhatsApp number</label>
            <input
              type="text"
              name="whatsapp_number"
              defaultValue={profile?.whatsapp_number ?? ""}
              placeholder="e.g. 923001234567"
            />
          </div>
          <div className="field">
            <label>
              <input
                type="checkbox"
                name="notify_whatsapp"
                style={{ width: "auto" }}
                defaultChecked={profile?.notify_whatsapp ?? true}
              />{" "}
              Send me WhatsApp updates (payments, complaints, notices)
            </label>
          </div>
          <button className="btn">Save</button>
        </form>
      </div>
    </AppShell>
  );
}
