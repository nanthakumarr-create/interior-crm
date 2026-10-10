import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { needsBootstrap } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <Suspense fallback={<div className="h-72" />}>
          <LoginCard searchParams={searchParams} />
        </Suspense>
      </Card>
    </main>
  );
}

async function LoginCard({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const [{ error }, bootstrap] = await Promise.all([searchParams, needsBootstrap()]);
  const notice = error === "not_member" ? "This account isn't on the team yet. Ask an admin to add you." : undefined;
  return (
    <>
      <CardHeader>
        <CardTitle className="text-lg">Aangan · Enquiries</CardTitle>
        <CardDescription>
          {bootstrap ? "Set up the first admin account for your firm." : "Sign in to your team workspace."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm bootstrap={bootstrap} notice={notice} />
      </CardContent>
    </>
  );
}
