-- Migration: add rich unit mix fields (Primer-style)
alter table unit_mix
  add column if not exists avg_sqft        numeric(10,2) not null default 0,
  add column if not exists avg_base_rent   numeric(10,2) not null default 0,
  add column if not exists avg_total_rent  numeric(10,2) not null default 0,
  add column if not exists latest_lease_up text,
  add column if not exists avg_utilities   numeric(10,2) not null default 0;

-- Migration: add per-month P&L columns to financials (m1..m12)
alter table financials
  add column if not exists m1  bigint not null default 0,
  add column if not exists m2  bigint not null default 0,
  add column if not exists m3  bigint not null default 0,
  add column if not exists m4  bigint not null default 0,
  add column if not exists m5  bigint not null default 0,
  add column if not exists m6  bigint not null default 0,
  add column if not exists m7  bigint not null default 0,
  add column if not exists m8  bigint not null default 0,
  add column if not exists m9  bigint not null default 0,
  add column if not exists m10 bigint not null default 0,
  add column if not exists m11 bigint not null default 0,
  add column if not exists m12 bigint not null default 0,
  add column if not exists per_unit numeric(12,2) not null default 0,
  add column if not exists pct_egi   numeric(6,2)  not null default 0;
