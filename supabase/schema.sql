-- ============================================================
-- CRE Underwriting OS — Supabase Schema
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";
-- Enable vector search (for RAG chat)
create extension if not exists vector;

-- ── deals ────────────────────────────────────────────────────────────────────
create table if not exists deals (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  address          text,
  city             text,
  state            text,
  lat              double precision,
  lng              double precision,
  asset_type       text,
  property_type    text,
  broker           text,
  brand            text,
  deal_lead        text,
  guidance_price   bigint,
  units            integer,
  year_built       integer,
  noi              bigint,
  cap_rate         numeric(5,2),
  broker_narrative text,
  location_insight text,
  status           text not null default 'lead'
                     check (status in ('lead','ingestion','extraction','underwriting','review','completed')),
  created_at       timestamptz not null default now()
);

-- ── documents ────────────────────────────────────────────────────────────────
create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references deals(id) on delete cascade,
  file_url      text not null,
  file_name     text not null,
  document_type text not null default 'unknown'
                  check (document_type in ('rent_roll','t12','om','excel','unknown')),
  ocr_text      text,
  ocr_method    text,
  ocr_pages     integer,
  uploaded_at   timestamptz not null default now()
);

-- ── extracted_data ───────────────────────────────────────────────────────────
create table if not exists extracted_data (
  id                   uuid primary key default gen_random_uuid(),
  deal_id              uuid not null references deals(id) on delete cascade,
  field_name           text not null,
  value                text not null,
  confidence_score     numeric(4,3) default 0.9,
  source_document_id   uuid references documents(id)
);

-- ── unit_mix ─────────────────────────────────────────────────────────────────
create table if not exists unit_mix (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references deals(id) on delete cascade,
  unit_type       text not null,
  total_units     integer not null default 0,
  vacant_units    integer not null default 0,
  avg_sqft        numeric(10,2) not null default 0,
  avg_base_rent   numeric(10,2) not null default 0,
  avg_total_rent  numeric(10,2) not null default 0,
  avg_rent        numeric(10,2) not null default 0,
  latest_lease_up text,
  avg_utilities   numeric(10,2) not null default 0
);

-- ── financials ───────────────────────────────────────────────────────────────
create table if not exists financials (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references deals(id) on delete cascade,
  category     text not null check (category in ('income','expense')),
  sub_category text not null,
  y2021        bigint not null default 0,
  y2022        bigint not null default 0,
  y2023        bigint not null default 0,
  y2024        bigint not null default 0,
  y2025        bigint not null default 0,
  ttm          bigint not null default 0,
  m1  bigint not null default 0,
  m2  bigint not null default 0,
  m3  bigint not null default 0,
  m4  bigint not null default 0,
  m5  bigint not null default 0,
  m6  bigint not null default 0,
  m7  bigint not null default 0,
  m8  bigint not null default 0,
  m9  bigint not null default 0,
  m10 bigint not null default 0,
  m11 bigint not null default 0,
  m12 bigint not null default 0,
  per_unit numeric(12,2) not null default 0,
  pct_egi  numeric(6,2)  not null default 0
);

-- ── ai_explanations ──────────────────────────────────────────────────────────
create table if not exists ai_explanations (
  id                 uuid primary key default gen_random_uuid(),
  deal_id            uuid not null references deals(id) on delete cascade,
  field_name         text not null,
  explanation_text   text not null,
  source_document_id uuid references documents(id),
  source_page        integer,
  source_snippet     text
);

-- ── ai_jobs ──────────────────────────────────────────────────────────────────
create table if not exists ai_jobs (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references deals(id) on delete cascade,
  job_type   text not null,
  status     text not null default 'pending'
               check (status in ('pending','running','completed','failed')),
  result     jsonb,
  created_at timestamptz not null default now()
);

-- ── criteria ─────────────────────────────────────────────────────────────────
create table if not exists criteria (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references deals(id) on delete cascade,
  criteria    text not null,
  requirement text not null,
  actual      text not null,
  meets       boolean not null default false
);

-- ── risks ────────────────────────────────────────────────────────────────────
create table if not exists risks (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references deals(id) on delete cascade,
  description text not null,
  severity    text not null default 'medium'
                check (severity in ('critical','high','medium','low'))
);

-- ── questions ────────────────────────────────────────────────────────────────
create table if not exists questions (
  id       uuid primary key default gen_random_uuid(),
  deal_id  uuid not null references deals(id) on delete cascade,
  question text not null,
  category text not null default 'General'
);

-- ── document_chunks (RAG / pgvector) ─────────────────────────────────────────
create table if not exists document_chunks (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references deals(id) on delete cascade,
  document_id uuid references documents(id),
  chunk_text  text not null,
  embedding   vector(1536),
  page_number integer
);
create index if not exists document_chunks_embedding_idx
  on document_chunks using ivfflat (embedding vector_cosine_ops);

-- ── Realtime: enable publications ────────────────────────────────────────────
-- Run these in the Supabase SQL editor after creating tables:
-- alter publication supabase_realtime add table deals;
-- alter publication supabase_realtime add table ai_jobs;
-- alter publication supabase_realtime add table documents;

-- ── Storage buckets (run via Supabase dashboard or CLI) ───────────────────────
-- insert into storage.buckets (id, name, public) values ('deal-documents', 'deal-documents', false);
-- insert into storage.buckets (id, name, public) values ('exports', 'exports', true);

-- ── Row Level Security (basic — open for development) ────────────────────────
alter table deals           enable row level security;
alter table documents       enable row level security;
alter table extracted_data  enable row level security;
alter table unit_mix        enable row level security;
alter table financials      enable row level security;
alter table ai_explanations enable row level security;
alter table ai_jobs         enable row level security;
alter table criteria        enable row level security;
alter table risks           enable row level security;
alter table questions       enable row level security;
alter table document_chunks enable row level security;

-- Allow all for now (tighten per-user later) — drop-then-create for idempotency
drop policy if exists "open_deals"        on deals;
drop policy if exists "open_documents"    on documents;
drop policy if exists "open_extracted"    on extracted_data;
drop policy if exists "open_unit_mix"     on unit_mix;
drop policy if exists "open_financials"   on financials;
drop policy if exists "open_explanations" on ai_explanations;
drop policy if exists "open_ai_jobs"      on ai_jobs;
drop policy if exists "open_criteria"     on criteria;
drop policy if exists "open_risks"        on risks;
drop policy if exists "open_questions"    on questions;
drop policy if exists "open_chunks"       on document_chunks;

create policy "open_deals"           on deals           for all using (true) with check (true);
create policy "open_documents"       on documents       for all using (true) with check (true);
create policy "open_extracted"       on extracted_data  for all using (true) with check (true);
create policy "open_unit_mix"        on unit_mix        for all using (true) with check (true);
create policy "open_financials"      on financials      for all using (true) with check (true);
create policy "open_explanations"    on ai_explanations for all using (true) with check (true);
create policy "open_ai_jobs"         on ai_jobs         for all using (true) with check (true);
create policy "open_criteria"        on criteria        for all using (true) with check (true);
create policy "open_risks"           on risks           for all using (true) with check (true);
create policy "open_questions"       on questions       for all using (true) with check (true);
create policy "open_chunks"          on document_chunks for all using (true) with check (true);
