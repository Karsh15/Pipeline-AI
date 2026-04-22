

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, BarChart3, Sparkles, Calendar, DollarSign, AlertTriangle, CheckCircle2, Minus } from "lucide-react";
import { supabase, type DBFinancial, type DBDeal } from "@/lib/supabase";
import DetailPanel, { type PanelData, type FinRowData } from "./DetailPanel";

interface Props { dealId: string; deal: DBDeal | null; refreshKey?: number }

const YEAR_KEYS: (keyof DBFinancial)[] = ["y2021","y2022","y2023","y2024","y2025","ttm"];
const YEAR_LABELS: Record<string,string> = { y2021:"2021",y2022:"2022",y2023:"2023",y2024:"2024",y2025:"2025",ttm:"TTM" };
const MONTH_KEYS: (keyof DBFinancial)[] = ["m1","m2","m3","m4","m5","m6","m7","m8","m9","m10","m11","m12"];
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const Q_LABELS = ["Q1","Q2","Q3","Q4"];

// Income lines — hotel order mirrors the T-12 summary section top-to-bottom
const INCOME_ORDER = [
  // Hotel revenue
  "Total Room Revenue","Total Revenue","Total Operating Revenue",
  // Dept income
  "Total Departmental Income","Rooms Dept Profit",
  // Undistributed / profit lines
  "Gross Operating Profit","Income Before Non-Oper Expenses",
  "EBITDA","Net Income","Net Operating Income",
  // MF lines
  "Gross Potential Rent","Vacancy & Concessions","Bad Debt","Other Income","Effective Gross Income",
];
const EXPENSE_ORDER = [
  // Hotel dept expenses
  "Total Departmental Expenses","Room Payroll","Rooms Expenses","Other Operated Depts Expenses",
  // Undistributed
  "Total Undistributed Expenses",
  "Administration & General","Information & Telecom","Sales & Marketing",
  "Property Operations & Maintenance","Utilities",
  // Non-operating
  "Management Fees","Total Non-Operating Expenses",
  "Depreciation & Amortization","Interest",
  // MF
  "Payroll","Repairs & Maintenance","Contract Services","Marketing","General & Admin",
  "Property Management","Property Taxes","Insurance","Total Operating Expenses",
];

type ViewMode = "annual" | "quarterly" | "monthly";

function fmt$(n: number | null | undefined, bold = false) {
  if (!n || n === 0) return <span className="text-slate-300">—</span>;
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = abs >= 1e6 ? `$${(abs/1e6).toFixed(2)}M` : abs >= 1e3 ? `$${(abs/1e3).toFixed(0)}K` : `$${abs}`;
  return <span className={`${bold ? "font-black text-primary" : "font-medium"} ${neg ? "text-red-500" : "text-foreground"}`}>{neg ? `(${s})` : s}</span>;
}

function fmtPlain(n: number | null | undefined): string {
  if (!n || n === 0) return "—";
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = abs >= 1e6 ? `$${(abs/1e6).toFixed(2)}M` : abs >= 1e3 ? `$${(abs/1e3).toFixed(0)}K` : `$${abs}`;
  return neg ? `(${s})` : s;
}

function quarterly(row: DBFinancial): [number, number, number, number] {
  const g = (k: keyof DBFinancial) => (row[k] as number) || 0;
  return [
    g("m1")+g("m2")+g("m3"),
    g("m4")+g("m5")+g("m6"),
    g("m7")+g("m8")+g("m9"),
    g("m10")+g("m11")+g("m12"),
  ];
}

function hasQuarterly(rows: DBFinancial[]): boolean {
  return rows.some(r => MONTH_KEYS.some(k => (r[k] as number) > 0));
}

export default function FinancialDashboard({ dealId, deal, refreshKey = 0 }: Props) {
  const [rows, setRows]       = useState<DBFinancial[]>([]);
  const [kpis, setKpis]       = useState<Record<string,number>>({});
  const [loading, setLoading] = useState(true);
  const [panel, setPanel]     = useState<PanelData | null>(null);
  const [view, setView]       = useState<ViewMode>("annual");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from("financials").select("*").eq("deal_id", dealId),
      supabase.from("extracted_data").select("field_name,value")
        .eq("deal_id", dealId).in("field_name", ["occupancy","adr","revpar"]),
    ]).then(([fin, kpiRes]) => {
      setRows((fin.data ?? []) as DBFinancial[]);
      const kpiMap: Record<string,number> = {};
      for (const r of (kpiRes.data ?? [])) kpiMap[r.field_name] = parseFloat(r.value) || 0;
      setKpis(kpiMap);
      setLoading(false);
    });
  }, [dealId, refreshKey]);

  const yoyPct = (row: DBFinancial): string => {
    const filled = YEAR_KEYS.filter(k => k !== "ttm" && (row[k] as number) > 0);
    const candidates: number[] = [];
    if (filled.length >= 2) {
      const prev = row[filled[filled.length - 2]] as number;
      const curr = row[filled[filled.length - 1]] as number;
      if (prev > 0) candidates.push(((curr - prev) / prev) * 100);
    }
    if ((row.ttm as number) > 0 && filled.length >= 1) {
      const prev = row[filled[filled.length - 1]] as number;
      if (prev > 0) candidates.push((((row.ttm as number) - prev) / prev) * 100);
    }
    return candidates.length ? `${candidates[0] > 0 ? "+" : ""}${candidates[0].toFixed(1)}%` : "—";
  };

  const income   = rows.filter(r => r.category === "income");
  const expenses = rows.filter(r => r.category === "expense");
  const sortedIncome   = [...INCOME_ORDER.map(m => income.find(r => r.sub_category === m)).filter(Boolean) as DBFinancial[],
                          ...income.filter(r => !INCOME_ORDER.includes(r.sub_category))];
  const sortedExpenses = [...EXPENSE_ORDER.map(m => expenses.find(r => r.sub_category === m)).filter(Boolean) as DBFinancial[],
                          ...expenses.filter(r => !EXPENSE_ORDER.includes(r.sub_category))];

  const findRow = (...names: string[]) => rows.find(r => names.some(n => r.sub_category === n));

  const buildPanel = (row: DBFinancial): FinRowData => ({
    kind: "financial",
    metric: row.sub_category,
    ttm: row.ttm || 0,
    category: row.category,
    monthly: MONTH_KEYS.map(k => (row[k] as number) || 0),
    monthLabels: MONTH_LABELS,
    perUnit: row.per_unit || undefined,
    pctOfRevenue: row.pct_egi || undefined,
    yoy: yoyPct(row),
  });

  const revenue  = findRow("Total Revenue","Total Operating Revenue","Effective Gross Income");
  const gopRow   = findRow("Gross Operating Profit");
  const ebitdaRow= findRow("EBITDA");
  const netIncRow= findRow("Net Income");
  const noi      = findRow("Net Operating Income","NOI");
  const egi      = findRow("Effective Gross Income");
  const totalExp = findRow("Total Operating Expenses","Total Departmental Expenses");

  const revTTM    = revenue?.ttm    || 0;
  const gopTTM    = gopRow?.ttm     || 0;
  const ebitdaTTM = ebitdaRow?.ttm  || 0;
  const netIncTTM = netIncRow?.ttm  || 0;
  // For hotels: GOP is the best NOI proxy; fall back to EBITDA, then extracted deal.noi
  const noiTTM    = noi?.ttm || gopTTM || ebitdaTTM || deal?.noi || 0;
  const egiTTM    = egi?.ttm || revTTM;
  const opexTTM   = totalExp?.ttm   || 0;

  // Hotel KPIs from extracted_data
  const occupancyPct = kpis.occupancy || deal?.occupancy_rate || 0;
  const adr          = kpis.adr       || 0;
  const revpar       = kpis.revpar    || 0;

  const profitable    = noiTTM > 0;
  const gopMargin     = revTTM > 0 && gopTTM > 0 ? (gopTTM / revTTM) * 100 : 0;
  const noiMargin     = egiTTM > 0 && noiTTM !== 0 ? (noiTTM / egiTTM) * 100 : 0;
  const expenseRatio  = egiTTM > 0 && opexTTM > 0 ? (opexTTM / egiTTM) * 100 : 0;
  const noiPerUnit    = deal?.units && deal.units > 0 && noiTTM !== 0 ? Math.round(noiTTM / deal.units) : 0;

  const isHighlight = (name: string) =>
    ["Total Revenue","Total Operating Revenue","Total Room Revenue",
     "Gross Operating Profit","Total Departmental Income","Total Departmental Expenses",
     "Total Undistributed Expenses","EBITDA","Net Income",
     "Effective Gross Income","Net Operating Income","Total Operating Expenses"].includes(name);

  const BadgeTrend = ({ row }: { row: DBFinancial }) => {
    const yoy = yoyPct(row);
    const v = parseFloat(yoy);
    const up = !isNaN(v) && v > 0;
    const dn = !isNaN(v) && v < 0;
    return (
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1
        ${yoy === "—" ? "text-slate-300" : up ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
        {yoy === "—" ? "—" : <>{up ? <TrendingUp className="h-3 w-3"/> : <TrendingDown className="h-3 w-3"/>}{yoy}</>}
      </span>
    );
  };

  if (loading) return (
    <div className="p-6 space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse"/>)}</div>
  );

  if (!rows.length) return (
    <div className="text-center py-12 text-muted-foreground text-sm">
      <BarChart3 className="h-8 w-8 mx-auto mb-2 text-slate-200"/>
      Financial data will appear after extraction
    </div>
  );

  const canViewMonthly = hasQuarterly(rows);

  const TableSection = ({ title, sectionRows, color }: { title: string; sectionRows: DBFinancial[]; color: string }) => {
    const colCount = view === "annual" ? YEAR_KEYS.length + 3 : view === "quarterly" ? 4 + 2 : MONTH_KEYS.length + 2;
    return (
      <>
        <tr className={`${color} border-y border-border`}>
          <td colSpan={colCount + 1} className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {title}
          </td>
        </tr>
        {sectionRows.map((row, i) => {
          const hi = isHighlight(row.sub_category);
          const qs = quarterly(row);
          return (
            <motion.tr key={row.id}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
              className={`hover:bg-[#FFF6ED] transition-colors cursor-pointer group ${hi ? "bg-slate-50/80" : ""}`}
              onClick={() => setPanel(buildPanel(row))}>
              <td className={`px-4 py-2.5 text-sm ${hi ? "font-black text-foreground" : "font-medium text-slate-700"}`}>
                <span className="flex items-center gap-1.5">
                  {hi && <span className="w-1 h-4 bg-primary rounded-full flex-shrink-0"/>}
                  {row.sub_category}
                  <Sparkles className="h-3 w-3 text-violet-300 opacity-0 group-hover:opacity-100 transition-opacity ml-auto"/>
                </span>
              </td>
              {view === "annual" && YEAR_KEYS.map(k => (
                <td key={k} className="px-4 py-2.5 text-sm text-right">{fmt$(row[k] as number, k === "ttm")}</td>
              ))}
              {view === "quarterly" && qs.map((q, qi) => (
                <td key={qi} className="px-4 py-2.5 text-sm text-right">{fmt$(q)}</td>
              ))}
              {view === "monthly" && MONTH_KEYS.map(k => (
                <td key={k} className="px-4 py-2.5 text-sm text-right">{fmt$(row[k] as number)}</td>
              ))}
              {view === "annual" && (
                <>
                  <td className="px-4 py-2.5 text-sm text-right text-slate-500">{row.per_unit > 0 ? `$${row.per_unit.toLocaleString(undefined,{maximumFractionDigits:0})}` : "—"}</td>
                  <td className="px-4 py-2.5 text-sm text-right text-slate-500">{row.pct_egi > 0 ? `${row.pct_egi.toFixed(1)}%` : "—"}</td>
                  <td className="px-4 py-2.5 text-sm"><BadgeTrend row={row}/></td>
                </>
              )}
              {view === "quarterly" && (
                <>
                  <td className="px-4 py-2.5 text-sm text-right text-slate-500">{row.per_unit > 0 ? `$${Math.round(row.per_unit/4).toLocaleString()}` : "—"}</td>
                  <td className="px-4 py-2.5 text-sm"><BadgeTrend row={row}/></td>
                </>
              )}
              {view === "monthly" && (
                <td className="px-4 py-2.5 text-sm"><BadgeTrend row={row}/></td>
              )}
            </motion.tr>
          );
        })}
      </>
    );
  };

  return (
    <div className="space-y-5 p-6">
      {/* ── Profit / Loss banner ── */}
      <div className={`flex items-center gap-4 rounded-xl px-5 py-4 border ${
        profitable
          ? "bg-emerald-50 border-emerald-100"
          : noiTTM === 0
            ? "bg-slate-50 border-slate-200"
            : "bg-red-50 border-red-100"
      }`}>
        <div className={`p-2.5 rounded-xl ${profitable ? "bg-emerald-100" : noiTTM === 0 ? "bg-slate-100" : "bg-red-100"}`}>
          {profitable
            ? <CheckCircle2 className="h-5 w-5 text-emerald-600"/>
            : noiTTM === 0
              ? <Minus className="h-5 w-5 text-slate-400"/>
              : <AlertTriangle className="h-5 w-5 text-red-500"/>
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-black ${profitable ? "text-emerald-700" : noiTTM === 0 ? "text-slate-500" : "text-red-600"}`}>
            {profitable
              ? `Property is Profitable — GOP ${fmtPlain(gopTTM || noiTTM)}`
              : noiTTM === 0 ? "Profitability data not yet extracted"
              : `Net Income Loss: ${fmtPlain(netIncTTM || noiTTM)}`}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
            {gopTTM !== 0    && <span>GOP: {fmtPlain(gopTTM)}</span>}
            {ebitdaTTM !== 0 && <span>EBITDA: {fmtPlain(ebitdaTTM)}</span>}
            {gopMargin > 0   && <span>GOP Margin: {gopMargin.toFixed(1)}%</span>}
            {expenseRatio > 0 && <span>Expense Ratio: {expenseRatio.toFixed(1)}%</span>}
            {noiPerUnit !== 0 && <span>Per Unit: ${Math.abs(noiPerUnit).toLocaleString()}</span>}
          </div>
        </div>
        {deal?.guidance_price && deal.guidance_price > 0 && gopTTM > 0 && (
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Implied Cap Rate</div>
            <div className="text-lg font-black text-foreground">
              {((gopTTM / deal.guidance_price) * 100).toFixed(2)}%
            </div>
          </div>
        )}
      </div>

      {/* ── Hotel KPI strip (Occupancy / ADR / RevPAR) ── */}
      {(occupancyPct > 0 || adr > 0 || revpar > 0) && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Occupancy",     value: occupancyPct > 0 ? `${occupancyPct.toFixed(1)}%` : "—", field: "occupancy",
              color: occupancyPct >= 80 ? "text-emerald-600" : occupancyPct >= 65 ? "text-amber-500" : "text-red-500" },
            { label: "ADR",           value: adr > 0 ? `$${adr.toFixed(2)}` : "—",    field: "adr",    color: "text-foreground" },
            { label: "RevPAR",        value: revpar > 0 ? `$${revpar.toFixed(2)}` : "—", field: "revpar", color: "text-foreground" },
          ].map(card => (
            <div key={card.label}
              className="bg-slate-50 border border-border rounded-xl px-4 py-3 flex items-center justify-between cursor-pointer group hover:border-primary/30 hover:bg-white hover:shadow-sm transition-all"
              onClick={() => {
                const r = findRow(card.field, card.label);
                if (r) setPanel(buildPanel(r));
              }}>
              <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{card.label}</div>
              <div className={`text-lg font-black ${card.color}`}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Key metric cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Guidance Price",  value: fmtPlain(deal?.guidance_price),           rowKeys: [] as string[],                                             icon: DollarSign   },
          { label: "Total Revenue",   value: fmtPlain(revTTM || undefined),             rowKeys: ["Total Revenue","Total Operating Revenue","Effective Gross Income"], icon: TrendingUp   },
          { label: "Gross Op. Profit",value: fmtPlain(gopTTM || undefined),             rowKeys: ["Gross Operating Profit"],                                 icon: BarChart3    },
          { label: "EBITDA",          value: fmtPlain(ebitdaTTM || undefined),          rowKeys: ["EBITDA"],                                                 icon: BarChart3    },
          { label: "Net Income",      value: fmtPlain(netIncTTM || undefined),          rowKeys: ["Net Income"],                                             icon: netIncTTM >= 0 ? TrendingUp : TrendingDown },
          { label: "Cap Rate",        value: deal?.cap_rate ? `${deal.cap_rate}%` : "—", rowKeys: [] as string[],                                            icon: BarChart3    },
          { label: "GOP Margin",      value: gopMargin > 0 ? `${gopMargin.toFixed(1)}%` : "—", rowKeys: ["Gross Operating Profit"],                         icon: BarChart3    },
          { label: "Per Key / Unit",  value: noiPerUnit !== 0 ? `$${Math.abs(noiPerUnit).toLocaleString()}` : "—", rowKeys: ["Net Operating Income","NOI","Gross Operating Profit"], icon: BarChart3 },
        ].map(card => {
          const Icon = card.icon;
          const isNeg = card.value.startsWith("(");
          return (
            <div key={card.label}
              className="bg-white border border-border rounded-xl p-4 cursor-pointer group hover:border-primary/30 hover:shadow-md transition-all"
              onClick={() => {
                if (!card.rowKeys.length) return;
                const r = findRow(...card.rowKeys);
                if (r) setPanel(buildPanel(r));
              }}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{card.label}</div>
                <Icon className={`h-3.5 w-3.5 ${isNeg ? "text-red-400" : "text-slate-300"} group-hover:text-primary transition-colors`}/>
              </div>
              <div className={`text-xl font-heading font-black ${isNeg ? "text-red-500" : "text-foreground"}`}>{card.value}</div>
            </div>
          );
        })}
      </div>

      {/* ── T-12 Operating Statement ── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-[#FFF6ED] flex items-center gap-3">
          <BarChart3 className="h-4 w-4 text-primary"/>
          <span className="text-sm font-bold">Operating Statement</span>
          {canViewMonthly && (
            <div className="ml-auto flex items-center gap-1 bg-white border border-border rounded-lg p-0.5">
              {(["annual","quarterly","monthly"] as ViewMode[]).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold capitalize transition-colors
                    ${view === v ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>
                  <Calendar className="h-3 w-3"/>{v}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-border">
                <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest w-52">Line Item</th>
                {view === "annual" && YEAR_KEYS.map(k => (
                  <th key={k} className={`px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-widest ${k==="ttm" ? "text-primary" : "text-muted-foreground"}`}>
                    {YEAR_LABELS[k]}
                  </th>
                ))}
                {view === "quarterly" && Q_LABELS.map(q => (
                  <th key={q} className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">{q}</th>
                ))}
                {view === "monthly" && MONTH_KEYS.map((k, i) => (
                  <th key={k} className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">{MONTH_LABELS[i]}</th>
                ))}
                {view === "annual" && <>
                  <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Per Unit</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">% EGI</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">YoY</th>
                </>}
                {view === "quarterly" && <>
                  <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Per Unit</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">YoY</th>
                </>}
                {view === "monthly" && (
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">YoY</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedIncome.length > 0   && <TableSection title="Income"   sectionRows={sortedIncome}   color="bg-emerald-50/50"/>}
              {sortedExpenses.length > 0 && <TableSection title="Expenses" sectionRows={sortedExpenses} color="bg-red-50/50"/>}
            </tbody>
          </table>
        </div>

        {/* ── Net Operating Income footer row ── */}
        {(noiTTM !== 0 || opexTTM !== 0) && (
          <div className={`border-t-2 ${profitable ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/60"} px-4 py-3 flex items-center justify-between`}>
            <span className="text-sm font-black text-foreground flex items-center gap-2">
              {profitable
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500"/>
                : <AlertTriangle className="h-4 w-4 text-red-400"/>
              }
              Net Operating Income (TTM)
            </span>
            <span className={`text-lg font-black ${profitable ? "text-emerald-600" : "text-red-500"}`}>
              {fmtPlain(noiTTM)}
            </span>
          </div>
        )}
      </div>

      {panel && <DetailPanel dealId={dealId} data={panel} onClose={() => setPanel(null)}/>}
    </div>
  );
}
