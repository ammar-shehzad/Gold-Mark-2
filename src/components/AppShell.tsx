import type { ComponentType } from "react";
import type { Profile } from "@/lib/auth";
import { MALL_NAME } from "@/lib/util";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import BottomNav from "./BottomNav";
import {
  DashboardIcon,
  ShopIcon,
  CollectIcon,
  ReportIcon,
  SetupIcon,
  OwnersIcon,
  ComplaintIcon,
  NoticeIcon,
  MoneyIcon,
  UserIcon,
  ChatIcon,
  SheetIcon,
} from "./icons";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
};

const ADMIN_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: DashboardIcon },
  { href: "/shops", label: "Shops", icon: ShopIcon },
  { href: "/collect", label: "Collect", icon: CollectIcon },
  { href: "/payments", label: "Payments", icon: MoneyIcon },
  { href: "/owners", label: "Owners", icon: OwnersIcon },
  { href: "/complaints", label: "Complaints", icon: ComplaintIcon },
  { href: "/notices", label: "Notices", icon: NoticeIcon },
  { href: "/whatsapp", label: "WhatsApp", icon: ChatIcon },
  { href: "/report", label: "Reports", icon: ReportIcon },
  { href: "/google-sheets", label: "Google Sheets", icon: SheetIcon },
  { href: "/setup", label: "Setup", icon: SetupIcon },
];
const COLLECTOR_STAFF_ITEMS: NavItem[] = [{ href: "/collect", label: "Collect", icon: CollectIcon }];
const DEPARTMENT_STAFF_ITEMS: NavItem[] = [{ href: "/complaints", label: "Complaints", icon: ComplaintIcon }];
const OWNER_ITEMS: NavItem[] = [
  { href: "/owner", label: "Invoices", icon: MoneyIcon },
  { href: "/owner/complaints", label: "Complaints", icon: ComplaintIcon },
  { href: "/owner/notices", label: "Notices", icon: NoticeIcon },
  { href: "/owner/profile", label: "Profile", icon: UserIcon },
];

export default function AppShell({
  user,
  active,
  children,
}: {
  user: Profile;
  active: string;
  children: React.ReactNode;
}) {
  const items =
    user.role === "admin"
      ? ADMIN_ITEMS
      : user.role === "staff"
        ? user.staff_type === "department"
          ? DEPARTMENT_STAFF_ITEMS
          : COLLECTOR_STAFF_ITEMS
        : OWNER_ITEMS;
  const title = items.find((i) => i.href === active)?.label ?? "Dashboard";

  return (
    <div className="shell">
      <Sidebar items={items} active={active} />
      <div className="shell-main">
        <Topbar user={user} title={title} />
        <main className="page">{children}</main>
        <footer className="page-foot muted">{MALL_NAME} maintenance collection</footer>
      </div>
      <BottomNav items={items} active={active} />
    </div>
  );
}
