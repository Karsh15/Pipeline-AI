import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Building2, Sparkles, TrendingDown, TrendingUp, Info } from "lucide-react";
import { supabase, type DBUnitMix } from "@/lib/supabase";
import DetailPanel, { type PanelData, type UnitRowData } from "./DetailPanel";

export default function UnitMixTable({ dealId, refreshKey = 0 }: { dealId: string; refreshKey?: number }) {
  const [rows, setRows]     = useState<DBUnitMix[]>([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel]   = useState<PanelData | null>(null);

  useEffect(() => {
    setLoading(true);
    supabase.from("unit_mix").select("*").eq("deal_id", dealId)
      .then(({ data }) => { setRows((data ?? []) as DBUnitMix[]); setLoading(false); });
  }, [dealId, refreshKey]);

  const fmt$ = (n: number | null | undefined) =>
    n && n > 0 ? `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
  const fmtN = (n: number | null | undefined) =>
    n && n > 0 ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";
  const fmtDec = (n: number | null | undefined, d = 2) =>
    n && n > 0 ? `$${Number(n).toFixed(d)}` : "—";

  const buildUnitPanel = (row: DBUnitMix): UnitRowData => {
    const occ = row.total_units > 0
      ? ((row.total_units - row.vacant_units) / row.total_units) * 100
      : (row.physical_occ || 0);
    return {
      kind: "unit",
      unitType:     row.unit_type,
      totalUnits:   row.total_units,
      vacantUnits:  row.vacant_units,
      physOcc:      occ,
      avgBaseRent:  row.avg_base_rent || row.avg_rent,
      avgTotalRent: row.avg_total_rent || row.avg_rent,
      marketRent:   row.market_rent || 0,
      lossToLease:  row.loss_to_lease || 0,
      annualRevenue:row.annual_revenue || 0,
      avgSqft:      row.avg_sqft || 0,
      avgUtilities: row.avg_utilities || 0,
      latestLeaseUp:row.latest_lease_up,
    };
  };

  // ── Portfolio aggregates ─────────────────────────────────────────────────
  const totalUnits  = rows.reduce((s, r) => s + r.total_units, 0);
  const totalVacant = rows.reduce((s, r) => s + r.vacant_units, 0);
  const totalOccupied = totalUnits - totalVacant;
  const totalAnnRev = rows.reduce((s, r) => s + (r.annual_revenue || 0), 0);
  const totalMonthRev = Math.round(totalAnnRev / 12);
  const physOcc     = totalUnits > 0 ? ((totalOccupied / totalUnits) * 100) : 0;

  const wavgBase    = totalUnits > 0 ? rows.reduce((s,r) => s+(r.avg_base_rent||r.avg_rent)*r.total_units,0)/totalUnits : 0;
  const wavgTotal   = totalUnits > 0 ? rows.reduce((s,r) => s+(r.avg_total_rent||r.avg_rent)*r.total_units,0)/totalUnits : 0;
  const wavgMarket  = totalUnits > 0 && rows.some(r=>r.market_rent>0)
                    ? rows.reduce((s,r) => s+(r.market_rent||0)*r.total_units,0)/totalUnits : 0;
  const wavgSqft    = totalUnits > 0 && rows.some(r=>r.avg_sqft>0)
                    ? rows.reduce((s,r) => s+(r.avg_sqft||0)*r.total_units,0)/totalUnits : 0;
  const totalLTL    = rows.reduce((s,r) => s+(r.loss_to_lease||0)*r.total_units, 0);
  const totalLTLAnn = totalLTL * 12;

  // Computed metrics
  const revenuePerUnit   = totalOccupied > 0 ? Math.round(totalAnnRev / totalOccupied) : 0;
  const revenuePerSqft   = wavgSqft > 0 && totalAnnRev > 0 ? (totalAnnRev / (wavgSqft * totalUnits)) : 0;
  const ltlPct           = wavgMarket > 0 && wavgBase > 0 ? ((wavgMarket - wavgBase) / wavgMarket) * 100 : 0;
  const potentialRevenue = wavgMarket > 0 ? wavgMarket * totalUnits * 12 : 0;
  const revenueUpside    = potentialRevenue > 0 ? potentialRevenue - totalAnnRev : 0;

  const hasMarket   = rows.some(r => r.market_rent > 0);
  const hasSqft     = rows.some(r => r.avg_sqft > 0);
  const hasUtil     = rows.some(r => r.avg_utilities > 0);
  const hasLeaseUp  = rows.some(r => r.latest_lease_up);
  const hasLTL      = rows.some(r => (r.loss_to_lease || 0) !== 0);
  const hasTotalRent= rows.some(r => r.avg_total_rent > 0 && r.avg_total_rent !== r.avg_base_rent);

  if (loading) return (
    <div className="p-6 space-y-2">
      {[1,2,3,4].map(i=><div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse"/>)}
    </div>
  );
  if (!rows.length) return (
    <div className="text-center py-12 text-muted-foreground text-sm">
      <Building2 className="h-8 w-8 mx-auto mb-2 text-slate-200"/>
      Unit mix data will appear after extraction
    </div>
  );

  return (
    <div className="space-y-5 p-6">

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {[
          { label:"Total Units",       value:String(totalUnits),                                         sub:`${totalOccupied} occupied` },
          { label:"Vacancy",           value:`${totalVacant} units`,                                     sub:`${physOcc>0?(100-physOcc).toFixed(1):"0"}% vacant` },
          { label:"Physical Occ.",     value:physOcc>0?`${physOcc.toFixed(1)}%`:"—",                     sub:"Target ≥90%" },
          { label:"Contract Rent",     value:wavgBase>0?`$${Math.round(wavgBase).toLocaleString()}`:"—", sub:"Wtd avg/unit" },
          { label:"Annual Revenue",    value:totalAnnRev>0?(totalAnnRev>=1e6?`$${(totalAnnRev/1e6).toFixed(2)}M`:`$${(totalAnnRev/1e3).toFixed(0)}K`):"—", sub:`$${totalMonthRev.toLocaleString()}/mo` },
          { label:"Market Rent",       value:wavgMarket>0?`$${Math.round(wavgMarket).toLocaleString()}`:"—", sub:"Wtd avg/unit" },
          { label:"Loss-to-Lease",     value:Math.abs(totalLTL)>0?`$${Math.abs(Math.round(totalLTL)).toLocaleString()}/mo`:"—", sub:ltlPct>0?`${ltlPct.toFixed(1)}% below mkt`:"" },
          { label:"Revenue Upside",    value:revenueUpside>0?`$${(revenueUpside/1e3).toFixed(0)}K/yr`:"—", sub:"At full market rent" },
          { label:"Rev / Occ. Unit",   value:revenuePerUnit>0?`$${revenuePerUnit.toLocaleString()}`:"—", sub:"Per year" },
          { label:"Rev / Sq Ft",       value:revenuePerSqft>0?`$${revenuePerSqft.toFixed(2)}`:"—",      sub:"Per year" },
        ].filter(s=>s.value!=="—"||s.label==="Total Units").map(stat=>(
          <div key={stat.label} className="bg-white border border-border rounded-xl p-3 hover:border-primary/30 hover:shadow-sm transition-all">
            <div className="text-xl font-heading font-black text-foreground">{stat.value}</div>
            <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5">{stat.label}</div>
            {stat.sub && <div className="text-[10px] text-slate-400">{stat.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Loss-to-lease / upside banner ── */}
      {hasLTL && totalLTL !== 0 && (
        <div className={`flex items-start gap-3 rounded-xl px-4 py-3 border text-sm
          ${totalLTL>0?"bg-amber-50 border-amber-100":"bg-emerald-50 border-emerald-100"}`}>
          {totalLTL>0
            ? <TrendingDown className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5"/>
            : <TrendingUp   className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5"/>}
          <div>
            <span className={`font-bold ${totalLTL>0?"text-amber-700":"text-emerald-700"}`}>
              {totalLTL>0
                ? `Loss-to-Lease: $${Math.abs(Math.round(totalLTL)).toLocaleString()}/mo · $${Math.abs(Math.round(totalLTLAnn)).toLocaleString()}/yr — rents below market`
                : `Gain-to-Lease: $${Math.abs(Math.round(totalLTL)).toLocaleString()}/mo — rents above market`}
            </span>
            {wavgMarket>0 && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Contract avg ${Math.round(wavgBase).toLocaleString()} · Market avg ${Math.round(wavgMarket).toLocaleString()} · {ltlPct.toFixed(1)}% spread
                {revenueUpside>0 && <span className="ml-2 text-amber-600 font-semibold">Upside: ${(revenueUpside/1e3).toFixed(0)}K/yr at full market</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Occupancy bar ── */}
      {totalUnits > 0 && (
        <div className="border border-border rounded-xl p-4 bg-white">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Portfolio Occupancy</span>
            <span className={`text-sm font-black ${physOcc>=90?"text-emerald-600":physOcc>=75?"text-amber-500":"text-red-500"}`}>
              {physOcc.toFixed(1)}% · {totalOccupied}/{totalUnits} units
            </span>
          </div>
          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              initial={{width:0}} animate={{width:`${Math.min(physOcc,100)}%`}} transition={{duration:0.8,ease:"easeOut"}}
              className={`h-full rounded-full ${physOcc>=90?"bg-emerald-500":physOcc>=75?"bg-amber-400":"bg-red-400"}`}/>
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-slate-400">
            <span>0%</span><span>50%</span><span>100%</span>
          </div>
        </div>
      )}

      {/* ── Unit mix table ── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-[#FFF6ED] border-b border-border flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary"/>
          <span className="text-sm font-bold">Unit Mix Detail</span>
          <div className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
            {wavgSqft>0 && <span>Wtd avg {Math.round(wavgSqft).toLocaleString()} SF</span>}
            <span className="flex items-center gap-1"><Info className="h-3 w-3"/> Hover row for AI detail</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-border">
                <th className="px-4 py-2.5 text-left   text-[10px] font-black text-muted-foreground uppercase tracking-widest sticky left-0 bg-slate-50">Unit Type</th>
                <th className="px-4 py-2.5 text-right  text-[10px] font-black text-muted-foreground uppercase tracking-widest">Total</th>
                <th className="px-4 py-2.5 text-right  text-[10px] font-black text-muted-foreground uppercase tracking-widest">Occupied</th>
                <th className="px-4 py-2.5 text-right  text-[10px] font-black text-muted-foreground uppercase tracking-widest">Vacant</th>
                <th className="px-4 py-2.5 text-right  text-[10px] font-black text-muted-foreground uppercase tracking-widest">Occ %</th>
                {hasSqft    && <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Avg SF</th>}
                <th className="px-4 py-2.5 text-right  text-[10px] font-black text-muted-foreground uppercase tracking-widest">Contract Rent</th>
                {hasTotalRent && <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Total Rent</th>}
                {hasMarket  && <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Market Rent</th>}
                {hasLTL     && <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">LTL/Unit</th>}
                {hasSqft    && <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Rent/SF</th>}
                <th className="px-4 py-2.5 text-right  text-[10px] font-black text-muted-foreground uppercase tracking-widest">Mo. Rev</th>
                <th className="px-4 py-2.5 text-right  text-[10px] font-black text-muted-foreground uppercase tracking-widest">Ann. Rev</th>
                <th className="px-4 py-2.5 text-right  text-[10px] font-black text-muted-foreground uppercase tracking-widest">% of Total</th>
                {hasUtil    && <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-widest">Utilities</th>}
                {hasLeaseUp && <th className="px-4 py-2.5 text-left  text-[10px] font-black text-muted-foreground uppercase tracking-widest">Last Lease-Up</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, i) => {
                const occupied  = row.total_units - row.vacant_units;
                const occ       = row.total_units > 0 ? ((occupied / row.total_units) * 100) : (row.physical_occ || 0);
                const base      = row.avg_base_rent || row.avg_rent || 0;
                const totalRent = row.avg_total_rent || row.avg_rent || base;
                const annRev    = row.annual_revenue || (totalRent > 0 ? Math.round(totalRent * row.total_units * 12) : 0);
                const moRev     = Math.round(annRev / 12);
                const ltl       = row.loss_to_lease || 0;
                const sqft      = row.avg_sqft || 0;
                const rentPerSF = sqft > 0 && base > 0 ? (base / sqft) : 0;
                const pctTotal  = totalAnnRev > 0 && annRev > 0 ? ((annRev / totalAnnRev) * 100) : 0;

                return (
                  <motion.tr key={row.id}
                    initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} transition={{delay:i*0.03}}
                    className="hover:bg-[#FFF6ED] transition-colors cursor-pointer group"
                    onClick={()=>setPanel(buildUnitPanel(row))}>
                    <td className="px-4 py-3 font-semibold text-foreground sticky left-0 bg-white group-hover:bg-[#FFF6ED] transition-colors">
                      <span className="flex items-center gap-1.5">
                        {row.unit_type}
                        <Sparkles className="h-3 w-3 text-violet-300 opacity-0 group-hover:opacity-100 transition-opacity"/>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">{row.total_units}</td>
                    <td className="px-4 py-3 text-right text-emerald-600 font-medium">{occupied}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{row.vacant_units}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="flex items-center justify-end gap-2">
                        <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${occ>=90?"bg-emerald-500":occ>=75?"bg-amber-400":"bg-red-400"}`}
                            style={{width:`${Math.min(occ,100)}%`}}/>
                        </div>
                        <span className={`text-xs font-bold ${occ>=90?"text-emerald-600":occ>=75?"text-amber-500":"text-red-500"}`}>
                          {occ.toFixed(0)}%
                        </span>
                      </span>
                    </td>
                    {hasSqft    && <td className="px-4 py-3 text-right text-slate-500">{fmtN(sqft)}</td>}
                    <td className="px-4 py-3 text-right font-medium text-foreground">{fmt$(base)}</td>
                    {hasTotalRent && <td className="px-4 py-3 text-right text-slate-500">{fmt$(totalRent)}</td>}
                    {hasMarket  && <td className="px-4 py-3 text-right text-slate-500">{fmt$(row.market_rent)}</td>}
                    {hasLTL && (
                      <td className="px-4 py-3 text-right">
                        {ltl!==0 ? (
                          <span className={`text-xs font-bold ${ltl>0?"text-amber-500":"text-emerald-600"}`}>
                            {ltl>0?"-":"+"}${Math.abs(ltl).toFixed(0)}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {hasSqft    && <td className="px-4 py-3 text-right text-slate-500">{rentPerSF>0?`$${rentPerSF.toFixed(2)}`:"—"}</td>}
                    <td className="px-4 py-3 text-right text-slate-600 font-medium">{moRev>0?`$${moRev.toLocaleString()}`:"—"}</td>
                    <td className="px-4 py-3 text-right font-black text-primary">
                      {annRev>0?(annRev>=1e6?`$${(annRev/1e6).toFixed(2)}M`:`$${(annRev/1e3).toFixed(0)}K`):"—"}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {pctTotal>0?(
                        <span className="flex items-center justify-end gap-1">
                          <div className="w-10 h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-primary/40 rounded-full" style={{width:`${Math.min(pctTotal,100)}%`}}/>
                          </div>
                          {pctTotal.toFixed(1)}%
                        </span>
                      ):"—"}
                    </td>
                    {hasUtil    && <td className="px-4 py-3 text-right text-slate-500">{fmtDec(row.avg_utilities)}</td>}
                    {hasLeaseUp && <td className="px-4 py-3 text-slate-500 text-xs">{row.latest_lease_up||"—"}</td>}
                  </motion.tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-border font-black">
                <td className="px-4 py-3 text-xs text-muted-foreground uppercase tracking-widest sticky left-0 bg-slate-50">Total / Wtd Avg</td>
                <td className="px-4 py-3 text-right text-foreground">{totalUnits}</td>
                <td className="px-4 py-3 text-right text-emerald-600">{totalOccupied}</td>
                <td className="px-4 py-3 text-right text-foreground">{totalVacant}</td>
                <td className="px-4 py-3 text-right text-foreground">{physOcc.toFixed(1)}%</td>
                {hasSqft    && <td className="px-4 py-3 text-right text-foreground">{wavgSqft>0?Math.round(wavgSqft).toLocaleString():"—"}</td>}
                <td className="px-4 py-3 text-right text-foreground">{wavgBase>0?`$${Math.round(wavgBase).toLocaleString()}`:"—"}</td>
                {hasTotalRent && <td className="px-4 py-3 text-right text-foreground">{wavgTotal>0?`$${Math.round(wavgTotal).toLocaleString()}`:"—"}</td>}
                {hasMarket  && <td className="px-4 py-3 text-right text-foreground">{wavgMarket>0?`$${Math.round(wavgMarket).toLocaleString()}`:"—"}</td>}
                {hasLTL     && <td className="px-4 py-3 text-right">
                  {totalLTL!==0?<span className={totalLTL>0?"text-amber-500":"text-emerald-600"}>
                    {totalLTL>0?"-":"+"}${Math.abs(Math.round(totalLTL)).toLocaleString()}
                  </span>:"—"}
                </td>}
                {hasSqft && <td className="px-4 py-3 text-right text-foreground">
                  {wavgSqft>0&&wavgBase>0?`$${(wavgBase/wavgSqft).toFixed(2)}`:"—"}
                </td>}
                <td className="px-4 py-3 text-right text-foreground">{totalMonthRev>0?`$${totalMonthRev.toLocaleString()}`:"—"}</td>
                <td className="px-4 py-3 text-right text-primary">
                  {totalAnnRev>0?(totalAnnRev>=1e6?`$${(totalAnnRev/1e6).toFixed(2)}M`:`$${(totalAnnRev/1e3).toFixed(0)}K`):"—"}
                </td>
                <td className="px-4 py-3 text-right text-foreground">100%</td>
                {hasUtil    && <td className="px-4 py-3">—</td>}
                {hasLeaseUp && <td className="px-4 py-3">—</td>}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {panel && <DetailPanel dealId={dealId} data={panel} onClose={()=>setPanel(null)}/>}
    </div>
  );
}
