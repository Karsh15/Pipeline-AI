import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FolderOpen, Search, ArrowLeft, TrendingUp,
  Building2, MapPin, DollarSign, BarChart3, Users, Calendar, ChevronDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { DBDeal } from "@/lib/supabase";

const ALL_STATUSES = ["lead", "ingestion", "extraction", "underwriting", "review", "completed", "dead"] as const;
type DealStatus = typeof ALL_STATUSES[number];

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  lead:         { bg: "bg-slate-100",  text: "text-slate-600",   border: "border-slate-300"  },
  ingestion:    { bg: "bg-sky-50",     text: "text-sky-700",     border: "border-sky-300"    },
  extraction:   { bg: "bg-indigo-50",  text: "text-indigo-700",  border: "border-indigo-300" },
  underwriting: { bg: "bg-violet-50",  text: "text-violet-700",  border: "border-violet-300" },
  review:       { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-300"},
  completed:    { bg: "bg-green-50",   text: "text-green-700",   border: "border-green-300"  },
  dead:         { bg: "bg-red-50",     text: "text-red-600",     border: "border-red-300"    },
};

const COLS = [
  { key: "name",           label: "Property"       },
  { key: "status",         label: "Status"         },
  { key: "city",           label: "Location"       },
  { key: "asset_type",     label: "Asset Type"     },
  { key: "property_type",  label: "Property Type"  },
  { key: "units",          label: "Units"          },
  { key: "year_built",     label: "Year Built"     },
  { key: "broker",         label: "Broker"         },
  { key: "brand",          label: "Brand"          },
  { key: "deal_lead",      label: "Deal Lead"      },
  { key: "guidance_price", label: "Guidance Price" },
  { key: "noi",            label: "NOI (TTM)"      },
  { key: "cap_rate",       label: "Cap Rate"       },
];

function fmtMoney(n: number | null) {
  if (!n || n <= 0) return "—";
  return n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}K`;
}

export default function PipelinePage() {
  const navigate = useNavigate();
  const [deals, setDeals]         = useState<DBDeal[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [sortKey, setSortKey]     = useState("name");
  const [sortAsc, setSortAsc]     = useState(true);
  const [statusFilter, setFilter] = useState("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function updateStatus(dealId: string, newStatus: DealStatus) {
    setUpdatingId(dealId);
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, status: newStatus } : d));
    await supabase.from("deals").update({ status: newStatus }).eq("id", dealId);
    setUpdatingId(null);
  }

  useEffect(() => {
    supabase.from("deals").select("*").order("created_at", { ascending: false })
      .then(({ data }) => { setDeals((data ?? []) as DBDeal[]); setLoading(false); });
  }, []);

  const statuses = ["all", ...Array.from(new Set(deals.map(d => d.status)))];

  const filtered = deals
    .filter(d => statusFilter === "all" || d.status === statusFilter)
    .filter(d => [d.name, d.city, d.state, d.broker, d.brand, d.asset_type, d.deal_lead]
      .some(v => v?.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });

  const totalGuidance = deals.reduce((s, d) => s + (d.guidance_price || 0), 0);
  const totalNoi      = deals.reduce((s, d) => s + (d.noi || 0), 0);
  const capRateDeals  = deals.filter(d => d.cap_rate && Number(d.cap_rate) > 0);
  const avgCapRate    = capRateDeals.length
    ? capRateDeals.reduce((s, d) => s + Number(d.cap_rate), 0) / capRateDeals.length : 0;

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortAsc(p => !p);
    else { setSortKey(key); setSortAsc(true); }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="bg-white border-b border-border px-6 py-4 flex items-center gap-4 sticky top-0 z-20 shadow-sm">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="h-5 w-px bg-border" />
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
            <FolderOpen className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-heading font-black leading-tight">Full Pipeline</h1>
            <p className="text-[11px] text-muted-foreground">{deals.length} properties</p>
          </div>
        </div>
        <div className="relative ml-4 flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, broker, city…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-white transition-all" />
        </div>
        <select value={statusFilter} onChange={e => setFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-primary/30">
          {statuses.map(s => (
            <option key={s} value={s}>{s === "all" ? "All Statuses" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Deals",    value: String(deals.length),    icon: Building2,  color: "text-blue-600",    bg: "bg-blue-50"    },
            { label: "Pipeline Value", value: fmtMoney(totalGuidance), icon: DollarSign, color: "text-primary",     bg: "bg-orange-50"  },
            { label: "Total NOI",      value: fmtMoney(totalNoi),      icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
            { label: "Avg Cap Rate",   value: avgCapRate > 0 ? `${avgCapRate.toFixed(1)}%` : "—", icon: BarChart3, color: "text-violet-600", bg: "bg-violet-50" },
          ].map(c => (
            <div key={c.label} className="bg-white border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm">
              <div className={`w-10 h-10 ${c.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                <c.icon className={`h-5 w-5 ${c.color}`} />
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{c.label}</div>
                <div className="text-xl font-heading font-black text-foreground">{c.value}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-border">
                  {COLS.map(col => (
                    <th key={col.key} onClick={() => toggleSort(col.key)}
                      className="px-4 py-3 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest whitespace-nowrap cursor-pointer hover:text-foreground select-none group">
                      <span className="flex items-center gap-1">
                        {col.label}
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                          {sortKey === col.key ? (sortAsc ? "↑" : "↓") : "↕"}
                        </span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>{COLS.map(c => (
                        <td key={c.key} className="px-4 py-3">
                          <div className="h-4 bg-slate-100 rounded animate-pulse" />
                        </td>
                      ))}</tr>
                    ))
                  : filtered.length === 0
                  ? <tr><td colSpan={COLS.length} className="px-4 py-12 text-center text-muted-foreground">No properties found</td></tr>
                  : filtered.map((d, i) => {
                      const sc = STATUS_COLORS[d.status] ?? { bg: "bg-slate-100", text: "text-slate-600", border: "border-slate-300" };
                      return (
                        <motion.tr key={d.id}
                          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                          className="hover:bg-[#FFF6ED] cursor-pointer transition-colors"
                          onClick={() => navigate(`/?deal=${d.id}`)}>
                          <td className="px-4 py-3 font-semibold text-foreground"><div className="max-w-[220px] truncate">{d.name}</div></td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <div className="relative inline-flex items-center">
                              <select
                                value={d.status}
                                disabled={updatingId === d.id}
                                onChange={e => updateStatus(d.id, e.target.value as DealStatus)}
                                className={`text-[10px] font-black uppercase tracking-widest pl-2.5 pr-6 py-1 rounded-full border-2 cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all disabled:opacity-50 ${sc.bg} ${sc.text} ${sc.border}`}
                              >
                                {ALL_STATUSES.map(s => (
                                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                                ))}
                              </select>
                              <ChevronDown className={`pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 ${sc.text}`} />
                            </div>
                          </td>
                          <td className="px-4 py-3"><div className="flex items-center gap-1 text-muted-foreground whitespace-nowrap"><MapPin className="h-3 w-3 flex-shrink-0" />{d.city || "—"}{d.state ? `, ${d.state}` : ""}</div></td>
                          <td className="px-4 py-3 text-muted-foreground">{d.asset_type || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{d.property_type || "—"}</td>
                          <td className="px-4 py-3"><div className="flex items-center gap-1 text-muted-foreground"><Users className="h-3 w-3" />{d.units ?? "—"}</div></td>
                          <td className="px-4 py-3"><div className="flex items-center gap-1 text-muted-foreground"><Calendar className="h-3 w-3" />{d.year_built ?? "—"}</div></td>
                          <td className="px-4 py-3 text-muted-foreground"><div className="max-w-[130px] truncate">{d.broker || "—"}</div></td>
                          <td className="px-4 py-3 text-muted-foreground">{d.brand || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground"><div className="max-w-[120px] truncate">{d.deal_lead || "—"}</div></td>
                          <td className="px-4 py-3 font-semibold text-foreground">{fmtMoney(d.guidance_price)}</td>
                          <td className="px-4 py-3">{d.noi && d.noi > 0 ? <span className="flex items-center gap-1 font-semibold text-emerald-600"><TrendingUp className="h-3 w-3" />{fmtMoney(d.noi)}</span> : <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-4 py-3">{d.cap_rate && Number(d.cap_rate) > 0 ? <span className="font-semibold text-violet-600">{d.cap_rate}%</span> : <span className="text-muted-foreground">—</span>}</td>
                        </motion.tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
          {!loading && (
            <div className="px-6 py-3 border-t border-border bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Showing <span className="font-bold text-foreground">{filtered.length}</span> of {deals.length} properties</span>
              <span className="text-xs text-muted-foreground">Click any row to open deal workspace</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
