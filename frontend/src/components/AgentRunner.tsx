

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Info, FileText, HelpCircle, ClipboardList, BarChart3, ShieldAlert,
  CheckCircle2, Loader2, X, Zap, ChevronRight, AlertCircle, Terminal,
  Activity, Clock3,
} from "lucide-react";

interface AgentDef {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
}

const AGENTS: AgentDef[] = [
  { key: "metadata",  label: "Metadata Extraction",   description: "Property identifiers & attributes", icon: Info,          color: "blue"    },
  { key: "financial", label: "Financial Analysis",     description: "T12 revenue, NOI & EBITDA",        icon: BarChart3,     color: "indigo"  },
  { key: "summary",   label: "Investment Summary",     description: "Executive narrative synthesis",    icon: FileText,      color: "amber"   },
  { key: "questions", label: "DD Questions",           description: "Due-diligence question set",       icon: HelpCircle,    color: "violet"  },
  { key: "criteria",  label: "Investment Criteria",    description: "Mandate fit scoring",              icon: ClipboardList, color: "emerald" },
  { key: "risks",     label: "Risk Detection",         description: "Anomaly & exposure scoring",       icon: ShieldAlert,   color: "red"     },
];

const DEMO_LOGS: Record<string, { logs: string[]; duration: number }> = {
  metadata:  { duration: 2200, logs: ["Parsing PDF binary stream...","Extracting document metadata...","Found property name: Sunrise Hotel Plaza","Year built detected: 2012","Units parsed: 350 keys","Brand: Marriott Autograph Collection","Address extracted: 123 Sunrise Way, Miami, FL","✓ Metadata extraction complete"] },
  financial: { duration: 2800, logs: ["Opening Excel workbook (T12_Financials.xlsx)...","Parsing 3 worksheets...","Reading Revenue columns (2021–2024)...","Total Revenue TTM: $5,938,774","GOP computed: $1,972,672 (33.2%)","NOI TTM: $1,312,557","EBITDA: $1,550,108","✓ Financial model complete"] },
  summary:   { duration: 3200, logs: ["Sending context to Claude...","Generating executive summary...","Analyzing broker narrative...","Synthesizing location insights...","Value-add upside estimated: 18-24% NOI lift","✓ Investment summary generated"] },
  questions: { duration: 2000, logs: ["Scanning for financial anomalies...","40% revenue spike flagged","Generating question set...","Q1: Revenue spike driver?","Q2: Management contract terms?","Q3: RevPAR vs comp set?","✓ 4 questions generated"] },
  criteria:  { duration: 1600, logs: ["Loading investment criteria rules...","Checking NOI Margin: 22.1% ≥ 22% → PASS","Checking Year Built: 2012 > 2005 → PASS","Checking Cap Rate: 6.2% → PASS","Verdict: 5/5 criteria met","✓ Deal qualifies for investment"] },
  risks:     { duration: 2400, logs: ["Running anomaly detection...","⚠ Expense ratio 66.8% — above submarket median","⚠ Tax reassessment risk post-acquisition","Scoring risk severity...","Overall risk score: MEDIUM","✓ Risk analysis complete"] },
};

const colorMap: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  blue:    { bg: "bg-blue-50",    text: "text-blue-600",    border: "border-blue-100",   dot: "bg-blue-500"    },
  indigo:  { bg: "bg-indigo-50",  text: "text-indigo-600",  border: "border-indigo-100", dot: "bg-indigo-500"  },
  amber:   { bg: "bg-amber-50",   text: "text-amber-600",   border: "border-amber-100",  dot: "bg-amber-500"   },
  violet:  { bg: "bg-violet-50",  text: "text-violet-600",  border: "border-violet-100", dot: "bg-violet-500"  },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-100",dot: "bg-emerald-500" },
  red:     { bg: "bg-red-50",     text: "text-red-600",     border: "border-red-100",    dot: "bg-red-500"     },
};

// Terminal tag colors per agent (readable on dark bg)
const terminalColors: Record<string, string> = {
  blue:    "text-blue-400",
  indigo:  "text-indigo-400",
  amber:   "text-amber-400",
  violet:  "text-violet-400",
  emerald: "text-emerald-400",
  red:     "text-red-400",
};

type AgentState = "waiting" | "running" | "done";

export interface ExtractedDealData {
  name?: string; propertyType?: string; assetType?: string;
  address?: string; city?: string; state?: string;
  units?: number; yearBuilt?: number; broker?: string; brand?: string;
  guidancePrice?: number; dealLead?: string;
  noi?: number; capRate?: number;
  financials?: unknown[]; criteria?: unknown[];
  questions?: string[]; risks?: string[];
  brokerNarrative?: string; locationInsight?: string;
  lat?: number; lng?: number;
}

interface AgentRunnerProps {
  dealName: string;
  file?: File | null;
  onClose: (extracted?: ExtractedDealData) => void;
}

function useElapsed(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (running) {
      start.current = Date.now();
      const id = setInterval(() => setElapsed(Math.floor((Date.now() - start.current!) / 1000)), 200);
      return () => clearInterval(id);
    }
  }, [running]);
  return elapsed;
}

export default function AgentRunner({ dealName, file, onClose }: AgentRunnerProps) {
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>(
    Object.fromEntries(AGENTS.map((a) => [a.key, "waiting"]))
  );
  const [progress, setProgress] = useState<Record<string, number>>(
    Object.fromEntries(AGENTS.map((a) => [a.key, 0]))
  );
  const [logs, setLogs] = useState<Record<string, string[]>>(
    Object.fromEntries(AGENTS.map((a) => [a.key, []]))
  );
  const [timestamps, setTimestamps] = useState<string[]>([]);
  const [allDone, setAllDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedDealData | undefined>();
  const [activeAgent, setActiveAgent] = useState<string | null>(null);

  const logsRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const progressTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const totalElapsed = useElapsed(!allDone && !error);

  const completedCount = Object.values(agentStates).filter((s) => s === "done").length;
  const runningCount   = Object.values(agentStates).filter((s) => s === "running").length;
  const globalPct = Math.round((completedCount / AGENTS.length) * 100);

  const appendLog = (agent: string, message: string) => {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setTimestamps((p) => [...p, ts]);
    setLogs((p) => ({ ...p, [agent]: [...(p[agent] ?? []), message] }));
    setActiveAgent(agent);
    setTimeout(() => logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: "smooth" }), 50);
  };

  const startProgressFill = (agentKey: string) => {
    let pct = 0;
    progressTimers.current[agentKey] = setInterval(() => {
      pct = Math.min(pct + 1, 92);
      setProgress((p) => ({ ...p, [agentKey]: pct }));
      if (pct >= 92) clearInterval(progressTimers.current[agentKey]);
    }, 300);
  };

  const finishProgress = (agentKey: string) => {
    clearInterval(progressTimers.current[agentKey]);
    setProgress((p) => ({ ...p, [agentKey]: 100 }));
  };

  // Live API mode
  useEffect(() => {
    if (!file || started.current) return;
    started.current = true;
    const formData = new FormData();
    formData.append("file", file);
    fetch("/api/process-deal", { method: "POST", body: formData })
      .then(async (res) => {
        if (!res.ok || !res.body) throw new Error(`API error ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6)) as { type: string; agent?: string; message?: string; extracted?: ExtractedDealData };
              if (evt.type === "agent_start" && evt.agent) {
                setAgentStates((p) => ({ ...p, [evt.agent!]: "running" }));
                startProgressFill(evt.agent);
              } else if (evt.type === "log" && evt.agent && evt.message) {
                appendLog(evt.agent, evt.message);
              } else if (evt.type === "agent_done" && evt.agent) {
                finishProgress(evt.agent);
                setAgentStates((p) => ({ ...p, [evt.agent!]: "done" }));
              } else if (evt.type === "complete" && evt.extracted) {
                setExtracted(evt.extracted);
                setTimeout(() => setAllDone(true), 300);
              } else if (evt.type === "error" && evt.message) {
                setError(evt.message);
              }
            } catch { /* ignore malformed SSE */ }
          }
        }
      })
      .catch((err) => setError(String(err)));
  }, [file]);

  // Demo simulation mode
  useEffect(() => {
    if (file || started.current) return;
    started.current = true;
    let delay = 600;
    AGENTS.forEach((agent, idx) => {
      const demo = DEMO_LOGS[agent.key];
      setTimeout(() => {
        setAgentStates((p) => ({ ...p, [agent.key]: "running" }));
        demo.logs.forEach((log, li) => {
          setTimeout(() => appendLog(agent.key, log), (demo.duration / demo.logs.length) * li);
        });
        const steps = 60;
        for (let s = 1; s <= steps; s++) {
          setTimeout(() => {
            setProgress((p) => ({ ...p, [agent.key]: Math.round((s / steps) * 100) }));
          }, (demo.duration / steps) * s);
        }
        setTimeout(() => {
          setAgentStates((p) => ({ ...p, [agent.key]: "done" }));
          if (idx === AGENTS.length - 1) setTimeout(() => setAllDone(true), 400);
        }, demo.duration);
      }, delay);
      delay += demo.duration + 150;
    });
  }, [file]);

  // Flat log list for terminal
  const flatLogs: { agent: AgentDef; msg: string; ts: string }[] = [];
  let tsIdx = 0;
  for (const agent of AGENTS) {
    for (const msg of logs[agent.key]) {
      flatLogs.push({ agent, msg, ts: timestamps[tsIdx++] ?? "" });
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
        className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-slate-200"
        style={{ maxHeight: "92vh" }}
      >
        {/* ── Header ── */}
        <div className="px-8 py-5 border-b border-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            {/* Pulse indicator */}
            <div className="relative flex-shrink-0">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${allDone ? "bg-emerald-50" : "bg-primary/10"}`}>
                {allDone
                  ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  : <Activity className={`h-5 w-5 text-primary ${runningCount > 0 ? "animate-pulse" : ""}`} />
                }
              </div>
              {!allDone && runningCount > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-primary animate-ping" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-lg font-heading font-black text-foreground tracking-tight leading-none">
                  Intelligence Pipeline
                </h2>
                {file && (
                  <span className="text-[9px] font-black tracking-widest uppercase bg-primary text-white px-2 py-0.5 rounded-full">
                    LIVE
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <Zap className="h-3 w-3 text-primary" />
                Analyzing <span className="font-semibold text-foreground mx-0.5">{dealName}</span>
              </p>
            </div>
          </div>

          {/* Stats strip */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Clock3 className="h-3.5 w-3.5" />
              <span className="tabular-nums font-mono">
                {String(Math.floor(totalElapsed / 60)).padStart(2, "0")}:{String(totalElapsed % 60).padStart(2, "0")}
              </span>
            </div>
            <div className="h-6 w-px bg-border" />
            <div className="text-center">
              <div className="text-xl font-heading font-black text-foreground leading-none tabular-nums">
                {completedCount}<span className="text-muted-foreground/30 font-medium text-sm">/{AGENTS.length}</span>
              </div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold mt-0.5">Agents</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-heading font-black text-foreground leading-none tabular-nums">{globalPct}%</div>
              <div className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold mt-0.5">Complete</div>
            </div>
            {allDone && (
              <button
                onClick={() => onClose(extracted)}
                className="ml-2 p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {/* ── Global Progress ── */}
        <div className="h-[3px] bg-secondary flex-shrink-0">
          <motion.div
            className="h-full bg-primary"
            style={{ boxShadow: "0 0 8px rgba(255,106,0,0.6)" }}
            animate={{ width: `${globalPct}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>

        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* ── Left: Agent Cards ── */}
          <div className="w-[380px] flex-shrink-0 border-r border-border flex flex-col bg-slate-50/60">
            <div className="px-5 pt-5 pb-3">
              <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Pipeline Agents</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
              {AGENTS.map((agent) => {
                const state = agentStates[agent.key];
                const pct   = progress[agent.key];
                const c     = colorMap[agent.color];
                const Icon  = agent.icon;
                const isActive = activeAgent === agent.key && state === "running";

                return (
                  <motion.div
                    key={agent.key}
                    layout
                    className={`
                      rounded-xl border p-3.5 transition-all duration-300 bg-white
                      ${state === "running" ? "border-primary/25 ring-2 ring-primary/8 shadow-sm" : "border-border"}
                      ${state === "done"    ? "border-emerald-200/70"                              : ""}
                    `}
                  >
                    <div className="flex items-center gap-3">
                      {/* Icon bubble */}
                      <div className={`
                        w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors
                        ${state === "done"    ? "bg-emerald-50 text-emerald-500"              : ""}
                        ${state === "running" ? `${c.bg} ${c.text}`                           : ""}
                        ${state === "waiting" ? "bg-slate-100 text-slate-400"                 : ""}
                      `}>
                        {state === "done"    && <CheckCircle2 className="h-5 w-5" />}
                        {state === "running" && <Loader2 className="h-5 w-5 animate-spin" />}
                        {state === "waiting" && <Icon className="h-5 w-5" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className={`text-sm font-semibold truncate leading-none ${state === "waiting" ? "text-slate-400" : "text-foreground"}`}>
                            {agent.label}
                          </span>
                          <StatusBadge state={state} />
                        </div>
                        <p className={`text-[11px] truncate mb-2 ${state === "waiting" ? "text-slate-300" : "text-muted-foreground"}`}>
                          {agent.description}
                        </p>

                        {/* Progress bar */}
                        <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${state === "done" ? "bg-emerald-400" : "bg-primary"}`}
                            animate={{ width: state === "waiting" ? "0%" : `${pct}%` }}
                            transition={{ duration: 0.3 }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Active log preview */}
                    <AnimatePresence>
                      {isActive && logs[agent.key].length > 0 && (
                        <motion.p
                          key={logs[agent.key].length}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className={`mt-2.5 pt-2.5 border-t ${c.border} text-[11px] font-mono ${c.text} truncate`}
                        >
                          {logs[agent.key].at(-1)}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* ── Right: Terminal ── */}
          <div className="flex-1 flex flex-col bg-[#0D1117] min-w-0">
            {/* Terminal chrome */}
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#FF5F57]" />
                  <div className="w-3 h-3 rounded-full bg-[#FEBC2E]" />
                  <div className="w-3 h-3 rounded-full bg-[#28C840]" />
                </div>
                <div className="flex items-center gap-1.5 ml-1">
                  <Terminal className="h-3.5 w-3.5 text-white/30" />
                  <span className="text-[11px] font-mono text-white/30 uppercase tracking-wider">
                    deal_parser — agent_log
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${allDone ? "bg-emerald-400" : runningCount > 0 ? "bg-primary animate-pulse" : "bg-white/20"}`} />
                <span className={`text-[10px] font-mono uppercase tracking-widest ${allDone ? "text-emerald-400" : runningCount > 0 ? "text-primary" : "text-white/20"}`}>
                  {allDone ? "complete" : runningCount > 0 ? "processing" : "idle"}
                </span>
              </div>
            </div>

            {/* Log output */}
            <div
              ref={logsRef}
              className="flex-1 overflow-y-auto p-5 font-mono text-[12px] leading-6 space-y-0.5"
            >
              {flatLogs.map(({ agent, msg, ts }, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-baseline gap-3 group"
                >
                  <span className="text-white/20 tabular-nums flex-shrink-0 text-[10px] pt-px w-16">{ts}</span>
                  <span className={`flex-shrink-0 text-[10px] font-bold uppercase w-20 truncate ${terminalColors[agent.color]}`}>
                    [{agent.key}]
                  </span>
                  <span className={`
                    ${msg.startsWith("✓") ? "text-emerald-400 font-medium" : ""}
                    ${msg.startsWith("⚠") ? "text-amber-400"               : ""}
                    ${!msg.startsWith("✓") && !msg.startsWith("⚠") ? "text-slate-300" : ""}
                  `}>
                    {msg}
                  </span>
                </motion.div>
              ))}

              {/* Cursor */}
              {!allDone && !error && (
                <motion.span
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="inline-block w-2 h-3.5 bg-primary ml-1 align-text-bottom"
                />
              )}

              {error && (
                <div className="flex items-center gap-3 text-red-400 mt-4 bg-red-500/10 p-4 rounded-lg border border-red-500/20">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <AnimatePresence>
          {allDone && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex-shrink-0 p-6 border-t border-border bg-white"
            >
              <div className="flex items-center justify-between bg-emerald-500 rounded-xl p-5 text-white shadow-[0_16px_40px_-12px_rgba(16,185,129,0.45)]">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-heading font-black text-lg leading-tight">Analysis Complete</div>
                    <div className="text-sm text-white/75 mt-0.5">
                      All {AGENTS.length} agents processed — {totalElapsed}s total runtime
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onClose(extracted)}
                  className="flex items-center gap-2.5 bg-white text-emerald-600 px-7 py-3.5 rounded-xl text-sm font-black hover:bg-emerald-50 active:scale-95 transition-all shadow-lg group"
                >
                  EXPLORE DEAL PROFILE
                  <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </motion.div>
          )}

          {error && !allDone && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex-shrink-0 p-6 border-t border-border bg-white"
            >
              <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl p-5">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="h-6 w-6 text-red-500" />
                  </div>
                  <div>
                    <div className="font-heading font-black text-lg text-red-900 leading-tight">Analysis Failed</div>
                    <div className="text-sm text-red-600 mt-0.5">{error}</div>
                  </div>
                </div>
                <button
                  onClick={() => onClose()}
                  className="bg-red-600 text-white px-7 py-3.5 rounded-xl text-sm font-black hover:bg-red-700 active:scale-95 transition-all shadow-lg"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function StatusBadge({ state }: { state: AgentState }) {
  if (state === "done") return (
    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
      Done
    </span>
  );
  if (state === "running") return (
    <span className="text-[9px] font-black uppercase tracking-widest text-primary bg-primary/8 px-1.5 py-0.5 rounded-full flex-shrink-0 animate-pulse">
      Running
    </span>
  );
  return (
    <span className="text-[9px] font-black uppercase tracking-widest text-slate-300 px-1.5 py-0.5 rounded-full flex-shrink-0">
      Queued
    </span>
  );
}
