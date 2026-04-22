"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail, RefreshCw, CheckCircle2, AlertCircle, Clock, Loader2,
  ExternalLink, Unlink, Inbox, Zap, ChevronDown, ChevronUp,
  Paperclip, User, Calendar,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Ingestion {
  id: string;
  outlook_message_id: string;
  deal_id: string | null;
  subject: string;
  sender_name: string | null;
  sender_email: string | null;
  received_at: string | null;
  attachment_count: number;
  status: "pending" | "processing" | "completed" | "failed";
  error_message: string | null;
  created_at: string;
}

interface OutlookStatus {
  connected: boolean;
  tokenExpired: boolean;
  email: string | null;
  lastSynced: string | null;
  stats: { total: number; completed: number; failed: number; processing: number };
  ingestions: Ingestion[];
}

interface PollResult {
  processed: number;
  failed: number;
  skipped: number;
  deals: Array<{ subject: string; dealId: string | null; error?: string }>;
  since?: string;
  email?: string;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return d.toLocaleDateString();
}

const STATUS_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  completed:  { label: "Imported",   icon: CheckCircle2, color: "text-emerald-600" },
  processing: { label: "Processing", icon: Loader2,      color: "text-blue-500"    },
  pending:    { label: "Pending",    icon: Clock,        color: "text-amber-500"   },
  failed:     { label: "Failed",     icon: AlertCircle,  color: "text-red-500"     },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onDealCreated?: (dealId: string) => void;
}

export default function OutlookInbox({ onDealCreated }: Props) {
  const [status, setStatus]       = useState<OutlookStatus | null>(null);
  const [polling, setPolling]     = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [expanded, setExpanded]   = useState(true);
  const [lastResult, setLastResult] = useState<PollResult | null>(null);
  const [showAll, setShowAll]     = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/outlook/status");
      const data = await res.json() as OutlookStatus;
      setStatus(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    // Refresh status every 60s
    const t = setInterval(fetchStatus, 60_000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const triggerPoll = useCallback(async () => {
    if (polling) return;
    setPolling(true);
    setLastResult(null);
    try {
      const res  = await fetch("/api/outlook/poll", { method: "POST" });
      const data = await res.json() as PollResult;
      setLastResult(data);
      if (data.deals?.length) {
        for (const d of data.deals) {
          if (d.dealId && !d.error && onDealCreated) onDealCreated(d.dealId);
        }
        await fetchStatus();
      }
    } catch (err) {
      setLastResult({ processed: 0, failed: 0, skipped: 0, deals: [], error: String(err) });
    }
    setPolling(false);
  }, [polling, onDealCreated, fetchStatus]);

  // Auto-poll every 5 minutes once connected
  useEffect(() => {
    if (!status?.connected || status.tokenExpired) return;
    const t = setInterval(triggerPoll, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [status?.connected, status?.tokenExpired, triggerPoll]);

  const disconnect = async () => {
    if (!confirm("Disconnect Outlook? Existing deals will not be deleted.")) return;
    setDisconnecting(true);
    await fetch("/api/outlook/disconnect", { method: "POST" });
    await fetchStatus();
    setDisconnecting(false);
  };

  // ── Not connected ────────────────────────────────────────────────────────
  if (!status) {
    return (
      <div className="border border-border rounded-xl p-4 bg-white animate-pulse h-24" />
    );
  }

  if (!status.connected) {
    return (
      <div className="border border-border rounded-xl overflow-hidden bg-white">
        <div className="px-4 py-3 bg-[#FFF6ED] border-b border-border flex items-center gap-2">
          <Inbox className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold text-foreground">Outlook Integration</span>
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase tracking-widest">
            Not connected
          </span>
        </div>
        <div className="px-4 py-5 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <Mail className="h-6 w-6 text-blue-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">Connect your Outlook inbox</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Deal emails with attachments are automatically imported &amp; extracted
            </p>
          </div>
          <a href="/api/outlook/connect"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-colors">
            <Mail className="h-4 w-4" />
            Connect Outlook / Microsoft 365
          </a>
          <p className="text-[10px] text-muted-foreground">
            Requires Mail.Read permission — read-only access
          </p>
        </div>
      </div>
    );
  }

  // ── Token expired ────────────────────────────────────────────────────────
  if (status.tokenExpired) {
    return (
      <div className="border border-red-200 rounded-xl overflow-hidden bg-red-50">
        <div className="px-4 py-3 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-500" />
          <span className="text-sm font-bold text-red-700">Outlook session expired</span>
          <a href="/api/outlook/connect"
            className="ml-auto px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 transition-colors">
            Reconnect
          </a>
        </div>
      </div>
    );
  }

  // ── Connected ─────────────────────────────────────────────────────────────
  const visibleIngestions = showAll ? status.ingestions : status.ingestions.slice(0, 5);

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-white">

      {/* Header */}
      <div className="px-4 py-3 bg-[#FFF6ED] border-b border-border flex items-center gap-2">
        <div className="w-5 h-5 rounded bg-blue-100 flex items-center justify-center flex-shrink-0">
          <Mail className="h-3 w-3 text-blue-600" />
        </div>
        <span className="text-sm font-bold text-foreground">Outlook Inbox</span>
        <span className="ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 uppercase tracking-widest flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          Live
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={triggerPoll} disabled={polling}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-border rounded-lg text-xs font-bold hover:bg-secondary transition-colors disabled:opacity-50">
            {polling
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <RefreshCw className="h-3 w-3" />}
            {polling ? "Polling…" : "Poll Now"}
          </button>
          <button onClick={() => setExpanded(e => !e)}
            className="p-1 hover:bg-white/60 rounded-lg transition-colors">
            {expanded
              ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {/* Account info + stats */}
            <div className="px-4 py-3 border-b border-border bg-slate-50 flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-black flex-shrink-0">
                {status.email?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-foreground truncate">{status.email}</div>
                <div className="text-[10px] text-muted-foreground">
                  Last synced {fmtTime(status.lastSynced)}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-[10px] font-bold">
                <span className="text-emerald-600">{status.stats.completed} imported</span>
                {status.stats.failed > 0 && <span className="text-red-500">{status.stats.failed} failed</span>}
                {status.stats.processing > 0 && <span className="text-blue-500">{status.stats.processing} processing</span>}
              </div>
            </div>

            {/* Poll result banner */}
            {lastResult && (
              <div className={`px-4 py-2.5 border-b border-border text-xs font-bold flex items-center gap-2
                ${lastResult.error ? "bg-red-50 text-red-700" :
                  lastResult.processed > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-600"}`}>
                {lastResult.error
                  ? <><AlertCircle className="h-3.5 w-3.5" /> {lastResult.error}</>
                  : lastResult.processed > 0
                    ? <><CheckCircle2 className="h-3.5 w-3.5" /> {lastResult.processed} new deal{lastResult.processed > 1 ? "s" : ""} imported from email</>
                    : <><Inbox className="h-3.5 w-3.5" /> No new deal emails found</>
                }
              </div>
            )}

            {/* Ingestion list */}
            {status.ingestions.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground space-y-2">
                <Mail className="h-6 w-6 mx-auto text-slate-200" />
                <p>No emails ingested yet.</p>
                <p>Click <strong>Poll Now</strong> to check your inbox.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {visibleIngestions.map(ing => {
                  const meta = STATUS_META[ing.status] ?? STATUS_META.pending;
                  const Icon = meta.icon;
                  return (
                    <div key={ing.id}
                      className="px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3">
                      <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${meta.color} ${ing.status === "processing" ? "animate-spin" : ""}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-bold text-foreground leading-snug line-clamp-1">
                            {ing.subject || "(No subject)"}
                          </p>
                          <span className={`text-[10px] font-bold flex-shrink-0 ${meta.color}`}>
                            {meta.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                          {ing.sender_name && (
                            <span className="flex items-center gap-0.5">
                              <User className="h-2.5 w-2.5" />
                              {ing.sender_name}
                            </span>
                          )}
                          {ing.attachment_count > 0 && (
                            <span className="flex items-center gap-0.5">
                              <Paperclip className="h-2.5 w-2.5" />
                              {ing.attachment_count} file{ing.attachment_count > 1 ? "s" : ""}
                            </span>
                          )}
                          <span className="flex items-center gap-0.5">
                            <Calendar className="h-2.5 w-2.5" />
                            {fmtTime(ing.received_at ?? ing.created_at)}
                          </span>
                        </div>
                        {ing.error_message && (
                          <p className="text-[10px] text-red-500 mt-0.5 line-clamp-1">{ing.error_message}</p>
                        )}
                        {ing.status === "processing" && (
                          <div className="flex items-center gap-1 mt-1 text-[10px] text-blue-500 font-bold">
                            <Zap className="h-2.5 w-2.5" />
                            Running AI extraction…
                          </div>
                        )}
                      </div>
                      {ing.deal_id && (
                        <a
                          href={`/pipeline/${ing.deal_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 p-1 hover:bg-slate-200 rounded transition-colors"
                          title="Open deal">
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      )}
                    </div>
                  );
                })}

                {/* Show more */}
                {status.ingestions.length > 5 && (
                  <button onClick={() => setShowAll(s => !s)}
                    className="w-full px-4 py-2.5 text-xs font-bold text-primary hover:bg-[#FFF6ED] transition-colors flex items-center justify-center gap-1">
                    {showAll
                      ? <><ChevronUp className="h-3 w-3" /> Show less</>
                      : <><ChevronDown className="h-3 w-3" /> Show {status.ingestions.length - 5} more</>
                    }
                  </button>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-border bg-slate-50 flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">
                Auto-polls every 5 min · read-only access
              </p>
              <button onClick={disconnect} disabled={disconnecting}
                className="flex items-center gap-1 text-[10px] font-bold text-red-400 hover:text-red-600 transition-colors disabled:opacity-50">
                <Unlink className="h-3 w-3" />
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
