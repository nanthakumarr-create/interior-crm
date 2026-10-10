import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseAdmin, createSupabaseServer } from "@/lib/supabase/server";

export type TeamRole = "admin" | "sales" | "designer";
export type Member = { id: string; full_name: string; role: TeamRole; email: string };

/** Data access layer entry point: the signed-in team member, or a redirect to /login. */
export async function getCurrentMember(): Promise<Member> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("team_members")
    .select("id, full_name, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!member) redirect("/login?error=not_member");

  return { ...member, email: user.email ?? "" } as Member;
}

export async function requireAdmin() {
  const member = await getCurrentMember();
  if (member.role !== "admin") redirect("/");
  return member;
}

/** True until the first admin account exists. */
export async function needsBootstrap() {
  const { count } = await createSupabaseAdmin().from("team_members").select("id", { count: "exact", head: true });
  return (count ?? 0) === 0;
}
