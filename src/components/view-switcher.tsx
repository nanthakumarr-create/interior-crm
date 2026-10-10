import Link from "next/link";
import { cn } from "@/lib/utils";

/** Period + live/demo toggles, as plain links so the page stays a Server Component. */
export function ViewSwitcher({ base, days, demo }: { base: string; days: number; demo: boolean }) {
  const href = (d: number, dm: boolean) => `${base}?days=${d}${dm ? "&demo=1" : ""}`;
  const item = (active: boolean) =>
    cn(
      "rounded-md px-2.5 py-1 text-xs font-medium",
      active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg bg-muted p-0.5">
        <Link href={href(days, false)} className={item(!demo)}>
          Live calls
        </Link>
        <Link href={href(days, true)} className={item(demo)}>
          September demo
        </Link>
      </div>
      {!demo && (
        <div className="flex rounded-lg bg-muted p-0.5">
          {[7, 30, 90].map((d) => (
            <Link key={d} href={href(d, false)} className={item(days === d)}>
              {d}d
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
