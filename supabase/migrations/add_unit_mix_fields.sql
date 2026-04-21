-- Migration: extended unit mix fields
alter table unit_mix
  add column if not exists market_rent      numeric(10,2) default 0,
  add column if not exists annual_revenue   bigint        default 0,
  add column if not exists loss_to_lease    numeric(10,2) default 0,
  add column if not exists physical_occ     numeric(5,2)  default 0;
