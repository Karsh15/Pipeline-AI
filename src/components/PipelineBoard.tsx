"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Building2, MapPin, DollarSign, Zap, RefreshCw,
  ChevronRight, Clock, CheckCircle2, Loader2, AlertCircle,
} from "lucide-react";
import { supabase, type DBDeal, type PipelineStatus } from "@/lib/supabase";
import { PIPELINE_STAGES, createDeal, fetchDeals, triggerExtraction, triggerUnderwriting } from "@/lib/pipeline";
import { formatCurrency } from "@/lib/mockData";

interface Props {
  onSelectDeal: (deal: DBDeal) => void;
  selectedId: string | null;
}

function StageIcon({ status }: { status: PipelineStatus }) {
  if (status === "completed")   return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === "extraction" || status === "underwriting")
                                 return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
  if (status === "lead")         return <Clock className="h-3.5 w-3.5 text-slate-400" />;
  return <ChevronRight className="h-3.5 w-3.5 text-blue-400" />;
}

export default function PipelineBoard({ onSelectDeal, selectedId }: Props) {
  const [deals, setDeals]           = useState<DBDeal[]>([]);
  const [loading, setLoading]       = useState(true);
  const [creating, setCreating]     = useState(false);
  const [newName, setNewName]       = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [runningId, setRunningId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetchDeals();
    setDeals(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Realtime subscription — update deal status live
  useEffect(() => {
    const channel = supabase
      .channel("deals-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setDeals(prev => [payload.new as DBDeal, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setDeals(prev => prev.map(d => d.id === (payload.new as DBDeal).id ? payload.new as DBDeal : d));
          } else if (payload.eventType === "DELETE") {
            setDeals(prev => prev.filter(d => d.id !== (payload.old as { id: string }).id));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const deal = await createDeal(newName.trim());
    setCreating(false);
    setNewName("");
    setShowCreate(false);
    if (deal) onSelectDeal(deal);
  };

  const runPipeline = async (deal: DBDeal, e: React.MouseEvent) => {
    e.stopPropagation();
    setRunningId(deal.id);
    try {
      const stream = await triggerExtraction(deal.id);
      const reader = stream.getReader();
      const dec    = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = dec.decode(value).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as { type: string; stage?: string };
            if (evt.type === "complete" && evt.stage === "underwriting") {
              // Auto-trigger underwriting next
              await triggerUnderwriting(deal.id);
            }
          } catch {}
        }
      }
    } finally {
      setRunningId(null);
    }
  };

  const grouped = PIPELINE_STAGES.reduce((acc, stage) => {
    acc[stage.key] = deals.filter(d => d.status === stage.key);
    return acc;
  }, {} as Record<PipelineStatus, DBDeal[]>);

  if (loading) return (
    <div className="p-4 space-y-2">
      {[1,2,3].map(i => <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />)}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-xs font-black text-foreground">AI Pipeline</div>
          <div className="text-[10px] text-muted-foreground">{deals.length} deals</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={load} className="p-1.5 hover:bg-secondary rounded-lg transition-colors">
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={() => setShowCreate(p => !p)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-border"
          >
            <div className="p-3 bg-[#FFF6ED] space-y-2">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
                placeholder="Deal name…"
                autoFocus
                className="w-full text-sm border border-orange-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex gap-2">
                <button onClick={() => setShowCreate(false)} className="flex-1 py-1.5 border border-border rounded-lg text-xs font-medium text-slate-600 hover:bg-white transition-colors">
                  Cancel
                </button>
                <button onClick={handleCreate} disabled={creating || !newName.trim()}
                  className="flex-1 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                  {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  Create
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Deal list grouped by stage */}
      <div className="flex-1 overflow-y-auto">
        {PIPELINE_STAGES.map(stage => {
          const stageDeals = grouped[stage.key] || [];
          if (!stageDeals.length) return null;
          return (
            <div key={stage.key}>
              <div className="px-4 py-2 bg-slate-50/80 border-b border-border sticky top-0 z-10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${stage.color}`}>
                      {stage.label}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">{stageDeals.length}</span>
                </div>
              </div>

              {stageDeals.map(deal => {
                const isActive  = deal.id === selectedId;
                const isRunning = runningId === deal.id;
                return (
                  <motion.button
                    key={deal.id}
                    layout
                    onClick={() => onSelectDeal(deal)}
                    className={`w-full text-left px-4 py-3 border-b border-border transition-all
                      ${isActive ? "bg-[#FFF6ED] border-l-2 border-l-primary" : "bg-white hover:bg-slate-50"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <StageIcon status={deal.status} />
                          <span className="text-sm font-semibold text-foreground truncate">{deal.name}</span>
                        </div>
                        {(deal.city || deal.state) && (
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <MapPin className="h-2.5 w-2.5" />
                            {deal.city}{deal.city && deal.state ? ", " : ""}{deal.state}
                          </div>
                        )}
                        {deal.guidance_price ? (
                          <div className="flex items-center gap-1 text-[11px] text-primary font-bold mt-0.5">
                            <DollarSign className="h-2.5 w-2.5" />
                            {formatCurrency(deal.guidance_price)}
                          </div>
                        ) : null}
                      </div>

                      {/* Run button for unprocessed deals */}
                      {(deal.status === "lead" || deal.status === "ingestion") && (
                        <button
                          onClick={e => runPipeline(deal, e)}
                          disabled={isRunning}
                          className="flex-shrink-0 p-1.5 bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors disabled:opacity-50"
                          title="Run AI Pipeline"
                        >
                          {isRunning
                            ? <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                            : <Zap className="h-3.5 w-3.5 text-primary" />
                          }
                        </button>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          );
        })}

        {!deals.length && (
          <div className="p-8 text-center">
            <Building2 className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground font-medium">No deals yet</p>
            <p className="text-xs text-slate-400 mt-1">Create a deal or upload a document to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
