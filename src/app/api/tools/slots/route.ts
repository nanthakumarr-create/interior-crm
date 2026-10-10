import { busyIntervals, calendarConfigured } from "@/lib/integrations/google-calendar";
import { candidateSlots, freeSlots, pickOffer, speakable } from "@/lib/slots";
import { toolAuthorized } from "@/lib/tool-auth";

// Vaani tool "check_consultation_slots": the agent calls this mid-call and reads the options out.
export async function POST(request: Request) {
  if (!toolAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!calendarConfigured()) {
    return Response.json({
      slots: [],
      message: "The calendar is not available right now. Tell the caller a designer will call within the hour to fix a time.",
    });
  }
  const now = new Date();
  const candidates = candidateSlots(now, 7);
  const busy = await busyIntervals(now, new Date(now.getTime() + 8 * 86_400_000));
  const offer = pickOffer(freeSlots(candidates, busy));
  return Response.json({
    slots: offer.map((s) => ({ start_iso: s.toISOString(), label: speakable(s) })),
    message: offer.length
      ? `Offer two or three of these one-hour consultation slots (India time): ${offer.map(speakable).join("; ")}. Pass the chosen slot's start_iso to book_consultation.`
      : "No free slots this week. Tell the caller a designer will call within the hour to fix a time.",
  });
}
