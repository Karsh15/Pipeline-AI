

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Lightbulb, FileText, BookOpen, Sparkles, Loader2 } from "lucide-react";
import { supabase, type DBExplanation } from "@/lib/supabase";

interface WhyPanelProps {
  dealId: string;
  fieldName: string;
  fieldLabel: string;
  value: string;
  onClose: () => void;
}

export default function WhyPanel({ dealId, fieldName, fieldLabel, value, onClose }: WhyPanelProps) {
  const [explanation, setExplanation] = useState<DBExplanation | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setExplanation(null);
    setAiSuggestion(null);
    setLoading(true);
    supabase
      .from("ai_explanations")
      .select("*")
      .eq("deal_id", dealId)
      .eq("field_name", fieldName)
      .maybeSingle()
      .then(({ data }) => {
        setExplanation(data as DBExplanation | null);
        setLoading(false);
      });
  }, [dealId, fieldName]);

  const generateSuggestion = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          message: `Give me a concise 2-3 sentence AI insight about the "${fieldLabel}" field for this deal. The extracted value is "${value}". Explain what this means for the investment, whether it's good/bad/typical for the asset class, and any red flags or positives an investor should note. Be specific and actionable.`,
          history: [],
        }),
      });
      const json = await res.json() as { reply?: string };
      if (json.reply) setAiSuggestion(json.reply);
    } catch {
      setAiSuggestion("Could not generate AI suggestion. Please try again.");
    }
    setGenerating(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed right-0 top-0 h-full w-[400px] bg-white border-l border-border shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-[#FFF6ED]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center">
              <Lightbulb className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-[10px] font-black text-primary uppercase tracking-widest">AI Insight</div>
              <div className="text-sm font-bold text-foreground">{fieldLabel}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-lg transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Value */}
        <div className="px-6 py-4 border-b border-border bg-white">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Extracted Value</div>
          <div className="text-2xl font-heading font-black text-foreground">{value || "—"}</div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />)}
            </div>
          ) : (
            <>
              {/* DB explanation (from extraction pipeline) */}
              {explanation && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb className="h-4 w-4 text-primary" />
                    <span className="text-xs font-black text-foreground uppercase tracking-widest">Why this number?</span>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed bg-[#FFF6ED] rounded-xl p-4 border border-orange-100">
                    {explanation.explanation_text}
                  </p>

                  {explanation.source_snippet && (
                    <div className="mt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <BookOpen className="h-4 w-4 text-blue-500" />
                        <span className="text-xs font-black text-foreground uppercase tracking-widest">Source Snippet</span>
                        {explanation.source_page && (
                          <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-bold">
                            Page {explanation.source_page}
                          </span>
                        )}
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 font-mono text-xs text-slate-600 leading-relaxed">
                        "…{explanation.source_snippet}…"
                      </div>
                    </div>
                  )}

                  {explanation.source_document_id && (
                    <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl border border-blue-100 mt-3">
                      <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
                      <span className="text-xs text-blue-700 font-medium">Referenced from uploaded document</span>
                    </div>
                  )}
                </div>
              )}

              {/* AI on-demand suggestion */}
              {aiSuggestion ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <span className="text-xs font-black text-foreground uppercase tracking-widest">AI Suggestion</span>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed bg-violet-50 rounded-xl p-4 border border-violet-100">
                    {aiSuggestion}
                  </p>
                </div>
              ) : (
                <button
                  onClick={generateSuggestion}
                  disabled={generating}
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-3.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold transition-colors shadow-sm"
                >
                  {generating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating insight…</>
                  ) : (
                    <><Sparkles className="h-4 w-4" /> Get AI Suggestion</>
                  )}
                </button>
              )}

              {/* Empty state when no DB explanation */}
              {!explanation && !aiSuggestion && !generating && (
                <p className="text-xs text-slate-400 text-center pt-1">
                  No extraction explanation yet. Click above to generate an AI insight.
                </p>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border">
          <p className="text-[10px] text-slate-400 text-center">
            AI insights are generated from your uploaded deal documents
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
