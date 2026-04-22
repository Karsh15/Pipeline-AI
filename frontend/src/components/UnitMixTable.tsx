

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Building2, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { supabase, type DBUnitMix } from "@/lib/supabase";
import DetailPanel, { type PanelData, type UnitRowData } from "./DetailPanel";

export default function UnitMixTable({ dealId, refreshKey = 0 }: { dealId: string; refreshKey?: number }) {
  const [rows, setRows]   = useState<DBUnitMix[]>([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<PanelData | null>(null);

  useEffect(() => {
    setLoading(true);
    supabase.from("unit_mix").select("*").eq("deal_id", dealId)
      .then(({ data }) => { setRows((data ?? []) as DBUnitMix[]); setLoading(false); });
  }, [dealId, refreshKey]);

  const fmt$ = (n: number | null | undefined) =>
    n && n > 0 ? `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
  const fmtN = (n: number | null | undefined) =>
    n && n > 0 ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";
  const fmtPct = (n: number | null | undefined) =>
    n && n > 0 ? `${Number(n).toFixed(1)}%` : "—";

  const buildUnitPanel = (row: DBUnitMix): UnitRowData => {
    const occ = row.total_units > 0
      ? ((row.total_units - row.vacant_units) / row.total_units) * 100
      : (row.physical_occ || 0);
    return {
      kind: "unit",
      unitType: row.unit_type,
      totalUnits: row.total_units,
      vacantUnits: row.vacant_units,
      physOcc: occ,
      avgBaseRent: row.avg_base_rent || row.avg_rent,
      avgTotalRent: row.avg_total_rent || row.avg_rent,
      marketRent: row.market_rent || 0,
      lossToLease: row.loss_to_lease || 0,
      annualRevenue: row.annual_revenue || 0,
      avgSqft: row.avg_sqft || 0,
      avgUtilities: row.avg_utilities || 0,
      latestLeaseUp: row.latest_lease_up,
    };
  };

  // Portfolio-level aggregates
  const totalUnits   = rows.reduce((s, r) => s + r.total_units, 0);
  const totalVacant  = rows.reduce((s, r) => s + r.vacant_units, 0);
  const totalAnnRev  = rows.reduce((s, r) => s + (r.annual_revenue || 0), 0);
  const physOcc      = totalUnits > 0 ? (((totalUnits - totalVacant) / totalUnits) * 100) : 0;

  const wavgBase = totalUnits > 0
    ? rows.reduce((s, r) => s + (r.avg_base_rent || r.avg_rent) * r.total_units, 0) / totalUnits : 0;
  const wavgTotal = totalUnits > 0
    ? rows.reduce((s, r) => s + (r.avg_total_rent || r.avg_rent) * r.total_units, 0) / totalUnits : 0;
  const wavgMarket = totalUnits > 0 && rows.some(r => r.market_rent > 0)
    ? rows.reduce((s, r) => s + (r.market_rent || 0) * r.total_units, 0) / totalUnits : 0;
  const wavgSqft = totalUnits > 0 && rows.some(r => r.avg_sqft > 0)
    ? rows.reduce((s, r) => s + (r.avg_sqft || 0) * r.total_units, 0) / totalUnits : 0;
  const totalLTL = rows.reduce((s, r) => s + (r.loss_to_lease || 0) * r.total_units, 0);

  const hasMarket  = rows.some(r => r.market_rent > 0);
  const hasSqft    = rows.some(r => r.avg_sqft > 0);
  const hasUtil    = rows.some(r => r.avg_utilities > 0);
  const hasLeaseUp = rows.some(r => r.latest_lease_up);
  const hasLTL     = rows.some(r => (r.loss_to_lease || 0) !== 0);

  if (loading) return (
    <div className="p-6 space-y-2">
      {[1,2,3,4].map(i => <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />)}
    </div>
  );

  if (!rows.length) return (
    <div className="text-center py-12 text-muted-foreground text-sm">
      <Building2 className="h-8 w-8 mx-auto mb-2 text-slate-200" />
      Unit mix data will appear after extraction
    </div>
  );

  return (
    <div className="space-y-5 p-6">

      {/* ── Summary KPI cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Units",      value: String(totalUnits),                               field: "units"       },
          { label: "Vacant",           value: `${totalVacant} (${physOcc > 0 ? (100-physOcc).toFixed(1) : "0"}%)`, field: "vacant" },
          { label: "Physical Occ.",    value: physOcc > 0 ? `${physOcc.toFixed(1)}%` : "—",     field: "occupancy"   },
          { label: "Avg Contract Rent",value: wavgBase > 0 ? `$${Math.round(wavgBase).toLocaleString()}` : "—",     field: "avgBaseRent"  },
          { label: "Avg Market Rent",  value: wavgMarket > 0 ? `$${Math.round(wavgMarket).toLocaleString()}` : "—", field: "avgMarket"    },
          { label: "Annual Revenue",   value: totalAnnRev > 0 ? (totalAnnRev >= 1e6 ? `$${(totalAnnRev/1e6).toFixed(2)}M` : `$${(totalAnnRev/1000).toFixed(0)}K`) : "—", field: "annualRevenue" },
        ].map(stat => (
          <div key={stat.label}
            className="bg-white border border-border rounded-xl p-3 cursor-pointer group hover:border-primary/30 hover:shadow-sm transition-all"
            onClick={() => {/* portfolio summary — no single row to drill into */}}>
            <div className="text-xl font-heading font-black text-foreground">{stat.value}</div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">{stat.label}</span>
              <Sparkles className="h-3 w-3 text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        ))}
      </div>

      {/* ── Loss-to-lease callout ── */}
      {hasLTL && totalLTL !== 0 && (
        <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border text-sm
          ${totalLTL > 0 ? "bg-amber-50 border-amber-100" : "bg-emerald-50 border-emerald-100"}`}>
          {totalLTL > 0
            ? <TrendingDown className="h-4 w-4 text-amber-500 flex-shrink-0"/>
            : <TrendingUp className="h-4 w-4 text-emerald-500 flex-shrink-0"/>}
          <span className={`font-bold ${totalLTL > 0 ? "text-amber-700" : "text-emerald-700"}`}>
            {totalLTL > 0
              ? `Loss-to-Lease: $${Math.round(totalLTL).toLocaleString()}/mo ($${Math.round(totalLTL*12).toLocaleString()}/yr) — rents are below market`
              : `Gain-to-Lease: $${Math.abs(Math.round(totalLTL)).toLocaleString()}/mo — rents are above market`}
          </span>
          {wavgMarket > 0 && <span className="ml-auto text-xs text-muted-foreground">
            Market avg: ${Math.round(wavgMarket).toLocaleString()} · Contract avg: ${Math.round(wavgBase).toLocaleString()}
          </span>}
        </div>
      )}

      {/* ── Unit mix table ── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-[#FFF6ED] border-b border-border flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">Unit Mix</span>
          {wavgSqft > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground font-medium">
              Wtd avg sqft: {Math.round(wavgSqft).toLocaleString()}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-border">
                <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">Unit Type</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Count</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Vacant</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Occ %</th>
                {hasSqft   && <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Avg SF</th>}
                <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Contract Rent</th>
                {hasMarket && <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Market Rent</th>}
                {hasLTL    && <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Loss/Gain</th>}
                <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Annual Rev</th>
                {hasUtil   && <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Utilities</th>}
                {hasLeaseUp && <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest">Last Lease-Up</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, i) => {
                const occ = row.total_units > 0
                  ? (((row.total_units - row.vacant_units) / row.total_units) * 100)
                  : (row.physical_occ || 0);
                const occPct = occ.toFixed(0);
                const ltl = row.loss_to_lease || 0;
                const annRev = row.annual_revenue || 0;
                return (
                  <motion.tr key={row.id}
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="hover:bg-[#FFF6ED] transition-colors cursor-pointer group"
                    onClick={() => setPanel(buildUnitPanel(row))}>
                    <td className="px-4 py-3 font-semibold text-foreground">
                      <span className="flex items-center gap-1.5">
                        {row.unit_type}
                        <Sparkles className="h-3 w-3 text-violet-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">{row.total_units}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{row.vacant_units}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="flex items-center justify-end gap-2">
                        <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${occ >= 90 ? "bg-emerald-500" : occ >= 75 ? "bg-amber-400" : "bg-red-400"}`}
                            style={{ width: `${Math.min(occ, 100)}%` }} />
                        </div>
                        <span className={`text-xs font-bold ${occ >= 90 ? "text-emerald-600" : occ >= 75 ? "text-amber-500" : "text-red-500"}`}>
                          {occPct}%
                        </span>
                      </span>
                    </td>
                    {hasSqft   && <td className="px-4 py-3 text-right text-slate-500">{fmtN(row.avg_sqft)}</td>}
                    <td className="px-4 py-3 text-right font-medium text-foreground">{fmt$(row.avg_base_rent || row.avg_rent)}</td>
                    {hasMarket && <td className="px-4 py-3 text-right text-slate-500">{fmt$(row.market_rent)}</td>}
                    {hasLTL && (
                      <td className="px-4 py-3 text-right">
                        {ltl !== 0 ? (
                          <span className={`text-xs font-bold ${ltl > 0 ? "text-amber-500" : "text-emerald-600"}`}>
                            {ltl > 0 ? "-" : "+"}${Math.abs(ltl).toFixed(0)}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right font-medium text-primary">
                      {annRev > 0 ? (annRev >= 1e6 ? `$${(annRev/1e6).toFixed(2)}M` : `$${(annRev/1000).toFixed(0)}K`) : "—"}
                    </td>
                    {hasUtil   && <td className="px-4 py-3 text-right text-slate-500">{fmt$(row.avg_utilities)}</td>}
                    {hasLeaseUp && <td className="px-4 py-3 text-slate-500 text-xs">{row.latest_lease_up || "—"}</td>}
                  </motion.tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-border">
                <td className="px-4 py-3 text-xs font-black text-muted-foreground uppercase tracking-widest">Total / Wtd Avg</td>
                <td className="px-4 py-3 text-right font-black text-foreground">{totalUnits}</td>
                <td className="px-4 py-3 text-right font-black text-foreground">{totalVacant}</td>
                <td className="px-4 py-3 text-right font-black text-foreground">{physOcc.toFixed(1)}%</td>
                {hasSqft   && <td className="px-4 py-3 text-right font-bold text-foreground">{wavgSqft > 0 ? Math.round(wavgSqft).toLocaleString() : "—"}</td>}
                <td className="px-4 py-3 text-right font-black text-foreground">{wavgBase > 0 ? `$${Math.round(wavgBase).toLocaleString()}` : "—"}</td>
                {hasMarket && <td className="px-4 py-3 text-right font-bold text-foreground">{wavgMarket > 0 ? `$${Math.round(wavgMarket).toLocaleString()}` : "—"}</td>}
                {hasLTL    && <td className="px-4 py-3 text-right font-bold">
                  {totalLTL !== 0 ? <span className={totalLTL > 0 ? "text-amber-500" : "text-emerald-600"}>
                    {totalLTL > 0 ? "-" : "+"}${Math.abs(Math.round(totalLTL)).toLocaleString()}
                  </span> : "—"}
                </td>}
                <td className="px-4 py-3 text-right font-black text-primary">
                  {totalAnnRev > 0 ? (totalAnnRev >= 1e6 ? `$${(totalAnnRev/1e6).toFixed(2)}M` : `$${(totalAnnRev/1000).toFixed(0)}K`) : "—"}
                </td>
                {hasUtil    && <td className="px-4 py-3">—</td>}
                {hasLeaseUp && <td className="px-4 py-3">—</td>}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {panel && <DetailPanel dealId={dealId} data={panel} onClose={() => setPanel(null)} />}
    </div>
  );
}
