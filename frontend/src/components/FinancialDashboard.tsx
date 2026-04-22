import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp, TrendingDown, BarChart3, Sparkles, Calendar,
  DollarSign, AlertTriangle, CheckCircle2, Minus, Building2,
  Percent, Activity, Layers,
} from "lucide-react";
import { supabase, type DBFinancial, type DBDeal } from "@/lib/supabase";
import DetailPanel, { type PanelData, type FinRowData } from "./DetailPanel";

interface Props { dealId: string; deal: DBDeal | null; refreshKey?: number }

const YEAR_KEYS: (keyof DBFinancial)[] = ["y2021","y2022","y2023","y2024","y2025","ttm"];
const YEAR_LABELS: Record<string,string> = { y2021:"2021",y2022:"2022",y2023:"2023",y2024:"2024",y2025:"2025",ttm:"TTM" };
const MONTH_KEYS: (keyof DBFinancial)[] = ["m1","m2","m3","m4","m5","m6","m7","m8","m9","m10","m11","m12"];
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const Q_LABELS = ["Q1","Q2","Q3","Q4"];
const WEEK_LABELS = Array.from({length:52},(_,i)=>`W${i+1}`);

// Full A-to-Z income order — hotel + multifamily + generic CRE
const INCOME_ORDER = [
  // Hotel room revenue
  "Rooms Revenue","Total Room Revenue","Food & Beverage Revenue","Other Operated Departments",
  "Miscellaneous Income","Parking Income","Laundry Income","Other Revenue",
  "Total Revenue",
  // Profit subtotals
  "Total Departmental Income","Rooms Dept Profit","Gross Operating Profit","EBITDAR","EBITDA",
  "Income Before Non-Oper Expenses","Net Income","Net Operating Income",
  // Multifamily
  "Gross Potential Rent","Rental Income","Late Fees","Vacancy & Credit Loss",
  "Bad Debt","Effective Gross Income",
  // KPI rows stored as income
  "Occupancy %","ADR","RevPAR",
];

// Full A-to-Z expense order
const EXPENSE_ORDER = [
  // Departmental
  "Rooms Expense","F&B Expense","Total Departmental Expenses",
  // Undistributed
  "Administrative & General","Information & Telecom","Sales & Marketing",
  "Property Operations & Maintenance","Repairs & Maintenance","Utilities",
  "Total Undistributed Expenses",
  // Fixed / non-operating
  "Management Fees","Franchise Fees","Reserve for Replacement",
  "Real Estate Taxes","Insurance","Total Fixed Charges","Total Non-Operating Expenses",
  // Below-line
  "Depreciation & Amortization","Interest Expense","Debt Service",
  // MF / generic
  "Payroll","Contract Services","Landscaping","Trash Removal","Cleaning",
  "Accounting","Legal & Professional","Administrative","General & Admin",
  "Marketing","Property Management",
  "Expense Ratio %","Total Operating Expenses",
];

// Rows that get bold/accent treatment
const HIGHLIGHT = new Set([
  "Total Revenue","Total Room Revenue","Rooms Revenue",
  "Gross Operating Profit","EBITDA","EBITDAR","Net Income","Net Operating Income",
  "Effective Gross Income","Total Departmental Income","Total Departmental Expenses",
  "Total Undistributed Expenses","Total Operating Expenses","Total Fixed Charges",
]);

// Human-readable glossary tooltips shown on hover
const GLOSSARY: Record<string,string> = {
  "Rooms Revenue":           "Revenue from room nights sold (rate × occupied rooms)",
  "Food & Beverage Revenue": "F&B department gross revenue (restaurant, bar, banquet, room service)",
  "Total Revenue":           "Sum of all operating department revenues",
  "Gross Operating Profit":  "Revenue minus all departmental and undistributed operating expenses (before fixed charges). Primary hotel profitability metric.",
  "EBITDA":                  "Earnings Before Interest, Tax, Depreciation & Amortization",
  "EBITDAR":                 "EBITDA before rent/lease obligations",
  "Net Operating Income":    "NOI = EGI − Total Operating Expenses. Key metric for cap rate and valuation.",
  "Net Income":              "Bottom-line profit after all expenses including debt service and taxes",
  "Effective Gross Income":  "EGI = Gross Potential Rent − Vacancy − Credit Loss + Other Income",
  "Gross Potential Rent":    "Maximum rent if 100% occupied at market rate",
  "Vacancy & Credit Loss":   "Lost revenue from vacant units and uncollected rent, expressed as % of GPR",
  "ADR":                     "Average Daily Rate — average revenue per occupied room",
  "RevPAR":                  "Revenue Per Available Room = Occupancy % × ADR",
  "Occupancy %":             "% of available rooms/units occupied during the period",
  "Management Fees":         "Fee paid to property management company, typically 3-6% of revenue",
  "Franchise Fees":          "Brand royalty + program fees, typically 8-12% of room revenue for flagged hotels",
  "Reserve for Replacement": "FF&E reserve fund for capital expenditures, typically 4% of revenue",
  "Debt Service":            "Total principal + interest payments on property debt",
  "Cap Rate":                "NOI ÷ Purchase Price — measures unlevered yield on cost",
  "DSCR":                    "Debt Service Coverage Ratio = NOI ÷ Annual Debt Service. Lenders require ≥1.20x",
  "Expense Ratio %":         "Total Operating Expenses ÷ EGI. Healthy range: 35-55%",
  "Real Estate Taxes":       "Annual property tax obligation",
  "Insurance":               "Property & casualty insurance premiums",
  "Depreciation & Amortization": "Non-cash accounting charge; added back in EBITDA calculation",
  "Interest Expense":        "Interest portion of mortgage/loan payments only",
};

type ViewMode = "annual" | "quarterly" | "monthly" | "weekly";

function fmt$(n: number | null | undefined, bold = false) {
  if (!n || n === 0) return <span className="text-slate-300">—</span>;
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? `$${(abs/1_000_000).toFixed(2)}M`
          : abs >= 1_000     ? `$${(abs/1_000).toFixed(0)}K`
          : `$${abs.toFixed(0)}`;
  return <span className={`${bold?"font-black text-primary":"font-medium"} ${neg?"text-red-500":"text-foreground"}`}>{neg?`(${s})`:s}</span>;
}

function fmtPlain(n: number | null | undefined): string {
  if (!n || n === 0) return "—";
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? `$${(abs/1_000_000).toFixed(2)}M`
          : abs >= 1_000     ? `$${(abs/1_000).toFixed(0)}K`
          : `$${abs.toFixed(0)}`;
  return neg ? `(${s})` : s;
}

function quarterly(row: DBFinancial): [number,number,number,number] {
  const g = (k: keyof DBFinancial) => (row[k] as number) || 0;
  return [g("m1")+g("m2")+g("m3"), g("m4")+g("m5")+g("m6"), g("m7")+g("m8")+g("m9"), g("m10")+g("m11")+g("m12")];
}

// Distribute TTM into 52 weekly estimates (proportional from monthly if available)
function weekly(row: DBFinancial): number[] {
  const monthVals = MONTH_KEYS.map(k => (row[k] as number) || 0);
  const hasMonthly = monthVals.some(v => v !== 0);
  const weeks: number[] = [];
  const DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
  let w = 0;
  for (let m = 0; m < 12; m++) {
    const weeksInMonth = DAYS[m] / 7;
    const weeklyVal = hasMonthly ? monthVals[m] / weeksInMonth : (row.ttm || 0) / 52;
    const full = Math.floor(weeksInMonth);
    const frac = weeksInMonth - full;
    for (let i = 0; i < full && w < 52; i++) { weeks.push(Math.round(weeklyVal * (1/weeksInMonth) * 7)); w++; }
    if (frac > 0.3 && w < 52) { weeks.push(Math.round(weeklyVal * frac)); w++; }
  }
  while (weeks.length < 52) weeks.push(0);
  return weeks.slice(0, 52);
}

function hasMonthlyData(rows: DBFinancial[]): boolean {
  return rows.some(r => MONTH_KEYS.some(k => (r[k] as number) > 0));
}

export default function FinancialDashboard({ dealId, deal, refreshKey = 0 }: Props) {
  const [rows, setRows]       = useState<DBFinancial[]>([]);
  const [kpis, setKpis]       = useState<Record<string,number>>({});
  const [loading, setLoading] = useState(true);
  const [panel, setPanel]     = useState<PanelData | null>(null);
  const [view, setView]       = useState<ViewMode>("annual");
  const [tooltip, setTooltip] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from("financials").select("*").eq("deal_id", dealId),
      supabase.from("extracted_data").select("field_name,value")
        .eq("deal_id", dealId)
        .in("field_name", ["occupancy","adr","revpar","dscr","cap_rate","noi","expense_ratio"]),
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
    if (filled.length >= 2) {
      const prev = row[filled[filled.length-2]] as number;
      const curr = row[filled[filled.length-1]] as number;
      if (prev > 0) return `${((curr-prev)/prev*100) > 0 ? "+" : ""}${((curr-prev)/prev*100).toFixed(1)}%`;
    }
    if ((row.ttm as number) > 0 && filled.length >= 1) {
      const prev = row[filled[filled.length-1]] as number;
      if (prev > 0) return `${(((row.ttm as number)-prev)/prev*100) > 0 ? "+" : ""}${(((row.ttm as number)-prev)/prev*100).toFixed(1)}%`;
    }
    return "—";
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

  const revenue    = findRow("Total Revenue","Total Operating Revenue","Effective Gross Income","Rooms Revenue");
  const gopRow     = findRow("Gross Operating Profit");
  const ebitdaRow  = findRow("EBITDA");
  const ebitdarRow = findRow("EBITDAR");
  const netIncRow  = findRow("Net Income");
  const noiRow     = findRow("Net Operating Income","NOI");
  const egi        = findRow("Effective Gross Income");
  const totalExp   = findRow("Total Operating Expenses","Total Departmental Expenses");
  const debtSvc    = findRow("Debt Service","Interest Expense");
  const mgmtFees   = findRow("Management Fees");
  const franFees   = findRow("Franchise Fees");
  const taxes      = findRow("Real Estate Taxes");
  const insurance  = findRow("Insurance");
  const reserves   = findRow("Reserve for Replacement");

  const revTTM      = revenue?.ttm    || 0;
  const gopTTM      = gopRow?.ttm     || 0;
  const ebitdaTTM   = ebitdaRow?.ttm  || 0;
  const netIncTTM   = netIncRow?.ttm  || 0;
  const noiTTM      = noiRow?.ttm || gopTTM || ebitdaTTM || deal?.noi || 0;
  const egiTTM      = egi?.ttm || revTTM;
  const opexTTM     = totalExp?.ttm   || 0;
  const debtSvcTTM  = debtSvc?.ttm    || 0;

  const occupancyPct = kpis.occupancy || deal?.occupancy_rate || 0;
  const adr          = kpis.adr       || 0;
  const revpar       = kpis.revpar    || 0;
  const dscrVal      = kpis.dscr      || deal?.dscr || (debtSvcTTM > 0 && noiTTM > 0 ? parseFloat((noiTTM/debtSvcTTM).toFixed(2)) : 0);

  const profitable   = noiTTM > 0;
  const gopMargin    = revTTM > 0 && gopTTM  > 0 ? (gopTTM  / revTTM) * 100 : 0;
  const noiMargin    = egiTTM > 0 && noiTTM !== 0 ? (noiTTM  / egiTTM) * 100 : 0;
  const expenseRatio = egiTTM > 0 && opexTTM > 0  ? (opexTTM / egiTTM) * 100 : 0;
  const noiPerUnit   = deal?.units && deal.units > 0 && noiTTM !== 0 ? Math.round(noiTTM / deal.units) : 0;
  const revPerUnit   = deal?.units && deal.units > 0 && revTTM > 0   ? Math.round(revTTM / deal.units) : 0;
  const impliedCap   = deal?.guidance_price && deal.guidance_price > 0 && noiTTM > 0
                       ? ((noiTTM / deal.guidance_price) * 100).toFixed(2) : null;
  const weeklyNOI    = noiTTM > 0 ? Math.round(noiTTM / 52) : 0;
  const weeklyRev    = revTTM > 0 ? Math.round(revTTM / 52) : 0;

  const BadgeTrend = ({ row }: { row: DBFinancial }) => {
    const yoy = yoyPct(row);
    const v = parseFloat(yoy);
    const up = !isNaN(v) && v > 0;
    return (
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1
        ${yoy==="—" ? "text-slate-300" : up ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
        {yoy==="—" ? "—" : <>{up ? <TrendingUp className="h-3 w-3"/> : <TrendingDown className="h-3 w-3"/>}{yoy}</>}
      </span>
    );
  };

  if (loading) return (
    <div className="p-6 space-y-3">{[1,2,3,4,5].map(i=><div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse"/>)}</div>
  );
  if (!rows.length) return (
    <div className="text-center py-12 text-muted-foreground text-sm">
      <BarChart3 className="h-8 w-8 mx-auto mb-2 text-slate-200"/>
      Financial data will appear after extraction
    </div>
  );

  const canViewMonthly = hasMonthlyData(rows);

  // ── Table section renderer ───────────────────────────────────────────────
  const TableSection = ({ title, sectionRows, color }: { title: string; sectionRows: DBFinancial[]; color: string }) => {
    const colCount = view==="annual" ? YEAR_KEYS.length+3
                   : view==="quarterly" ? 4+2
                   : view==="monthly" ? MONTH_KEYS.length+2
                   : 52+1; // weekly
    return (
      <>
        <tr className={`${color} border-y border-border`}>
          <td colSpan={colCount+1} className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</td>
        </tr>
        {sectionRows.map((row, i) => {
          const hi   = HIGHLIGHT.has(row.sub_category);
          const qs   = quarterly(row);
          const ws   = view === "weekly" ? weekly(row) : [];
          const tip  = GLOSSARY[row.sub_category];
          return (
            <motion.tr key={row.id}
              initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*0.02}}
              className={`hover:bg-[#FFF6ED] transition-colors cursor-pointer group ${hi?"bg-slate-50/80":""}`}
              onClick={()=>setPanel(buildPanel(row))}>
              <td className={`px-4 py-2.5 text-sm ${hi?"font-black text-foreground":"font-medium text-slate-700"} relative`}>
                <span className="flex items-center gap-1.5"
                  onMouseEnter={()=>tip && setTooltip(`${row.sub_category}||${tip}`)}
                  onMouseLeave={()=>setTooltip(null)}>
                  {hi && <span className="w-1 h-4 bg-primary rounded-full flex-shrink-0"/>}
                  {row.sub_category}
                  <Sparkles className="h-3 w-3 text-violet-300 opacity-0 group-hover:opacity-100 transition-opacity ml-auto"/>
                </span>
                {tooltip?.startsWith(row.sub_category+"||") && (
                  <div className="absolute left-full top-0 z-50 ml-2 w-64 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none">
                    <div className="font-bold mb-1">{row.sub_category}</div>
                    {tooltip.split("||")[1]}
                  </div>
                )}
              </td>
              {view==="annual" && YEAR_KEYS.map(k=>(
                <td key={k} className="px-4 py-2.5 text-sm text-right">{fmt$(row[k] as number, k==="ttm")}</td>
              ))}
              {view==="quarterly" && qs.map((q,qi)=>(
                <td key={qi} className="px-4 py-2.5 text-sm text-right">{fmt$(q)}</td>
              ))}
              {view==="monthly" && MONTH_KEYS.map(k=>(
                <td key={k} className="px-4 py-2.5 text-sm text-right">{fmt$(row[k] as number)}</td>
              ))}
              {view==="weekly" && ws.map((w,wi)=>(
                <td key={wi} className="px-2 py-2.5 text-xs text-right min-w-[52px]">{w>0?`$${(w/1000).toFixed(0)}K`:"—"}</td>
              ))}
              {/* Extra columns */}
              {view==="annual" && (
                <>
                  <td className="px-4 py-2.5 text-sm text-right text-slate-500">{row.per_unit>0?`$${row.per_unit.toLocaleString(undefined,{maximumFractionDigits:0})}`:"—"}</td>
                  <td className="px-4 py-2.5 text-sm text-right text-slate-500">{row.pct_egi>0?`${row.pct_egi.toFixed(1)}%`:"—"}</td>
                  <td className="px-4 py-2.5 text-sm"><BadgeTrend row={row}/></td>
                </>
              )}
              {view==="quarterly" && (
                <>
                  <td className="px-4 py-2.5 text-sm text-right text-slate-500">{row.per_unit>0?`$${Math.round(row.per_unit/4).toLocaleString()}`:"—"}</td>
                  <td className="px-4 py-2.5 text-sm"><BadgeTrend row={row}/></td>
                </>
              )}
              {(view==="monthly"||view==="weekly") && (
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
        profitable ? "bg-emerald-50 border-emerald-100"
        : noiTTM===0 ? "bg-slate-50 border-slate-200"
        : "bg-red-50 border-red-100"}`}>
        <div className={`p-2.5 rounded-xl ${profitable?"bg-emerald-100":noiTTM===0?"bg-slate-100":"bg-red-100"}`}>
          {profitable ? <CheckCircle2 className="h-5 w-5 text-emerald-600"/>
           : noiTTM===0 ? <Minus className="h-5 w-5 text-slate-400"/>
           : <AlertTriangle className="h-5 w-5 text-red-500"/>}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-black ${profitable?"text-emerald-700":noiTTM===0?"text-slate-500":"text-red-600"}`}>
            {profitable ? `Profitable — NOI ${fmtPlain(noiTTM)} TTM`
             : noiTTM===0 ? "Profitability data not yet extracted"
             : `Operating at a Loss: ${fmtPlain(noiTTM)} TTM`}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-4">
            {gopTTM    !== 0 && <span>GOP {fmtPlain(gopTTM)}</span>}
            {ebitdaTTM !== 0 && <span>EBITDA {fmtPlain(ebitdaTTM)}</span>}
            {gopMargin  > 0  && <span>GOP Margin {gopMargin.toFixed(1)}%</span>}
            {noiMargin  !== 0 && <span>NOI Margin {noiMargin.toFixed(1)}%</span>}
            {expenseRatio > 0 && <span>Exp. Ratio {expenseRatio.toFixed(1)}%</span>}
            {noiPerUnit  !== 0 && <span>NOI/Unit ${Math.abs(noiPerUnit).toLocaleString()}</span>}
            {weeklyNOI   > 0  && <span>Weekly NOI ${weeklyNOI.toLocaleString()}</span>}
          </div>
        </div>
        {impliedCap && (
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Implied Cap</div>
            <div className="text-lg font-black text-foreground">{impliedCap}%</div>
          </div>
        )}
      </div>

      {/* ── Hotel KPI strip ── */}
      {(occupancyPct>0 || adr>0 || revpar>0) && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label:"Occupancy", value:occupancyPct>0?`${occupancyPct.toFixed(1)}%`:"—", sub:"Target ≥80%",
              color:occupancyPct>=80?"text-emerald-600":occupancyPct>=65?"text-amber-500":"text-red-500", key:"occupancy" },
            { label:"ADR",       value:adr>0?`$${adr.toFixed(2)}`:"—",         sub:"Avg Daily Rate",  color:"text-foreground", key:"adr"    },
            { label:"RevPAR",    value:revpar>0?`$${revpar.toFixed(2)}`:"—",   sub:"Rev/Avail Room",  color:"text-foreground", key:"revpar" },
          ].map(card=>(
            <div key={card.label}
              className="bg-slate-50 border border-border rounded-xl px-4 py-3 cursor-pointer group hover:border-primary/30 hover:bg-white hover:shadow-sm transition-all"
              onClick={()=>{ const r=findRow(card.key,card.label); if(r) setPanel(buildPanel(r)); }}>
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{card.label}</div>
                <div className="text-[10px] text-slate-400">{card.sub}</div>
              </div>
              <div className={`text-xl font-black mt-1 ${card.color}`}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Key metric cards (2 rows of 4) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label:"Guidance Price",   value:fmtPlain(deal?.guidance_price), sub:"Asking price",           icon:DollarSign,  keys:[] as string[] },
          { label:"Total Revenue",    value:fmtPlain(revTTM||undefined),    sub:`$${revPerUnit.toLocaleString()}/unit/yr`,  icon:TrendingUp,  keys:["Total Revenue","Total Operating Revenue","Effective Gross Income","Rooms Revenue"] },
          { label:"Gross Op. Profit", value:fmtPlain(gopTTM||undefined),    sub:gopMargin>0?`${gopMargin.toFixed(1)}% margin`:"", icon:BarChart3,   keys:["Gross Operating Profit"] },
          { label:"EBITDA",           value:fmtPlain(ebitdaTTM||undefined), sub:"Before D&A + debt",      icon:Activity,    keys:["EBITDA"] },
          { label:"Net Op. Income",   value:fmtPlain(noiTTM||undefined),    sub:noiMargin!==0?`${noiMargin.toFixed(1)}% of EGI`:"", icon:Building2,  keys:["Net Operating Income","NOI","Gross Operating Profit"] },
          { label:"Cap Rate",         value:deal?.cap_rate?`${deal.cap_rate}%`:(impliedCap?`${impliedCap}%`:"—"), sub:"NOI ÷ Price",  icon:Percent,    keys:[] },
          { label:"DSCR",             value:dscrVal>0?`${dscrVal.toFixed(2)}x`:"—",  sub:"Target ≥1.20×", icon:Layers,      keys:[] },
          { label:"Weekly Revenue",   value:weeklyRev>0?`$${weeklyRev.toLocaleString()}`:"—", sub:"TTM ÷ 52",  icon:Calendar,    keys:["Total Revenue","Total Operating Revenue","Rooms Revenue"] },
        ].map(card=>{
          const Icon = card.icon;
          const isNeg = card.value.startsWith("(");
          const isDSCR = card.label==="DSCR";
          const dscrWarn = isDSCR && dscrVal > 0 && dscrVal < 1.20;
          return (
            <div key={card.label}
              className={`bg-white border rounded-xl p-4 cursor-pointer group hover:border-primary/30 hover:shadow-md transition-all
                ${dscrWarn?"border-amber-300 bg-amber-50":"border-border"}`}
              onClick={()=>{ if(!card.keys.length) return; const r=findRow(...card.keys); if(r) setPanel(buildPanel(r)); }}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{card.label}</div>
                <Icon className={`h-3.5 w-3.5 ${isNeg||dscrWarn?"text-amber-400":"text-slate-300"} group-hover:text-primary transition-colors`}/>
              </div>
              <div className={`text-xl font-heading font-black ${isNeg?"text-red-500":dscrWarn?"text-amber-600":"text-foreground"}`}>{card.value}</div>
              {card.sub && <div className="text-[10px] text-slate-400 mt-0.5">{card.sub}</div>}
            </div>
          );
        })}
      </div>

      {/* ── Expense breakdown mini-grid ── */}
      {(mgmtFees||franFees||taxes||insurance||reserves) && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-red-50/40 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Fixed Cost Breakdown (TTM)
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 divide-x divide-y divide-border">
            {[
              { label:"Mgmt Fees",   row:mgmtFees,  tip:"Typically 3-6% of revenue" },
              { label:"Franchise",   row:franFees,  tip:"Brand royalty fees (hotels)" },
              { label:"RE Taxes",    row:taxes,     tip:"Annual property tax" },
              { label:"Insurance",   row:insurance, tip:"Property & casualty" },
              { label:"FF&E Reserve",row:reserves,  tip:"Capital reserve fund" },
            ].filter(x=>x.row).map(x=>(
              <div key={x.label} className="px-4 py-3">
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{x.label}</div>
                <div className="text-base font-black text-foreground mt-0.5">{fmtPlain(x.row?.ttm)}</div>
                {revTTM>0 && x.row?.ttm ? <div className="text-[10px] text-slate-400">{((x.row.ttm/revTTM)*100).toFixed(1)}% of rev</div> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Operating Statement table ── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-[#FFF6ED] flex items-center gap-3">
          <BarChart3 className="h-4 w-4 text-primary"/>
          <span className="text-sm font-bold">Operating Statement</span>
          <div className="ml-auto flex items-center gap-1 bg-white border border-border rounded-lg p-0.5">
            {(["annual","quarterly","monthly","weekly"] as ViewMode[]).map(v=>(
              <button key={v} onClick={()=>setView(v)} disabled={v!=="annual"&&v!=="weekly"&&!canViewMonthly}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold capitalize transition-colors
                  ${view===v?"bg-primary text-white":"text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"}`}>
                <Calendar className="h-3 w-3"/>{v}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-border">
                <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest w-52 sticky left-0 bg-slate-50">Line Item</th>
                {view==="annual" && YEAR_KEYS.map(k=>(
                  <th key={k} className={`px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-widest ${k==="ttm"?"text-primary":"text-muted-foreground"}`}>{YEAR_LABELS[k]}</th>
                ))}
                {view==="quarterly" && Q_LABELS.map(q=>(
                  <th key={q} className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">{q}</th>
                ))}
                {view==="monthly" && MONTH_LABELS.map(m=>(
                  <th key={m} className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">{m}</th>
                ))}
                {view==="weekly" && WEEK_LABELS.map(w=>(
                  <th key={w} className="px-2 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest min-w-[52px]">{w}</th>
                ))}
                {view==="annual" && <>
                  <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Per Unit</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">% EGI</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">YoY</th>
                </>}
                {view==="quarterly" && <>
                  <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Per Unit</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">YoY</th>
                </>}
                {(view==="monthly"||view==="weekly") && (
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">YoY</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedIncome.length>0   && <TableSection title="Income"   sectionRows={sortedIncome}   color="bg-emerald-50/50"/>}
              {sortedExpenses.length>0 && <TableSection title="Expenses" sectionRows={sortedExpenses} color="bg-red-50/50"/>}
            </tbody>
          </table>
        </div>

        {/* NOI footer */}
        {noiTTM !== 0 && (
          <div className={`border-t-2 ${profitable?"border-emerald-200 bg-emerald-50/60":"border-red-200 bg-red-50/60"} px-4 py-3 flex items-center justify-between`}>
            <span className="text-sm font-black text-foreground flex items-center gap-2">
              {profitable ? <CheckCircle2 className="h-4 w-4 text-emerald-500"/> : <AlertTriangle className="h-4 w-4 text-red-400"/>}
              Net Operating Income (TTM)
            </span>
            <div className="text-right">
              <span className={`text-lg font-black ${profitable?"text-emerald-600":"text-red-500"}`}>{fmtPlain(noiTTM)}</span>
              {weeklyNOI>0 && <div className="text-[10px] text-slate-400">${weeklyNOI.toLocaleString()}/week</div>}
            </div>
          </div>
        )}
      </div>

      {panel && <DetailPanel dealId={dealId} data={panel} onClose={()=>setPanel(null)}/>}
    </div>
  );
}
