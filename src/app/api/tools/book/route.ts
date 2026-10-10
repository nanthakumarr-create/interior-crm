import { z } from "zod";
import { normalizePhone } from "@/lib/crm";
import { busyIntervals, calendarConfigured, createEvent } from "@/lib/integrations/google-calendar";
import { CONSULT_MINUTES, isValidSlot, speakable } from "@/lib/slots";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { toolAuthorized, toolArgs } from "@/lib/tool-auth";

const Args = z.object({
  start_iso: z.string(),
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  consultation_type: z.enum(["site_visit", "studio"]).optional().nullable(),
  locality: z.string().optional().nullable(),
  scope: z.string().optional().nullable(),
});

// Vaani tool "book_consultation": books the slot the caller chose into the studio's Google Calendar.
export async function POST(request: Request) {
  if (!toolAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Args.safeParse(await toolArgs(request));
  if (!parsed.success) {
    return Response.json({ booked: false, message: "Missing the slot or the caller's name. Ask for it and try again." });
  }
  const a = parsed.data;
  const start = new Date(a.start_iso);
  const now = new Date();
  if (Number.isNaN(start.getTime()) || !isValidSlot(start, now)) {
    return Response.json({ booked: false, message: "That time is not one of the offered slots. Check slots again and offer those." });
  }
  if (!calendarConfigured()) {
    return Response.json({ booked: false, message: "Calendar unavailable. Tell the caller a designer will call within the hour to confirm a time." });
  }
  const end = new Date(start.getTime() + CONSULT_MINUTES * 60_000);
  const busy = await busyIntervals(start, end);
  if (busy.length) {
    return Response.json({ booked: false, message: "That slot was just taken. Check slots again and offer another." });
  }

  const phone = normalizePhone(a.phone);
  const kind = a.consultation_type === "studio" ? "Studio consultation" : "Site visit";
  const event = await createEvent({
    summary: `${kind}: ${a.name}${a.locality ? ` (${a.locality})` : ""}`,
    description: [`Booked by the Aangan voice agent.`, phone && `Phone: ${phone}`, a.scope && `Scope: ${a.scope}`]
      .filter(Boolean)
      .join("\n"),
    location: a.consultation_type === "studio" ? "Aangan Studio" : (a.locality ?? undefined),
    start,
    end,
  });

  // Attach to the caller's in-progress call (created by Vaani's call_started webhook)
  if (phone) {
    const db = createSupabaseAdmin();
    const { data: call } = await db
      .from("calls")
      .select("id")
      .eq("phone", phone)
      .gte("created_at", new Date(now.getTime() - 2 * 3600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (call) await db.from("calls").update({ booking_at: start.toISOString(), booking_ref: event.id }).eq("id", call.id);
  }

  return Response.json({
    booked: true,
    start_iso: start.toISOString(),
    message: `Booked: ${kind.toLowerCase()} on ${speakable(start)}. Confirm this back to the caller.`,
  });
}
