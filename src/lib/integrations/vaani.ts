import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Vaani Voice API: https://docs.vaanivoice.ai/api-reference/introduction
const BASE = "https://api.vaanivoice.ai";

export function vaaniConfigured() {
  return Boolean(process.env.VAANI_API_KEY && process.env.VAANI_AGENT_ID);
}

export async function triggerCall(args: { phone: string; name: string; metadata?: Record<string, unknown> }) {
  const res = await fetch(`${BASE}/api/trigger-call/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": process.env.VAANI_API_KEY! },
    body: JSON.stringify({
      agent_id: process.env.VAANI_AGENT_ID,
      contact_number: args.phone,
      name: args.name,
      metadata: args.metadata ?? {},
      ...(process.env.VAANI_OUTBOUND_NUMBER ? { outbound_number: process.env.VAANI_OUTBOUND_NUMBER } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(`Vaani trigger-call ${res.status}: ${JSON.stringify(body.detail ?? body.error ?? body).slice(0, 300)}`);
  }
  return { callId: String(body.output?.call_id), liveCaptionsUrl: body.output?.live_captions_url as string | undefined };
}

/**
 * Verifies `X-Vaani-Signature: sha256=<hex>` = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 * and rejects timestamps more than 5 minutes off.
 */
export function verifyVaaniSignature(rawBody: string, signature: string | null, timestamp: string | null) {
  const secret = process.env.VAANI_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signature || !timestamp) return false;
  const ts = Number(timestamp);
  const tsMs = ts > 1e12 ? ts : ts * 1000;
  if (!Number.isFinite(ts) || Math.abs(Date.now() - tsMs) > 300_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const given = signature.replace(/^sha256=/, "");
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export type VaaniWebhook = {
  event: string;
  call_id?: string;
  timestamp?: string;
  phone_number?: string;
  data?: {
    call_id?: string;
    room_name?: string;
    call_duration?: number;
    end_reason?: string;
    summary?: string;
    entities?: Record<string, unknown> | null;
    dispositions?: Record<string, unknown> | null;
    recording_url?: string;
    transcript?: string;
    phone_number?: string;
    error?: string;
  };
};
