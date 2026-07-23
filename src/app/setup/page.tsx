import AppShell from "@/components/AppShell";
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
  if ((count ?? 0) > 0) redirect("/setup?err=That+floor+has+shops+on+it+-+move+them+first");
  await supabase.from("floors").delete().eq("id", id);
  redirect("/setup?ok=Floor+removed");
}

async function addDepartment(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("department_name") || "").trim();
  if (name) {
    const supabase = await supabaseServer();
    const { error } = await supabase.from("mallpay_departments").insert({ name });
    if (error) redirect("/setup?err=That+department+already+exists");
  }
  redirect("/setup?ok=Department+added");
}

async function deleteDepartment(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") || "");
  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("department", name)
    .eq("active", true);
  if ((count ?? 0) > 0) redirect("/setup?err=That+department+has+active+staff+-+reassign+them+first");
  await supabase.from("mallpay_departments").delete().eq("id", id);
  redirect("/setup?ok=Department+removed");
}

async function createAdmin(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("a_name") || "").trim();
  const email = String(formData.get("a_email") || "").trim();
  const password = String(formData.get("a_password") || "");
  if (!name || !email || password.length < 6) {
    redirect("/setup?err=Admin+needs+a+name,+email,+and+a+password+of+at+least+6+characters");
  }
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name },
  });
  if (error || !data.user) redirect("/setup?err=Could+not+create+the+account+-+is+the+email+already+used%3F");
  await admin.from("profiles").update({ name, role: "admin" }).eq("id", data.user.id);
  redirect("/setup?ok=Admin+account+created");
}

async function createCollectionStaff(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("c_name") || "").trim();
  const email = String(formData.get("c_email") || "").trim();
  const password = String(formData.get("c_password") || "");
  if (!name || !email || password.length < 6) {
    redirect("/setup?err=Staff+needs+a+name,+email,+and+a+password+of+at+least+6+characters");
  }
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name },
  });
  if (error || !data.user) redirect("/setup?err=Could+not+create+the+account+-+is+the+email+already+used%3F");
  await admin.from("profiles").update({ name, role: "staff", staff_type: "collector", department: null }).eq("id", data.user.id);
  redirect("/setup?ok=Collection+staff+account+created");
}

async function createDepartmentStaff(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("d_name") || "").trim();
  const email = String(formData.get("d_email") || "").trim();
  const password = String(formData.get("d_password") || "");
  const department = String(formData.get("d_department") || "").trim() || null;
  const whatsapp = String(formData.get("d_whatsapp") || "").trim() || null;
  if (!name || !email || password.length < 6) {
    redirect("/setup?err=Staff+needs+a+name,+email,+and+a+password+of+at+least+6+characters");
  }
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name },
  });
  if (error || !data.user) redirect("/setup?err=Could+not+create+the+account+-+is+the+email+already+used%3F");
  await admin
    .from("profiles")
    .update({ name, role: "staff", staff_type: "department", department, whatsapp_number: whatsapp })
    .eq("id", data.user.id);
  redirect("/setup?ok=Department+staff+account+created");
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

async function savePaymentDetails(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = await supabaseServer();
  await supabase
    .from("mall_settings")
    .update({
      bank_name: String(formData.get("bank_name") || "").trim() || null,
      bank_account_title: String(formData.get("bank_account_title") || "").trim() || null,
      bank_account_number: String(formData.get("bank_account_number") || "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  redirect("/setup?ok=Payment+details+saved");
}

type Person = {
  id: string; name: string; role: string; active: boolean;
  department: string | null; staff_type: string | null; whatsapp_number: string | null;
};

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const supabase = await supabaseServer();

  const [{ data: floors }, { data: departments }, { data: users }, { data: settings }] = await Promise.all([
    supabase.from("floors").select("*").order("sort").order("name"),
    supabase.from("mallpay_departments").select("*").order("name"),
    supabase.from("profiles").select("*").neq("role", "owner").order("name"),
    supabase.from("mall_settings").select("*").single(),
  ]);

  const allUsers = (users ?? []) as unknown as Person[];
  const admins = allUsers.filter((u) => u.role === "admin");
  const collectionStaff = allUsers.filter((u) => u.role === "staff" && u.staff_type !== "department");
  const departmentStaff = allUsers.filter((u) => u.role === "staff" && u.staff_type === "department");

  const renderToggle = (x: Person) => (
    x.id !== user.id ? (
      <form action={toggleUser} style={{ display: "inline" }}>
        <input type="hidden" name="id" value={x.id} />
        <button className="btn ghost small">{x.active ? "Disable" : "Enable"}</button>
      </form>
    ) : (
      <span className="muted">you</span>
    )
  );

  return (
    <AppShell user={user} active="/setup">
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

          <div className="card" style={{ margin: 0 }}>
            <h2>Departments</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Complaints are routed to staff by department. Add as many as you need.
            </p>
            <div className="tablewrap"><table>
              <tbody>
                {(departments ?? []).map(d => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td className="r">
                      <form action={deleteDepartment} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="name" value={d.name} />
                        <button className="btn ghost small">Remove</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <form action={addDepartment} style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input type="text" name="department_name" placeholder="e.g. HVAC" />
              <button className="btn">Add</button>
            </form>
          </div>
        </div>

        <div className="card">
          <h2>Admins</h2>
          <div className="tablewrap"><table>
            <thead><tr><th>Name</th><th className="r" /></tr></thead>
            <tbody>
              {admins.map(x => (
                <tr key={x.id}>
                  <td>{x.name}{!x.active && <> <span className="badge off">disabled</span></>}</td>
                  <td className="r">{renderToggle(x)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <form action={createAdmin} style={{ marginTop: 14 }}>
            <div className="frow">
              <div className="field"><label>Full name</label><input type="text" name="a_name" placeholder="Imran Ali" /></div>
              <div className="field"><label>Email (their login)</label><input type="email" name="a_email" placeholder="imran@example.com" /></div>
            </div>
            <div className="field"><label>Password (min 6 characters)</label><input type="password" name="a_password" /></div>
            <button className="btn">Create admin account</button>
          </form>
        </div>

        <div className="card">
          <h2>Collection staff</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Only see the Collect page - mark maintenance payments as collected. No totals, dashboards, complaints, or reports.
          </p>
          <div className="tablewrap"><table>
            <thead><tr><th>Name</th><th className="r" /></tr></thead>
            <tbody>
              {collectionStaff.map(x => (
                <tr key={x.id}>
                  <td>{x.name}{!x.active && <> <span className="badge off">disabled</span></>}</td>
                  <td className="r">{renderToggle(x)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <form action={createCollectionStaff} style={{ marginTop: 14 }}>
            <div className="frow">
              <div className="field"><label>Full name</label><input type="text" name="c_name" placeholder="Rizwan Malik" /></div>
              <div className="field"><label>Email (their login)</label><input type="email" name="c_email" placeholder="rizwan@example.com" /></div>
            </div>
            <div className="field"><label>Password (min 6 characters)</label><input type="password" name="c_password" /></div>
            <button className="btn">Create collection staff account</button>
          </form>
        </div>

        <div className="card">
          <h2>Department staff</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Only see complaints for their own department - never the Collect page or payment ledger.
          </p>
          <div className="tablewrap"><table>
            <thead><tr><th>Name</th><th>Department</th><th>WhatsApp</th><th className="r" /></tr></thead>
            <tbody>
              {departmentStaff.map(x => (
                <tr key={x.id}>
                  <td>{x.name}{!x.active && <> <span className="badge off">disabled</span></>}</td>
                  <td>{x.department ?? <span className="muted">-</span>}</td>
                  <td>{x.whatsapp_number ?? <span className="muted">-</span>}</td>
                  <td className="r">{renderToggle(x)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <form action={createDepartmentStaff} style={{ marginTop: 14 }}>
            <div className="frow">
              <div className="field"><label>Full name</label><input type="text" name="d_name" placeholder="Ali Raza" /></div>
              <div className="field"><label>Email (their login)</label><input type="email" name="d_email" placeholder="ali@example.com" /></div>
            </div>
            <div className="frow">
              <div className="field"><label>Password (min 6 characters)</label><input type="password" name="d_password" /></div>
              <div className="field">
                <label>Department</label>
                <select name="d_department">
                  {(departments ?? []).map(d => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field"><label>WhatsApp number <span className="muted">(for complaint alerts)</span></label><input type="text" name="d_whatsapp" placeholder="923001234567" /></div>
            <button className="btn">Create department staff account</button>
          </form>
        </div>

        <div className="card">
          <h2>Payment details</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Shown to shop owners so they can transfer maintenance payments manually.
          </p>
          <form action={savePaymentDetails}>
            <div className="frow">
              <div className="field"><label>Bank name</label><input type="text" name="bank_name" defaultValue={settings?.bank_name ?? ""} placeholder="Meezan Bank" /></div>
              <div className="field"><label>Account title</label><input type="text" name="bank_account_title" defaultValue={settings?.bank_account_title ?? ""} placeholder="Mall Management" /></div>
            </div>
            <div className="field"><label>Account number</label><input type="text" name="bank_account_number" defaultValue={settings?.bank_account_number ?? ""} placeholder="PK00XXXX0000000000000000" /></div>
            <button className="btn">Save payment details</button>
          </form>
        </div>
    </AppShell>
  );
}
