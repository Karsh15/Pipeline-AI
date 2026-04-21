"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Upload, Zap, MessageSquare, Send, Bot, User,
  AlertTriangle, CheckCircle2, HelpCircle, ClipboardList,
  Loader2, ShieldAlert, BarChart3, Info, FileText, Trash2, Sparkles,
  Map, GitCompare, Building2,
} from "lucide-react";
import { supabase, type DBDeal, type DBRisk, type DBQuestion, type DBDocument } from "@/lib/supabase";
import { PIPELINE_STAGES, stageMeta, triggerExtraction, triggerUnderwriting, uploadDocument } from "@/lib/pipeline";
import FinancialDashboard from "./FinancialDashboard";
import UnitMixTable from "./UnitMixTable";
import ExportButtons from "./ExportButtons";
import WhyPanel from "./WhyPanel";
import DocumentViewer from "./DocumentViewer";
import dynamic from "next/dynamic";

const MapComponent = dynamic(() => import("./Map"), { ssr: false, loading: () => <div className="h-full bg-slate-100 animate-pulse" /> });

interface ChatMsg { role: "user" | "ai"; content: string; citations?: { field: string; snippet: string; page: number }[] }

interface Props {
  deal: DBDeal;
  onClose: () => void;
  onUpdate: (deal: DBDeal) => void;
}

export default function DealWorkspace({ deal, onClose, onUpdate }: Props) {
  const [tab, setTab]             = useState<"overview" | "financials" | "unit-mix" | "diligence" | "documents" | "chat" | "map" | "match">("overview");
  const [allDeals, setAllDeals]   = useState<DBDeal[]>([]);
  const [risks, setRisks]         = useState<DBRisk[]>([]);
  const [questions, setQuestions] = useState<DBQuestion[]>([]);
  const [documents, setDocuments] = useState<DBDocument[]>([]);
  const [viewDoc, setViewDoc]     = useState<DBDocument | null>(null);
  const [chatMsgs, setChatMsgs]   = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isBotTyping, setTyping]  = useState(false);
  const [runState, setRunState]   = useState<"idle" | "running" | "done">("idle");
  const [runLog, setRunLog]       = useState<string[]>([]);
  const [agentResults, setAgentResults] = useState<Record<string, unknown>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [whyPanel, setWhyPanel]   = useState<{ field: string; label: string; value: string } | null>(null);
  const fileRef   = useRef<HTMLInputElement>(null);
  const chatRef   = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  // Re-fetch risks/questions/documents whenever deal changes OR status advances
  // (status change signals that an agent just wrote new rows)
  useEffect(() => {
    supabase.from("risks").select("*").eq("deal_id", deal.id).then(({ data }) => setRisks((data ?? []) as DBRisk[]));
    supabase.from("questions").select("*").eq("deal_id", deal.id).then(({ data }) => setQuestions((data ?? []) as DBQuestion[]));
    supabase.from("documents").select("*").eq("deal_id", deal.id).order("uploaded_at", { ascending: false })
      .then(({ data }) => setDocuments((data ?? []) as DBDocument[]));
  }, [deal.id, deal.status]);

  // Realtime subscriptions for diligence tables (risks, questions, documents)
  useEffect(() => {
    const ch = supabase.channel(`diligence-${deal.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "documents", filter: `deal_id=eq.${deal.id}` },
        (p) => {
          if (p.eventType === "INSERT") setDocuments(prev => [p.new as DBDocument, ...prev]);
          else if (p.eventType === "DELETE") setDocuments(prev => prev.filter(d => d.id !== (p.old as { id: string }).id));
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "risks", filter: `deal_id=eq.${deal.id}` },
        () => {
          supabase.from("risks").select("*").eq("deal_id", deal.id).then(({ data }) => setRisks((data ?? []) as DBRisk[]));
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "questions", filter: `deal_id=eq.${deal.id}` },
        () => {
          supabase.from("questions").select("*").eq("deal_id", deal.id).then(({ data }) => setQuestions((data ?? []) as DBQuestion[]));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [deal.id]);

  const deleteDocument = async (docId: string) => {
    if (!confirm("Delete this document?")) return;
    await supabase.from("documents").delete().eq("id", docId);
  };

  const openDocument = (doc: DBDocument) => setViewDoc(doc);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMsgs, isBotTyping]);

  // Realtime: watch for deal updates
  useEffect(() => {
    const ch = supabase
      .channel(`deal-${deal.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "deals", filter: `id=eq.${deal.id}` },
        payload => onUpdate(payload.new as DBDeal)
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [deal.id, onUpdate]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRunState("running");
    setRunLog([`Uploading ${file.name}…`]);
    await uploadDocument(deal.id, file);
    setRunLog(p => [...p, "✓ Document stored", "Starting AI extraction…"]);
    await runExtraction();
  };

  const cancelPipeline = async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunLog(p => [...p, "⛔ Pipeline cancelled by user"]);
    setRunState("idle");
    // Mark the deal + any running jobs as cancelled in DB
    await supabase.from("ai_jobs").update({ status: "failed", result: { cancelled: true } })
      .eq("deal_id", deal.id).in("status", ["pending", "running"]);
    await supabase.from("deals").update({ status: "lead" }).eq("id", deal.id);
  };

  const runExtraction = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunState("running");
    try {
      const stream = await triggerExtraction(deal.id, ctrl.signal);
      const reader = stream.getReader();
      const dec    = new TextDecoder();
      while (true) {
        if (ctrl.signal.aborted) { reader.cancel(); break; }
        const { done, value } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").forEach(line => {
          if (!line.startsWith("data: ")) return;
          try {
            const evt = JSON.parse(line.slice(6)) as { type: string; agent?: string; message?: string; stage?: string; json?: unknown; raw?: string };
            if (evt.type === "log" && evt.message)       setRunLog(p => [...p, evt.message!]);
            if (evt.type === "agent_start" && evt.agent) setRunLog(p => [...p, `→ Running ${evt.agent}…`]);
            if (evt.type === "error")                    setRunLog(p => [...p, `⚠ ERROR: ${evt.message}`]);
            if (evt.type === "agent_result" && evt.agent) {
              setAgentResults(p => ({ ...p, [evt.agent!]: evt.json ?? evt.raw ?? null }));
              setRefreshKey(k => k + 1);
            }
            if (evt.type === "complete") {
              setRefreshKey(k => k + 1);
              setRunLog(p => [...p, "✓ Extraction complete. Running underwriting…"]);
              triggerUnderwriting(deal.id, ctrl.signal).then(async uwStream => {
                const r2 = uwStream.getReader();
                while (true) {
                  if (ctrl.signal.aborted) { r2.cancel(); break; }
                  const { done: d2, value: v2 } = await r2.read();
                  if (d2) break;
                  dec.decode(v2).split("\n").forEach(l => {
                    if (!l.startsWith("data: ")) return;
                    try {
                      const e2 = JSON.parse(l.slice(6)) as { type: string; message?: string };
                      if (e2.type === "log" && e2.message) setRunLog(p => [...p, e2.message!]);
                      if (e2.type === "complete") { setRunLog(p => [...p, "✓ Pipeline complete!"]); setRunState("done"); abortRef.current = null; }
                    } catch {}
                  });
                }
              }).catch(() => {});
            }
          } catch {}
        });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setRunLog(p => [...p, `⚠ Error: ${err}`]);
      }
      setRunState("idle");
      abortRef.current = null;
    }
  };

  const sendChat = async (msg?: string) => {
    const text = msg ?? chatInput;
    if (!text.trim() || isBotTyping) return;
    setChatInput("");
    setChatMsgs(p => [...p, { role: "user", content: text }]);
    setTyping(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.id, message: text, history: chatMsgs.slice(-6) }),
      });
      const data = await res.json() as { reply: string; citations: { field: string; snippet: string; page: number }[] };
      setChatMsgs(p => [...p, { role: "ai", content: data.reply, citations: data.citations }]);
    } catch {
      setChatMsgs(p => [...p, { role: "ai", content: "Error fetching response. Please try again." }]);
    }
    setTyping(false);
  };

  const stage     = stageMeta(deal.status);
  const dbStageIdx = PIPELINE_STAGES.findIndex(s => s.key === deal.status);

  // Derive live progress from runLog so dots fill in real-time during pipeline
  const liveStageIdx = (() => {
    if (runState === "idle") return dbStageIdx;
    const log = runLog.join(" ");
    if (log.includes("Pipeline complete")) return PIPELINE_STAGES.length - 1;
    if (log.includes("Running underwriting") || log.includes("underwriting"))
      return Math.max(dbStageIdx, PIPELINE_STAGES.findIndex(s => s.key === "underwriting"));
    if (log.includes("Extraction complete") || agentResults["financial"] || agentResults["unit_mix"])
      return Math.max(dbStageIdx, PIPELINE_STAGES.findIndex(s => s.key === "extraction"));
    if (log.includes("Distilling") || agentResults["metadata"])
      return Math.max(dbStageIdx, PIPELINE_STAGES.findIndex(s => s.key === "ingestion"));
    return dbStageIdx;
  })();

  const stageIdx = runState === "done" ? PIPELINE_STAGES.length - 1 : liveStageIdx;
  const fmt       = (n: number | null | undefined) => (n && n > 0) ? (n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : `$${(n/1e3).toFixed(0)}K`) : "—";

  useEffect(() => {
    if (tab === "match" && !allDeals.length) {
      supabase.from("deals").select("*").then(({ data }) => setAllDeals((data ?? []) as DBDeal[]));
    }
  }, [tab, allDeals.length]);

  const tabs = [
    { key: "overview",   label: "Overview",   icon: Info          },
    { key: "financials", label: "Financials", icon: BarChart3     },
    { key: "unit-mix",   label: "Unit Mix",   icon: ClipboardList },
    { key: "diligence",  label: "Diligence",  icon: ShieldAlert   },
    { key: "documents",  label: "Documents",  icon: FileText      },
    { key: "map",        label: "Map",        icon: Map           },
    { key: "match",      label: "Match",      icon: GitCompare    },
    { key: "chat",       label: "Chat",       icon: MessageSquare },
  ] as const;

  return (
    <div className="flex flex-col min-h-full bg-white">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-border bg-white">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${stage.color}`}>
                {stage.label}
              </span>
              {(deal.status === "extraction" || deal.status === "underwriting") && (
                <span className="flex items-center gap-1 text-[10px] text-primary font-bold animate-pulse">
                  <Loader2 className="h-3 w-3 animate-spin" /> Processing…
                </span>
              )}
            </div>
            <h1 className="text-xl font-heading font-black text-foreground">{deal.name}</h1>
            {(deal.city || deal.state) && (
              <p className="text-xs text-muted-foreground">{deal.address ? `${deal.address}, ` : ""}{deal.city}, {deal.state}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Pipeline progress */}
          <div className="hidden lg:flex items-center gap-1">
            {PIPELINE_STAGES.map((s, i) => {
              const filled  = i <= stageIdx;
              const active  = i === stageIdx && runState === "running";
              const done    = runState === "done" && i <= stageIdx;
              return (
                <div key={s.key} className="flex items-center gap-1">
                  <div className="relative flex items-center justify-center">
                    {active && (
                      <span className="absolute w-4 h-4 rounded-full bg-primary/30 animate-ping" />
                    )}
                    <div className={`w-2.5 h-2.5 rounded-full transition-all duration-500
                      ${done ? "bg-emerald-500 scale-110" : filled ? "bg-primary" : "bg-slate-200"}`}
                      title={s.label}
                    />
                  </div>
                  {i < PIPELINE_STAGES.length - 1 && (
                    <div className={`w-5 h-0.5 transition-all duration-500 ${i < stageIdx ? "bg-primary" : "bg-slate-200"}`} />
                  )}
                </div>
              );
            })}
          </div>

          <input type="file" ref={fileRef} className="hidden" accept=".pdf,.xlsx,.xls,.docx,.csv"
            onChange={handleFileUpload} />
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-xl text-xs font-bold hover:bg-secondary transition-colors">
            <Upload className="h-3.5 w-3.5" /> Upload Doc
          </button>
          {runState === "running" ? (
            <button onClick={cancelPipeline}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-500 text-white rounded-xl text-xs font-bold hover:bg-red-600 transition-colors">
              <X className="h-3.5 w-3.5" /> Cancel Pipeline
            </button>
          ) : (deal.status === "lead" || deal.status === "ingestion") ? (
            <button onClick={() => runExtraction()}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/90 transition-colors">
              <Zap className="h-3.5 w-3.5" /> Run Pipeline
            </button>
          ) : (
            <button onClick={() => runExtraction()}
              className="flex items-center gap-1.5 px-3 py-2 border border-primary text-primary rounded-xl text-xs font-bold hover:bg-primary/10 transition-colors">
              <Zap className="h-3.5 w-3.5" /> Re-run
            </button>
          )}
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-xl transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* ── Pipeline log (when running OR processing) ── */}
      <AnimatePresence>
        {(runState === "running" || deal.status === "extraction" || deal.status === "underwriting" || deal.status === "ingestion") && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
            className="overflow-hidden border-b border-border bg-slate-900">
            <div className="p-4 max-h-48 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-0.5">
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                <span className="text-primary font-bold uppercase tracking-wider text-[10px]">
                  Pipeline · {deal.status}
                </span>
              </div>
              {runLog.length > 0 ? runLog.map((l, i) => (
                <div key={i} className={l.startsWith("✓") ? "text-emerald-400" : l.startsWith("⚠") ? "text-amber-400" : "text-slate-300"}>
                  {l}
                </div>
              )) : (
                <LivePipelineStatus dealId={deal.id} dealStatus={deal.status} />
              )}
              <span className="animate-pulse text-primary">▌</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Pipeline success banner ── */}
      <AnimatePresence>
        {runState === "done" && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: "spring", damping: 24, stiffness: 260 }}
            className="mx-6 mt-3 flex items-center justify-between gap-4 bg-emerald-500 text-white rounded-xl px-5 py-3.5 shadow-lg shadow-emerald-200"
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
              <div>
                <p className="text-sm font-black leading-tight">Pipeline completed successfully</p>
                <p className="text-xs text-white/75 mt-0.5">All agents finished — deal data has been updated.</p>
              </div>
            </div>
            <button
              onClick={() => setRunState("idle")}
              className="p-1.5 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Agent JSON output viewer ── */}
      {Object.keys(agentResults).length > 0 && (
        <AgentResultsViewer results={agentResults} />
      )}

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-border bg-white overflow-x-auto">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap
                ${tab === t.key ? "bg-[#FFF6ED] text-primary border border-orange-100" : "text-muted-foreground hover:text-foreground hover:bg-slate-50"}`}>
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Content ── */}
      <div className={`flex-1 ${tab === "documents" ? "overflow-hidden flex flex-col" : ""}`}>
        {/* OVERVIEW */}
        {tab === "overview" && (
          <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Key metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Guidance Price", value: fmt(deal.guidance_price), field: "guidancePrice" },
                  { label: "NOI (TTM)",      value: fmt(deal.noi),            field: "noi"           },
                  { label: "Cap Rate",       value: deal.cap_rate ? `${deal.cap_rate}%` : "—", field: "capRate" },
                  { label: "Units",          value: deal.units ? String(deal.units) : "—", field: "units" },
                ].map(m => (
                  <div key={m.label}
                    className="bg-white border border-border rounded-xl p-4 cursor-pointer group hover:border-primary/30 hover:shadow-sm transition-all"
                    onClick={() => setWhyPanel({ field: m.field, label: m.label, value: m.value })}
                  >
                    <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1 flex justify-between">
                      {m.label}
                      <HelpCircle className="h-3 w-3 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="text-xl font-heading font-black text-foreground">{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Details */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Asset Type",     value: deal.asset_type,    field: "assetType"     },
                  { label: "Property Type",  value: deal.property_type, field: "propertyType"  },
                  { label: "Year Built",     value: deal.year_built,    field: "yearBuilt"     },
                  { label: "Broker",         value: deal.broker,        field: "broker"        },
                  { label: "Brand / Flag",   value: deal.brand,         field: "brand"         },
                  { label: "Deal Lead",      value: deal.deal_lead,     field: "dealLead"      },
                ].filter(r => r.value).map(r => (
                  <div key={r.label}
                    className="bg-slate-50 rounded-xl p-3 border border-border cursor-pointer group hover:border-primary/30 hover:bg-white hover:shadow-sm transition-all"
                    onClick={() => setWhyPanel({ field: r.field, label: r.label, value: String(r.value) })}
                  >
                    <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-0.5 flex justify-between items-center">
                      {r.label}
                      <Sparkles className="h-3 w-3 text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="text-sm font-semibold text-foreground">{String(r.value)}</div>
                  </div>
                ))}
              </div>

              {/* Narratives */}
              {deal.broker_narrative && (
                <div className="bg-[#FFF6ED] border border-orange-100 rounded-xl p-5 cursor-pointer group hover:shadow-sm transition-all"
                  onClick={() => setWhyPanel({ field: "brokerNarrative", label: "Broker Narrative", value: deal.broker_narrative! })}>
                  <div className="text-[10px] font-black text-primary uppercase tracking-widest mb-2 flex justify-between items-center">
                    Broker Narrative
                    <Sparkles className="h-3 w-3 text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{deal.broker_narrative}</p>
                </div>
              )}
              {deal.location_insight && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 cursor-pointer group hover:shadow-sm transition-all"
                  onClick={() => setWhyPanel({ field: "locationInsight", label: "Location Insight", value: deal.location_insight! })}>
                  <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-2 flex justify-between items-center">
                    Location Insight
                    <Sparkles className="h-3 w-3 text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{deal.location_insight}</p>
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="space-y-5">
              {/* Mini map */}
              {deal.lat && deal.lng && (
                <div className="h-48 rounded-xl overflow-hidden border border-border">
                  <MapComponent selectedDealId={deal.id} deals={[{
                    id: deal.id, name: deal.name, status: deal.status as "LOI",
                    address: deal.address || "", city: deal.city || "", state: deal.state || "",
                    lat: deal.lat, lng: deal.lng,
                    assetType: deal.asset_type || "", propertyType: deal.property_type || "",
                    broker: deal.broker || "", brand: deal.brand || "", dealLead: deal.deal_lead || "",
                    units: deal.units || 0, guidancePrice: deal.guidance_price || 0,
                    yearBuilt: deal.year_built || 0, noi: deal.noi || 0, capRate: Number(deal.cap_rate) || 0,
                    addedAt: deal.created_at, amenities: [], files: [], notes: [], financials: [],
                    criteria: [], questions: [], risks: [], brokerNarrative: "", locationInsight: "",
                    agents: { metadata: "pending" as const, summary: "pending" as const, questions: "pending" as const, criteria: "pending" as const, financial: "pending" as const, risks: "pending" as const },
                  }]} instanceId={`workspace-${deal.id}`} />
                </div>
              )}

              {/* Criteria */}
              <CriteriaWidget dealId={deal.id} />

              {/* Export */}
              {(deal.status === "review" || deal.status === "completed") && (
                <ExportButtons dealId={deal.id} dealName={deal.name} />
              )}
            </div>
          </div>
        )}

        {/* FINANCIALS */}
        {tab === "financials" && (
          <div className="p-8">
            <FinancialDashboard dealId={deal.id} deal={deal} refreshKey={refreshKey} />
          </div>
        )}

        {/* UNIT MIX */}
        {tab === "unit-mix" && (
          <div className="p-8">
            <UnitMixTable dealId={deal.id} refreshKey={refreshKey} />
          </div>
        )}

        {/* DILIGENCE */}
        {tab === "diligence" && (
          <div className="p-8 space-y-6">
            {/* Risks */}
            <div className="border border-red-100 rounded-xl overflow-hidden">
              <div className="px-5 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-red-500" />
                <span className="text-sm font-bold text-red-800">Risk Flags</span>
                <span className="ml-auto text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold">{risks.length}</span>
              </div>
              {risks.length ? risks.map(r => (
                <div key={r.id} className="flex items-start gap-3 px-5 py-3 border-b border-red-50 last:border-0">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5
                    ${r.severity === "critical" ? "bg-red-100 text-red-700" : r.severity === "high" ? "bg-orange-100 text-orange-700" :
                      r.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                    {r.severity}
                  </span>
                  <span className="text-sm text-slate-700">{r.description}</span>
                </div>
              )) : <p className="px-5 py-4 text-sm text-muted-foreground italic">No risks identified yet.</p>}
            </div>

            {/* Questions */}
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-border flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-violet-500" />
                <span className="text-sm font-bold text-foreground">Due Diligence Questions</span>
                <span className="ml-auto text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded font-bold">{questions.length}</span>
              </div>
              {questions.length ? (
                Object.entries(
                  questions.reduce((g, q) => { (g[q.category] = g[q.category] || []).push(q); return g; }, {} as Record<string, typeof questions>)
                ).map(([cat, qs]) => (
                  <div key={cat}>
                    <div className="px-5 py-2 bg-violet-50/50 border-b border-border">
                      <span className="text-[10px] font-black text-violet-600 uppercase tracking-widest">{cat}</span>
                    </div>
                    {qs.map((q, i) => (
                      <div key={q.id} className="flex gap-3 px-5 py-3 border-b border-border last:border-0">
                        <span className="flex-shrink-0 w-5 h-5 bg-violet-100 text-violet-700 rounded-full flex items-center justify-center text-[10px] font-bold">{i+1}</span>
                        <span className="text-sm text-slate-700">{q.question}</span>
                      </div>
                    ))}
                  </div>
                ))
              ) : <p className="px-5 py-4 text-sm text-muted-foreground italic">Questions will be generated after extraction.</p>}
            </div>
          </div>
        )}

        {/* DOCUMENTS */}
        {tab === "documents" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between px-8 pt-8 pb-4 border-b border-border bg-white sticky top-0 z-10">
              <div>
                <h3 className="text-base font-heading font-black text-foreground">Uploaded Documents</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{documents.length} file{documents.length !== 1 ? "s" : ""} attached to this deal</p>
              </div>
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors">
                <Upload className="h-3.5 w-3.5" /> Upload More
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-5">
            {documents.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {documents.map(doc => {
                  const ext = doc.file_name.split(".").pop()?.toUpperCase() || "FILE";
                  const typeColor: Record<string, string> = {
                    PDF: "bg-red-50 text-red-600 border-red-200",
                    XLSX: "bg-emerald-50 text-emerald-600 border-emerald-200",
                    XLS: "bg-emerald-50 text-emerald-600 border-emerald-200",
                    DOCX: "bg-blue-50 text-blue-600 border-blue-200",
                    CSV: "bg-amber-50 text-amber-600 border-amber-200",
                  };
                  const badge = typeColor[ext] || "bg-slate-50 text-slate-600 border-slate-200";
                  return (
                    <div key={doc.id}
                      onClick={() => openDocument(doc)}
                      className="group flex items-center gap-3 p-4 bg-white border border-border rounded-xl hover:border-primary/40 hover:shadow-md transition-all cursor-pointer">
                      <div className={`flex-shrink-0 w-11 h-11 rounded-lg border flex items-center justify-center font-black text-[10px] ${badge}`}>
                        {ext}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate" title={doc.file_name}>
                          {doc.file_name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                            {doc.document_type.replace("_", " ")}
                          </span>
                          <span className="text-[10px] text-muted-foreground">•</span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(doc.uploaded_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteDocument(doc.id); }}
                        title="Delete"
                        className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-50 rounded-lg transition-all">
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="border-2 border-dashed border-border rounded-xl p-12 text-center">
                <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">No documents uploaded yet</p>
                <p className="text-xs text-muted-foreground mt-1">Upload an OM, rent roll, or T-12 to start extraction.</p>
                <button onClick={() => fileRef.current?.click()}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors">
                  <Upload className="h-3.5 w-3.5" /> Upload Document
                </button>
              </div>
            )}
            </div>
          </div>
        )}

        {/* MAP */}
        {tab === "map" && (
          <div className="h-[calc(100vh-220px)] min-h-[500px]">
            <MapComponent
              selectedDealId={deal.id}
              deals={[{
                id: deal.id, name: deal.name, status: deal.status as "LOI",
                address: deal.address || "", city: deal.city || "", state: deal.state || "",
                lat: deal.lat ?? 0, lng: deal.lng ?? 0,
                assetType: deal.asset_type || "", propertyType: deal.property_type || "",
                broker: deal.broker || "", brand: deal.brand || "", dealLead: deal.deal_lead || "",
                units: deal.units || 0, guidancePrice: deal.guidance_price || 0,
                yearBuilt: deal.year_built || 0, noi: deal.noi || 0, capRate: Number(deal.cap_rate) || 0,
                addedAt: deal.created_at, amenities: [], files: [], notes: [], financials: [],
                criteria: [], questions: [], risks: [], brokerNarrative: "", locationInsight: "",
                agents: { metadata: "pending" as const, summary: "pending" as const, questions: "pending" as const, criteria: "pending" as const, financial: "pending" as const, risks: "pending" as const },
              }]}
              instanceId={`map-tab-${deal.id}`}
            />
          </div>
        )}

        {/* MATCH */}
        {tab === "match" && (
          <div className="p-8 space-y-6">
            <div>
              <h2 className="text-base font-heading font-black text-foreground mb-1">Comparable Deals</h2>
              <p className="text-xs text-muted-foreground">Deals in your pipeline with similar asset type, size, or geography.</p>
            </div>
            <MatchPanel deal={deal} allDeals={allDeals} />
          </div>
        )}

        {/* CHAT */}
        {tab === "chat" && (
          <div className="flex flex-col h-full">
            <div ref={chatRef} className="flex-1 overflow-y-auto p-6 space-y-4" style={{ minHeight: 0 }}>
              {!chatMsgs.length && (
                <div className="text-center py-8">
                  <Bot className="h-10 w-10 text-primary/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground font-medium">Ask anything about this deal</p>
                  <div className="flex flex-wrap gap-2 justify-center mt-4">
                    {["What's the NOI?", "Summarize the risks", "Is this a buy?", "What's the cap rate?"].map(q => (
                      <button key={q} onClick={() => sendChat(q)}
                        className="text-xs px-3 py-1.5 bg-[#FFF6ED] text-primary border border-orange-100 rounded-lg hover:bg-orange-100 transition-colors font-medium">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatMsgs.map((m, i) => (
                <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "ai" && <div className="w-7 h-7 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0"><Bot className="h-4 w-4 text-primary" /></div>}
                  <div className={`max-w-[80%] space-y-1`}>
                    <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed
                      ${m.role === "user" ? "bg-primary text-white rounded-br-sm" : "bg-slate-100 text-slate-800 rounded-bl-sm"}`}>
                      {m.content}
                    </div>
                    {m.citations?.map((c, ci) => c.snippet && (
                      <div key={ci} className="text-[10px] bg-blue-50 border border-blue-100 rounded-lg px-2 py-1 text-blue-700">
                        📄 Page {c.page}: "{c.snippet.substring(0,60)}…"
                      </div>
                    ))}
                  </div>
                  {m.role === "user" && <div className="w-7 h-7 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0"><User className="h-4 w-4 text-slate-500" /></div>}
                </div>
              ))}
              {isBotTyping && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 bg-primary/10 rounded-full flex items-center justify-center"><Bot className="h-4 w-4 text-primary" /></div>
                  <div className="bg-slate-100 rounded-2xl px-4 py-3 flex gap-1 items-center">
                    {[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />)}
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-border">
              <form onSubmit={e => { e.preventDefault(); sendChat(); }} className="flex gap-2">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                  placeholder={`Ask about ${deal.name}…`}
                  className="flex-1 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white" />
                <button type="submit" disabled={isBotTyping || !chatInput.trim()}
                  className="p-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50">
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {whyPanel && (
        <WhyPanel dealId={deal.id} fieldName={whyPanel.field} fieldLabel={whyPanel.label}
          value={whyPanel.value} onClose={() => setWhyPanel(null)} />
      )}

      <AnimatePresence>
        {viewDoc && <DocumentViewer doc={viewDoc} onClose={() => setViewDoc(null)} />}
      </AnimatePresence>
    </div>
  );
}

function CriteriaWidget({ dealId }: { dealId: string }) {
  const [criteria, setCriteria] = useState<{ criteria: string; actual: string; meets: boolean }[]>([]);
  useEffect(() => {
    supabase.from("criteria").select("*").eq("deal_id", dealId)
      .then(({ data }) => setCriteria((data ?? []) as { criteria: string; actual: string; meets: boolean }[]));
  }, [dealId]);
  if (!criteria.length) return null;
  const pass = criteria.filter(c => c.meets).length;
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-emerald-500" />
          <span className="text-xs font-bold text-foreground">Buy Box</span>
        </div>
        <span className={`text-xs font-black px-1.5 py-0.5 rounded ${pass === criteria.length ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
          {pass}/{criteria.length}
        </span>
      </div>
      {criteria.slice(0, 5).map(c => (
        <div key={c.criteria} className="flex items-center justify-between px-4 py-2 border-b border-border last:border-0">
          <span className="text-xs text-slate-600 truncate">{c.criteria}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">{c.actual}</span>
            {c.meets
              ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
              : <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Live pipeline status (polls Supabase when runLog is empty) ───────────────
function LivePipelineStatus({ dealId, dealStatus }: { dealId: string; dealStatus: string }) {
  const [counts, setCounts] = useState({
    metadata: 0, financial: 0, unitMix: 0, questions: 0, criteria: 0, risks: 0, underwriting: 0,
  });

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const [ex, fin, um, q, c, r] = await Promise.all([
        supabase.from("extracted_data").select("field_name", { count: "exact", head: true }).eq("deal_id", dealId),
        supabase.from("financials").select("id", { count: "exact", head: true }).eq("deal_id", dealId),
        supabase.from("unit_mix").select("id", { count: "exact", head: true }).eq("deal_id", dealId),
        supabase.from("questions").select("id", { count: "exact", head: true }).eq("deal_id", dealId),
        supabase.from("criteria").select("id", { count: "exact", head: true }).eq("deal_id", dealId),
        supabase.from("risks").select("id", { count: "exact", head: true }).eq("deal_id", dealId),
      ]);
      if (!alive) return;
      setCounts({
        metadata:     ex.count ?? 0,
        financial:    fin.count ?? 0,
        unitMix:      um.count ?? 0,
        questions:    q.count ?? 0,
        criteria:     c.count ?? 0,
        risks:        r.count ?? 0,
        underwriting: dealStatus === "review" || dealStatus === "completed" ? 1 : 0,
      });
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(interval); };
  }, [dealId, dealStatus]);

  const steps: { key: keyof typeof counts; label: string; target: number; eta: number }[] = [
    { key: "metadata",     label: "Metadata agent (name, address, units)",           target: 5, eta: 10 },
    { key: "financial",    label: "Financial agent (T-12, revenue, expenses)",       target: 1, eta: 20 },
    { key: "unitMix",      label: "Unit mix agent (unit types, vacancy, rents)",     target: 1, eta: 12 },
    { key: "questions",    label: "Questions agent (due-diligence questions)",       target: 1, eta: 10 },
    { key: "criteria",     label: "Criteria agent (buy-box checklist)",              target: 1, eta: 10 },
    { key: "risks",        label: "Risks agent (red flags, market risks)",           target: 1, eta: 15 },
    { key: "underwriting", label: "Underwriting (NOI, cap rate, DSCR, recommend)",   target: 1, eta: 15 },
  ];

  const totalEta = steps.reduce((s, x) => s + x.eta, 0);
  const remainingEta = steps
    .filter(s => counts[s.key] < s.target)
    .reduce((sum, x) => sum + x.eta, 0);

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
        <span>⏱ Total est. ~{totalEta}s</span>
        {remainingEta > 0 && remainingEta < totalEta && (
          <>
            <span>·</span>
            <span className="text-primary">~{remainingEta}s remaining</span>
          </>
        )}
      </div>
      {steps.map(s => {
        const done = counts[s.key] >= s.target;
        const running = !done && steps.slice(0, steps.findIndex(x => x.key === s.key)).every(p => counts[p.key] >= p.target);
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span className={done ? "text-emerald-400" : running ? "text-primary" : "text-slate-600"}>
              {done ? "✓" : running ? "→" : "·"}
            </span>
            <span className={done ? "text-emerald-400" : running ? "text-primary animate-pulse" : "text-slate-500"}>
              {s.label}
            </span>
            <span className="text-[10px] text-slate-500 ml-auto">
              {done
                ? counts[s.key] > 1 ? `${counts[s.key]} rows` : "✓"
                : running ? `est. ~${s.eta}s` : `${s.eta}s`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Match Panel — comparable deals ───────────────────────────────────────────
function MatchPanel({ deal, allDeals }: { deal: DBDeal; allDeals: DBDeal[] }) {
  const fmt = (n: number | null | undefined) => (n && n > 0) ? (n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : `$${(n/1e3).toFixed(0)}K`) : "—";

  const score = (d: DBDeal): number => {
    let s = 0;
    if (d.id === deal.id) return -1;
    if (d.asset_type && d.asset_type === deal.asset_type) s += 40;
    if (d.state && d.state === deal.state) s += 20;
    if (d.city && d.city === deal.city) s += 15;
    if (d.units && deal.units) {
      const ratio = Math.min(d.units, deal.units) / Math.max(d.units, deal.units);
      s += Math.round(ratio * 15);
    }
    if (d.year_built && deal.year_built) {
      const diff = Math.abs(d.year_built - deal.year_built);
      if (diff <= 5) s += 10;
      else if (diff <= 15) s += 5;
    }
    return s;
  };

  const comps = allDeals
    .map(d => ({ deal: d, score: score(d) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (!comps.length) return (
    <div className="text-center py-12 text-muted-foreground text-sm border-2 border-dashed border-border rounded-xl">
      <Building2 className="h-8 w-8 mx-auto mb-2 text-slate-200" />
      No comparable deals found in your pipeline yet.
    </div>
  );

  const MATCH_FIELDS = [
    { label: "Asset Type",     get: (d: DBDeal) => d.asset_type || "—"                               },
    { label: "Location",       get: (d: DBDeal) => d.city && d.state ? `${d.city}, ${d.state}` : "—" },
    { label: "Units",          get: (d: DBDeal) => d.units ? String(d.units) : "—"                   },
    { label: "Year Built",     get: (d: DBDeal) => d.year_built ? String(d.year_built) : "—"          },
    { label: "Guidance Price", get: (d: DBDeal) => fmt(d.guidance_price)                              },
    { label: "NOI",            get: (d: DBDeal) => fmt(d.noi)                                         },
    { label: "Cap Rate",       get: (d: DBDeal) => d.cap_rate ? `${d.cap_rate}%` : "—"               },
  ];

  const dealVals = MATCH_FIELDS.map(f => f.get(deal));

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-border">
              <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest w-36">Field</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black text-primary uppercase tracking-widest w-48 bg-[#FFF6ED]">
                {deal.name} <span className="text-[9px] font-normal text-muted-foreground">(This Deal)</span>
              </th>
              {comps.map(({ deal: d, score: s }) => (
                <th key={d.id} className="px-4 py-2.5 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                  <div>{d.name}</div>
                  <div className="text-[9px] font-medium text-emerald-600 normal-case mt-0.5">{s}% match</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {MATCH_FIELDS.map((field, fi) => (
              <tr key={field.label} className="hover:bg-slate-50/50">
                <td className="px-4 py-2.5 text-xs font-bold text-muted-foreground uppercase tracking-widest">{field.label}</td>
                <td className="px-4 py-2.5 text-sm font-semibold text-foreground bg-[#FFF6ED]/50">{dealVals[fi]}</td>
                {comps.map(({ deal: d }) => {
                  const val = field.get(d);
                  const matches = val === dealVals[fi] && val !== "—";
                  return (
                    <td key={d.id} className={`px-4 py-2.5 text-sm ${matches ? "text-emerald-600 font-semibold" : "text-slate-600"}`}>
                      {val}
                      {matches && <span className="ml-1 text-[9px]">✓</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Agent results viewer — shows the JSON output of each agent ───────────────
function AgentResultsViewer({ results }: { results: Record<string, unknown> }) {
  const [open, setOpen] = useState(true);
  const [activeAgent, setActiveAgent] = useState<string>(Object.keys(results)[0] || "");

  // Keep activeAgent valid as new agents emit
  useEffect(() => {
    if (!results[activeAgent]) {
      const keys = Object.keys(results);
      if (keys.length) setActiveAgent(keys[keys.length - 1]);
    }
  }, [results, activeAgent]);

  const agents = Object.keys(results);
  if (!agents.length) return null;

  const active = results[activeAgent];
  const jsonText = typeof active === "string" ? active : JSON.stringify(active, null, 2);

  return (
    <div className="border-b border-border bg-slate-50">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-2 hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-black uppercase tracking-widest text-foreground">
            Agent Output ({agents.length})
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground font-medium">
          {open ? "▾ hide" : "▸ show"}
        </span>
      </button>

      {open && (
        <div className="px-6 pb-3">
          {/* Tab strip for each agent */}
          <div className="flex items-center gap-1 mb-2 overflow-x-auto">
            {agents.map(a => (
              <button
                key={a}
                onClick={() => setActiveAgent(a)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap transition-colors
                  ${activeAgent === a
                    ? "bg-primary text-white"
                    : "bg-white text-muted-foreground border border-border hover:bg-slate-100"}`}
              >
                {a}
              </button>
            ))}
            <button
              onClick={() => navigator.clipboard.writeText(jsonText)}
              className="ml-auto px-2.5 py-1 rounded-md text-[10px] font-bold text-muted-foreground border border-border hover:bg-slate-100 transition-colors"
              title="Copy JSON"
            >
              ⧉ Copy
            </button>
          </div>

          {/* JSON pretty-print */}
          <pre className="bg-slate-900 text-slate-100 text-[11px] font-mono p-3 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap break-words">
            {jsonText}
          </pre>
        </div>
      )}
    </div>
  );
}
