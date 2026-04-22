import { useState } from "react";
import { motion } from "framer-motion";
import { FileSpreadsheet, Presentation, Loader2, CheckCircle2, Download, FileText } from "lucide-react";
import { exportExcel, exportPPT, exportUnderwritingPdf } from "@/lib/pipeline";

type BtnState = "idle" | "loading" | "done" | "error";

function ExportBtn({
  state, onClick, icon, idleLabel, loadingLabel = "Generating…", className = "",
}: {
  state: BtnState; onClick: () => void; icon: React.ReactNode;
  idleLabel: string; loadingLabel?: string; className?: string;
}) {
  return (
    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
      onClick={onClick} disabled={state === "loading"}
      className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all border
        ${state === "done"  ? "bg-emerald-500 text-white border-emerald-500" :
          state === "error" ? "bg-red-500 text-white border-red-500" :
          className} disabled:opacity-60`}>
      {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> :
       state === "done"    ? <CheckCircle2 className="h-4 w-4" /> :
       state === "error"   ? <span className="text-xs">Retry</span> :
       icon}
      {state === "loading" ? loadingLabel :
       state === "done"    ? "Downloaded!" :
       state === "error"   ? "Failed — retry" :
       idleLabel}
    </motion.button>
  );
}

function useBtnState(fn: () => Promise<void>): [BtnState, () => Promise<void>] {
  const [state, setState] = useState<BtnState>("idle");
  const run = async () => {
    setState("loading");
    try {
      await fn();
      setState("done");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  };
  return [state, run];
}

export default function ExportButtons({ dealId }: { dealId: string; dealName?: string }) {
  const [xlsxState, runExcel] = useBtnState(() => exportExcel(dealId));
  const [pptState,  runPPT]   = useBtnState(() => exportPPT(dealId));
  const [pdfState,  runPdf]   = useBtnState(() => exportUnderwritingPdf(dealId));

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
        <Download className="h-3 w-3" /> Export Analysis
      </div>
      <div className="flex gap-2">
        <ExportBtn state={xlsxState} onClick={runExcel}
          icon={<FileSpreadsheet className="h-4 w-4 text-emerald-600" />}
          idleLabel="Excel"
          className="flex-1 bg-white border-border text-foreground hover:bg-[#FFF6ED] hover:border-primary/30" />
        <ExportBtn state={pptState} onClick={runPPT}
          icon={<Presentation className="h-4 w-4 text-orange-500" />}
          idleLabel="Slides"
          className="flex-1 bg-white border-border text-foreground hover:bg-[#FFF6ED] hover:border-primary/30" />
      </div>
      <ExportBtn state={pdfState} onClick={runPdf}
        icon={<FileText className="h-4 w-4" />}
        idleLabel="Underwriting PDF" loadingLabel="Generating PDF…"
        className="w-full bg-primary text-white border-primary hover:bg-primary/90" />
      <p className="text-[10px] text-muted-foreground text-center">
        Generated from live AI-extracted deal data
      </p>
    </div>
  );
}
