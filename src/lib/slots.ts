// Consultation slot rules (pure, testable). Times are IST; Date objects are UTC instants.

export const CONSULT_MINUTES = 60;
const IST_OFFSET_MIN = 330;
// Studio consultations: Mon-Sat, starts on the hour 11:00-17:00 IST, at least 3 hours from now
const START_HOURS = [11, 12, 13, 14, 15, 16, 17];
const MIN_LEAD_MS = 3 * 3600_000;

/** UTC instant for a given IST calendar date + hour. */
function istInstant(y: number, m: number, d: number, hour: number) {
  return new Date(Date.UTC(y, m, d, hour, 0) - IST_OFFSET_MIN * 60_000);
}

function istParts(at: Date) {
  const ist = new Date(at.getTime() + IST_OFFSET_MIN * 60_000);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate(), dow: ist.getUTCDay() };
}

export function candidateSlots(now: Date, days = 7) {
  const out: Date[] = [];
  for (let i = 0; i <= days; i++) {
    const { y, m, d, dow } = istParts(new Date(now.getTime() + i * 86_400_000));
    if (dow === 0) continue; // Sunday
    for (const h of START_HOURS) {
      const start = istInstant(y, m, d, h);
      if (start.getTime() - now.getTime() >= MIN_LEAD_MS) out.push(start);
    }
  }
  return out;
}

export function freeSlots(candidates: Date[], busy: { start: Date; end: Date }[]) {
  return candidates.filter((s) => {
    const e = new Date(s.getTime() + CONSULT_MINUTES * 60_000);
    return !busy.some((b) => b.start < e && b.end > s);
  });
}

/** Spread the offer across days: at most `perDay` per day, `max` overall. */
export function pickOffer(slots: Date[], max = 6, perDay = 2) {
  const perDayCount = new Map<string, number>();
  const out: Date[] = [];
  for (const s of slots) {
    const key = s.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
    if ((perDayCount.get(key) ?? 0) >= perDay) continue;
    perDayCount.set(key, (perDayCount.get(key) ?? 0) + 1);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function speakable(at: Date) {
  return at.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function isValidSlot(start: Date, now: Date) {
  return candidateSlots(now, 21).some((s) => s.getTime() === start.getTime());
}
