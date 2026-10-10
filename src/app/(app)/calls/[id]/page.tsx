import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Moon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RouteBadge } from "@/components/route-badge";
import { getCall } from "@/lib/calls";
import { formatDuration, formatINR } from "@/lib/crm";
import { CRITERIA, CRITERION_LABEL } from "@/lib/route";

export default function CallPage({ params }: PageProps<"/calls/[id]">) {
  return (
    <div className="grid gap-4">
      <Link href="/calls" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Calls
      </Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted/50" />}>
        <CallDetail params={params} />
      </Suspense>
    </div>
  );
}

const STATUS_STYLE = {
  pass: "text-emerald-700 dark:text-emerald-400",
  unclear: "text-amber-700 dark:text-amber-400",
  fail: "text-red-700 dark:text-red-400",
} as const;

async function CallDetail({ params }: Pick<PageProps<"/calls/[id]">, "params">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const c = await getCall(id);
  if (!c) notFound();

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";

  const facts: [string, string | null | undefined][] = [
    ["Phone", c.phone],
    ["Type", c.project_type],
    ["Locality", c.locality],
    ["Carpet area", c.carpet_area_sqft ? `${c.carpet_area_sqft} sq ft` : null],
    ["Scope", c.scope],
    ["Complete by", c.completion_by],
    ["Decides", c.decision_maker],
    ["Budget (volunteered)", c.budget_volunteered],
    ["Consultation", c.booking_at ? fmt(c.booking_at) : null],
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{c.caller_name ?? c.phone ?? "Unknown caller"}</h1>
        <RouteBadge route={c.route} />
        {c.after_hours && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Moon className="size-3.5" /> after hours
          </span>
        )}
        {c.is_test && <span className="text-xs text-muted-foreground">demo data</span>}
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">
        {fmt(c.started_at)} · {formatDuration(c.voice_seconds)}
        {c.alert_sent_at && ` · handoff sent ${fmt(c.alert_sent_at)}`}
      </p>
      {c.processing_error && (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">Processing error: {c.processing_error}</p>
      )}
      {c.route_mismatch && (
        <p className="rounded-md bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          The voice agent routed this call as “{c.agent_route}” live, but the five-criteria check says otherwise. Please review.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Handoff note</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.handoff_note ?? "—"}</p>
              {c.follow_up_question && (
                <p className="rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950/50">
                  <span className="font-medium">Ask next: </span>
                  {c.follow_up_question}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nikhil&apos;s five criteria</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {CRITERIA.map((k, i) => {
                const r = c.criteria?.[k];
                return (
                  <div key={k} className="grid grid-cols-[1.5rem_1fr_auto] gap-2 text-sm">
                    <span className="text-muted-foreground tabular-nums">{i + 1}</span>
                    <div>
                      <div className="font-medium">{CRITERION_LABEL[k]}</div>
                      <div className="text-muted-foreground">{r?.evidence ?? "—"}</div>
                    </div>
                    <span className={`font-medium capitalize ${r ? STATUS_STYLE[r.status] : ""}`}>{r?.status ?? "—"}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transcript</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {c.recording_url && (
                <audio controls preload="none" src={c.recording_url} className="w-full">
                  <a href={c.recording_url}>Recording</a>
                </audio>
              )}
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed">
                {c.transcript ?? "No transcript."}
              </pre>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Captured on the call</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                {facts.map(([k, v]) => (
                  <div key={k} className="grid gap-0.5">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd>{v || "—"}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="grid gap-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">AI cost</span>
                <span className="tabular-nums">{formatINR(c.ai_cost_inr)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Voice cost</span>
                <span className="tabular-nums">{c.voice_cost_inr ? formatINR(c.voice_cost_inr) : "rate not set"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">HubSpot deal</span>
                <span>{c.hubspot_deal_id ?? "—"}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
