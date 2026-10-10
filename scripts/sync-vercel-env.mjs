// Pushes every non-empty key in .env.local to Vercel (preview + development) without printing values.
// Usage: node scripts/sync-vercel-env.mjs [KEY ...]   (no keys = all)
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const SKIP = new Set(["VERCEL_OIDC_TOKEN", "NEXT_PUBLIC_APP_URL"]);
const only = process.argv.slice(2);
const entries = readFileSync(".env.local", "utf8")
  .split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, ""))
  .filter((l) => l && !l.startsWith("#") && l.includes("="))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")])
  .filter(([k, v]) => v && !SKIP.has(k) && (!only.length || only.includes(k)));

const vercel = (args, input) =>
  spawnSync("vercel", args, { input, encoding: "utf8", shell: process.platform === "win32" });

for (const [key, value] of entries) {
  for (const target of ["preview", "development"]) {
    vercel(["env", "rm", key, target, "--yes"]); // replace if it already exists
    // NEXT_PUBLIC_ values ship to the browser anyway, so they are Config, not Secret
    const kind = key.startsWith("NEXT_PUBLIC_") ? ["--no-sensitive"] : [];
    const r = vercel(["env", "add", key, target, "--yes", ...kind], value);
    console.log(`${key.padEnd(30)} ${target.padEnd(12)} ${r.status === 0 ? "ok" : `FAILED: ${(r.stderr || r.stdout).split("\n").filter(Boolean).pop()}`}`);
  }
}
