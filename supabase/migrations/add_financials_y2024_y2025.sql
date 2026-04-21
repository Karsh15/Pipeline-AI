-- Migration: add y2024 and y2025 columns to financials table
alter table financials
  add column if not exists y2024 bigint not null default 0,
  add column if not exists y2025 bigint not null default 0;
