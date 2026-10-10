import Link from "next/link";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RouteBadge } from "@/components/route-badge";
import { ViewSwitcher } from "@/components/view-switcher";
import { listCalls, parseView } from "@/lib/calls";
import { costRates } from "@/lib/costs";
import { formatDuration, formatINR, type CallRow } from "@/lib/crm";
import { FORWARDED, ROUTES } from "@/lib/route";

export default function DashboardPage({ searchParams }: PageProps<"/">) {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Enquiry engine</h1>
        <p className="text-sm text-muted-foreground">Every inbound call: answered, qualified, handed off, and what it cost.</p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted/50" />}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function Dashboard({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const view = parseView(await searchParams);
  const calls = await listCalls(view);
  const rates = costRates();

  const answered = calls.filter((c) => (c.voice_seconds ?? 0) > 0 && c.end_reason !== "no_answer");
  const enquiries = calls.filter((c) => c.route && c.route !== "not_enquiry" && c.route !== "escalate");
  const forwarded = calls.filter((c) => c.route && FORWARDED.includes(c.route));
  const booked = calls.filter((c) => c.booking_at);
  const afterHours = calls.filter((c) => c.after_hours);
  const handoffMins = median(
    calls
      .filter((c) => c.alert_sent_at && c.ended_at)
      .map((c) => (new Date(c.alert_sent_at!).getTime() - new Date(c.ended_at!).getTime()) / 60_000),
  );
  const voiceCost = calls.reduce((s, c) => s + Number(c.voice_cost_inr ?? 0), 0);
  const aiCost = calls.reduce((s, c) => s + Number(c.ai_cost_inr ?? 0), 0);
  const voiceMinutes = calls.reduce((s, c) => s + (c.voice_seconds ?? 0), 0) / 60;
  const total = voiceCost + aiCost;
  const byRoute = ROUTES.map((r) => ({ route: r, n: calls.filter((c) => c.route === r).length }));
  const mismatches = calls.filter((c) => c.route_mismatch).length;

  return (
    <>
      <ViewSwitcher base="/" days={view.days} demo={view.demo} />
      {view.demo && (
        <p className="text-sm text-muted-foreground">
          The 20 September 2026 phone transcripts, run through the live triage. Durations are the real call lengths; nothing
          was sent to Telegram or HubSpot.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Calls" value={calls.length} hint={`${pct(afterHours.length, calls.length)} after hours (${afterHours.length})`} />
        <Stat
          label="Answered by the agent"
          value={pct(answered.length, calls.length)}
          hint="Picked up live, any hour (target: within 5 min)"
        />
        <Stat
          label="Qualified"
          value={pct(forwarded.length, enquiries.length)}
          hint={`${forwarded.length} of ${enquiries.length} enquiries reached a designer`}
        />
        <Stat
          label="Consultations booked"
          value={booked.length}
          hint={handoffMins != null ? `Median handoff ${handoffMins.toFixed(1)} min after the call` : "Handoff time shows once Telegram is live"}
        />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Where calls went</CardTitle>
            <CardDescription>Gemini checks the five criteria; fixed rules pick the route.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {byRoute.map(({ route, n }) => (
              <Link
                key={route}
                href={`/calls?route=${route}${view.demo ? "&demo=1" : `&days=${view.days}`}`}
                className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-3 rounded-md px-1 py-0.5 hover:bg-muted/60"
              >
                <RouteBadge route={route} className="justify-self-start" />
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-foreground/70" style={{ width: pct(n, calls.length || 1) }} />
                </div>
                <span className="text-right text-sm tabular-nums">{n}</span>
              </Link>
            ))}
            {mismatches > 0 && (
              <p className="pt-1 text-xs text-amber-700 dark:text-amber-400">
                {mismatches} call(s) where the voice agent&apos;s live decision differed from Gemini&apos;s check: review these.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What it costs</CardTitle>
            <CardDescription>Estimated from usage logged on every call</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label={`Voice (${voiceMinutes.toFixed(0)} min)`} value={rates.vaaniPerMinInr ? formatINR(voiceCost) : "rate not set"} />
            <Row label="AI triage (Gemini Flash)" value={formatINR(aiCost)} />
            <div className="my-1 border-t" />
            <Row label="Total" value={formatINR(total)} strong />
            <Row label="Per call" value={calls.length ? formatINR(total / calls.length) : "—"} />
            <Row label="Per qualified lead" value={forwarded.length ? formatINR(total / forwarded.length) : "—"} />
            {!rates.vaaniPerMinInr && (
              <p className="pt-1 text-xs text-muted-foreground">
                Set VAANI_COST_PER_MIN_INR to include voice minutes. Telegram is free.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Latest calls</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1">
          {calls.slice(0, 8).map((c) => (
            <CallLine key={c.id} c={c} />
          ))}
          {!calls.length && <p className="text-sm text-muted-foreground">No calls in this period yet.</p>}
          <Link href={`/calls${view.demo ? "?demo=1" : `?days=${view.days}`}`} className="pt-2 text-sm text-primary hover:underline">
            All calls →
          </Link>
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <Card size="sm">
      <CardContent className="grid gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function CallLine({ c }: { c: CallRow }) {
  const when = c.started_at
    ? new Date(c.started_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "—";
  return (
    <Link href={`/calls/${c.id}`} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 rounded-md px-1 py-1.5 text-sm hover:bg-muted/60">
      <span className="text-xs text-muted-foreground tabular-nums">{when}</span>
      <span className="truncate">
        {c.caller_name ?? c.phone ?? "Unknown"}
        <span className="text-muted-foreground"> · {[c.locality, c.scope].filter(Boolean).join(" · ") || formatDuration(c.voice_seconds)}</span>
      </span>
      <RouteBadge route={c.route} />
    </Link>
  );
}
