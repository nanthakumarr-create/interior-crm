// Small shared helpers for the call engine and dashboard

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

export function formatINR(value: number | null | undefined) {
  return value == null ? "—" : inr.format(value);
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

/** Normalises Indian numbers to E.164 (+91XXXXXXXXXX); leaves other formats alone. */
export function normalizePhone(raw: string | null | undefined) {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^0\d{10}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  return digits || null;
}

export type CallRow = {
  id: string;
  vaani_call_id: string | null;
  lead_id: string | null;
  phone: string | null;
  caller_name: string | null;
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
  after_hours: boolean | null;
  project_type: string | null;
  locality: string | null;
  carpet_area_sqft: number | null;
  scope: string | null;
  completion_by: string | null;
  decision_maker: string | null;
  budget_volunteered: string | null;
  criteria: Record<string, { status: "pass" | "unclear" | "fail"; evidence: string }> | null;
  route: import("@/lib/route").Route | null;
  agent_route: string | null;
  route_mismatch: boolean;
  follow_up_question: string | null;
  handoff_note: string | null;
  booking_at: string | null;
  booking_ref: string | null;
  alert_sent_at: string | null;
  hubspot_contact_id: string | null;
  hubspot_deal_id: string | null;
  voice_seconds: number | null;
  ai_cost_inr: number | null;
  voice_cost_inr: number | null;
  summary: string | null;
  transcript: string | null;
  recording_url: string | null;
  end_reason: string | null;
  processing_error: string | null;
  is_test: boolean;
  created_at: string;
};
