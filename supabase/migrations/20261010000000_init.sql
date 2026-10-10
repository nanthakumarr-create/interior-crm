-- Interior CRM: lives in schema interior_crm on the shared "universal" project.
create schema if not exists interior_crm;

create type interior_crm.team_role as enum ('admin', 'sales', 'designer');
create type interior_crm.lead_stage as enum (
  'new', 'contacted', 'qualified', 'site_visit', 'proposal', 'negotiation', 'won', 'lost'
);
create type interior_crm.lead_source as enum (
  'vaani_call', 'website', 'referral', 'walk_in', 'instagram', 'facebook', 'other'
);
create type interior_crm.property_type as enum ('apartment', 'villa', 'independent_house', 'office', 'retail', 'other');
create type interior_crm.appointment_kind as enum ('site_visit', 'consultation', 'design_review');
create type interior_crm.appointment_status as enum ('scheduled', 'completed', 'cancelled', 'no_show');
create type interior_crm.quotation_status as enum ('draft', 'sent', 'accepted', 'rejected');
create type interior_crm.project_status as enum ('design', 'execution', 'handover', 'completed', 'on_hold');

create or replace function interior_crm.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Team members map 1:1 to Supabase auth users
create table interior_crm.team_members (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role interior_crm.team_role not null default 'sales',
  phone text,
  telegram_chat_id text,
  created_at timestamptz not null default now()
);

create table interior_crm.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  city text,
  locality text,
  source interior_crm.lead_source not null default 'other',
  property_type interior_crm.property_type,
  property_size_sqft integer,
  rooms text,
  scope text,
  budget_min numeric(14, 2),
  budget_max numeric(14, 2),
  timeline text,
  stage interior_crm.lead_stage not null default 'new',
  score smallint check (score between 0 and 100),
  ai_summary text,
  lost_reason text,
  assigned_to uuid references interior_crm.team_members (id) on delete set null,
  hubspot_contact_id text,
  hubspot_deal_id text,
  next_follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index leads_phone_key on interior_crm.leads (phone);
create index leads_stage_idx on interior_crm.leads (stage);
create index leads_assigned_idx on interior_crm.leads (assigned_to);
create trigger leads_touch before update on interior_crm.leads
  for each row execute function interior_crm.touch_updated_at();

-- Voice AI calls (Vaani Voice). raw keeps the full webhook payload.
create table interior_crm.calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references interior_crm.leads (id) on delete cascade,
  vaani_call_id text unique,
  direction text not null default 'outbound' check (direction in ('inbound', 'outbound')),
  phone text,
  status text,
  duration_seconds integer,
  end_reason text,
  summary text,
  transcript text,
  recording_url text,
  entities jsonb,
  dispositions jsonb,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calls_lead_idx on interior_crm.calls (lead_id);
create trigger calls_touch before update on interior_crm.calls
  for each row execute function interior_crm.touch_updated_at();

-- Timeline: notes, stage changes and system events
create table interior_crm.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references interior_crm.leads (id) on delete cascade,
  author_id uuid references interior_crm.team_members (id) on delete set null,
  kind text not null default 'note' check (kind in ('note', 'stage_change', 'call', 'appointment', 'quotation', 'system')),
  body text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index activities_lead_idx on interior_crm.activities (lead_id, created_at desc);

create table interior_crm.follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references interior_crm.leads (id) on delete cascade,
  title text not null,
  due_at timestamptz not null,
  done_at timestamptz,
  assigned_to uuid references interior_crm.team_members (id) on delete set null,
  created_at timestamptz not null default now()
);
create index follow_ups_due_idx on interior_crm.follow_ups (due_at) where done_at is null;

create table interior_crm.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references interior_crm.leads (id) on delete cascade,
  kind interior_crm.appointment_kind not null default 'site_visit',
  status interior_crm.appointment_status not null default 'scheduled',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  notes text,
  assigned_to uuid references interior_crm.team_members (id) on delete set null,
  google_event_id text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index appointments_starts_idx on interior_crm.appointments (starts_at);

-- Quotations in INR with GST
create table interior_crm.quotations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references interior_crm.leads (id) on delete cascade,
  number text not null unique,
  status interior_crm.quotation_status not null default 'draft',
  gst_rate numeric(5, 2) not null default 18,
  discount numeric(14, 2) not null default 0,
  valid_until date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger quotations_touch before update on interior_crm.quotations
  for each row execute function interior_crm.touch_updated_at();

create table interior_crm.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references interior_crm.quotations (id) on delete cascade,
  position integer not null default 0,
  room text,
  description text not null,
  unit text not null default 'nos',
  quantity numeric(12, 2) not null default 1,
  rate numeric(14, 2) not null default 0,
  amount numeric(16, 2) generated always as (quantity * rate) stored
);
create index quotation_items_quotation_idx on interior_crm.quotation_items (quotation_id, position);

create view interior_crm.quotation_totals with (security_invoker = true) as
select q.id as quotation_id,
       coalesce(sum(i.amount), 0) as subtotal,
       q.discount,
       round((coalesce(sum(i.amount), 0) - q.discount) * q.gst_rate / 100, 2) as gst,
       round((coalesce(sum(i.amount), 0) - q.discount) * (1 + q.gst_rate / 100), 2) as total
from interior_crm.quotations q
left join interior_crm.quotation_items i on i.quotation_id = q.id
group by q.id;

create table interior_crm.projects (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references interior_crm.leads (id) on delete set null,
  name text not null,
  status interior_crm.project_status not null default 'design',
  contract_value numeric(14, 2),
  start_date date,
  target_date date,
  designer_id uuid references interior_crm.team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger projects_touch before update on interior_crm.projects
  for each row execute function interior_crm.touch_updated_at();

-- Access: internal tool, every team member can read and write.
-- Webhooks use the service role, which bypasses RLS.
grant usage on schema interior_crm to authenticated, service_role;
grant all on all tables in schema interior_crm to authenticated, service_role;
grant all on all sequences in schema interior_crm to authenticated, service_role;
alter default privileges in schema interior_crm grant all on tables to authenticated, service_role;

create or replace function interior_crm.is_team_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from interior_crm.team_members where id = auth.uid())
$$;
revoke execute on function interior_crm.is_team_member() from public, anon;
grant execute on function interior_crm.is_team_member() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['leads', 'calls', 'activities', 'follow_ups', 'appointments',
                           'quotations', 'quotation_items', 'projects']
  loop
    execute format('alter table interior_crm.%I enable row level security', t);
    execute format('create policy team_all on interior_crm.%I for all to authenticated '
                   'using (interior_crm.is_team_member()) with check (interior_crm.is_team_member())', t);
  end loop;
end $$;

alter table interior_crm.team_members enable row level security;
create policy team_read on interior_crm.team_members for select to authenticated
  using (interior_crm.is_team_member());
create policy self_update on interior_crm.team_members for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
