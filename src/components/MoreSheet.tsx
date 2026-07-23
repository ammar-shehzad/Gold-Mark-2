"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { MenuIcon } from "./icons";

type SheetItem = { href: string; label: string; icon: ReactNode };

export default function MoreSheet({ items, active }: { items: SheetItem[]; active: string }) {
  const [open, setOpen] = useState(false);
  const isActive = items.some((i) => i.href === active);

  return (
    <>
      <button
        type="button"
        className={"bottom-nav-item" + (isActive ? " on" : "")}
        onClick={() => setOpen(true)}
      >
        <MenuIcon size={17} />
        <span>More</span>
      </button>
      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-grid">
              {items.map(({ href, label, icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={"sheet-item" + (active === href ? " on" : "")}
                  onClick={() => setOpen(false)}
                >
                  <span className="sheet-item-icon">{icon}</span>
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
