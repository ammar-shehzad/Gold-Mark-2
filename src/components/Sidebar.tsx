import Link from "next/link";
import { MALL_NAME } from "@/lib/util";
import type { NavItem } from "./AppShell";

export default function Sidebar({ items, active }: { items: NavItem[]; active: string }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="mark">{MALL_NAME.charAt(0).toUpperCase()}</span>
        <span className="sidebar-brand-name">{MALL_NAME}</span>
      </div>
      <nav className="sidebar-nav">
        {items.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={"sidebar-item" + (active === href ? " on" : "")}>
            <Icon size={18} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
