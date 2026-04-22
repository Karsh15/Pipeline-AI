"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search, Filter, FolderOpen, Plus, Download, Map as MapIcon, Table2,
  MessageSquare, ChevronDown, ChevronRight, MoreHorizontal, Zap, AlertCircle,
  CheckCircle2, MapPin, Send, X,
} from "lucide-react";
import { supabase, type DBDeal } from "@/lib/supabase";
import { fetchDeals, createDeal, triggerExtraction, triggerUnderwriting } from "@/lib/pipeline";
import { mockDeals, formatCurrency, type Deal, type DealStatus } from "@/lib/mockData";
import DealWorkspace from "@/components/DealWorkspace";
import AgentRunner from "@/components/AgentRunner";
import OutlookInbox from "@/components/OutlookInbox";

const MapComponent = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-slate-100 animate-pulse" />,
});

// ── Supabase hook ─────────────────────────────────────────────────────────────
function useSupabaseDeals() {
  const [deals, setDeals]     = useState<DBDeal[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setDeals(await fetchDeals()); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url || url.includes("your-project")) return;
    const ch = supabase.channel("deals-home")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, (p) => {
        if (p.eventType === "INSERT")
          setDeals(prev => [p.new as DBDeal, ...prev]);
        else if (p.eventType === "UPDATE")
          setDeals(prev => prev.map(d => d.id === (p.new as DBDeal).id ? (p.new as DBDeal) : d));
        else if (p.eventType === "DELETE")
          setDeals(prev => prev.filter(d => d.id !== (p.old as { id: string }).id));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return { deals, loading, reload: load };
}

// ── File/folder helpers (drag-drop + directory walk) ─────────────────────────
const ACCEPTED_EXTS = [".pdf", ".xlsx", ".xls", ".csv", ".docx"];

function filterAccepted(files: File[]): File[] {
  return files.filter(f => {
    const lower = f.name.toLowerCase();
    return ACCEPTED_EXTS.some(ext => lower.endsWith(ext));
  });
}

// Minimal typing for the File System Entry API (still not in TS lib by default).
interface FSEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void, onErr?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (entries: FSEntry[]) => void, onErr?: (e: unknown) => void) => void };
}

/** Recursively walk a File System Entry, collecting all Files. */
async function walkEntry(entry: FSEntry, out: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    await new Promise<void>((resolve) => {
      entry.file!(f => { out.push(f); resolve(); }, () => resolve());
    });
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // readEntries only returns a chunk at a time — keep calling until empty
    const readChunk = (): Promise<FSEntry[]> =>
      new Promise((res) => reader.readEntries(e => res(e), () => res([])));
    while (true) {
      const chunk = await readChunk();
      if (!chunk.length) break;
      for (const e of chunk) await walkEntry(e, out);
    }
  }
}

// ── Convert DBDeal → legacy Deal (for Map + Workspace) ────────────────────────
function dbToLegacy(d: DBDeal): Deal {
  const statusMap: Record<string, DealStatus> = {
    lead: "Tracking", ingestion: "Tracking", extraction: "Underwriting",
    underwriting: "Underwriting", review: "LOI", completed: "Tracking",
  };
  return {
    id: d.id, name: d.name, status: statusMap[d.status] || "Tracking",
    address: d.address || "", city: d.city || "", state: d.state || "",
    lat: d.lat || 39.5, lng: d.lng || -98.4,
    assetType: d.asset_type || "Multifamily", propertyType: d.property_type || "",
    broker: d.broker || "", brand: d.brand || "", dealLead: d.deal_lead || "",
    units: d.units || 0, guidancePrice: d.guidance_price || 0,
    yearBuilt: d.year_built || 0, noi: d.noi || 0, capRate: Number(d.cap_rate) || 0,
    addedAt: d.created_at, amenities: [], files: [], notes: [], financials: [],
    criteria: [], questions: [], risks: [], brokerNarrative: d.broker_narrative || "",
    locationInsight: d.location_insight || "",
    agents: { metadata: "pending", summary: "pending", questions: "pending",
              criteria: "pending", financial: "pending", risks: "pending" },
  };
}

// ── Status badge color map ────────────────────────────────────────────────────
const STATUS_COLOR: Record<DealStatus, { bg: string; text: string; dot: string }> = {
  Tracking:      { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500" },
  Underwriting:  { bg: "bg-blue-100",    text: "text-blue-700",    dot: "bg-blue-500" },
  LOI:           { bg: "bg-amber-100",   text: "text-amber-700",   dot: "bg-amber-500" },
  Dead:          { bg: "bg-slate-100",   text: "text-slate-600",   dot: "bg-slate-400" },
};

const STATUS_GROUPS: DealStatus[] = ["Tracking", "Underwriting", "LOI", "Dead"];

// ══════════════════════════════════════════════════════════════════════════════
export default function Home() {
  const { deals: dbDeals } = useSupabaseDeals();
  const supabaseConfigured = !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("your-project");

  // Combined deal list — Supabase + mock fallback
  const allDeals: Deal[] = useMemo(() => {
    const live = dbDeals.map(dbToLegacy);
    return supabaseConfigured && live.length ? live : [...live, ...mockDeals];
  }, [dbDeals, supabaseConfigured]);

  const [tab, setTab]                         = useState<"deals" | "chats">("deals");
  const [view, setView]                       = useState<"map" | "table" | "chat">("map");
  const [globalChatMsgs, setGlobalChatMsgs]   = useState<{role:"user"|"ai"; content:string}[]>([]);
  const [globalChatInput, setGlobalChatInput] = useState("");
  const [globalChatTyping, setGlobalChatTyping] = useState(false);
  const [search, setSearch]                   = useState("");
  const [selectedId, setSelectedId]           = useState<string | null>(null);
  const [selectedDbDeal, setSelectedDbDeal]   = useState<DBDeal | null>(null);
  const [openGroups, setOpenGroups]           = useState<Record<DealStatus, boolean>>({
    Tracking: true, Underwriting: true, LOI: true, Dead: true,
  });
  const [showImport, setShowImport]           = useState(false);
  const [showFullPipeline, setShowFullPipeline] = useState(false);
  const [showAgentRunner, setShowAgentRunner] = useState(false);
  const [agentFile, setAgentFile]             = useState<File | null>(null);
  const [chatInput, setChatInput]             = useState("");
  const [creatingDeal, setCreatingDeal]       = useState(false);
  const [outlookToast, setOutlookToast]       = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const outlookToastTimer                     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Group by status for sidebar
  const filtered = allDeals.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.city.toLowerCase().includes(search.toLowerCase())
  );
  const grouped = STATUS_GROUPS.reduce((acc, s) => {
    acc[s] = filtered.filter(d => d.status === s);
    return acc;
  }, {} as Record<DealStatus, Deal[]>);
  const noStatus = filtered.filter(d => !STATUS_GROUPS.includes(d.status));

  const selectDeal = (id: string) => {
    setSelectedId(id);
    const dbDeal = dbDeals.find(d => d.id === id);
    if (dbDeal) setSelectedDbDeal(dbDeal);
    else setSelectedDbDeal(null);
  };

  const onImportFiles = async (files: File[]) => {
    if (!files.length) return;
    if (!supabaseConfigured) {
      setAgentFile(files[0]);
      setShowAgentRunner(true);
      setShowImport(false);
      return;
    }
    setCreatingDeal(true);

    // Deal name: use folder name if uploaded via directory picker, else first file name
    // webkitRelativePath is "folderName/sub/file.pdf" when available
    const firstWithPath = files.find(f => {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
      return rel && rel.includes("/");
    });
    const dealName = firstWithPath
      ? (firstWithPath as File & { webkitRelativePath: string }).webkitRelativePath.split("/")[0]
      : files[0].name.replace(/\.[^.]+$/, "");

    const deal = await createDeal(dealName);
    if (deal) {
      // Upload in batches of 4 to avoid overwhelming the server / storage
      const BATCH_SIZE = 4;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async f => {
          try {
            const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
            const form = new FormData();
            form.append("file", f);
            form.append("dealId", deal.id);
            form.append("relativePath", rel);
            const res = await fetch("/api/process-documents", { method: "POST", body: form });
            if (!res.ok) console.error(`Upload failed for ${rel}:`, await res.text());
          } catch (err) {
            console.error(`Upload error for ${f.name}:`, err);
          }
        }));
      }

      // Kick off extraction once — it will read all uploaded docs
      const stream = await triggerExtraction(deal.id);
      const reader = stream.getReader();
      const dec = new TextDecoder();
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const line of dec.decode(value).split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                const evt = JSON.parse(line.slice(6)) as { type: string; stage?: string };
                if (evt.type === "complete" && evt.stage === "underwriting")
                  await triggerUnderwriting(deal.id);
              } catch {}
            }
          }
        } catch (err) {
          console.error("Extraction stream error:", err);
        }
      })();
      setSelectedDbDeal(deal);
      setSelectedId(deal.id);
    }
    setCreatingDeal(false);
    setShowImport(false);
  };

  // Handle OAuth callback toast (?outlook=connected | error)
  // Must run after hydration — useEffect guarantees client-only execution.
  // We use the native History API directly (not Next.js router) to strip the
  // query params so we don't trigger "Router action before initialization".
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ot = params.get("outlook");
    if (!ot) return;
    const email  = params.get("email");
    const reason = params.get("reason");
    if (ot === "connected") {
      setOutlookToast({ type: "success", msg: `Outlook connected${email ? ` · ${email}` : ""}` });
    } else if (ot === "error") {
      setOutlookToast({ type: "error", msg: `Outlook error: ${reason ?? "unknown"}` });
    }
    // Strip ?outlook=... from the URL bar without any navigation
    const url = new URL(window.location.href);
    url.searchParams.delete("outlook");
    url.searchParams.delete("email");
    url.searchParams.delete("reason");
    // replaceState with { shallow: true } equivalent — no Next.js router involved
    history.replaceState(history.state, "", url.pathname + (url.search || ""));
    if (outlookToastTimer.current) clearTimeout(outlookToastTimer.current);
    outlookToastTimer.current = setTimeout(() => setOutlookToast(null), 6000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleGroup = (s: DealStatus) => setOpenGroups(p => ({ ...p, [s]: !p[s] }));

  const exportCSV = () => {
    const rows = [
      ["Property Name","Status","Asset Type","Property Type","Broker","Total Units",
       "Guidance","Year Built","Interest Type","Brand","Address","Amenities",
       "Brand Parent Company","SF","Deal Lead","Sale Price","City","State","Cap Rate","NOI"],
      ...filtered.map(d => [d.name, d.status, d.assetType, d.propertyType, d.broker,
        d.units, d.guidancePrice, d.yearBuilt, d.interestType || "", d.brand,
        d.address, (d.amenities || []).join("; "), d.brandParentCompany || "",
        d.sf || "", d.dealLead, d.salePrice || "", d.city, d.state, d.capRate, d.noi]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "pipeline-deals.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedDeal = filtered.find(d => d.id === selectedId) || null;

  const sendGlobalChat = async (msg?: string) => {
    const text = msg ?? globalChatInput;
    if (!text.trim() || globalChatTyping) return;
    setGlobalChatInput("");
    setGlobalChatMsgs(p => [...p, { role: "user", content: text }]);
    setGlobalChatTyping(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: null, message: text, history: globalChatMsgs.slice(-6) }),
      });
      const data = await res.json() as { reply: string };
      setGlobalChatMsgs(p => [...p, { role: "ai", content: data.reply }]);
    } catch {
      setGlobalChatMsgs(p => [...p, { role: "ai", content: "Error — please try again." }]);
    }
    setGlobalChatTyping(false);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans bg-white">

      {/* ═══ LEFT SIDEBAR ═══ */}
      <aside className="w-[320px] flex-shrink-0 flex flex-col border-r border-border bg-white">

        {/* Logo + tabs */}
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-white font-black text-sm">
                <Zap className="h-4 w-4" />
              </div>
              <span className="font-heading font-black text-base">Pipeline AI</span>
            </div>
            <div className="flex rounded-lg bg-secondary p-0.5 text-xs font-bold">
              <button onClick={() => setTab("deals")}
                className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1.5
                  ${tab === "deals" ? "bg-primary text-white shadow-sm" : "text-muted-foreground"}`}>
                Deals <span className={`${tab === "deals" ? "text-white/80" : "text-muted-foreground"} text-[10px]`}>{filtered.length}</span>
              </button>
              <button onClick={() => setTab("chats")}
                className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1.5
                  ${tab === "chats" ? "bg-primary text-white shadow-sm" : "text-muted-foreground"}`}>
                Chats <span className="text-[10px]">5</span>
              </button>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search deals by name..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-white transition-all" />
          </div>
        </div>

        {/* Filter / Full Pipeline / Import */}
        <div className="px-4 pb-3 flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-secondary transition-colors">
            <Filter className="h-3 w-3" /> 0
          </button>
          <a href="/pipeline"
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-secondary transition-colors">
            <FolderOpen className="h-3 w-3" /> Full Pipeline
          </a>
          <button onClick={() => setShowImport(true)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-colors">
            <Plus className="h-3 w-3" /> Import Deals
          </button>
        </div>

        {/* Status groups */}
        <div className="flex-1 overflow-y-auto">
          {STATUS_GROUPS.map(status => {
            const deals = grouped[status];
            const open  = openGroups[status];
            const col   = STATUS_COLOR[status];
            return (
              <div key={status} className="border-b border-border">
                <button onClick={() => toggleGroup(status)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2">
                    {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${col.bg} ${col.text}`}>
                      {status}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="font-bold">{deals.length}</span>
                    <MoreHorizontal className="h-3 w-3" />
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {open && deals.map(d => (
                    <motion.button key={d.id}
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      onClick={() => selectDeal(d.id)}
                      className={`w-full text-left px-4 py-2.5 border-t border-border/50 transition-colors
                        ${selectedId === d.id ? "bg-[#FFF6ED]" : "hover:bg-slate-50"}`}>
                      <div className="text-sm font-semibold text-foreground truncate">{d.name}</div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <MapPin className="h-2.5 w-2.5" /> {d.city}, {d.state}
                      </div>
                    </motion.button>
                  ))}
                </AnimatePresence>
              </div>
            );
          })}

          {/* No status group */}
          <div className="border-b border-border">
            <button className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                  No Status
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground font-bold">{noStatus.length}</span>
            </button>
          </div>
        </div>

        {/* Outlook integration panel */}
        <div className="px-3 py-3 border-t border-border">
          <OutlookInbox onDealCreated={(id) => {
            const dbDeal = dbDeals.find(d => d.id === id);
            if (dbDeal) { setSelectedDbDeal(dbDeal); setSelectedId(id); }
          }} />
        </div>

        {/* User footer */}
        <div className="px-4 py-3 border-t border-border flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-bold">
            N
          </div>
          <span className="text-sm font-medium text-foreground">Jessica Moore</span>
          <button className="ml-auto p-1 hover:bg-secondary rounded">
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </aside>

      {/* ═══ MAIN AREA ═══ */}
      <main className="flex-1 flex flex-col overflow-hidden relative">

        {/* Outlook OAuth toast */}
        <AnimatePresence>
          {outlookToast && (
            <motion.div
              initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className={`absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-xl text-sm font-bold flex items-center gap-2
                ${outlookToast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
              {outlookToast.type === "success"
                ? <CheckCircle2 className="h-4 w-4" />
                : <AlertCircle className="h-4 w-4" />}
              {outlookToast.msg}
              <button onClick={() => setOutlookToast(null)} className="ml-2 opacity-70 hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-white z-10">
          <div className="flex items-center gap-1 bg-secondary rounded-xl p-1">
            <button onClick={() => setView("map")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all
                ${view === "map" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <MapIcon className="h-3.5 w-3.5" /> Map
            </button>
            <button onClick={() => setView("table")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all
                ${view === "table" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <Table2 className="h-3.5 w-3.5" /> Table
            </button>
            <button onClick={() => setView("chat")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all
                ${view === "chat" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <MessageSquare className="h-3.5 w-3.5" /> Chat
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowAgentRunner(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-primary/30 bg-[#FFF6ED] text-primary rounded-lg text-xs font-bold hover:bg-primary/10 transition-colors">
              <Zap className="h-3.5 w-3.5" /> Demo Agents
            </button>
            <button onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-bold hover:bg-secondary transition-colors">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </div>
        </div>

        {/* Supabase status banner */}
        {!supabaseConfigured && (
          <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-[11px] text-amber-700 font-medium">
              Demo Mode — add Supabase keys to <code className="px-1 bg-amber-100 rounded">.env.local</code> to enable the AI pipeline.
            </span>
          </div>
        )}

        {/* Workspace or Map/Table */}
        <div className="flex-1 relative overflow-hidden">
          <AnimatePresence mode="wait">
            {selectedDbDeal ? (
              <motion.div key="workspace" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-white z-20 overflow-y-auto">
                <DealWorkspace deal={selectedDbDeal}
                  onClose={() => { setSelectedDbDeal(null); setSelectedId(null); }}
                  onUpdate={(d) => setSelectedDbDeal(d)} />
              </motion.div>
            ) : view === "map" ? (
              <motion.div key="map" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0">
                <MapComponent selectedDealId={selectedId} deals={filtered} />
              </motion.div>
            ) : view === "table" ? (
              <motion.div key="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 p-6 overflow-auto">
                <TableView deals={filtered} onSelect={selectDeal} />
              </motion.div>
            ) : (
              <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col bg-white">
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {!globalChatMsgs.length && (
                    <div className="max-w-xl mx-auto text-center pt-16">
                      <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <MessageSquare className="h-7 w-7 text-primary" />
                      </div>
                      <h2 className="text-lg font-heading font-black text-foreground mb-1">Pipeline AI Chat</h2>
                      <p className="text-sm text-muted-foreground mb-6">Ask anything across all your deals in the pipeline.</p>
                      <div className="flex flex-wrap gap-2 justify-center">
                        {[
                          "Which deals have the best cap rate?",
                          "Show me all hotel assets in LOI",
                          "What's the total pipeline value?",
                          "Which deals are at risk?",
                        ].map(q => (
                          <button key={q} onClick={() => sendGlobalChat(q)}
                            className="text-xs px-3 py-2 bg-[#FFF6ED] text-primary border border-orange-100 rounded-xl hover:bg-orange-100 transition-colors font-medium">
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {globalChatMsgs.map((m, i) => (
                    <div key={i} className={`flex gap-3 max-w-3xl ${m.role === "user" ? "ml-auto justify-end" : ""}`}>
                      {m.role === "ai" && (
                        <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                          <MessageSquare className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed max-w-[80%]
                        ${m.role === "user" ? "bg-primary text-white rounded-br-sm" : "bg-slate-100 text-slate-800 rounded-bl-sm"}`}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {globalChatTyping && (
                    <div className="flex gap-3 max-w-3xl">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                        <MessageSquare className="h-4 w-4 text-primary" />
                      </div>
                      <div className="bg-slate-100 rounded-2xl px-4 py-3 flex gap-1 items-center">
                        {[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />)}
                      </div>
                    </div>
                  )}
                </div>
                {/* Input */}
                <div className="p-4 border-t border-border bg-white">
                  <form onSubmit={e => { e.preventDefault(); sendGlobalChat(); }}
                    className="max-w-3xl mx-auto flex gap-2">
                    <input value={globalChatInput} onChange={e => setGlobalChatInput(e.target.value)}
                      placeholder="Ask anything about your pipeline…"
                      className="flex-1 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white" />
                    <button type="submit" disabled={globalChatTyping || !globalChatInput.trim()}
                      className="px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5 text-sm font-bold">
                      <Send className="h-4 w-4" /> Send
                    </button>
                  </form>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat input (only in map/table view, not in dedicated chat view) */}
          {!selectedDbDeal && view !== "chat" && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-6">
              <div className="flex items-center gap-2 bg-white border border-border shadow-xl rounded-full px-4 py-2.5">
                <MessageSquare className="h-4 w-4 text-primary flex-shrink-0" />
                <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                  placeholder="Ask me anything about your deals..."
                  className="flex-1 text-sm bg-transparent focus:outline-none" />
                <button className="p-1.5 bg-primary text-white rounded-full hover:bg-primary/90 transition-colors">
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ═══ IMPORT MODAL ═══ */}
      <AnimatePresence>
        {showImport && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => !creatingDeal && setShowImport(false)}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
              <h2 className="text-lg font-heading font-black mb-1">Import Deal</h2>
              <p className="text-sm text-muted-foreground mb-5">
                Upload a file, multiple files, or a whole folder. AI extracts everything automatically.
              </p>

              {/* Drop zone (accepts files AND folders via DataTransferItem) */}
              <div
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={async e => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (creatingDeal) return;
                  const items = e.dataTransfer.items;
                  const all: File[] = [];
                  if (items && items.length) {
                    // Folder-aware drop: walk directory entries recursively
                    await Promise.all(Array.from(items).map(async it => {
                      const entry = it.webkitGetAsEntry?.();
                      if (entry) await walkEntry(entry as unknown as FSEntry, all);
                      else { const f = it.getAsFile?.(); if (f) all.push(f); }
                    }));
                  }
                  if (!all.length) {
                    // Fallback: plain files
                    all.push(...Array.from(e.dataTransfer.files));
                  }
                  const accepted = filterAccepted(all);
                  if (accepted.length) onImportFiles(accepted);
                }}
                className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 hover:bg-[#FFF6ED]/30 transition-all"
              >
                <FolderOpen className="h-10 w-10 text-primary mx-auto mb-3" />
                <p className="text-sm font-bold text-foreground mb-3">
                  {creatingDeal ? "Uploading & extracting..." : "Drop files or folder here"}
                </p>
                <div className="flex gap-2 justify-center mb-2">
                  <label className="cursor-pointer px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors">
                    Choose Files
                    <input type="file" multiple className="hidden"
                      accept=".pdf,.xlsx,.xls,.csv,.docx"
                      disabled={creatingDeal}
                      onChange={e => e.target.files && onImportFiles(filterAccepted(Array.from(e.target.files)))} />
                  </label>
                  <label className="cursor-pointer px-3 py-1.5 border border-primary/40 text-primary rounded-lg text-xs font-bold hover:bg-[#FFF6ED] transition-colors">
                    Choose Folder
                    <input type="file" className="hidden"
                      // @ts-expect-error — non-standard but widely supported in Chromium/WebKit
                      webkitdirectory="" directory="" multiple
                      disabled={creatingDeal}
                      onChange={e => e.target.files && onImportFiles(filterAccepted(Array.from(e.target.files)))} />
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  PDF, XLSX, DOCX, CSV · subfolders are scanned recursively
                </p>
              </div>

              <button onClick={() => setShowImport(false)} disabled={creatingDeal}
                className="mt-4 w-full py-2 border border-border rounded-lg text-sm font-medium hover:bg-secondary transition-colors disabled:opacity-50">
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ FULL PIPELINE MODAL ═══ */}
      <AnimatePresence>
        {showFullPipeline && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => setShowFullPipeline(false)}>
            <motion.div initial={{ scale: 0.96, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 16 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl flex flex-col overflow-hidden"
              style={{ maxHeight: "90vh" }}>

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-[#FFF6ED] flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center">
                    <FolderOpen className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-heading font-black text-foreground leading-tight">Full Pipeline</h2>
                    <p className="text-xs text-muted-foreground">{allDeals.length} properties across all stages</p>
                  </div>
                </div>
                <button onClick={() => setShowFullPipeline(false)}
                  className="p-2 hover:bg-white rounded-lg transition-colors">
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>

              {/* Table */}
              <div className="overflow-auto flex-1">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 border-b border-border z-10">
                    <tr>
                      {["Property", "Status", "Location", "Asset Type", "Units", "Year Built",
                        "Broker", "Brand", "Guidance Price", "NOI", "Cap Rate", "Deal Lead"].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] font-black text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {allDeals.map((d, i) => {
                      const fmtMoney = (n: number) => n > 0 ? (n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : `$${(n/1e3).toFixed(0)}K`) : "—";
                      const statusColors: Record<string, string> = {
                        Tracking:     "bg-blue-50 text-blue-700",
                        Underwriting: "bg-purple-50 text-purple-700",
                        LOI:          "bg-amber-50 text-amber-700",
                        Dead:         "bg-red-50 text-red-600",
                        lead:         "bg-slate-100 text-slate-600",
                        ingestion:    "bg-sky-50 text-sky-700",
                        extraction:   "bg-indigo-50 text-indigo-700",
                        underwriting: "bg-violet-50 text-violet-700",
                        review:       "bg-emerald-50 text-emerald-700",
                        completed:    "bg-green-50 text-green-700",
                      };
                      return (
                        <motion.tr key={d.id}
                          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                          className="hover:bg-[#FFF6ED] cursor-pointer transition-colors"
                          onClick={() => { selectDeal(d.id); setShowFullPipeline(false); }}>
                          <td className="px-4 py-3 font-semibold text-foreground max-w-[220px]">
                            <div className="truncate">{d.name}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${statusColors[d.status] ?? "bg-slate-100 text-slate-600"}`}>
                              {d.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{d.city || "—"}, {d.state || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{d.assetType || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{d.units > 0 ? d.units : "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{d.yearBuilt > 0 ? d.yearBuilt : "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground max-w-[120px]"><div className="truncate">{d.broker || "—"}</div></td>
                          <td className="px-4 py-3 text-muted-foreground">{d.brand || "—"}</td>
                          <td className="px-4 py-3 font-semibold text-foreground">{fmtMoney(d.guidancePrice)}</td>
                          <td className="px-4 py-3 font-semibold text-emerald-600">{fmtMoney(d.noi)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{d.capRate > 0 ? `${d.capRate}%` : "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{d.dealLead || "—"}</td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-slate-50 flex-shrink-0">
                <span className="text-xs text-muted-foreground">{allDeals.length} deals total</span>
                <button onClick={() => setShowFullPipeline(false)}
                  className="px-4 py-2 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors">
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ AGENT RUNNER (demo mode) ═══ */}
      <AnimatePresence>
        {showAgentRunner && (
          <AgentRunner
            dealName={selectedDeal?.name || "Demo Deal"}
            file={agentFile}
            onClose={() => { setShowAgentRunner(false); setAgentFile(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Table view ───────────────────────────────────────────────────────────────
function TableView({ deals, onSelect }: { deals: Deal[]; onSelect: (id: string) => void }) {
  const cols: { label: string; cls?: string }[] = [
    { label: "Property Name" }, { label: "Status" }, { label: "Asset Type" },
    { label: "Property Type" }, { label: "Broker" }, { label: "Total Units" },
    { label: "Guidance" }, { label: "Year Built" }, { label: "Interest Type" },
    { label: "Brand" }, { label: "Address" }, { label: "Amenities" },
    { label: "Brand Parent Company" }, { label: "SF" }, { label: "Deal Lead" },
    { label: "Sale Price" },
  ];
  const dash = <span className="text-slate-300">—</span>;
  return (
    <div className="bg-white border border-border rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-max min-w-full">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              {cols.map(c => (
                <th key={c.label}
                  className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b border-border whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {deals.map(d => {
              const col = STATUS_COLOR[d.status];
              return (
                <tr key={d.id} onClick={() => onSelect(d.id)}
                  className="hover:bg-[#FFF6ED] cursor-pointer transition-colors">
                  <td className="px-4 py-3 text-sm font-semibold text-foreground whitespace-nowrap">{d.name}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${col.bg} ${col.text}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{d.assetType || dash}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{d.propertyType || dash}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{d.broker || dash}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right">{d.units || dash}</td>
                  <td className="px-4 py-3 text-sm font-bold text-foreground whitespace-nowrap">
                    {d.guidancePrice ? formatCurrency(d.guidancePrice) : dash}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right">{d.yearBuilt || dash}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{d.interestType || dash}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{d.brand || dash}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 max-w-[220px] truncate" title={d.address}>
                    {d.address || dash}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 max-w-[180px] truncate"
                      title={d.amenities?.join(", ")}>
                    {d.amenities?.length ? d.amenities.join(", ") : dash}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{d.brandParentCompany || dash}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right whitespace-nowrap">
                    {d.sf ? d.sf.toLocaleString() : dash}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{d.dealLead || dash}</td>
                  <td className="px-4 py-3 text-sm font-bold text-foreground whitespace-nowrap">
                    {d.salePrice ? formatCurrency(d.salePrice) : dash}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!deals.length && (
        <div className="p-12 text-center text-sm text-muted-foreground">No deals match your search.</div>
      )}
    </div>
  );
}
