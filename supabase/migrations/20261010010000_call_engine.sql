-- Case 03 "Inbound Call Enquiry Engine": one row per call carries the whole story.
-- Quotations/projects were generic-CRM scope and are not part of this build.
drop view if exists interior_crm.quotation_totals;
drop table if exists interior_crm.quotation_items;
drop table if exists interior_crm.quotations;
drop table if exists interior_crm.projects;
drop type if exists interior_crm.quotation_status;
drop type if exists interior_crm.project_status;

create type interior_crm.call_route as enum (
  'qualified',          -- all five criteria pass
  'qualified_flagged',  -- 4 (budget) or 5 (decision-maker) unclear: forward with a flag
  'follow_up',          -- 1-3 unclear after the call: one direct question still needed
  'closed',             -- a criterion failed: graceful close
  'escalate',           -- existing-client complaint: human now
  'not_enquiry'         -- wrong number, spam, silence, dropped before any details
);

alter table interior_crm.calls
  add column caller_name text,
  add column started_at timestamptz,
  add column ended_at timestamptz,
  add column after_hours boolean,
  add column project_type text check (project_type in ('home', 'office', 'other')),
  add column locality text,
  add column carpet_area_sqft integer,
  add column scope text,
  add column completion_by text,
  add column decision_maker text,
  add column budget_volunteered text,
  add column criteria jsonb,              -- {real_project:{status,evidence}, service_area:…, …}
  add column route interior_crm.call_route,
  add column agent_route text,            -- what the Vaani agent decided live (from dispositions)
  add column route_mismatch boolean not null default false,
  add column follow_up_question text,
  add column handoff_note text,
  add column booking_at timestamptz,
  add column booking_ref text,
  add column alert_sent_at timestamptz,
  add column hubspot_contact_id text,
  add column hubspot_deal_id text,
  add column voice_seconds integer,
  add column ai_input_tokens integer,
  add column ai_output_tokens integer,
  add column ai_cost_inr numeric(10, 4),
  add column voice_cost_inr numeric(10, 2),
  add column processing_error text,
  add column is_test boolean not null default false;

update interior_crm.calls set voice_seconds = duration_seconds where duration_seconds is not null;
alter table interior_crm.calls drop column duration_seconds;

create index calls_started_idx on interior_crm.calls (started_at desc);
create index calls_route_idx on interior_crm.calls (route);
