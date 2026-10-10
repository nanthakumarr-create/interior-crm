import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-agnostic (interior_crm client)
type Db = SupabaseClient<any, any, any>;
import { normalizePhone, type CallRow } from "@/lib/crm";
import { aiCostInr, voiceCostInr } from "@/lib/costs";
import { geminiConfigured, triageCall } from "@/lib/integrations/gemini";
import { createContactAndDeal } from "@/lib/integrations/hubspot";
import { escapeHtml, notifyTeam } from "@/lib/integrations/telegram";
import type { VaaniWebhook } from "@/lib/integrations/vaani";
import { CRITERIA, CRITERION_LABEL, FORWARDED, ROUTE_LABEL, ROUTES, isAfterHours, type Route } from "@/lib/route";

const appUrl = (path: string) => `${process.env.NEXT_PUBLIC_APP_URL ?? ""}${path}`;

/** Case-insensitive lookup over Vaani's extracted entities / dispositions. */
function pick(obj: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!obj) return null;
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

/**
 * Entry point for every Vaani webhook. Lifecycle events just keep the call row current;
 * `call_postprocessing` runs the triage → route → handoffs pipeline exactly once per call.
 */
export async function handleVaaniEvent(db: Db, payload: VaaniWebhook, opts: { isTest?: boolean; notify?: boolean } = {}) {
  const data = payload.data ?? {};
  const callId = payload.call_id ?? data.call_id;
  if (!callId) return { ignored: "no call_id" };

  const { data: existing } = await db
    .from("calls")
    .select("id, phone, started_at, route, processing_error")
    .eq("vaani_call_id", callId)
    .maybeSingle();
  const eventPhone = normalizePhone(payload.phone_number ?? data.phone_number);
  const eventAt = payload.timestamp ? new Date(payload.timestamp) : new Date();

  if (payload.event !== "call_postprocessing") {
    await db.from("calls").upsert(
      {
        ...(existing ? { id: existing.id } : { direction: "inbound", is_test: Boolean(opts.isTest) }),
        vaani_call_id: callId,
        status: payload.event,
        ...(eventPhone ? { phone: eventPhone } : {}),
        ...(payload.event === "call_started" ? { started_at: eventAt.toISOString(), after_hours: isAfterHours(eventAt) } : {}),
        ...(data.end_reason ? { end_reason: data.end_reason } : {}),
      },
      { onConflict: "vaani_call_id" },
    );
    return { updated: payload.event };
  }

  // Vaani retries failed deliveries; never triage or alert twice
  if (existing?.route && !existing.processing_error) return { duplicate: true, route: existing.route };

  const voiceSeconds = data.call_duration != null ? Math.round(data.call_duration / 1000) : null;
  const endedAt = eventAt;
  const startedAt = existing?.started_at
    ? new Date(existing.started_at)
    : new Date(endedAt.getTime() - (voiceSeconds ?? 0) * 1000);
  const entities = data.entities ?? null;
  const phone = existing?.phone ?? eventPhone ?? normalizePhone(pick(entities, "phone", "phone_number", "mobile"));
  const agentRoute = pick(data.dispositions, "route", "outcome", "disposition");

  const base: Record<string, unknown> = {
    ...(existing ? { id: existing.id } : { direction: "inbound", is_test: Boolean(opts.isTest) }),
    vaani_call_id: callId,
    phone,
    status: "completed",
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    after_hours: isAfterHours(startedAt),
    voice_seconds: voiceSeconds,
    voice_cost_inr: voiceSeconds != null ? voiceCostInr(voiceSeconds) : null,
    end_reason: data.end_reason ?? null,
    summary: data.summary ?? null,
    transcript: data.transcript ?? null,
    recording_url: data.recording_url ?? null,
    entities,
    dispositions: data.dispositions ?? null,
    agent_route: agentRoute,
    booking_at: parseDate(pick(entities, "booking_time", "consultation_time", "consultation_slot", "booked_slot")),
    raw: payload,
  };
  const { data: saved, error: saveError } = await db
    .from("calls")
    .upsert(base, { onConflict: "vaani_call_id" })
    .select()
    .single();
  if (saveError) throw saveError;
  const call = saved as CallRow;

  if (!geminiConfigured()) {
    await db.from("calls").update({ processing_error: "GEMINI_API_KEY not set" }).eq("id", call.id);
    return { callId: call.id, error: "gemini not configured" };
  }

  let triaged;
  try {
    const callText = [
      `Call · ${startedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" })}` +
        (voiceSeconds != null ? ` · ${voiceSeconds}s` : ""),
      phone && `Caller number: ${phone}`,
      data.summary && `Agent's summary: ${data.summary}`,
      entities && `Fields the agent captured: ${JSON.stringify(entities)}`,
      data.transcript ? `Transcript:\n${data.transcript.slice(0, 40_000)}` : "No transcript (call may have dropped).",
    ]
      .filter(Boolean)
      .join("\n\n");
    triaged = await triageCall(callText);
  } catch (e) {
    await db.from("calls").update({ processing_error: String(e).slice(0, 500) }).eq("id", call.id);
    throw e;
  }
  const { triage, usage } = triaged;
  // Seeded demo calls never reach HubSpot or Telegram
  const notify = opts.notify ?? !opts.isTest;

  const normalizedAgentRoute = agentRoute && (ROUTES as readonly string[]).includes(agentRoute) ? agentRoute : null;
  const callerName = triage.caller_name ?? pick(entities, "name", "caller_name", "customer_name");
  const update = {
    caller_name: callerName,
    project_type: triage.project_type,
    locality: triage.locality,
    carpet_area_sqft: triage.carpet_area_sqft,
    scope: triage.scope,
    completion_by: triage.completion_by,
    decision_maker: triage.decision_maker,
    budget_volunteered: triage.budget_volunteered,
    criteria: triage.criteria,
    route: triage.route,
    route_mismatch: normalizedAgentRoute != null && normalizedAgentRoute !== triage.route,
    follow_up_question: triage.follow_up_question,
    handoff_note: triage.handoff_note,
    ai_input_tokens: usage.inputTokens,
    ai_output_tokens: usage.outputTokens,
    ai_cost_inr: aiCostInr(usage.inputTokens, usage.outputTokens),
    processing_error: null,
  };
  await db.from("calls").update(update).eq("id", call.id);
  const full = { ...call, ...update } as CallRow;

  // Contact record per phone number (repeat callers link to the same lead)
  if (phone && triage.route !== "not_enquiry") {
    const { data: lead } = await db
      .from("leads")
      .upsert(
        { phone, name: callerName ?? phone, source: "vaani_call", locality: triage.locality, scope: triage.scope },
        { onConflict: "phone", ignoreDuplicates: false },
      )
      .select("id, hubspot_contact_id")
      .single();
    if (lead) {
      await db.from("calls").update({ lead_id: lead.id }).eq("id", call.id);
      if (notify && FORWARDED.includes(triage.route) && !lead.hubspot_contact_id) {
        try {
          const hs = await createContactAndDeal({
            name: callerName ?? phone,
            phone,
            locality: triage.locality,
            dealName: `${callerName ?? phone} · ${triage.scope ?? "Interior project"}`.slice(0, 200),
            note: triage.handoff_note,
          });
          if (hs) {
            await db.from("calls").update({ hubspot_contact_id: hs.contactId, hubspot_deal_id: hs.dealId }).eq("id", call.id);
            await db.from("leads").update({ hubspot_contact_id: hs.contactId, hubspot_deal_id: hs.dealId }).eq("id", lead.id);
          }
        } catch (e) {
          console.error("HubSpot sync failed", e);
        }
      }
    }
  }

  // Telegram: designer handoff, urgent complaint, or a front-desk follow-up
  if (notify && (FORWARDED.includes(triage.route) || triage.route === "escalate" || triage.route === "follow_up")) {
    const sent = await notifyTeam(telegramMessage(full)).catch((e) => {
      console.error("Telegram notify failed", e);
      return { skipped: false as const, ok: false };
    });
    if (!sent.skipped && sent.ok) {
      await db.from("calls").update({ alert_sent_at: new Date().toISOString() }).eq("id", call.id);
    }
  }

  return { callId: call.id, route: triage.route };
}

function parseDate(v: string | null) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const ROUTE_ICON: Record<Route, string> = {
  qualified: "✅",
  qualified_flagged: "✅⚑",
  follow_up: "❓",
  closed: "⛔",
  escalate: "🚨",
  not_enquiry: "·",
};

export function telegramMessage(c: CallRow) {
  const route = c.route ?? "not_enquiry";
  const title =
    route === "escalate"
      ? "URGENT · existing client complaint"
      : route === "follow_up"
        ? "Follow-up needed · one question"
        : `New ${route === "qualified_flagged" ? "lead (flagged)" : "qualified lead"}`;
  const flags =
    c.criteria &&
    CRITERIA.filter((k) => c.criteria![k]?.status !== "pass").map(
      (k) => `⚑ ${CRITERION_LABEL[k]}: ${c.criteria![k].status} – ${c.criteria![k].evidence}`,
    );
  const when = c.booking_at
    ? new Date(c.booking_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : null;
  return [
    `${ROUTE_ICON[route]} <b>${escapeHtml(title)}</b>${c.after_hours ? " · after hours" : ""}`,
    `<b>${escapeHtml(c.caller_name ?? "Unknown caller")}</b>${c.phone ? ` · ${escapeHtml(c.phone)}` : ""}`,
    [c.project_type, c.locality, c.carpet_area_sqft && `${c.carpet_area_sqft} sq ft`].filter(Boolean).join(" · ") &&
      escapeHtml([c.project_type, c.locality, c.carpet_area_sqft && `${c.carpet_area_sqft} sq ft`].filter(Boolean).join(" · ")),
    c.scope && `Scope: ${escapeHtml(c.scope)}`,
    c.completion_by && `Timeline: ${escapeHtml(c.completion_by)}`,
    c.decision_maker && `Decides: ${escapeHtml(c.decision_maker)}`,
    when ? `📅 Consultation: ${escapeHtml(when)}` : FORWARDED.includes(route) ? "📅 Not booked yet: call to book" : null,
    route === "follow_up" && c.follow_up_question && `Ask: ${escapeHtml(c.follow_up_question)}`,
    "",
    escapeHtml(c.handoff_note ?? ""),
    ...(route !== "escalate" && flags?.length ? ["", ...flags.map(escapeHtml)] : []),
    "",
    `<a href="${appUrl(`/calls/${c.id}`)}">Transcript &amp; details</a> · ${ROUTE_LABEL[route]}`,
  ]
    .filter((l) => l !== null && l !== false && l !== undefined)
    .join("\n");
}
