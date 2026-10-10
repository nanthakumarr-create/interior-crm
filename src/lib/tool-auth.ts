import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Vaani custom tools send `X-Tool-Secret: <VAANI_WEBHOOK_SECRET>` (set in the tool's headers). */
export function toolAuthorized(request: Request) {
  const secret = process.env.VAANI_WEBHOOK_SECRET;
  const given = request.headers.get("x-tool-secret") ?? new URL(request.url).searchParams.get("token") ?? "";
  return Boolean(secret) && given.length === secret!.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret!));
}

/** Tool arguments may arrive bare or wrapped, depending on how the platform posts them. */
export async function toolArgs(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => ({}));
  const inner = body?.parameters ?? body?.args ?? body?.arguments ?? body;
  return typeof inner === "string" ? JSON.parse(inner) : (inner ?? {});
}
