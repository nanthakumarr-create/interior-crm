"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFirstAdmin, signIn } from "./actions";

export function LoginForm({ bootstrap, notice }: { bootstrap: boolean; notice?: string }) {
  const [state, action, pending] = useActionState(bootstrap ? createFirstAdmin : signIn, undefined);
  const error = state?.error ?? notice;

  return (
    <form action={action} className="grid gap-4">
      {bootstrap && (
        <div className="grid gap-1.5">
          <Label htmlFor="full_name">Your name</Label>
          <Input id="full_name" name="full_name" required autoComplete="name" />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={bootstrap ? 8 : undefined}
          autoComplete={bootstrap ? "new-password" : "current-password"}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-9">
        {pending ? "Please wait…" : bootstrap ? "Create admin account" : "Sign in"}
      </Button>
    </form>
  );
}
