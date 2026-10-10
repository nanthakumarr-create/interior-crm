import Link from "next/link";
import { Suspense } from "react";
import { LayoutDashboard, LogOut, PhoneIncoming } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentMember } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calls", label: "Calls", icon: PhoneIncoming },
] as const;

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4">
          <Link href="/" className="mr-4 font-semibold tracking-tight">
            Aangan · Enquiries
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

async function UserMenu() {
  const member = await getCurrentMember();
  return (
    <>
      <span className="hidden text-sm text-muted-foreground sm:inline">{member.full_name}</span>
      <form action={signOut}>
        <Button variant="ghost" size="icon-sm" type="submit" aria-label="Sign out">
          <LogOut />
        </Button>
      </form>
    </>
  );
}
