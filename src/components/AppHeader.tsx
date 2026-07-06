import Link from "next/link";
import { MALL_NAME } from "@/lib/util";
import type { Profile } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

async function signOut() {
  "use server";
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}

export default function AppHeader({ user, active }: { user: Profile; active: string }) {
  const items =
    user.role === "admin"
      ? [
          ["/", "Dashboard"],
          ["/shops", "Shops"],
          ["/collect", "Collect"],
          ["/report", "Reports"],
          ["/setup", "Setup"],
        ]
      : [["/collect", "Collect"]];
  return (
    <header className="top">
      <div className="wrap bar">
        <div className="brand">
          <span className="mark">{MALL_NAME.charAt(0).toUpperCase()}</span>
          <span>{MALL_NAME}</span>
        </div>
        <nav className="nav">
          {items.map(([href, label]) => (
            <Link key={href} href={href} className={active === href ? "on" : ""}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="who">
          <span className="muted">
            {user.name}
            {user.role === "staff" ? " · staff" : ""}
          </span>
          <form action={signOut}>
            <button className="btn ghost small">Log out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
