import { createClient } from "@supabase/supabase-js";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser / SSR client (uses anon key)
export const supabase = createClient(url, anon);

// Server-only admin client (uses service role — never expose to browser)
export function supabaseAdmin() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// ── Types matching the DB schema ─────────────────────────────────────────────

export type PipelineStatus =
  | "lead"
  | "ingestion"
  | "extraction"
  | "underwriting"
  | "review"
  | "completed";

export interface DBDeal {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  asset_type: string | null;
  property_type: string | null;
  broker: string | null;
  brand: string | null;
  deal_lead: string | null;
  guidance_price: number | null;
  units: number | null;
  year_built: number | null;
  noi: number | null;
  cap_rate: number | null;
  broker_narrative: string | null;
  location_insight: string | null;
  status: PipelineStatus;
  created_at: string;
}

export interface DBDocument {
  id: string;
  deal_id: string;
  file_url: string;
  file_name: string;
  document_type: "rent_roll" | "t12" | "om" | "excel" | "unknown";
  ocr_text:   string | null;
  ocr_method: string | null;
  ocr_pages:  number | null;
  uploaded_at: string;
}

export interface DBExtractedData {
  id: string;
  deal_id: string;
  field_name: string;
  value: string;
  confidence_score: number;
  source_document_id: string | null;
}

export interface DBUnitMix {
  id: string;
  deal_id: string;
  unit_type: string;
  total_units: number;
  vacant_units: number;
  avg_sqft: number;
  avg_base_rent: number;
  avg_total_rent: number;
  avg_rent: number;
  latest_lease_up: string | null;
  avg_utilities: number;
}

export interface DBFinancial {
  id: string;
  deal_id: string;
  category: "income" | "expense";
  sub_category: string;
  y2021: number;
  y2022: number;
  y2023: number;
  y2024: number;
  y2025: number;
  ttm: number;
  m1: number; m2: number; m3: number; m4: number;
  m5: number; m6: number; m7: number; m8: number;
  m9: number; m10: number; m11: number; m12: number;
  per_unit: number;
  pct_egi: number;
}

export interface DBExplanation {
  id: string;
  deal_id: string;
  field_name: string;
  explanation_text: string;
  source_document_id: string | null;
  source_page: number | null;
  source_snippet: string | null;
}

export interface DBAIJob {
  id: string;
  deal_id: string;
  job_type: string;
  status: "pending" | "running" | "completed" | "failed";
  result: Record<string, unknown> | null;
  created_at: string;
}

export interface DBCriteria {
  id: string;
  deal_id: string;
  criteria: string;
  requirement: string;
  actual: string;
  meets: boolean;
}

export interface DBRisk {
  id: string;
  deal_id: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
}

export interface DBQuestion {
  id: string;
  deal_id: string;
  question: string;
  category: string;
}
