"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Building2, Sparkles } from "lucide-react";
import { supabase, type DBUnitMix } from "@/lib/supabase";
import WhyPanel from "./WhyPanel";

const COLS = [
  { key: "unit_type",       label: "Unit Type"       },
  { key: "total_units",     label: "Count"           },
  { key: "vacant_units",    label: "Vacant"          },
  { key: "avg_sqft",        label: "Avg S/F"         },
  { key: "avg_base_rent",   label: "Avg Base Rent"   },
  { key: "avg_total_rent",  label: "Avg Total Rent"  },
  { key: "avg_utilities",   label: "Avg Utilities"   },
  { key: "latest_lease_up", label: "Latest Lease Up" },
  { key: "occ",             label: "Occ %"           },
];

export default function UnitMixTable({ dealId, refreshKey = 0 }: { dealId: string; refreshKey?: number }) {
  const [rows, setRows]   = useState<DBUnitMix[]>([]);
  const [loading, setLoading] = useState(true);
  const [why, setWhy]     = useState<{ field: string; label: string; value: string } | null>(null);

  useEffect(() => {
    supabase.from("unit_mix").select("*").eq("deal_id", dealId)
      .then(({ data }) => { setRows((data ?? []) as DBUnitMix[]); setLoading(false); });
  }, [dealId, refreshKey]);

  const totalUnits  = rows.reduce((s, r) => s + r.total_units, 0);
  const totalVacant = rows.reduce((s, r) => s + r.vacant_units, 0);
  const occupancy   = totalUnits > 0 ? (((totalUnits - totalVacant) / totalUnits) * 100).toFixed(1) : "—";
  const avgBaseRent = totalUnits > 0
    ? (rows.reduce((s, r) => s + (r.avg_base_rent || r.avg_rent) * r.total_units, 0) / totalUnits).toFixed(0)
    : "—";
  const avgTotalRent = totalUnits > 0
    ? (rows.reduce((s, r) => s + (r.avg_total_rent || r.avg_rent) * r.total_units, 0) / totalUnits).toFixed(0)
    : "—";
  const avgSqft = totalUnits > 0
    ? (rows.reduce((s, r) => s + (r.avg_sqft || 0) * r.total_units, 0) / totalUnits).toFixed(0)
    : "—";

  const fmt$ = (n: number) => n > 0 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
  const fmtN = (n: number) => n > 0 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";

  if (loading) return (
    <div className="space-y-2">
      {[1,2,3,4].map(i => <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />)}
    </div>
  );

  if (!rows.length) return (
    <div className="text-center py-8 text-muted-foreground text-sm">
      <Building2 className="h-8 w-8 mx-auto mb-2 text-slate-200" />
      Unit mix data will appear after extraction
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Units",      value: String(totalUnits),                  field: "units"     },
          { label: "Vacant Units",     value: String(totalVacant),                 field: "vacant"    },
          { label: "Occupancy",        value: `${occupancy}%`,                     field: "occupancy" },
          { label: "Avg Base Rent",    value: avgBaseRent !== "—" ? `$${Number(avgBaseRent).toLocaleString()}` : "—", field: "avgBaseRent"  },
          { label: "Avg Total Rent",   value: avgTotalRent !== "—" ? `$${Number(avgTotalRent).toLocaleString()}` : "—", field: "avgTotalRent" },
        ].map(stat => (
          <div key={stat.label}
            className="bg-[#FFF6ED] border border-orange-100 rounded-xl p-3 cursor-pointer group hover:border-primary/30 hover:shadow-sm transition-all"
            onClick={() => setWhy({ field: stat.field, label: stat.label, value: stat.value })}>
            <div className="text-xl font-heading font-black text-foreground">{stat.value}</div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[10px] text-muted-foreground font-medium">{stat.label}</span>
              <Sparkles className="h-3 w-3 text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        ))}
      </div>

      {/* Unit Mix Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-[#FFF6ED] border-b border-border flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">Unit Projection / Mix</span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            Avg S/F: {avgSqft !== "—" ? avgSqft : "—"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-border">
                {COLS.map(c => (
                  <th key={c.key} className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, i) => {
                const occ = row.total_units > 0
                  ? (((row.total_units - row.vacant_units) / row.total_units) * 100).toFixed(0)
                  : "0";
                return (
                  <motion.tr key={row.id}
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                    className="hover:bg-[#FFF6ED] transition-colors cursor-pointer group"
                    onClick={() => setWhy({ field: row.unit_type, label: row.unit_type, value: fmt$(row.avg_total_rent || row.avg_rent) })}>
                    <td className="px-4 py-3 font-semibold text-foreground flex items-center gap-1.5">
                      {row.unit_type}
                      <Sparkles className="h-3 w-3 text-violet-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.total_units}</td>
                    <td className="px-4 py-3 text-slate-700">{row.vacant_units}</td>
                    <td className="px-4 py-3 text-slate-700">{fmtN(row.avg_sqft)}</td>
                    <td className="px-4 py-3 font-medium text-slate-700">{fmt$(row.avg_base_rent || row.avg_rent)}</td>
                    <td className="px-4 py-3 font-bold text-primary">{fmt$(row.avg_total_rent || row.avg_rent)}</td>
                    <td className="px-4 py-3 text-slate-700">{fmt$(row.avg_utilities)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{row.latest_lease_up || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${occ}%` }} />
                        </div>
                        <span className="text-xs font-bold text-slate-700">{occ}%</span>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-border font-bold">
                <td className="px-4 py-3 text-xs font-black text-muted-foreground uppercase tracking-widest">Total / Avg</td>
                <td className="px-4 py-3 text-foreground">{totalUnits}</td>
                <td className="px-4 py-3 text-foreground">{totalVacant}</td>
                <td className="px-4 py-3 text-foreground">{avgSqft !== "—" ? avgSqft : "—"}</td>
                <td className="px-4 py-3 text-foreground">{avgBaseRent !== "—" ? `$${Number(avgBaseRent).toLocaleString()}` : "—"}</td>
                <td className="px-4 py-3 text-primary">{avgTotalRent !== "—" ? `$${Number(avgTotalRent).toLocaleString()}` : "—"}</td>
                <td className="px-4 py-3">—</td>
                <td className="px-4 py-3">—</td>
                <td className="px-4 py-3 text-foreground">{occupancy}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {why && (
        <WhyPanel dealId={dealId} fieldName={why.field} fieldLabel={why.label} value={why.value} onClose={() => setWhy(null)} />
      )}
    </div>
  );
}
