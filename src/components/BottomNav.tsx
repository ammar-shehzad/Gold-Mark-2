import Link from "next/link";
import type { NavItem } from "./AppShell";
import MoreSheet from "./MoreSheet";

const MAX_PRIMARY = 4;

export default function BottomNav({ items, active }: { items: NavItem[]; active: string }) {
  const overflowing = items.length > MAX_PRIMARY + 1;
  const primary = overflowing ? items.slice(0, MAX_PRIMARY) : items;
  const rest = overflowing ? items.slice(MAX_PRIMARY) : [];

  return (
    <nav className="bottom-nav">
      {primary.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className={"bottom-nav-item" + (active === href ? " on" : "")}>
          <Icon size={17} />
          <span>{label}</span>
        </Link>
      ))}
      {rest.length > 0 && (
        <MoreSheet
          items={rest.map(({ href, label, icon: Icon }) => ({ href, label, icon: <Icon size={22} /> }))}
          active={active}
        />
      )}
    </nav>
  );
}
