"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, BarChart3, Sparkles, Calendar } from "lucide-react";
import { supabase, type DBFinancial, type DBDeal } from "@/lib/supabase";
import WhyPanel from "./WhyPanel";

interface Props { dealId: string; deal: DBDeal | null; refreshKey?: number }

const YEAR_KEYS: (keyof DBFinancial)[] = ["y2021","y2022","y2023","y2024","y2025","ttm"];
const YEAR_LABELS: Record<string,string> = { y2021:"2021",y2022:"2022",y2023:"2023",y2024:"2024",y2025:"2025",ttm:"TTM" };
const MONTH_KEYS: (keyof DBFinancial)[] = ["m1","m2","m3","m4","m5","m6","m7","m8","m9","m10","m11","m12"];
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const INCOME_ORDER  = ["Gross Potential Rent","Vacancy & Concessions","Bad Debt","Other Income","Effective Gross Income","Total Revenue","Gross Operating Profit","EBITDA","Net Operating Income"];
const EXPENSE_ORDER = ["Payroll","Repairs & Maintenance","Contract Services","Marketing","General & Admin","Utilities","Property Management","Property Taxes","Insurance","Total Operating Expenses"];

type ViewMode = "annual" | "monthly";

export default function FinancialDashboard({ dealId, deal, refreshKey = 0 }: Props) {
  const [rows, setRows]   = useState<DBFinancial[]>([]);
  const [loading, setLoading] = useState(true);
  const [why, setWhy]     = useState<{ field: string; label: string; value: string } | null>(null);
  const [view, setView]   = useState<ViewMode>("annual");

  useEffect(() => {
    supabase.from("financials").select("*").eq("deal_id", dealId)
      .then(({ data }) => { setRows((data ?? []) as DBFinancial[]); setLoading(false); });
  }, [dealId, refreshKey]);

  const fmt = (n: number, highlight = false) => {
    if (!n || n === 0) return <span className="text-slate-300">—</span>;
    const s = n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(0)}K` : `$${n}`;
    return <span className={highlight ? "font-black text-primary" : "font-medium text-foreground"}>{s}</span>;
  };
  const fmtPlain = (n: number | null | undefined) => {
    if (!n || n === 0) return "—";
    return n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(0)}K` : `$${n}`;
  };

  const yoyPct = (row: DBFinancial) => {
    const filled = YEAR_KEYS.filter(k => k !== "ttm" && (row[k] as number) > 0);
    if (filled.length >= 2) {
      const prev = row[filled[filled.length - 2]] as number;
      const curr = row[filled[filled.length - 1]] as number;
      if (prev > 0) return `${(((curr - prev) / prev) * 100).toFixed(1)}%`;
    }
    if (filled.length >= 1 && (row.ttm as number) > 0) {
      const prev = row[filled[filled.length - 1]] as number;
      if (prev > 0) return `${(((row.ttm as number - prev) / prev) * 100).toFixed(1)}%`;
    }
    return "—";
  };

  const income   = rows.filter(r => r.category === "income");
  const expenses = rows.filter(r => r.category === "expense");
  const sortedIncome   = [...INCOME_ORDER.map(m => income.find(r => r.sub_category === m)).filter(Boolean) as DBFinancial[],
                          ...income.filter(r => !INCOME_ORDER.includes(r.sub_category))];
  const sortedExpenses = [...EXPENSE_ORDER.map(m => expenses.find(r => r.sub_category === m)).filter(Boolean) as DBFinancial[],
                          ...expenses.filter(r => !EXPENSE_ORDER.includes(r.sub_category))];

  const revenue = rows.find(r => r.sub_category === "Total Revenue" || r.sub_category === "Effective Gross Income");
  const noi     = rows.find(r => r.sub_category === "Net Operating Income" || r.sub_category === "NOI");
  const egi     = rows.find(r => r.sub_category === "Effective Gross Income");
  const totalExp= rows.find(r => r.sub_category === "Total Operating Expenses");

  const isHighlight = (name: string) =>
    ["Effective Gross Income","Total Revenue","Net Operating Income","EBITDA","Gross Operating Profit","Total Operating Expenses"].includes(name);

  const noyRow = (row: DBFinancial) => {
    const yoy = yoyPct(row);
    const v = parseFloat(yoy);
    const up = !isNaN(v) && v > 0;
    const dn = !isNaN(v) && v < 0;
    return (
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${yoy === "—" ? "text-slate-300" : up ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
        {yoy === "—" ? "—" : <>{up ? <TrendingUp className="h-3 w-3"/> : <TrendingDown className="h-3 w-3"/>}{v > 0 ? "+" : ""}{yoy}</>}
      </span>
    );
  };

  if (loading) return (
    <div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse"/>)}</div>
  );

  if (!rows.length) return (
    <div className="text-center py-8 text-muted-foreground text-sm">
      <BarChart3 className="h-8 w-8 mx-auto mb-2 text-slate-200"/>
      Financial data will appear after extraction
    </div>
  );

  const hasMonthly = rows.some(r => MONTH_KEYS.some(k => (r[k] as number) > 0));

  const TableSection = ({ title, sectionRows, color }: { title: string; sectionRows: DBFinancial[]; color: string }) => (
    <>
      <tr className={`${color} border-y border-border`}>
        <td colSpan={view === "annual" ? YEAR_KEYS.length + 3 : MONTH_KEYS.length + 4}
          className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          {title}
        </td>
      </tr>
      {sectionRows.map((row, i) => {
        const hi = isHighlight(row.sub_category);
        return (
          <motion.tr key={row.id}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
            className={`hover:bg-[#FFF6ED] transition-colors cursor-pointer group ${hi ? "bg-slate-50/80" : ""}`}
            onClick={() => setWhy({ field: row.sub_category, label: row.sub_category, value: fmtPlain(row.ttm) })}>
            <td className={`px-4 py-2.5 text-sm ${hi ? "font-black text-foreground" : "font-medium text-slate-700"} flex items-center gap-1.5`}>
              {hi && <span className="w-1 h-4 bg-primary rounded-full flex-shrink-0"/>}
              {row.sub_category}
              <Sparkles className="h-3 w-3 text-violet-300 opacity-0 group-hover:opacity-100 transition-opacity ml-auto"/>
            </td>
            {view === "annual"
              ? YEAR_KEYS.map(k => (
                  <td key={k} className="px-4 py-2.5 text-sm">{fmt(row[k] as number, k === "ttm")}</td>
                ))
              : MONTH_KEYS.map(k => (
                  <td key={k} className="px-4 py-2.5 text-sm">{fmt(row[k] as number)}</td>
                ))
            }
            {view === "annual" && (
              <>
                <td className="px-4 py-2.5 text-sm text-slate-500">{row.per_unit > 0 ? `$${row.per_unit.toLocaleString(undefined,{maximumFractionDigits:0})}` : "—"}</td>
                <td className="px-4 py-2.5 text-sm text-slate-500">{row.pct_egi > 0 ? `${row.pct_egi.toFixed(1)}%` : "—"}</td>
                <td className="px-4 py-2.5">{noyRow(row)}</td>
              </>
            )}
          </motion.tr>
        );
      })}
    </>
  );

  return (
    <div className="space-y-5">
      {/* Key metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label:"Guidance Price", value: fmtPlain(deal?.guidance_price), field:"guidancePrice" },
          { label:"NOI / EBITDA",   value: fmtPlain(deal?.noi),            field:"noi"           },
          { label:"Cap Rate",       value: deal?.cap_rate ? `${deal.cap_rate}%` : "—", field:"capRate" },
          { label:"Total Revenue",  value: fmtPlain(revenue?.ttm),         field:"totalRevenue"  },
          { label:"EGI",            value: fmtPlain(egi?.ttm),             field:"egi"           },
          { label:"Total OpEx",     value: fmtPlain(totalExp?.ttm),        field:"opex"          },
          { label:"Expense Ratio",  value: egi?.ttm && totalExp?.ttm ? `${((totalExp.ttm/egi.ttm)*100).toFixed(1)}%` : "—", field:"expenseRatio" },
          { label:"NOI / Unit",     value: deal?.noi && deal?.units ? `$${Math.round(deal.noi / deal.units).toLocaleString()}` : "—", field:"noiPerUnit" },
        ].map(card => (
          <div key={card.label}
            className="bg-white border border-border rounded-xl p-4 cursor-pointer group hover:border-primary/30 hover:shadow-md transition-all"
            onClick={() => setWhy({ field: card.field, label: card.label, value: card.value })}>
            <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1 flex justify-between items-center">
              {card.label}
              <Sparkles className="h-3 w-3 text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity"/>
            </div>
            <div className="text-xl font-heading font-black text-foreground">{card.value}</div>
          </div>
        ))}
      </div>

      {/* T-12 Operating Statement */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-[#FFF6ED] flex items-center gap-3">
          <BarChart3 className="h-4 w-4 text-primary"/>
          <span className="text-sm font-bold">T-12 Operating Statement</span>
          {hasMonthly && (
            <div className="ml-auto flex items-center gap-1 bg-white border border-border rounded-lg p-0.5">
              <button onClick={() => setView("annual")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${view==="annual" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
                <BarChart3 className="h-3 w-3"/> Annual
              </button>
              <button onClick={() => setView("monthly")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${view==="monthly" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
                <Calendar className="h-3 w-3"/> Monthly
              </button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-border">
                <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest w-52">Line Item</th>
                {view === "annual"
                  ? YEAR_KEYS.map(k => (
                      <th key={k} className={`px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest ${k==="ttm" ? "text-primary" : "text-muted-foreground"}`}>
                        {YEAR_LABELS[k]}
                      </th>
                    ))
                  : MONTH_KEYS.map((k, i) => (
                      <th key={k} className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                        {MONTH_LABELS[i]}
                      </th>
                    ))
                }
                {view === "annual" && <>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">Per Unit</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">% EGI</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">YoY %</th>
                </>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedIncome.length > 0   && <TableSection title="Income"   sectionRows={sortedIncome}   color="bg-emerald-50/50"/>}
              {sortedExpenses.length > 0 && <TableSection title="Expenses" sectionRows={sortedExpenses} color="bg-red-50/50"/>}
            </tbody>
          </table>
        </div>
      </div>

      {why && <WhyPanel dealId={dealId} fieldName={why.field} fieldLabel={why.label} value={why.value} onClose={() => setWhy(null)}/>}
    </div>
  );
}
