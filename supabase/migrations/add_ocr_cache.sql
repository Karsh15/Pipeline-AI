-- Migration: cache OCR text on documents table
-- Run in Supabase SQL Editor if you already have the schema deployed.

alter table documents
  add column if not exists ocr_text   text,
  add column if not exists ocr_method text,
  add column if not exists ocr_pages  integer;
