import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CRITERIA, decideRoute, type Route } from "@/lib/route";

const CriterionSchema = z.object({ status: z.enum(["pass", "unclear", "fail"]), evidence: z.string() });

const TriageSchema = z.object({
  kind: z.enum(["new_enquiry", "complaint", "not_enquiry"]),
  criteria: z.object(Object.fromEntries(CRITERIA.map((c) => [c, CriterionSchema])) as Record<
    (typeof CRITERIA)[number],
    typeof CriterionSchema
  >),
  caller_name: z.string().nullable(),
  project_type: z.enum(["home", "office", "other"]).nullable(),
  locality: z.string().nullable(),
  carpet_area_sqft: z.number().int().nullable(),
  scope: z.string().nullable(),
  completion_by: z.string().nullable(),
  decision_maker: z.string().nullable(),
  budget_volunteered: z.string().nullable(),
  follow_up_question: z.string().nullable(),
  handoff_note: z.string(),
});
export type Triage = z.infer<typeof TriageSchema> & { route: Route };
export type TriageUsage = { inputTokens: number; outputTokens: number };

const criterion = {
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: ["pass", "unclear", "fail"] },
    evidence: { type: "STRING", description: "Short quote or paraphrase from the call that justifies the status" },
  },
  required: ["status", "evidence"],
};
const nullableString = (description: string) => ({ type: "STRING", nullable: true, description });

const responseSchema = {
  type: "OBJECT",
  properties: {
    kind: {
      type: "STRING",
      enum: ["new_enquiry", "complaint", "not_enquiry"],
      description: "complaint = existing client unhappy about an ongoing project; not_enquiry = missed/empty/wrong number",
    },
    criteria: {
      type: "OBJECT",
      properties: Object.fromEntries(CRITERIA.map((c) => [c, criterion])),
      required: [...CRITERIA],
    },
    caller_name: nullableString("Caller's name if given"),
    project_type: { type: "STRING", enum: ["home", "office", "other"], nullable: true },
    locality: nullableString("Area / locality and city of the site"),
    carpet_area_sqft: { type: "INTEGER", nullable: true },
    scope: nullableString("Rooms and work wanted, e.g. 'Full 3BHK: modular kitchen, wardrobes, living room'"),
    completion_by: nullableString("When they need it complete, in their words"),
    decision_maker: nullableString("Who decides, e.g. 'Caller + husband, husband agreed'"),
    budget_volunteered: nullableString("Only if the caller said a number themselves, verbatim"),
    follow_up_question: nullableString(
      "If real_project, service_area or timeline is unclear: the ONE direct question to ask next. Else null.",
    ),
    handoff_note: {
      type: "STRING",
      description:
        "Note for the designer, plain text, max 8 short lines: who, what, where, size, timeline, decider, " +
        "anything they already asked (e.g. pricing), and FLAG lines for budget/decision-maker uncertainty, " +
        "frustration or repeat calls. Never include prices. For a complaint: what happened and who they want to hear from.",
    },
  },
  required: ["kind", "criteria", "handoff_note"],
};

let studioContext: string | undefined;
function loadStudioContext() {
  // Studio files live in /context so Nikhil's team can edit them without touching code
  studioContext ??= ["services.md", "qualified.md", "pricing.md"]
    .map((f) => `<file name="${f}">\n${readFileSync(path.join(process.cwd(), "context", f), "utf8")}\n</file>`)
    .join("\n\n");
  return studioContext;
}

const RULES = `You triage phone enquiries for Aangan Studio, an interior design studio in Pune.
Judge each of Nikhil's five criteria from qualified.md as pass, unclear or fail, using only what the caller said.

Status guidance:
- real_project: pass if they want design WITH execution (full home, partial home, a single room redesign, or an office).
  fail if advice/ideas/decor only, furniture sourcing only, Vastu only, structural/architecture work,
  or an out-of-scope space type (restaurant, hotel, retail, gym, hospitality). Commercial spaces under 500 sq ft
  or over ~3,000 sq ft fail. Not knowing exactly what they want is NOT a fail.
- service_area: pass for Pune city or PCMC localities (see services.md). fail for Talegaon, Lonavala, Nashik,
  Mumbai or other cities. unclear if no location was given.
- timeline: pass if the timeline gives room for 3-4 weeks of design plus execution, or if they are flexible.
  fail if they need it finished in a few weeks (e.g. "before Diwali in 3 weeks"). unclear if never discussed.
  There is no fixed minimum number of weeks: judge whether it is workable. Judge relative to the call date in the
  header (assume the current year if none). Design can start right away, so a move-in or completion two or more
  months out is workable.
- budget: pass if not mentioned (do not probe). fail ONLY if the caller volunteered a number clearly below any
  project of that scope (use pricing.md internally to judge). unclear if the number is borderline.
- decision_maker: pass if the caller decides or is clearly authorised. unclear if they are researching for someone
  else, or it was not established. A representative whose principals will attend the consultation is unclear
  (forward with a flag), not a fail.

Existing clients complaining about an ongoing project are kind=complaint (criteria can all be "unclear").
A missed call, dropped call with no details, or wrong number is kind=not_enquiry.
Repeat callers who were not called back: note the frustration in the handoff note.`;

export function geminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function triageCall(callText: string): Promise<{ triage: Triage; usage: TriageUsage }> {
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${RULES}\n\n${loadStudioContext()}` }] },
      contents: [{ role: "user", parts: [{ text: callText }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const text: string | undefined = body.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned no content");

  const raw = JSON.parse(text);
  for (const key of Object.keys(TriageSchema.shape)) raw[key] ??= null;
  const parsed = TriageSchema.parse(raw);
  const usage = {
    inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
    // thinking tokens are billed as output
    outputTokens: (body.usageMetadata?.candidatesTokenCount ?? 0) + (body.usageMetadata?.thoughtsTokenCount ?? 0),
  };
  return { triage: { ...parsed, route: decideRoute(parsed) }, usage };
}
