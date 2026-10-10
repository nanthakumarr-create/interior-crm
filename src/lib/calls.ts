import "server-only";
import { getCurrentMember } from "@/lib/auth";
import type { CallRow } from "@/lib/crm";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Calls in the window, newest first. Demo rows (seeded transcripts) only when asked for. */
export async function listCalls(opts: { days: number; demo: boolean; route?: string }) {
  await getCurrentMember();
  const supabase = await createSupabaseServer();
  let q = supabase
    .from("calls")
    .select(
      "id, vaani_call_id, phone, caller_name, started_at, after_hours, project_type, locality, carpet_area_sqft, scope, route, route_mismatch, booking_at, alert_sent_at, ended_at, voice_seconds, ai_cost_inr, voice_cost_inr, end_reason, processing_error, is_test, created_at",
    )
    .eq("is_test", opts.demo)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(500);
  // Demo data is from September 2026, so don't apply the rolling window to it
  if (!opts.demo) q = q.gte("created_at", new Date(Date.now() - opts.days * 86_400_000).toISOString());
  if (opts.route) q = q.eq("route", opts.route);
  const { data, error } = await q;
  if (error) throw error;
  return data as CallRow[];
}

export async function getCall(id: string) {
  await getCurrentMember();
  const supabase = await createSupabaseServer();
  const { data } = await supabase.from("calls").select("*").eq("id", id).maybeSingle();
  return data as CallRow | null;
}

export function parseView(sp: Record<string, string | string[] | undefined>) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const days = Number(one(sp.days)) || 30;
  return { days: [7, 30, 90].includes(days) ? days : 30, demo: one(sp.demo) === "1", route: one(sp.route) };
}
