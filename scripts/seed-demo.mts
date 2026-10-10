// Loads the 20 September phone transcripts into the call log as demo rows (is_test = true)
// by running them through the real pipeline (Gemini triage + rules). No Telegram, no HubSpot.
// Usage: npm run seed:demo        (re-running skips calls that are already loaded)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { handleVaaniEvent } from "../src/lib/engine";

type Enquiry = { id: string; channel: string; header: string; text: string };

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  db: { schema: "interior_crm" },
  auth: { persistSession: false },
});

const MONTHS: Record<string, number> = { September: 8 };
const phones = readFileSync("seed/enquiries.json", "utf8");
const cases = (JSON.parse(phones) as Enquiry[]).filter((c) => c.channel === "phone");

for (const c of cases) {
  // "T05 · Phone · 5 September · 10:52am · 6 min 44 sec"
  const [, day, month, time] = c.header.match(/(\d+) (\w+) · (\d+:\d+[ap]m)/) ?? [];
  const [, hh, mm, ap] = time?.match(/(\d+):(\d+)([ap]m)/) ?? [];
  const hour24 = (Number(hh) % 12) + (ap === "pm" ? 12 : 0);
  const startIst = new Date(Date.UTC(2026, MONTHS[month] ?? 8, Number(day), hour24, Number(mm)) - 330 * 60_000);
  const mins = c.header.match(/(\d+) min (\d+) sec/);
  const seconds = mins ? Number(mins[1]) * 60 + Number(mins[2]) : 20;
  const callId = `demo-${c.id}`;
  const phone = `+9198000000${c.id.slice(1)}`;

  const { data: done } = await db.from("calls").select("id").eq("vaani_call_id", callId).not("route", "is", null).maybeSingle();
  if (done) {
    console.log(`${c.id} already loaded`);
    continue;
  }

  await handleVaaniEvent(db, { event: "call_started", call_id: callId, timestamp: startIst.toISOString(), phone_number: phone }, { isTest: true });
  const result = await handleVaaniEvent(
    db,
    {
      event: "call_postprocessing",
      call_id: callId,
      timestamp: new Date(startIst.getTime() + seconds * 1000).toISOString(),
      data: {
        call_id: callId,
        call_duration: seconds * 1000,
        end_reason: c.header.includes("MISSED") ? "no_answer" : "completed",
        transcript: c.text.replace(/^Front Desk:/gm, "AGENT:").replace(/^Caller:/gm, "USER:"),
      },
    },
    { isTest: true },
  );
  console.log(c.id, JSON.stringify(result));
}
