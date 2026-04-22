-- Migration: Outlook / Microsoft Graph integration tables
-- Run in Supabase SQL Editor

-- Stores the OAuth2 token for the connected Outlook account
create table if not exists outlook_tokens (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  tenant_id     text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Tracks every email that was ingested as a deal
create table if not exists email_ingestions (
  id              uuid primary key default gen_random_uuid(),
  outlook_message_id text not null unique,   -- Graph API message ID (dedup key)
  deal_id         uuid references deals(id) on delete set null,
  subject         text not null,
  sender_name     text,
  sender_email    text,
  received_at     timestamptz,
  attachment_count integer not null default 0,
  status          text not null default 'pending'
                    check (status in ('pending','processing','completed','failed')),
  error_message   text,
  created_at      timestamptz not null default now()
);

-- RLS: open for development (tighten per-user later)
alter table outlook_tokens   enable row level security;
alter table email_ingestions enable row level security;

drop policy if exists "open_outlook_tokens"    on outlook_tokens;
drop policy if exists "open_email_ingestions"  on email_ingestions;

create policy "open_outlook_tokens"    on outlook_tokens    for all using (true) with check (true);
create policy "open_email_ingestions"  on email_ingestions  for all using (true) with check (true);

-- Index for fast lookup of recent ingestions
create index if not exists email_ingestions_created_at_idx on email_ingestions(created_at desc);
create index if not exists email_ingestions_deal_id_idx    on email_ingestions(deal_id);
