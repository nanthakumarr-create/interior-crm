import Link from "next/link";
import { Suspense } from "react";
import { Moon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RouteBadge } from "@/components/route-badge";
import { ViewSwitcher } from "@/components/view-switcher";
import { listCalls, parseView } from "@/lib/calls";
import { formatDuration } from "@/lib/crm";
import { ROUTE_LABEL, ROUTES, type Route } from "@/lib/route";

export default function CallsPage({ searchParams }: PageProps<"/calls">) {
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Calls</h1>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted/50" />}>
        <CallsTable searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CallsTable({ searchParams }: Pick<PageProps<"/calls">, "searchParams">) {
  const view = parseView(await searchParams);
  const route = view.route && (ROUTES as readonly string[]).includes(view.route) ? (view.route as Route) : undefined;
  const calls = await listCalls({ ...view, route });
  const keep = view.demo ? "demo=1" : `days=${view.days}`;

  return (
    <>
      <ViewSwitcher base="/calls" days={view.days} demo={view.demo} />
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Link href={`/calls?${keep}`} className={`rounded-md border px-2 py-1 ${!route ? "bg-muted font-medium" : ""}`}>
          All
        </Link>
        {ROUTES.map((r) => (
          <Link key={r} href={`/calls?${keep}&route=${r}`} className={`rounded-md border px-2 py-1 ${route === r ? "bg-muted font-medium" : ""}`}>
            {ROUTE_LABEL[r]}
          </Link>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Caller</TableHead>
              <TableHead className="hidden md:table-cell">Project</TableHead>
              <TableHead>Route</TableHead>
              <TableHead className="hidden sm:table-cell">Booked</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Length</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((c) => (
              <TableRow key={c.id} className="relative">
                <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    {c.started_at
                      ? new Date(c.started_at).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          day: "numeric",
                          month: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "—"}
                    {c.after_hours && <Moon className="size-3.5" aria-label="After hours" />}
                  </span>
                </TableCell>
                <TableCell className="max-w-48 truncate">
                  <Link href={`/calls/${c.id}`} className="font-medium after:absolute after:inset-0">
                    {c.caller_name ?? c.phone ?? "Unknown"}
                  </Link>
                </TableCell>
                <TableCell className="hidden max-w-72 truncate text-muted-foreground md:table-cell">
                  {[c.locality, c.carpet_area_sqft && `${c.carpet_area_sqft} sq ft`, c.scope].filter(Boolean).join(" · ")}
                </TableCell>
                <TableCell>
                  <RouteBadge route={c.route} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">{c.booking_at ? "Yes" : ""}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatDuration(c.voice_seconds)}</TableCell>
              </TableRow>
            ))}
            {!calls.length && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No calls match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
