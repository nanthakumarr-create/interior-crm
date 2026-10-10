import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "@/lib/crm";
import { createSupabaseAdmin } from "@/lib/supabase/server";

// Cal.com → CRM. The Vaani agent books through its Cal.com integration during the call;
// this webhook (Cal.com → Settings → Developer → Webhooks, event BOOKING_CREATED) attaches
// the booking to the caller's most recent call so the dashboard counts it.
export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  const sig = request.headers.get("x-cal-signature-256") ?? "";
  if (!secret) return Response.json({ error: "not configured" }, { status: 503 });
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(raw);
  if (body.triggerEvent !== "BOOKING_CREATED" && body.triggerEvent !== "BOOKING_RESCHEDULED") {
    return Response.json({ ignored: body.triggerEvent });
  }
  const p = body.payload ?? {};
  const phone = normalizePhone(
    p.responses?.attendeePhoneNumber?.value ??
      p.responses?.phone?.value ??
      p.attendees?.[0]?.phoneNumber ??
      p.smsReminderNumber ??
      null,
  );
  if (!phone) return Response.json({ ignored: "no phone on booking" });

  const db = createSupabaseAdmin();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: call } = await db
    .from("calls")
    .select("id")
    .eq("phone", phone)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!call) return Response.json({ ignored: "no recent call for this number" });

  await db
    .from("calls")
    .update({ booking_at: p.startTime ?? null, booking_ref: p.uid ?? null })
    .eq("id", call.id);
  return Response.json({ ok: true, callId: call.id });
}
