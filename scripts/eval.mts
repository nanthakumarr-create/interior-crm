// Runs the triage (Gemini + routing rules) over the 40 September enquiries and
// compares each route with the expected one(s) in seed/enquiries.json.
// Usage: npm run eval [-- --phone-only] [-- --only=T07,T14]
import { readFileSync, writeFileSync } from "node:fs";
import { triageCall } from "../src/lib/integrations/gemini";
import { aiCostInr } from "../src/lib/costs";

type Enquiry = { id: string; channel: string; header: string; text: string; expected: string[] };

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
let cases: Enquiry[] = JSON.parse(readFileSync("seed/enquiries.json", "utf8"));
if (args.includes("--phone-only")) cases = cases.filter((c) => c.channel === "phone");
if (only) cases = cases.filter((c) => only.includes(c.id));

async function run(c: Enquiry) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { triage, usage } = await triageCall(`${c.header}\n\n${c.text}`);
      return { c, triage, usage };
    } catch (e) {
      if (attempt >= 3) return { c, error: String(e) };
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const results: Awaited<ReturnType<typeof run>>[] = [];
for (let i = 0; i < cases.length; i += 5) results.push(...(await Promise.all(cases.slice(i, i + 5).map(run))));

let pass = 0;
let inTok = 0;
let outTok = 0;
for (const r of results) {
  if ("error" in r) {
    console.log(`${r.c.id}  ERROR  ${r.error}`);
    continue;
  }
  const ok = r.c.expected.includes(r.triage.route);
  if (ok) pass++;
  inTok += r.usage.inputTokens;
  outTok += r.usage.outputTokens;
  const crit = Object.entries(r.triage.criteria)
    .map(([k, v]) => `${k.slice(0, 4)}:${v.status[0]}`)
    .join(" ");
  console.log(`${r.c.id}  ${ok ? "ok  " : "MISS"}  ${r.triage.route.padEnd(17)} expected ${r.c.expected.join("|").padEnd(30)} ${crit}`);
}
console.log(`\n${pass}/${results.length} routed as expected`);
console.log(`tokens in ${inTok} out ${outTok}  ≈ ₹${aiCostInr(inTok, outTok).toFixed(2)} total, ₹${(aiCostInr(inTok, outTok) / results.length).toFixed(3)} per call`);
writeFileSync("seed/eval-results.json", JSON.stringify(results, null, 1));
