import { cn } from "@/lib/utils";
import { ROUTE_LABEL, type Route } from "@/lib/route";

const STYLE: Record<Route, string> = {
  qualified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  qualified_flagged: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  follow_up: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  closed: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  escalate: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  not_enquiry: "bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400",
};

export function RouteBadge({ route, className }: { route: Route | null; className?: string }) {
  if (!route) {
    return <span className={cn("rounded-md px-2 py-0.5 text-xs text-muted-foreground", className)}>Processing…</span>;
  }
  return (
    <span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap", STYLE[route], className)}>
      {ROUTE_LABEL[route]}
    </span>
  );
}
