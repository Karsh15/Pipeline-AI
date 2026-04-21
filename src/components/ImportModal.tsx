"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, X, CheckCircle, FileText, Zap, Info } from "lucide-react";

export default function ImportModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const handleUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      setIsDone(true);
    }, 2500);
  };

  const reset = () => {
    setIsUploading(false);
    setIsDone(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-border overflow-hidden relative"
        >
          {/* Header */}
          <div className="px-8 py-6 border-b border-border flex items-center justify-between bg-white">
             <div>
                <h2 className="text-2xl font-heading font-black text-foreground tracking-tight">Import Intelligence</h2>
                <p className="text-muted-foreground text-sm font-medium mt-1">Upload deal documents for institutional-grade AI parsing.</p>
             </div>
             <button onClick={reset} className="p-2.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl transition-colors">
               <X className="h-6 w-6" />
             </button>
          </div>

          <div className="p-8">
            {!isDone ? (
              <div className="premium-card p-12 text-center bg-muted/20 border-2 border-dashed border-border group hover:border-primary/30 transition-all">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                  <UploadCloud className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-heading font-black text-foreground mb-2">Drop Institutional Documents</h3>
                <p className="text-sm text-muted-foreground mb-8 max-w-sm mx-auto">Upload OM, T12 Financials, or Rent Rolls. Pipeline AI handles the rest.</p>
                
                <div className="flex justify-center gap-4">
                  <button className="px-6 py-3 bg-white border border-border text-foreground font-black rounded-xl text-sm shadow-sm hover:bg-secondary transition-all active:scale-95">
                    Select Files
                  </button>
                  <button 
                    onClick={handleUpload}
                    disabled={isUploading}
                    className={`px-8 py-3 bg-primary text-white font-black rounded-xl text-sm shadow-xl shadow-primary/20 hover:bg-primary/90 transition-all flex items-center gap-2 active:scale-95 ${isUploading ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4" />
                        Initiate Parsing
                      </>
                    )}
                  </button>
                </div>

                {isUploading && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-10 text-left max-w-sm mx-auto">
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">
                      <span>Neural Extraction Active</span>
                      <span className="text-primary italic">Syncing with Claude 3...</span>
                    </div>
                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: "100%" }}
                        transition={{ duration: 2.5 }}
                      />
                    </div>
                  </motion.div>
                )}
              </div>
            ) : (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="premium-card border-none bg-emerald-500/5 p-12 text-center">
                <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="h-10 w-10 text-emerald-600" />
                </div>
                <h3 className="text-2xl font-heading font-black text-emerald-900 mb-2">Ingestion Complete</h3>
                <p className="text-sm text-emerald-700/80 mb-8 max-w-sm mx-auto font-medium leading-relaxed">
                  Your asset has been digitized and populated. The Intelligence Pipeline is now generating your summaries.
                </p>
                <button onClick={reset} className="px-10 py-4 bg-emerald-600 text-white rounded-2xl text-base font-black shadow-xl shadow-emerald-600/20 hover:bg-emerald-700 transition-all active:scale-95">
                  Explore Result
                </button>
              </motion.div>
            )}
          </div>

          <div className="px-8 py-4 bg-muted/30 border-t border-border flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Supports PDF, XLXS, XLS, DOCX</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function Loader2(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2v4" />
      <path d="m16.2 7.8 2.9-2.9" />
      <path d="M18 12h4" />
      <path d="m16.2 16.2 2.9 2.9" />
      <path d="M12 18v4" />
      <path d="m4.9 19.1 2.9-2.9" />
      <path d="M2 12h4" />
      <path d="m4.9 4.9 2.9 2.9" />
    </svg>
  );
}
