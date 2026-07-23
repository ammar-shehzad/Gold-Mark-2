import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import type { Profile } from "@/lib/auth";
import { SearchIcon, LogoutIcon } from "./icons";
import ThemeToggle from "./ThemeToggle";

async function signOut() {
  "use server";
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}

export default function Topbar({ user, title }: { user: Profile; title: string }) {
  return (
    <header className="topbar">
      <h1 className="topbar-title">{title}</h1>
      <form className="topbar-search" action="/shops" method="get">
        <SearchIcon size={16} className="topbar-search-icon" />
        <input type="text" name="q" placeholder="Search shops, owners…" />
      </form>
      <div className="topbar-actions">
        <ThemeToggle />
        <div className="topbar-user">
          <span className="topbar-avatar" aria-hidden="true">{user.name.charAt(0).toUpperCase()}</span>
          <span className="topbar-user-name">
            {user.name}
            {user.role !== "admin" ? <span className="muted"> · {user.role}</span> : null}
          </span>
          <form action={signOut}>
            <button className="btn ghost small logout-btn" aria-label="Log out">
              <LogoutIcon size={15} />
              <span className="logout-btn-label">Log out</span>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
