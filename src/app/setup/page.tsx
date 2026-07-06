import AppHeader from "@/components/AppHeader";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function addFloor(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("floor_name") || "").trim();
  if (name) {
    const supabase = await supabaseServer();
    const { data: max } = await supabase.from("floors").select("sort").order("sort", { ascending: false }).limit(1);
    await supabase.from("floors").insert({ name, sort: (max?.[0]?.sort ?? 0) + 1 });
  }
  redirect("/setup?ok=Floor+added");
}

async function deleteFloor(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = Number(formData.get("id"));
  const supabase = await supabaseServer();
  const { count } = await supabase.from("shops").select("id", { count: "exact", head: true }).eq("floor_id", id);
  if ((count ?? 0) > 0) redirect("/setup?err=That+floor+has+shops+on+it+—+move+them+first");
  await supabase.from("floors").delete().eq("id", id);
  redirect("/setup?ok=Floor+removed");
}

async function createUser(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("u_name") || "").trim();
  const email = String(formData.get("u_email") || "").trim();
  const password = String(formData.get("u_password") || "");
  const role = formData.get("u_role") === "admin" ? "admin" : "staff";
  if (!name || !email || password.length < 6) {
    redirect("/setup?err=User+needs+a+name,+email,+and+a+password+of+at+least+6+characters");
  }
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name },
  });
  if (error || !data.user) redirect("/setup?err=Could+not+create+the+account+—+is+the+email+already+used%3F");
  await admin.from("profiles").update({ name, role }).eq("id", data.user.id);
  redirect("/setup?ok=Account+created");
}

async function toggleUser(formData: FormData) {
  "use server";
  const me = await requireAdmin();
  const id = String(formData.get("id"));
  if (id === me.id) redirect("/setup");
  const supabase = await supabaseServer();
  const { data: target } = await supabase.from("profiles").select("active").eq("id", id).single();
  if (target) await supabase.from("profiles").update({ active: !target.active }).eq("id", id);
  redirect("/setup?ok=Account+updated");
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const supabase = await supabaseServer();

  const [{ data: floors }, { data: users }] = await Promise.all([
    supabase.from("floors").select("*").order("sort").order("name"),
    supabase.from("profiles").select("*").order("role").order("name"),
  ]);

  return (
    <>
      <AppHeader user={user} active="/setup" />
      <main className="wrap">
        <h1>Setup</h1>
        {sp.ok && <div className="flash ok">{sp.ok}</div>}
        {sp.err && <div className="flash err">{sp.err}</div>}

        <div className="grid c2" style={{ marginTop: 14 }}>
          <div className="card" style={{ margin: 0 }}>
            <h2>Floors</h2>
            <div className="tablewrap"><table>
              <tbody>
                {(floors ?? []).map(f => (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td className="r">
                      <form action={deleteFloor} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={f.id} />
                        <button className="btn ghost small">Remove</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <form action={addFloor} style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input type="text" name="floor_name" placeholder="e.g. Third floor" />
              <button className="btn">Add</button>
            </form>
          </div>

        </div>

        <div className="card">
          <h2>Team accounts</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Staff accounts only see the Collect page — no totals, dashboards, or reports.
          </p>
          <div className="tablewrap"><table>
            <thead>
              <tr><th>Name</th><th>Role</th><th className="r" /></tr>
            </thead>
            <tbody>
              {(users ?? []).map(x => (
                <tr key={x.id}>
                  <td>
                    {x.name}
                    {!x.active && <> <span className="badge off">disabled</span></>}
                  </td>
                  <td>{x.role}</td>
                  <td className="r">
                    {x.id !== user.id ? (
                      <form action={toggleUser} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={x.id} />
                        <button className="btn ghost small">{x.active ? "Disable" : "Enable"}</button>
                      </form>
                    ) : (
                      <span className="muted">you</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <form action={createUser} style={{ marginTop: 14 }}>
            <div className="frow">
              <div className="field"><label>Full name</label><input type="text" name="u_name" placeholder="Imran Ali" /></div>
              <div className="field"><label>Email (their login)</label><input type="email" name="u_email" placeholder="imran@example.com" /></div>
            </div>
            <div className="frow">
              <div className="field"><label>Password (min 6 characters)</label><input type="password" name="u_password" /></div>
              <div className="field">
                <label>Role</label>
                <select name="u_role">
                  <option value="staff">Staff — collect only</option>
                  <option value="admin">Admin — full access</option>
                </select>
              </div>
            </div>
            <button className="btn">Create account</button>
          </form>
        </div>
      </main>
      <footer className="wrap foot muted">MallPay maintenance collection</footer>
    </>
  );
}
