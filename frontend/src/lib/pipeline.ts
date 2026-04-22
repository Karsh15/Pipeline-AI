import { supabase, type DBDeal, type PipelineStatus } from "./supabase";

const API = import.meta.env.VITE_API_URL ?? "";

export const PIPELINE_STAGES: { key: PipelineStatus; label: string; color: string }[] = [
  { key: "lead",          label: "Lead",         color: "bg-slate-100 text-slate-600 border-slate-200"    },
  { key: "ingestion",     label: "Ingestion",    color: "bg-blue-100 text-blue-700 border-blue-200"       },
  { key: "extraction",    label: "Extraction",   color: "bg-violet-100 text-violet-700 border-violet-200" },
  { key: "underwriting",  label: "Underwriting", color: "bg-amber-100 text-amber-700 border-amber-200"    },
  { key: "review",        label: "Review",       color: "bg-orange-100 text-orange-700 border-orange-200" },
  { key: "completed",     label: "Completed",    color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
];

export function stageIndex(status: PipelineStatus): number {
  return PIPELINE_STAGES.findIndex(s => s.key === status);
}

export function stageMeta(status: PipelineStatus) {
  return PIPELINE_STAGES.find(s => s.key === status) ?? PIPELINE_STAGES[0];
}

// ── Deal CRUD ────────────────────────────────────────────────────────────────

export async function createDeal(name: string): Promise<DBDeal | null> {
  const { data, error } = await supabase
    .from("deals")
    .insert({ name, status: "lead" })
    .select()
    .single();
  if (error) { console.error("createDeal:", error); return null; }
  return data as DBDeal;
}

export async function fetchDeals(): Promise<DBDeal[]> {
  const { data } = await supabase
    .from("deals")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as DBDeal[];
}

export async function fetchDeal(id: string): Promise<DBDeal | null> {
  const { data } = await supabase.from("deals").select("*").eq("id", id).single();
  return data as DBDeal | null;
}

export async function updateDealStatus(id: string, status: PipelineStatus) {
  await supabase.from("deals").update({ status }).eq("id", id);
}

// ── Trigger next stage via API ────────────────────────────────────────────────

export async function triggerExtraction(dealId: string, signal?: AbortSignal): Promise<ReadableStream> {
  const res = await fetch(`${API}/api/run-extraction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealId }),
    signal,
  });
  return res.body!;
}

export async function triggerUnderwriting(dealId: string, signal?: AbortSignal): Promise<ReadableStream> {
  const res = await fetch(`${API}/api/run-underwriting`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealId }),
    signal,
  });
  return res.body!;
}

export async function uploadDocument(dealId: string, file: File): Promise<{ success: boolean; document?: unknown }> {
  const form = new FormData();
  form.append("deal_id", dealId);
  form.append("file", file);
  const res = await fetch(`${API}/api/process-documents`, { method: "POST", body: form });
  return res.json();
}

export async function exportExcel(dealId: string) {
  const res = await fetch(`${API}/api/export-excel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealId }),
  });
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g,"") || "underwriting.xlsx";
  a.click();
}

export async function exportPPT(dealId: string) {
  const res = await fetch(`${API}/api/export-ppt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealId }),
  });
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g,"") || "analysis.pptx";
  a.click();
}

export async function exportUnderwritingPdf(dealId: string) {
  const res = await fetch(`${API}/api/export-underwriting-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealId }),
  });
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g,"") || "underwriting.pdf";
  a.click();
}
