import Link from "next/link";
import type { NavItem } from "./AppShell";
import BrandLogo from "./BrandLogo";

export default function Sidebar({ items, active }: { items: NavItem[]; active: string }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <BrandLogo height={72} />
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
