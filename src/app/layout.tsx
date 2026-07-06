import type { Metadata } from "next";
import { MALL_NAME } from "@/lib/util";
import "./globals.css";

export const metadata: Metadata = {
  title: MALL_NAME + " — Maintenance",
  description: "Mall maintenance collection system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
