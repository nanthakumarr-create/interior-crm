"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { needsBootstrap } from "@/lib/auth";
import { createSupabaseAdmin, createSupabaseServer } from "@/lib/supabase/server";

export type FormState = { error?: string } | undefined;

const SignIn = z.object({ email: z.email(), password: z.string().min(1) });

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const parsed = SignIn.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter your email and password." };
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Wrong email or password." };
  redirect("/");
}

const Bootstrap = z.object({
  full_name: z.string().trim().min(2),
  email: z.email(),
  password: z.string().min(8),
});

/** Creates the first admin. Refuses once any team member exists. */
export async function createFirstAdmin(_: FormState, form: FormData): Promise<FormState> {
  const parsed = Bootstrap.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Name, a valid email and a password of 8+ characters are required." };
  if (!(await needsBootstrap())) return { error: "An admin already exists. Ask them to add you." };
  // The site is public: only the configured owner may claim the first admin account
  const owner = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!owner || parsed.data.email.trim().toLowerCase() !== owner) {
    return { error: "Only the studio owner's email can create the first admin account." };
  }

  const admin = createSupabaseAdmin();
  const { email, password, full_name } = parsed.data;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) return { error: error?.message ?? "Could not create the account." };
  const { error: memberError } = await admin.from("team_members").insert({ id: data.user.id, full_name, role: "admin" });
  if (memberError) return { error: memberError.message };

  const supabase = await createSupabaseServer();
  await supabase.auth.signInWithPassword({ email, password });
  redirect("/");
}

export async function signOut() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
