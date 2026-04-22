"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, Loader2, TrendingUp, TrendingDown, Minus, FileText } from "lucide-react";
import { supabase, type DBExplanation } from "@/lib/supabase";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FinRowData {
  kind: "financial";
  metric: string;
  ttm: number;
  pctOfRevenue?: number;   // % of total revenue
  perUnit?: number;
  yoy?: string;            // "+5.2%" or "-3.1%"
  monthly?: number[];      // m1..m12 values
  monthLabels?: string[];  // ["Aug 24","Sep 24",...] — rolling T-12 labels
  category: "income" | "expense";
}

export interface UnitRowData {
  kind: "unit";
  unitType: string;
  totalUnits: number;
  vacantUnits: number;
  physOcc: number;
  avgBaseRent: number;
  avgTotalRent: number;
  marketRent: number;
  lossToLease: number;
  annualRevenue: number;
  avgSqft: number;
  avgUtilities: number;
  latestLeaseUp: string | null;
}

export type PanelData = FinRowData | UnitRowData;

interface Props {
  dealId: string;
  data: PanelData;
  onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (!n && n !== 0) return "—";
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = abs >= 1e6 ? `$${(abs/1e6).toFixed(2)}M`
          : abs >= 1e3 ? `$${(abs/1e3).toFixed(0)}K`
          : `$${abs.toFixed(0)}`;
  return neg ? `(${s})` : s;
}

// Mini horizontal bar chart for monthly data
function Sparkbar({ values, labels, color }: { values: number[]; labels?: string[]; color: string }) {
  if (!values.length || values.every(v => !v)) return null;
  const nonZero = values.filter(v => v !== 0);
  if (nonZero.length < 2) return null;
  const max = Math.max(...values.map(Math.abs));
  if (max === 0) return null;

  return (
    <div className="space-y-1">
      {labels && (
        <div className="flex justify-between text-[9px] text-slate-400 font-medium">
          <span>{labels[0]}</span><span>{labels[labels.length-1]}</span>
        </div>
      )}
      <div className="flex items-end gap-0.5 h-10">
        {values.map((v, i) => {
          const pct = max > 0 ? (Math.abs(v) / max) * 100 : 0;
          const isNeg = v < 0;
          return (
            <div key={i} className="flex-1 flex flex-col justify-end" title={`${labels?.[i] ?? `M${i+1}`}: ${fmtMoney(v)}`}>
              <div
                className={`rounded-t-sm transition-all ${isNeg ? "bg-red-400" : color}`}
                style={{ height: `${Math.max(pct, 4)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground">
        <span>{fmtMoney(Math.min(...values))}</span>
        <span>{fmtMoney(Math.max(...values))}</span>
      </div>
    </div>
  );
}

// ── Financial detail view ────────────────────────────────────────────────────
function FinancialDetail({ data }: { data: FinRowData }) {
  const isExpense = data.category === "expense";
  const hasMonthly = (data.monthly?.filter(v => v !== 0).length ?? 0) >= 3;

  // Trend: compare first 3 months avg vs last 3 months avg
  let trend = 0;
  if (hasMonthly && data.monthly) {
    const first3 = data.monthly.slice(0, 3).reduce((s,v) => s+v,0) / 3;
    const last3  = data.monthly.slice(-3).reduce((s,v) => s+v,0) / 3;
    if (first3 > 0) trend = ((last3 - first3) / first3) * 100;
  }

  const stats = [
    { label: "TTM Total",      value: fmtMoney(data.ttm) },
    { label: "Monthly Avg",    value: data.monthly ? fmtMoney(Math.round(data.ttm / 12)) : "—" },
    data.perUnit   ? { label: "Per Unit/Key",  value: fmtMoney(data.perUnit) }     : null,
    data.pctOfRevenue ? { label: "% of Revenue", value: `${data.pctOfRevenue.toFixed(1)}%` } : null,
    data.yoy       ? { label: "YoY Change",   value: data.yoy }                    : null,
    hasMonthly     ? { label: "6-Mo Trend",   value: trend !== 0 ? `${trend > 0 ? "+" : ""}${trend.toFixed(1)}%` : "Flat" } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-5">
      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-2">
        {stats.map(s => (
          <div key={s.label} className="bg-slate-50 rounded-xl p-3 border border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">{s.label}</div>
            <div className={`text-base font-black mt-0.5 ${
              s.label === "YoY Change" || s.label === "6-Mo Trend"
                ? s.value.startsWith("-") || s.value.startsWith("(")
                  ? isExpense ? "text-emerald-600" : "text-red-500"
                  : isExpense ? "text-red-500" : "text-emerald-600"
                : "text-foreground"
            }`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Monthly chart */}
      {hasMonthly && data.monthly && (
        <div className="bg-slate-50 rounded-xl p-4 border border-border">
          <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-3">
            Monthly Trend (T-12)
          </div>
          <Sparkbar
            values={data.monthly}
            labels={data.monthLabels}
            color={isExpense ? "bg-red-300" : "bg-primary/70"}
          />
        </div>
      )}

      {/* Monthly table */}
      {hasMonthly && data.monthly && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-3 py-2 bg-slate-50 border-b border-border">
            Monthly Breakdown
          </div>
          <div className="divide-y divide-border">
            {data.monthly.map((v, i) => {
              if (!v) return null;
              const label = data.monthLabels?.[i] ?? `Month ${i+1}`;
              return (
                <div key={i} className="flex items-center justify-between px-3 py-2 hover:bg-slate-50">
                  <span className="text-xs text-muted-foreground font-medium">{label}</span>
                  <span className={`text-xs font-bold ${v < 0 ? "text-red-500" : "text-foreground"}`}>{fmtMoney(v)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Benchmark callout */}
      {data.pctOfRevenue !== undefined && data.pctOfRevenue > 0 && (
        <div className={`rounded-xl p-4 border text-sm ${
          isExpense
            ? data.pctOfRevenue > 40 ? "bg-red-50 border-red-100 text-red-700" : "bg-emerald-50 border-emerald-100 text-emerald-700"
            : "bg-blue-50 border-blue-100 text-blue-700"
        }`}>
          {isExpense
            ? data.pctOfRevenue > 40
              ? `⚠ ${data.pctOfRevenue.toFixed(1)}% of revenue — above typical 35-40% threshold for this category`
              : `✓ ${data.pctOfRevenue.toFixed(1)}% of revenue — within normal range`
            : `This line represents ${data.pctOfRevenue.toFixed(1)}% of total revenue`
          }
        </div>
      )}
    </div>
  );
}

// ── Unit detail view ─────────────────────────────────────────────────────────
function UnitDetail({ data }: { data: UnitRowData }) {
  const occupied   = data.totalUnits - data.vacantUnits;
  const occPct     = data.physOcc > 0 ? data.physOcc : data.totalUnits > 0 ? (occupied / data.totalUnits) * 100 : 0;
  const hasMarket  = data.marketRent > 0;
  const hasLTL     = data.lossToLease !== 0;
  const totalLTLmo = hasLTL ? data.lossToLease * data.totalUnits : 0;

  const stats = [
    { label: "Total Units",       value: String(data.totalUnits)                                     },
    { label: "Vacant",            value: `${data.vacantUnits} units`                                 },
    { label: "Occupancy",         value: `${occPct.toFixed(1)}%`                                     },
    { label: "Contract Rent",     value: fmtMoney(data.avgBaseRent || data.avgTotalRent)             },
    hasMarket ? { label: "Market Rent",  value: fmtMoney(data.marketRent) }   : null,
    hasLTL    ? { label: "Loss/Gain",   value: `${data.lossToLease > 0 ? "-" : "+"}${fmtMoney(Math.abs(data.lossToLease))}/unit` } : null,
    data.annualRevenue > 0 ? { label: "Annual Revenue", value: fmtMoney(data.annualRevenue) }        : null,
    data.avgSqft > 0       ? { label: "Avg Sqft",       value: `${data.avgSqft.toLocaleString(undefined,{maximumFractionDigits:0})} sf` } : null,
    data.avgUtilities > 0  ? { label: "Avg Utilities",  value: fmtMoney(data.avgUtilities) }         : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-5">
      {/* Occupancy bar */}
      <div className="bg-slate-50 rounded-xl p-4 border border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Occupancy</span>
          <span className={`text-sm font-black ${occPct >= 90 ? "text-emerald-600" : occPct >= 75 ? "text-amber-500" : "text-red-500"}`}>
            {occPct.toFixed(1)}%
          </span>
        </div>
        <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${occPct >= 90 ? "bg-emerald-500" : occPct >= 75 ? "bg-amber-400" : "bg-red-400"}`}
            style={{ width: `${Math.min(occPct, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>{occupied} occupied</span>
          <span>{data.vacantUnits} vacant of {data.totalUnits}</span>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-2">
        {stats.map(s => (
          <div key={s.label} className="bg-slate-50 rounded-xl p-3 border border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">{s.label}</div>
            <div className="text-base font-black text-foreground mt-0.5">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Market vs contract comparison */}
      {hasMarket && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-3 py-2 bg-slate-50 border-b border-border">
            Rent Comparison
          </div>
          {[
            { label: "Contract Rent",   value: data.avgBaseRent,   bar: 100 },
            { label: "Market Rent",     value: data.marketRent,    bar: (data.marketRent / data.avgBaseRent) * 100 },
          ].map(r => (
            <div key={r.label} className="px-3 py-2.5 space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">{r.label}</span>
                <span className="text-xs font-bold text-foreground">{fmtMoney(r.value)}/mo</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(r.bar, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Loss-to-lease callout */}
      {hasLTL && (
        <div className={`rounded-xl p-4 border text-sm ${data.lossToLease > 0 ? "bg-amber-50 border-amber-100 text-amber-700" : "bg-emerald-50 border-emerald-100 text-emerald-700"}`}>
          {data.lossToLease > 0
            ? `⚠ Rents are $${data.lossToLease.toFixed(0)}/unit below market — $${Math.abs(totalLTLmo).toLocaleString(undefined,{maximumFractionDigits:0})}/mo ($${Math.abs(totalLTLmo*12).toLocaleString(undefined,{maximumFractionDigits:0})}/yr) of unrealized upside`
            : `✓ Rents are $${Math.abs(data.lossToLease).toFixed(0)}/unit above market — premium positioning`
          }
        </div>
      )}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────
export default function DetailPanel({ dealId, data, onClose }: Props) {
  const [explanation, setExplanation]   = useState<DBExplanation | null>(null);
  const [aiInsight, setAiInsight]       = useState<string | null>(null);
  const [loadingExp, setLoadingExp]     = useState(true);
  const [generating, setGenerating]     = useState(false);

  const fieldName = data.kind === "financial" ? data.metric : data.unitType;
  const title     = data.kind === "financial" ? data.metric : data.unitType;
  const valueStr  = data.kind === "financial" ? fmtMoney(data.ttm) : fmtMoney(data.avgBaseRent || data.avgTotalRent);

  useEffect(() => {
    setExplanation(null); setAiInsight(null); setLoadingExp(true);
    supabase.from("ai_explanations").select("*")
      .eq("deal_id", dealId).eq("field_name", fieldName).maybeSingle()
      .then(({ data: d }) => { setExplanation(d as DBExplanation | null); setLoadingExp(false); });
  }, [dealId, fieldName]);

  const generateInsight = async () => {
    setGenerating(true);
    const context = data.kind === "financial"
      ? `Metric: ${data.metric}. TTM value: ${fmtMoney(data.ttm)}. Category: ${data.category}. ${data.yoy ? `YoY: ${data.yoy}.` : ""} ${data.pctOfRevenue ? `% of revenue: ${data.pctOfRevenue.toFixed(1)}%.` : ""} ${data.perUnit ? `Per unit: ${fmtMoney(data.perUnit)}.` : ""}`
      : `Unit type: ${data.unitType}. ${data.totalUnits} units, ${data.vacantUnits} vacant (${data.physOcc.toFixed(1)}% occ). Contract rent: ${fmtMoney(data.avgBaseRent)}/mo. ${data.marketRent > 0 ? `Market rent: ${fmtMoney(data.marketRent)}/mo.` : ""} Annual revenue: ${fmtMoney(data.annualRevenue)}.`;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          message: `Give a 2-3 sentence investment insight about "${title}". Data: ${context}. Is this good/bad/typical? Any red flags or upside?`,
          history: [],
        }),
      });
      const json = await res.json() as { reply?: string };
      if (json.reply) setAiInsight(json.reply);
    } catch { setAiInsight("Could not generate insight."); }
    setGenerating(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
        className="fixed right-0 top-0 h-full w-[420px] bg-white border-l border-border shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border bg-[#FFF6ED] flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-black text-primary uppercase tracking-widest">
                {data.kind === "financial" ? (data.category === "expense" ? "Expense" : "Revenue / Profit") : "Unit Type"}
              </div>
              <div className="text-sm font-black text-foreground truncate">{title}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/60 rounded-lg transition-colors flex-shrink-0">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Value bar */}
        <div className="px-6 py-3 border-b border-border bg-white flex items-center justify-between">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-0.5">
              {data.kind === "financial" ? "TTM Value" : "Contract Rent / Unit"}
            </div>
            <div className={`text-2xl font-heading font-black ${valueStr.startsWith("(") ? "text-red-500" : "text-foreground"}`}>
              {valueStr || "—"}
            </div>
          </div>
          {data.kind === "financial" && data.yoy && (
            <div className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-black ${
              data.yoy.startsWith("+") ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"
            }`}>
              {data.yoy.startsWith("+") ? <TrendingUp className="h-3.5 w-3.5"/> : <TrendingDown className="h-3.5 w-3.5"/>}
              {data.yoy}
            </div>
          )}
          {data.kind === "unit" && (
            <div className={`text-sm font-black px-3 py-1.5 rounded-full ${
              data.physOcc >= 90 ? "bg-emerald-50 text-emerald-600"
              : data.physOcc >= 75 ? "bg-amber-50 text-amber-600"
              : "bg-red-50 text-red-500"
            }`}>
              {data.physOcc.toFixed(1)}% occ
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Inline data — no API call */}
          {data.kind === "financial" ? <FinancialDetail data={data} /> : <UnitDetail data={data} />}

          {/* DB explanation from extraction */}
          {loadingExp ? (
            <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-4 bg-slate-100 rounded animate-pulse"/>)}</div>
          ) : explanation ? (
            <div className="space-y-3">
              <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Source Explanation</div>
              <p className="text-sm text-slate-700 leading-relaxed bg-[#FFF6ED] rounded-xl p-4 border border-orange-100">
                {explanation.explanation_text}
              </p>
              {explanation.source_snippet && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 font-mono text-xs text-slate-600 leading-relaxed">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <FileText className="h-3 w-3 text-blue-400"/>
                    <span className="text-[10px] font-bold text-blue-500">
                      {explanation.source_page ? `Page ${explanation.source_page}` : "Document"}
                    </span>
                  </div>
                  "…{explanation.source_snippet}…"
                </div>
              )}
            </div>
          ) : null}

          {/* AI insight — on demand only, no auto-call = zero tokens unless user clicks */}
          {aiInsight ? (
            <div className="space-y-2">
              <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">AI Insight</div>
              <p className="text-sm text-slate-700 leading-relaxed bg-violet-50 rounded-xl p-4 border border-violet-100">
                {aiInsight}
              </p>
            </div>
          ) : (
            <button onClick={generateInsight} disabled={generating}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold transition-colors">
              {generating
                ? <><Loader2 className="h-4 w-4 animate-spin"/> Generating…</>
                : <><Sparkles className="h-4 w-4"/> Get AI Insight</>
              }
            </button>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border">
          <p className="text-[10px] text-slate-400 text-center">Data from uploaded deal documents</p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
