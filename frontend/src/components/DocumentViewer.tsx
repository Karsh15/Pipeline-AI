

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, ExternalLink, Download, Loader2, FileText, AlertCircle } from "lucide-react";
import type { DBDocument } from "@/lib/supabase";

interface Props {
  doc: DBDocument;
  onClose: () => void;
}

type SheetData = { name: string; rows: string[][] }[];

export default function DocumentViewer({ doc, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [textContent, setText] = useState<string | null>(null);
  const [sheets, setSheets]    = useState<SheetData | null>(null);
  const [signedUrl, setSignedUrl] = useState<string>(doc.file_url);

  const ext = doc.file_name.split(".").pop()?.toLowerCase() || "";
  const isPdf   = ext === "pdf";
  const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
  const isExcel = ["xlsx", "xls"].includes(ext);
  const isCsv   = ext === "csv";
  const isDocx  = ext === "docx";
  const isText  = ["txt", "md", "json"].includes(ext);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setText(null); setSheets(null);

    (async () => {
      try {
        const url = doc.file_url;
        setSignedUrl(url);

        if (isPdf || isImage) {
          setLoading(false);
          return;
        }

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        if (isExcel) {
          const XLSX = await import("xlsx");
          const buf  = await res.arrayBuffer();
          const wb   = XLSX.read(buf, { type: "array" });
          const data: SheetData = wb.SheetNames.map(name => {
            const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, defval: "" });
            return { name, rows: rows.slice(0, 500) };  // cap for perf
          });
          if (!cancelled) setSheets(data);
        } else if (isCsv) {
          const text = await res.text();
          const rows = text.split("\n").slice(0, 500).map(l =>
            l.split(",").map(c => c.replace(/^"|"$/g, ""))
          );
          if (!cancelled) setSheets([{ name: "CSV", rows }]);
        } else if (isDocx) {
          const mammoth = await import("mammoth");
          const buf = await res.arrayBuffer();
          const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
          if (!cancelled) setText(value);
        } else if (isText) {
          if (!cancelled) setText(await res.text());
        } else {
          if (!cancelled) setText(await res.text());
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [doc.file_url, isPdf, isImage, isExcel, isCsv, isDocx, isText]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-slate-50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-heading font-black truncate">{doc.file_name}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                {doc.document_type.replace("_", " ")} · {new Date(doc.uploaded_at).toLocaleString()}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <a href={signedUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-bold hover:bg-white transition-colors">
              <ExternalLink className="h-3.5 w-3.5" /> Open in tab
            </a>
            <a href={signedUrl} download={doc.file_name}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-bold hover:bg-white transition-colors">
              <Download className="h-3.5 w-3.5" /> Download
            </a>
            <button onClick={onClose}
              className="p-1.5 hover:bg-white rounded-lg transition-colors">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-slate-100">
          {loading && (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm font-medium">Loading document...</p>
            </div>
          )}

          {error && !loading && (
            <div className="h-full flex flex-col items-center justify-center p-8">
              <AlertCircle className="h-10 w-10 text-red-500 mb-3" />
              <p className="text-sm font-bold text-foreground">Could not load preview</p>
              <p className="text-xs text-muted-foreground mt-1 text-center max-w-md">{error}</p>
              <a href={signedUrl} target="_blank" rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors">
                <ExternalLink className="h-3.5 w-3.5" /> Try opening in new tab
              </a>
            </div>
          )}

          {!loading && !error && isPdf && (
            <iframe src={signedUrl} className="w-full h-full bg-white" title={doc.file_name} />
          )}

          {!loading && !error && isImage && (
            <div className="h-full flex items-center justify-center p-6">
              <img src={signedUrl} alt={doc.file_name} className="max-w-full max-h-full object-contain rounded-lg shadow-lg" />
            </div>
          )}

          {!loading && !error && sheets && (
            <SheetsView sheets={sheets} />
          )}

          {!loading && !error && textContent && (
            <pre className="p-6 text-xs text-foreground whitespace-pre-wrap font-mono bg-white m-4 rounded-lg border border-border">
              {textContent}
            </pre>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function SheetsView({ sheets }: { sheets: SheetData }) {
  const [active, setActive] = useState(0);
  const sheet = sheets[active];
  if (!sheet) return null;

  return (
    <div className="h-full flex flex-col">
      {sheets.length > 1 && (
        <div className="flex items-center gap-1 px-4 py-2 bg-white border-b border-border overflow-x-auto flex-shrink-0">
          {sheets.map((s, i) => (
            <button key={s.name} onClick={() => setActive(i)}
              className={`px-3 py-1 rounded-md text-xs font-bold whitespace-nowrap transition-colors
                ${active === i ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary"}`}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r} className={r === 0 ? "bg-slate-100 font-bold" : r % 2 ? "bg-slate-50" : ""}>
                  {row.map((cell, c) => (
                    <td key={c} className="px-2 py-1 border-r border-b border-border/50 whitespace-nowrap max-w-[240px] truncate"
                      title={String(cell)}>
                      {String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.rows.length >= 500 && (
            <div className="p-3 text-center text-[11px] text-muted-foreground bg-slate-50 border-t border-border">
              Showing first 500 rows
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
