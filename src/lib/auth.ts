import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  name: string;
  role: "admin" | "staff" | "owner";
  active: boolean;
  staff_type?: "collector" | "department" | null;
  department?: string | null;
};

export async function requireUser(): Promise<Profile> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles").select("*").eq("id", user.id).single();
  if (!profile || !profile.active) redirect("/login");
  return profile as Profile;
}

export async function requireAdmin(): Promise<Profile> {
  const p = await requireUser();
  if (p.role !== "admin") redirect("/collect");
  return p;
}

export async function requireStaff(): Promise<Profile> {
  const p = await requireUser();
  if (p.role !== "admin" && p.role !== "staff") redirect("/");
  return p;
}

export async function requireOwner(): Promise<Profile> {
  const p = await requireUser();
  if (p.role !== "owner") redirect("/");
  return p;
}
