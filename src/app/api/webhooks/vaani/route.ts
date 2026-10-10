import { handleVaaniEvent } from "@/lib/engine";
import { verifyVaaniSignature, type VaaniWebhook } from "@/lib/integrations/vaani";
import { createSupabaseAdmin } from "@/lib/supabase/server";

// Vaani Voice → CRM. Configure in Vaani: Settings → Webhooks → <app>/api/webhooks/vaani
// If Vaani can't sign requests, append ?token=<VAANI_WEBHOOK_SECRET> to the URL instead.
export async function POST(request: Request) {
  const raw = await request.text();
  const token = new URL(request.url).searchParams.get("token");
  const signed = verifyVaaniSignature(
    raw,
    request.headers.get("x-vaani-signature"),
    request.headers.get("x-vaani-timestamp"),
  );
  const secret = process.env.VAANI_WEBHOOK_SECRET;
  if (!signed && !(secret && token === secret)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: VaaniWebhook;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  try {
    const result = await handleVaaniEvent(createSupabaseAdmin(), payload);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("Vaani webhook failed", e);
    // 500 lets Vaani retry (0/5/25/125/625s)
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
