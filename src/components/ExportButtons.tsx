"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { FileSpreadsheet, Presentation, Loader2, CheckCircle2, Download } from "lucide-react";
import { exportExcel, exportPPT } from "@/lib/pipeline";

export default function ExportButtons({ dealId, dealName }: { dealId: string; dealName: string }) {
  const [xlsxState, setXlsxState] = useState<"idle" | "loading" | "done">("idle");
  const [pptState,  setPptState]  = useState<"idle" | "loading" | "done">("idle");

  const handleExcel = async () => {
    setXlsxState("loading");
    await exportExcel(dealId);
    setXlsxState("done");
    setTimeout(() => setXlsxState("idle"), 2500);
  };

  const handlePPT = async () => {
    setPptState("loading");
    await exportPPT(dealId);
    setPptState("done");
    setTimeout(() => setPptState("idle"), 2500);
  };

  return (
    <div className="space-y-3">
      <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
        <Download className="h-3 w-3" /> Export Analysis
      </div>
      <div className="flex gap-2">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleExcel}
          disabled={xlsxState === "loading"}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all border
            ${xlsxState === "done"
              ? "bg-emerald-500 text-white border-emerald-500"
              : "bg-white border-border text-foreground hover:bg-[#FFF6ED] hover:border-primary/30"
            } disabled:opacity-60`}
        >
          {xlsxState === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> :
           xlsxState === "done"    ? <CheckCircle2 className="h-4 w-4" /> :
                                     <FileSpreadsheet className="h-4 w-4 text-emerald-600" />}
          {xlsxState === "loading" ? "Generating..." : xlsxState === "done" ? "Downloaded!" : "Excel Model"}
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handlePPT}
          disabled={pptState === "loading"}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all border
            ${pptState === "done"
              ? "bg-emerald-500 text-white border-emerald-500"
              : "bg-white border-border text-foreground hover:bg-[#FFF6ED] hover:border-primary/30"
            } disabled:opacity-60`}
        >
          {pptState === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> :
           pptState === "done"    ? <CheckCircle2 className="h-4 w-4" /> :
                                    <Presentation className="h-4 w-4 text-orange-500" />}
          {pptState === "loading" ? "Generating..." : pptState === "done" ? "Downloaded!" : "PowerPoint"}
        </motion.button>
      </div>
      <p className="text-[10px] text-muted-foreground text-center">
        Generates from live AI-extracted deal data
      </p>
    </div>
  );
}
