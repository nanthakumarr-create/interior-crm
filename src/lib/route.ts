// Routing rules from flow.jpeg / qualified.md. Gemini judges each criterion;
// this file (plain code, no AI) turns those judgements into a route.

export const CRITERIA = [
  "real_project",
  "service_area",
  "timeline",
  "budget",
  "decision_maker",
] as const;
export type Criterion = (typeof CRITERIA)[number];
export type CriterionStatus = "pass" | "unclear" | "fail";

export const CRITERION_LABEL: Record<Criterion, string> = {
  real_project: "Real project, with execution",
  service_area: "Site in Pune or PCMC",
  timeline: "Timeline workable",
  budget: "Budget (only if volunteered)",
  decision_maker: "Decision-maker on the call",
};

export const ROUTES = ["qualified", "qualified_flagged", "follow_up", "closed", "escalate", "not_enquiry"] as const;
export type Route = (typeof ROUTES)[number];

export const ROUTE_LABEL: Record<Route, string> = {
  qualified: "Qualified",
  qualified_flagged: "Qualified + flag",
  follow_up: "Ask one question",
  closed: "Closed gracefully",
  escalate: "Escalate to human",
  not_enquiry: "Not an enquiry",
};

/** Routes that reach a designer (Telegram handoff + HubSpot). */
export const FORWARDED: readonly Route[] = ["qualified", "qualified_flagged"];

export type CriteriaResult = Record<Criterion, { status: CriterionStatus; evidence: string }>;

export function decideRoute(input: { kind: "new_enquiry" | "complaint" | "not_enquiry"; criteria: CriteriaResult }): Route {
  if (input.kind === "complaint") return "escalate";
  if (input.kind === "not_enquiry") return "not_enquiry";

  const s = (c: Criterion) => input.criteria[c].status;
  // Any fail: close gracefully. Budget only fails when the caller volunteered a clearly-too-low number.
  if (CRITERIA.some((c) => s(c) === "fail")) return "closed";
  // 1-3 unclear: one direct question still needed
  if ((["real_project", "service_area", "timeline"] as const).some((c) => s(c) === "unclear")) return "follow_up";
  // 4-5 unclear: forward, with the uncertainty flagged in the handoff note
  if (s("budget") === "unclear" || s("decision_maker") === "unclear") return "qualified_flagged";
  return "qualified";
}

/** 10am-7pm IST is front-desk time; everything else is after hours. */
export function isAfterHours(at: Date) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(at),
  );
  return hour < 10 || hour >= 19;
}
