"use client";

import { useEffect, useState } from "react";
import { SunIcon, MoonIcon } from "./icons";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button type="button" className="icon-btn" aria-label="Toggle theme" onClick={toggle}>
      {dark ? <SunIcon size={18} /> : <MoonIcon size={18} />}
    </button>
  );
}
