"use client";

import { motion } from "framer-motion";
import {
  X, CheckCircle2, FileText, BarChart3, HelpCircle, ClipboardList,
  ShieldAlert, Info, Download, Copy, AlertTriangle, XCircle, TrendingUp,
  TrendingDown, Minus, ExternalLink, ChevronRight, Building2, MapPin,
  DollarSign, Calendar, Users
} from "lucide-react";
import type { Deal } from "@/lib/mockData";
import { formatCurrencyFull, formatCurrency } from "@/lib/mockData";

type AgentKey = "metadata" | "summary" | "questions" | "criteria" | "financial" | "risks";

interface Props {
  agentKey: AgentKey;
  deal: Deal;
  onClose: () => void;
}

// ── Shared: Source chip ──────────────────────────────────────────────────────
function SourceChip({ label, href }: { label: string; href?: string }) {
  const cls = "inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded ml-1 transition-colors";
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer"
        className={`${cls} hover:bg-blue-100 hover:border-blue-300 cursor-pointer`}>
        <FileText className="h-2.5 w-2.5" />
        {label}
        <ExternalLink className="h-2 w-2 opacity-60" />
      </a>
    );
  }
  return (
    <span className={`${cls} opacity-60`}>
      <FileText className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

// Resolve a deal file URL by matching on type or name keywords
function resolveFileUrl(deal: Deal, ...keywords: string[]): string | undefined {
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    const match = deal.files.find(
      (f) => f.name.toLowerCase().includes(kwLower) || f.type.toLowerCase().includes(kwLower)
    );
    if (match?.url) return match.url;
  }
  return undefined;
}

// ── Shared: Modal Shell ──────────────────────────────────────────────────────
function ModalShell({
  title, icon: Icon, iconColor, completedAt, onClose, children, footer
}: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  completedAt: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
        className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
        style={{ maxHeight: "92vh" }}
      >
        {/* Header */}
        <div className="px-8 py-5 border-b border-border flex items-center justify-between flex-shrink-0 bg-white">
          <div>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconColor} shadow-lg shadow-primary/10`}>
                <Icon className="h-4.5 w-4.5 text-white" />
              </div>
              <h2 className="text-[20px] font-heading font-black text-foreground tracking-tight">{title}</h2>
              <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] px-2.5 py-1 rounded-full font-black tracking-widest uppercase">
                <CheckCircle2 className="h-3 w-3" /> COMPLETE
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground font-bold tracking-widest uppercase mt-1 pl-12">{completedAt}</p>
          </div>
          <button onClick={onClose} className="p-2.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-7 space-y-6">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-7 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between flex-shrink-0">
            {footer}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── INVESTMENT SUMMARY ────────────────────────────────────────────────────────
function SummaryModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  return (
    <ModalShell
      title="Investment Summary"
      icon={FileText}
      iconColor="bg-orange-500"
      completedAt="Completed Dec 12, 1:48 PM"
      onClose={onClose}
      footer={
        <>
          <span className="text-xs text-slate-400">AI-generated · Based on OM + Financial Documents</span>
          <div className="flex gap-2">
            <button className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50 transition-colors">
              <Copy className="h-3.5 w-3.5" /> Copy CSV
            </button>
            <button className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-colors">
              <Download className="h-3.5 w-3.5" /> Download CSV
            </button>
          </div>
        </>
      }
    >
      {/* Deal summary header */}
      <div>
        <h3 className="font-heading font-black text-foreground text-[17px] mb-4 tracking-tight">Executive Overview: {deal.name}</h3>
        <div className="premium-card p-6 space-y-3 bg-muted/30">
          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-2">Primary Asset Characteristics</p>
          <ul className="space-y-2 text-[13.5px] text-foreground leading-relaxed">
            <li className="flex items-start gap-2.5">
              <span className="text-primary flex-shrink-0 mt-1">●</span>
              <span>{deal.units}-room {deal.assetType.toLowerCase()} {deal.propertyType.toLowerCase()}, built {deal.yearBuilt}
              {deal.brand !== "N/A" ? ` (${deal.brand} Flag)` : ""}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-primary flex-shrink-0 mt-1">●</span>
              <span>Located in prime market: {deal.address}, {deal.city}, {deal.state}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="text-primary flex-shrink-0 mt-1">●</span>
              <span>Feature Set: {deal.amenities.join(", ")}</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Financial Performance Table */}
      <div>
        <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-3">Institutional Performance History</p>
        <div className="premium-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted border-b border-border">
              <tr>
                {["Metric", "2021", "2022", "2023", "TTM (JAN '24)"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deal.financials.map((row) => (
                <tr key={row.metric} className="hover:bg-muted/50 transition-colors">
                  <td className="px-5 py-4 font-bold text-foreground text-[13px]">{row.metric}</td>
                  <td className="px-5 py-4 text-muted-foreground text-[13px]">{formatCurrencyFull(row.y2021)}</td>
                  <td className="px-5 py-4 text-muted-foreground text-[13px]">{formatCurrencyFull(row.y2022)}</td>
                  <td className="px-5 py-4 text-muted-foreground text-[13px]">{formatCurrencyFull(row.y2023)}</td>
                  <td className="px-5 py-4 font-black text-primary text-[13px]">{formatCurrencyFull(row.ttm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Broker narrative */}
      <div>
        <p className="text-[13px] leading-relaxed text-slate-700">
          <span className="font-semibold text-slate-900">Broker Narrative: </span>
          {deal.brokerNarrative}
          <SourceChip label="Offering Memorandum" href={resolveFileUrl(deal, "pdf", "om", "offering")} />
        </p>
      </div>

      {/* Location insight */}
      <div>
        <p className="text-[13px] leading-relaxed text-slate-700">
          <span className="font-semibold text-slate-900">Location: </span>
          {deal.locationInsight}
        </p>
      </div>

      {/* Capital Expenditures */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="text-[12px] font-bold text-amber-800 uppercase tracking-wider mb-1.5">Capital Expenditures &amp; Property Condition</p>
        <p className="text-sm text-slate-700 leading-relaxed">
          Property is {new Date().getFullYear() - deal.yearBuilt} years old (built {deal.yearBuilt}). Replacement reserves set at 4.0% of total revenue.
          {deal.risks.find(r => r.toLowerCase().includes("capex") || r.toLowerCase().includes("capital")) && (
            <span className="block mt-1 text-amber-700 font-medium">
              ⚠ {deal.risks.find(r => r.toLowerCase().includes("capex") || r.toLowerCase().includes("capital"))}
            </span>
          )}
        </p>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Guidance Price", value: formatCurrency(deal.guidancePrice), icon: DollarSign, color: "text-primary bg-primary/10" },
          { label: "NOI (TTM)", value: formatCurrency(deal.noi), icon: TrendingUp, color: "text-emerald-600 bg-emerald-100" },
          { label: "Cap Rate", value: `${deal.capRate}%`, icon: BarChart3, color: "text-blue-600 bg-blue-100" },
          { label: "Total Units", value: deal.units.toString(), icon: Building2, color: "text-violet-600 bg-violet-100" },
          { label: "Year Built", value: deal.yearBuilt.toString(), icon: Calendar, color: "text-slate-600 bg-secondary" },
          { label: "Broker Agent", value: deal.broker, icon: Users, color: "text-indigo-600 bg-indigo-100" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="premium-card p-5 bg-white">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color} mb-3 shadow-sm`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{label}</div>
            <div className="text-[15px] font-heading font-black text-foreground mt-1 truncate">{value}</div>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

// ── INVESTMENT CRITERIA ───────────────────────────────────────────────────────
function CriteriaModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const allMeet = deal.criteria.every((c) => c.meets);
  const failedCriteria = deal.criteria.filter((c) => !c.meets);
  const revenue = deal.financials.find((r) => r.metric === "Total Revenue" || r.metric === "Gross Rent" || r.metric === "Gross Income");

  return (
    <ModalShell
      title="Investment Criteria"
      icon={ClipboardList}
      iconColor="bg-emerald-500"
      completedAt="Completed Dec 12, 1:53 PM"
      onClose={onClose}
      footer={
        <>
          <span className="text-xs text-slate-400">AI-generated · Based on extracted financials</span>
          <button className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-colors">
            <Copy className="h-3.5 w-3.5" /> Copy to clipboard
          </button>
        </>
      }
    >
      {/* AI narrative intro */}
      <div className="text-sm text-slate-700 leading-relaxed space-y-3">
        <p>
          Based on my analysis of the <strong>{deal.city}, {deal.state} deal ({deal.name})</strong>, here's how it fits your investment criteria:
        </p>
      </div>

      {/* Property Age Section */}
      <div className={`border rounded-xl p-4 ${deal.yearBuilt < 2005 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
        <h4 className={`font-bold text-sm mb-2 ${deal.yearBuilt < 2005 ? "text-red-800" : "text-emerald-800"}`}>
          Property Age: {deal.yearBuilt < 2005 ? "Does NOT Meet Criteria" : "Meets Criteria"}
        </h4>
        <p className="text-sm text-slate-700 leading-relaxed">
          The property was built in {deal.yearBuilt}, making it approximately {new Date().getFullYear() - deal.yearBuilt} years old as of {new Date().getFullYear()}.
          {deal.yearBuilt < 2010
            ? " This may exceed the standard age requirement for institutional-grade assets."
            : " This falls within acceptable vintage requirements."}
          <SourceChip label="Offering Memorandum" href={resolveFileUrl(deal, "pdf", "om", "offering")} />
        </p>
      </div>

      {/* Revenue Performance */}
      {revenue && (
        <div>
          <h4 className="font-bold text-sm text-slate-800 mb-3">Revenue Growth Analysis</h4>
          <div className="space-y-2">
            {[
              { year: "2021", val: revenue.y2021 },
              { year: "2022", val: revenue.y2022 },
              { year: "2023", val: revenue.y2023 },
              { year: "TTM", val: revenue.ttm },
            ].map(({ year, val }) => (
              <div key={year} className="flex items-center gap-2 text-sm text-slate-700">
                <span className="text-slate-400 w-10 font-medium">{year}:</span>
                <span className="font-semibold text-slate-800">{formatCurrencyFull(val)}</span>
                <SourceChip label={`${year} Financials`} />
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-600 leading-relaxed mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            Revenue growth analysis: TTM of {formatCurrencyFull(revenue.ttm)} vs 2021 baseline of {formatCurrencyFull(revenue.y2021)}.
          </p>
        </div>
      )}

      {/* Conclusion */}
      <div className={`border rounded-xl p-4 ${allMeet ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
        <h4 className={`font-bold text-sm mb-2 ${allMeet ? "text-emerald-800" : "text-red-800"}`}>Conclusion</h4>
        {allMeet ? (
          <p className="text-sm text-emerald-700 leading-relaxed">
            This deal <strong>MEETS</strong> all {deal.criteria.length} of your investment criteria. It qualifies for further underwriting.
          </p>
        ) : (
          <>
            <p className="text-sm text-red-700 leading-relaxed mb-2">
              This deal does <strong>NOT</strong> meet your criteria due to:
            </p>
            <ol className="list-decimal pl-5 text-sm text-red-700 space-y-1">
              {failedCriteria.map((c, i) => (
                <li key={i}>{c.criteria}: {c.requirement} (actual: {c.actual})</li>
              ))}
            </ol>
            {deal.criteria.some((c) => c.meets) && (
              <p className="text-sm text-slate-600 mt-2">
                However, it does meet {deal.criteria.filter(c => c.meets).length} of {deal.criteria.length} criteria.
              </p>
            )}
          </>
        )}
      </div>

      {/* Criteria Table */}
      <div>
        <h4 className="font-bold text-sm text-slate-800 mb-3">{deal.city}, {deal.state} Investment Criteria Analysis</h4>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Criteria", "Requirement", "Actual", "Meets Criteria"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deal.criteria.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{row.criteria}</td>
                  <td className="px-4 py-3 text-slate-500">{row.requirement}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.actual}</td>
                  <td className="px-4 py-3">
                    {row.meets
                      ? <span className="flex items-center gap-1 text-emerald-600 font-bold text-xs"><CheckCircle2 className="h-3.5 w-3.5" />YES</span>
                      : <span className="flex items-center gap-1 text-red-600 font-bold text-xs"><XCircle className="h-3.5 w-3.5" />NO</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ModalShell>
  );
}

// ── DD QUESTIONS ─────────────────────────────────────────────────────────────
function QuestionsModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  // Categorize questions
  const categories = [
    {
      title: "Financial Performance & Trends",
      icon: TrendingUp,
      color: "text-blue-600",
      bg: "bg-blue-50 border-blue-200",
      questions: deal.questions.filter((_, i) => i % 3 === 0 || i === 0),
      subcategories: ["Revenue Concerns", "Profitability Analysis"],
    },
    {
      title: "Operational Issues & Red Flags",
      icon: AlertTriangle,
      color: "text-amber-600",
      bg: "bg-amber-50 border-amber-200",
      questions: deal.questions.filter((_, i) => i % 3 === 1),
      subcategories: ["Expense Management", "Competitive Position"],
    },
    {
      title: "Capital Expenditures & Property Condition",
      icon: Building2,
      color: "text-violet-600",
      bg: "bg-violet-50 border-violet-200",
      questions: deal.questions.filter((_, i) => i % 3 === 2),
      subcategories: ["CapEx History", "Deferred Maintenance"],
    },
  ];

  // Assign source chips per question
  const getChips = (i: number) => {
    const chips = [
      ["2024 Budget", "2024 Financials"],
      ["2023 Financials", "2022 Financials"],
      ["2021 Financials"],
      ["Offering Memorandum", "2023 Financials"],
    ];
    return chips[i % chips.length] || [];
  };

  return (
    <ModalShell
      title="Due Diligence Questions"
      icon={HelpCircle}
      iconColor="bg-violet-500"
      completedAt="Completed Dec 12, 1:51 PM"
      onClose={onClose}
      footer={
        <>
          <span className="text-xs text-slate-400">{deal.questions.length} questions generated · AI-powered analysis</span>
          <button className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-colors">
            <Copy className="h-3.5 w-3.5" /> Copy all questions
          </button>
        </>
      }
    >
      {/* All questions in sections */}
      {categories.map((cat, ci) => {
        const catQuestions = deal.questions.filter((_, qi) => qi % 3 === ci || (ci === 0 && qi === 0));
        if (catQuestions.length === 0 && deal.questions.length <= ci) return null;

        return (
          <div key={ci} className="space-y-3">
            <div className={`flex items-center gap-2 p-3 rounded-xl border ${cat.bg}`}>
              <cat.icon className={`h-4 w-4 ${cat.color}`} />
              <h4 className={`font-bold text-sm ${cat.color}`}>{cat.title}</h4>
            </div>
            <div className="space-y-2 pl-1">
              {deal.questions
                .slice(ci * Math.ceil(deal.questions.length / 3), (ci + 1) * Math.ceil(deal.questions.length / 3))
                .map((q, qi) => (
                  <div key={qi} className="flex items-start gap-2.5 text-sm text-slate-700 leading-relaxed py-2 border-b border-slate-100 last:border-0">
                    <span className="flex-shrink-0 w-5 h-5 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5">
                      {qi + 1 + ci * Math.ceil(deal.questions.length / 3)}
                    </span>
                    <div>
                      <span>{q}</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {getChips(qi + ci).map((chip) => (
                          <SourceChip key={chip} label={chip} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        );
      })}

      {/* Risk flags as additional questions */}
      {deal.risks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 rounded-xl border bg-red-50 border-red-200">
            <ShieldAlert className="h-4 w-4 text-red-600" />
            <h4 className="font-bold text-sm text-red-600">Risk-Based Follow-Ups</h4>
          </div>
          <div className="space-y-2 pl-1">
            {deal.risks.map((risk, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm text-slate-700 leading-relaxed py-2 border-b border-slate-100 last:border-0">
                <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span>Given that "{risk}", what is the mitigation strategy?</span>
                  <div className="mt-1">
                    <SourceChip label="Risk Assessment" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ── FINANCIAL ANALYSIS ────────────────────────────────────────────────────────
function FinancialModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const revenue = deal.financials.find((r) => r.metric.includes("Revenue") || r.metric.includes("Rent") || r.metric.includes("Income"));
  const noi = deal.financials.find((r) => r.metric === "NOI");
  const ebitda = deal.financials.find((r) => r.metric === "EBITDA");

  const growthPct = revenue
    ? (((revenue.ttm - revenue.y2021) / revenue.y2021) * 100).toFixed(1)
    : "0";

  return (
    <ModalShell
      title="Financial Analysis"
      icon={BarChart3}
      iconColor="bg-indigo-500"
      completedAt="Completed Dec 12, 1:45 PM"
      onClose={onClose}
      footer={
        <>
          <span className="text-xs text-slate-400">AI-generated · Parsed from financial worksheets</span>
          <div className="flex gap-2">
            <button className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50 transition-colors">
              <Copy className="h-3.5 w-3.5" /> Copy CSV
            </button>
            <button className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-colors">
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          </div>
        </>
      }
    >
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-xl p-4 text-center">
          <div className="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-1">TTM Revenue</div>
          <div className="text-lg font-black text-orange-700">{revenue ? formatCurrency(revenue.ttm) : "—"}</div>
          <div className="text-[10px] text-orange-500 mt-0.5 flex items-center justify-center gap-0.5">
            <TrendingUp className="h-3 w-3" /> +{growthPct}% vs 2021
          </div>
        </div>
        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 rounded-xl p-4 text-center">
          <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1">TTM NOI</div>
          <div className="text-lg font-black text-emerald-700">{noi ? formatCurrency(noi.ttm) : formatCurrency(deal.noi)}</div>
          <div className="text-[10px] text-emerald-500 mt-0.5">Net Operating Income</div>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-4 text-center">
          <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">Cap Rate</div>
          <div className="text-lg font-black text-blue-700">{deal.capRate}%</div>
          <div className="text-[10px] text-blue-500 mt-0.5">Going-in cap rate</div>
        </div>
      </div>

      {/* Full financials table */}
      <div>
        <h4 className="font-bold text-sm text-slate-800 mb-3">Complete Financial Performance</h4>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Metric", "2021", "2022", "2023", "TTM"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deal.financials.map((row) => {
                const growth = row.y2021 > 0 ? ((row.ttm - row.y2021) / row.y2021 * 100).toFixed(0) : "0";
                const isPositive = Number(growth) > 0;
                return (
                  <tr key={row.metric} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.metric}</td>
                    <td className="px-4 py-3 text-slate-600">{formatCurrencyFull(row.y2021)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatCurrencyFull(row.y2022)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatCurrencyFull(row.y2023)}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-orange-500">{formatCurrencyFull(row.ttm)}</div>
                      <div className={`text-[10px] flex items-center gap-0.5 ${isPositive ? "text-emerald-500" : "text-red-500"}`}>
                        {isPositive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                        {isPositive ? "+" : ""}{growth}% vs 2021
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Key ratios */}
      <div>
        <h4 className="font-bold text-sm text-slate-800 mb-3">Key Financial Ratios</h4>
        <div className="space-y-2">
          {noi && revenue && (
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-sm text-slate-600">NOI Margin (TTM)</span>
              <span className="font-bold text-slate-900">
                {((noi.ttm / revenue.ttm) * 100).toFixed(1)}%
                <SourceChip label="TTM Financials" />
              </span>
            </div>
          )}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="text-sm text-slate-600">Price / Unit</span>
            <span className="font-bold text-slate-900">
              {formatCurrency(deal.guidancePrice / deal.units)}
            </span>
          </div>
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="text-sm text-slate-600">Going-In Cap Rate</span>
            <span className="font-bold text-slate-900">{deal.capRate}%</span>
          </div>
          {ebitda && revenue && (
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-sm text-slate-600">EBITDA Margin (TTM)</span>
              <span className="font-bold text-slate-900">
                {((ebitda.ttm / revenue.ttm) * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ── RISK DETECTION ────────────────────────────────────────────────────────────
function RisksModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const riskLevels = deal.risks.map((r, i) => ({
    text: r,
    level: i === 0 ? "critical" : i === 1 ? "high" : "moderate",
    category: i === 0 ? "Financial" : i === 1 ? "Market" : "Operational",
  }));

  const overallScore = deal.criteria.filter((c) => !c.meets).length > 1 ? 7.8 : 5.2;

  return (
    <ModalShell
      title="Risk Detection"
      icon={ShieldAlert}
      iconColor="bg-red-500"
      completedAt="Completed Dec 12, 1:55 PM"
      onClose={onClose}
      footer={
        <>
          <span className="text-xs text-slate-400">AI-generated · Anomaly detection + criteria analysis</span>
          <button className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-colors">
            <Download className="h-3.5 w-3.5" /> Export Risk Report
          </button>
        </>
      }
    >
      {/* Overall risk score */}
      <div className={`border rounded-xl p-5 text-center ${overallScore > 6.5 ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
        <div className={`text-4xl font-black mb-1 ${overallScore > 6.5 ? "text-red-600" : "text-amber-600"}`}>
          {overallScore}/10
        </div>
        <div className={`text-sm font-bold uppercase tracking-wider ${overallScore > 6.5 ? "text-red-700" : "text-amber-700"}`}>
          Overall Risk Score — {overallScore > 6.5 ? "HIGH" : "MEDIUM"}
        </div>
        <div className={`text-[11px] mt-1 ${overallScore > 6.5 ? "text-red-500" : "text-amber-500"}`}>
          {riskLevels.filter(r => r.level === "critical").length} critical, {riskLevels.filter(r => r.level === "high").length} high, {riskLevels.filter(r => r.level === "moderate").length} moderate flags
        </div>
      </div>

      {/* Risk Items */}
      <div className="space-y-3">
        <h4 className="font-bold text-sm text-slate-800">Identified Risk Flags</h4>
        {riskLevels.map((risk, i) => (
          <div key={i} className={`border rounded-xl p-4 ${
            risk.level === "critical" ? "border-red-200 bg-red-50" :
            risk.level === "high" ? "border-orange-200 bg-orange-50" :
            "border-amber-200 bg-amber-50"
          }`}>
            <div className="flex items-start gap-3">
              <AlertTriangle className={`h-4 w-4 flex-shrink-0 mt-0.5 ${
                risk.level === "critical" ? "text-red-500" :
                risk.level === "high" ? "text-orange-500" :
                "text-amber-500"
              }`} />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    risk.level === "critical" ? "bg-red-100 text-red-700" :
                    risk.level === "high" ? "bg-orange-100 text-orange-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>{risk.level} · {risk.category}</span>
                </div>
                <p className="text-sm text-slate-800 font-medium leading-relaxed">{risk.text}</p>
              </div>
            </div>
          </div>
        ))}

        {deal.risks.length === 0 && (
          <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-4 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-emerald-700">No major risk flags detected</p>
            <p className="text-xs text-emerald-500 mt-0.5">This deal passed all risk criteria</p>
          </div>
        )}
      </div>

      {/* Risk categories breakdown */}
      <div>
        <h4 className="font-bold text-sm text-slate-800 mb-3">Risk Category Breakdown</h4>
        <div className="space-y-2.5">
          {["Financial", "Market", "Operational", "Legal", "Physical"].map((cat, i) => {
            const hasRisk = i < riskLevels.length;
            const pct = hasRisk ? [85, 70, 55, 20, 40][i] : 15;
            return (
              <div key={cat} className="flex items-center gap-3">
                <span className="text-[12px] text-slate-500 w-24 font-medium">{cat}</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ delay: i * 0.1, duration: 0.6, ease: "easeOut" }}
                    className={`h-full rounded-full ${
                      pct > 70 ? "bg-red-400" : pct > 50 ? "bg-orange-400" : pct > 30 ? "bg-amber-400" : "bg-emerald-400"
                    }`}
                  />
                </div>
                <span className="text-[11px] font-bold text-slate-500 w-8 text-right">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Criteria failures as risks */}
      {deal.criteria.some(c => !c.meets) && (
        <div className="border border-red-200 bg-red-50 rounded-xl p-4">
          <h4 className="font-bold text-sm text-red-800 mb-2 flex items-center gap-2">
            <XCircle className="h-4 w-4" /> Failed Investment Criteria
          </h4>
          <ul className="space-y-1.5">
            {deal.criteria.filter(c => !c.meets).map((c, i) => (
              <li key={i} className="text-sm text-red-700 flex items-start gap-2">
                <ChevronRight className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span><strong>{c.criteria}</strong>: Required {c.requirement}, actual {c.actual}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ModalShell>
  );
}

// ── METADATA EXTRACTION ───────────────────────────────────────────────────────
function MetadataModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const omUrl = resolveFileUrl(deal, "pdf", "om", "offering");
  const fields = [
    { label: "Property Name", value: deal.name, source: "Offering Memorandum", url: omUrl },
    { label: "Asset Type", value: deal.assetType, source: "Offering Memorandum", url: omUrl },
    { label: "Property Type", value: deal.propertyType, source: "Offering Memorandum", url: omUrl },
    { label: "Brand / Flag", value: deal.brand, source: "Offering Memorandum", url: omUrl },
    { label: "Year Built", value: deal.yearBuilt.toString(), source: "Offering Memorandum", url: omUrl },
    { label: "Total Units / Keys", value: `${deal.units} ${deal.assetType === "Hospitality" ? "keys" : "units"}`, source: "Offering Memorandum", url: omUrl },
    { label: "Address", value: deal.address, source: "Offering Memorandum", url: omUrl },
    { label: "City", value: deal.city, source: "Offering Memorandum", url: omUrl },
    { label: "State", value: deal.state, source: "Offering Memorandum", url: omUrl },
    { label: "Broker", value: deal.broker, source: "Offering Memorandum", url: omUrl },
    { label: "Guidance Price", value: formatCurrencyFull(deal.guidancePrice), source: "Offering Memorandum", url: omUrl },
    { label: "Amenities", value: deal.amenities.join(", "), source: "Offering Memorandum", url: omUrl },
  ];

  return (
    <ModalShell
      title="Metadata Extraction"
      icon={Info}
      iconColor="bg-blue-500"
      completedAt="Completed Dec 12, 1:42 PM"
      onClose={onClose}
      footer={
        <>
          <span className="text-xs text-slate-400">Extracted from {deal.files.length} document(s)</span>
          <button className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-colors">
            <Copy className="h-3.5 w-3.5" /> Copy all metadata
          </button>
        </>
      }
    >
      {/* Source documents */}
      <div>
        <h4 className="font-bold text-sm text-slate-800 mb-3">Source Documents Parsed</h4>
        <div className="space-y-2">
          {deal.files.map((f, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <FileText className="h-4 w-4 text-orange-500" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-800">{f.name}</div>
                <div className="text-[11px] text-slate-400 uppercase font-semibold">{f.type}</div>
              </div>
              <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Extracted fields */}
      <div>
        <h4 className="font-bold text-sm text-slate-800 mb-3">Extracted Fields</h4>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Field", "Extracted Value", "Source"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fields.map(({ label, value, source, url }) => (
                <tr key={label} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 text-slate-500 font-medium text-[12px]">{label}</td>
                  <td className="px-4 py-2.5 font-semibold text-slate-900 text-[12px]">{value}</td>
                  <td className="px-4 py-2.5">
                    <SourceChip label={source} href={url} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confidence scores */}
      <div>
        <h4 className="font-bold text-sm text-slate-800 mb-3">Extraction Confidence</h4>
        <div className="space-y-2">
          {["Property details", "Financial figures", "Location data", "Contact info"].map((cat, i) => {
            const conf = [98, 94, 99, 87][i];
            return (
              <div key={cat} className="flex items-center gap-3">
                <span className="text-[12px] text-slate-500 w-36 font-medium">{cat}</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${conf}%` }}
                    transition={{ delay: i * 0.1, duration: 0.6 }}
                    className="h-full rounded-full bg-blue-400"
                  />
                </div>
                <span className="text-[11px] font-bold text-blue-600 w-8 text-right">{conf}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </ModalShell>
  );
}

// ── ROOT DISPATCHER ───────────────────────────────────────────────────────────
export default function AgentDetailModal({ agentKey, deal, onClose }: Props) {
  if (agentKey === "summary")   return <SummaryModal   deal={deal} onClose={onClose} />;
  if (agentKey === "criteria")  return <CriteriaModal  deal={deal} onClose={onClose} />;
  if (agentKey === "questions") return <QuestionsModal deal={deal} onClose={onClose} />;
  if (agentKey === "financial") return <FinancialModal deal={deal} onClose={onClose} />;
  if (agentKey === "risks")     return <RisksModal     deal={deal} onClose={onClose} />;
  if (agentKey === "metadata")  return <MetadataModal  deal={deal} onClose={onClose} />;
  return null;
}
