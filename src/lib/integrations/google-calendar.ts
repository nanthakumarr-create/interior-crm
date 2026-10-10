import "server-only";
import { createSign } from "node:crypto";

// Google Calendar via a service account. The studio shares its consultations calendar
// with the service account's email ("Make changes to events"), so no user OAuth is needed.
// GOOGLE_SERVICE_ACCOUNT_JSON: the key file contents, base64-encoded. GOOGLE_CALENDAR_ID: the calendar's id.

type ServiceAccount = { client_email: string; private_key: string };

export function calendarConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_CALENDAR_ID);
}

function serviceAccount(): ServiceAccount {
  return JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!, "base64").toString("utf8"));
}

let cached: { token: string; expires: number } | undefined;

async function accessToken() {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  cached = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

async function google(path: string, body: unknown) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

export async function busyIntervals(from: Date, to: Date) {
  const id = process.env.GOOGLE_CALENDAR_ID!;
  const json = await google("/freeBusy", { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id }] });
  const cal = json.calendars?.[id];
  if (cal?.errors?.length) throw new Error(`Calendar not shared with the service account (${cal.errors[0].reason})`);
  return (cal?.busy ?? []).map((b: { start: string; end: string }) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export async function createEvent(event: { summary: string; description: string; location?: string; start: Date; end: Date }) {
  const json = await google(`/calendars/${encodeURIComponent(process.env.GOOGLE_CALENDAR_ID!)}/events`, {
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: { dateTime: event.start.toISOString(), timeZone: "Asia/Kolkata" },
    end: { dateTime: event.end.toISOString(), timeZone: "Asia/Kolkata" },
  });
  return { id: json.id as string, link: json.htmlLink as string };
}
