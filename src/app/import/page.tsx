"use client";

import { useState } from "react";
import { UploadCloud, File, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";

export default function ImportDeal() {
  const [isUploading, setIsUploading] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const handleUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      setIsDone(true);
    }, 2500);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Import Deal Documents</h2>
        <p className="text-muted-foreground mt-1">Upload PDF brochures, Excel financials, or Word documents. Our AI will automatically extract data and build the deal profile.</p>
      </div>

      {!isDone ? (
        <div className="mt-8 bg-card border border-border rounded-2xl shadow-sm p-8 text-center pt-16 pb-16">
          <UploadCloud className="mx-auto h-16 w-16 text-primary mb-4" />
          <h3 className="text-lg font-semibold mb-2">Drag & Drop Files Here</h3>
          <p className="text-muted-foreground text-sm max-w-md mx-auto mb-8">
            Supports PDF, DOCX, XLSX. Max file size 50MB per document.
          </p>
          
          <div className="flex justify-center gap-4">
            <button className="px-6 py-2.5 bg-secondary text-foreground font-medium rounded-xl hover:bg-secondary/80 transition-colors">
              Browse Files
            </button>
            <button 
              onClick={handleUpload}
              disabled={isUploading}
              className={`px-6 py-2.5 bg-primary text-white font-medium rounded-xl hover:bg-primary/90 transition-colors shadow-sm flex items-center gap-2 ${isUploading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isUploading ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Uploading...
                </>
              ) : 'Upload & Process'}
            </button>
          </div>

          {isUploading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-12 max-w-md mx-auto">
              <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }} 
                  animate={{ width: "100%" }} 
                  transition={{ duration: 2.5 }}
                  className="h-full bg-primary"
                />
              </div>
              <p className="text-sm text-muted-foreground mt-3 animate-pulse">Running AI extraction agents...</p>
            </motion.div>
          )}
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-card border-2 border-green-500/20 rounded-2xl shadow-sm p-8 text-center pt-16 pb-16">
          <CheckCircle className="mx-auto h-16 w-16 text-green-500 mb-4" />
          <h3 className="text-xl font-bold mb-2">Deal Extracted Successfully</h3>
          <p className="text-muted-foreground mb-8">AI Agents have populated the deal context.</p>
          <button 
            onClick={() => setIsDone(false)}
            className="px-6 py-2.5 bg-primary text-white font-medium rounded-xl hover:bg-primary/90 transition-colors shadow-sm"
          >
            Go to Deal Profile
          </button>
        </motion.div>
      )}

      <div className="bg-secondary/40 rounded-2xl p-6 border border-border">
        <h4 className="font-semibold mb-4 flex items-center gap-2">
          <File className="h-5 w-5 text-primary" /> Supported Agent Workflows
        </h4>
        <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
          <li><strong>Metadata Extraction Agent:</strong> Property name, year built, units, brand, location</li>
          <li><strong>Financial Analysis Agent:</strong> Margins, revenue, NOI, EBITDA</li>
          <li><strong>Investment Summary Agent:</strong> Location insights, highlights, comp positioning</li>
        </ul>
      </div>
    </div>
  );
}
