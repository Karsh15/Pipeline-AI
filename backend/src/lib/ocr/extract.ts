/**
 * Hybrid document text extractor — adapted from OCR-V1 repo.
 *
 * 4-tier strategy (fastest → slowest):
 *   1. Spreadsheets (xlsx/csv/ods/tsv) → direct read (instant)
 *   2. Text-based PDFs                 → native pdfjs extraction (instant)
 *   3. Scanned PDFs / images + NVIDIA  → NVIDIA NIM OCR (~2-7s/page)
 *   4. Scanned PDFs / images no key    → Tesseract.js fallback (~10-15s/page)
 *
 * All functions take a Buffer/Uint8Array + filename — no disk reads required,
 * which matches how our Supabase storage downloads work.
 */

import { nvidiaOcrRecognize } from "./nvidiaOcr";

export interface OcrExtractResult {
  text: string;
  method: "native" | "spreadsheet" | "nvidia-ocr" | "tesseract" | "docx" | "empty";
  pages: number;
  avgConfidence: number;
}

const MIN_TEXT_ITEMS_PER_PAGE = 10; // heuristic: is the PDF text-based?

/* ───────── Top-level dispatcher ───────── */

export async function extractDocumentText(
  buffer: Buffer,
  fileName: string,
  opts: { nvidiaApiKey?: string; pdfScale?: number } = {}
): Promise<OcrExtractResult> {
  const name = fileName.toLowerCase();

  if (/\.(xlsx|xls|csv|ods|tsv)$/.test(name)) {
    const text = await extractSpreadsheet(buffer);
    return { text, method: "spreadsheet", pages: 1, avgConfidence: 100 };
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: value as string, method: "docx", pages: 1, avgConfidence: 100 };
  }

  if (name.endsWith(".pdf")) {
    // Try native text extraction first
    const native = await extractPdfNative(buffer);
    if (native.isTextBased) {
      return {
        text: native.pages.map((p) => p.text).join("\n"),
        method: "native",
        pages: native.pages.length,
        avgConfidence: 100,
      };
    }
    // Scanned PDF — needs OCR
    const pageImages = await renderPdfPages(buffer, opts.pdfScale ?? 1.5);
    if (!pageImages.length) return { text: "", method: "empty", pages: 0, avgConfidence: 0 };

    if (opts.nvidiaApiKey) {
      return await ocrWithNvidia(pageImages, opts.nvidiaApiKey);
    }
    return await ocrWithTesseract(pageImages);
  }

  if (/\.(jpg|jpeg|png|tiff|tif|bmp|webp)$/.test(name)) {
    if (opts.nvidiaApiKey) {
      const r = await nvidiaOcrRecognize(buffer, { apiKey: opts.nvidiaApiKey });
      return { text: r.text, method: "nvidia-ocr", pages: 1, avgConfidence: r.confidence };
    }
    return await ocrWithTesseract([buffer]);
  }

  // Plain text fallback
  return { text: buffer.toString("utf-8"), method: "empty", pages: 1, avgConfidence: 0 };
}

/* ───────── Spreadsheet ───────── */

async function extractSpreadsheet(buffer: Buffer): Promise<string> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets: string[] = [];

  wb.eachSheet((sheet) => {
    const lines: string[] = [];
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1); // index 0 is unused
      const formatted = cells.map((c) => formatCell(c)).join("\t").trimEnd();
      if (formatted.trim()) lines.push(formatted);
    });
    if (lines.length) sheets.push(`=== SHEET: ${sheet.name} ===\n${lines.join("\n")}`);
  });
  return sheets.join("\n\n");
}

function formatCell(cell: unknown): string {
  if (cell == null || cell === "") return "";
  if (cell instanceof Date) {
    const m = String(cell.getMonth() + 1).padStart(2, "0");
    const d = String(cell.getDate()).padStart(2, "0");
    return `${m}/${d}/${cell.getFullYear()}`;
  }
  if (typeof cell === "number") return Number.isInteger(cell) ? cell.toString() : cell.toFixed(2);
  if (typeof cell === "object") {
    // exceljs rich text: { richText: [{ text: '...' }, ...] }
    const rt = (cell as Record<string, unknown>).richText;
    if (Array.isArray(rt)) return rt.map((r) => (r as Record<string, unknown>).text ?? "").join("").trim();
    // exceljs hyperlink: { text: '...', hyperlink: '...' }
    const t = (cell as Record<string, unknown>).text;
    if (t != null) return String(t).trim();
    // formula result: { formula: '...', result: ... }
    const res = (cell as Record<string, unknown>).result;
    if (res != null) return formatCell(res);
  }
  return String(cell).trim();
}

/* ───────── Native PDF text ───────── */

interface PdfTextItem { str?: string; transform?: number[] }

async function extractPdfNative(buffer: Buffer): Promise<{ pages: { pageNumber: number; text: string }[]; isTextBased: boolean }> {
  // Use unpdf (serverless PDF.js build) — it ships its own worker-free build,
  // so Turbopack's chunking of pdfjs-dist doesn't break it.
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buffer));

  const pages: { pageNumber: number; text: string }[] = [];
  let totalItems = 0, successPages = 0;

  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      totalItems += tc.items.length;
      successPages++;
      pages.push({ pageNumber: i, text: reconstructPageText(tc.items as PdfTextItem[]) });
    } catch {
      pages.push({ pageNumber: i, text: "" });
    }
  }

  const avgItems = successPages > 0 ? totalItems / successPages : 0;
  return { pages, isTextBased: avgItems >= MIN_TEXT_ITEMS_PER_PAGE && successPages > 0 };
}

function reconstructPageText(items: PdfTextItem[]): string {
  const sorted = items.filter((it) => it.str !== undefined && it.transform).sort((a, b) => {
    const yDiff = (b.transform![5]) - (a.transform![5]);
    if (Math.abs(yDiff) > 3) return yDiff;
    return (a.transform![4]) - (b.transform![4]);
  });
  const lines: string[] = [];
  let current: string[] = [];
  let lastY = sorted[0]?.transform?.[5] ?? 0;
  for (const it of sorted) {
    const y = it.transform![5];
    if (!it.str) continue;
    if (Math.abs(y - lastY) > 3) {
      if (current.length) lines.push(current.join(" ").trim());
      current = [];
      lastY = y;
    }
    current.push(it.str);
  }
  if (current.length) lines.push(current.join(" ").trim());
  return lines.filter((l) => l.length).join("\n");
}

/* ───────── Render PDF pages to images (for OCR) ───────── */

async function renderPdfPages(buffer: Buffer, scale: number): Promise<Buffer[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pdf } = await import("pdf-to-img");
    const document = await pdf(buffer, { scale });
    const images: Buffer[] = [];
    for await (const image of document) {
      images.push(Buffer.from(image));
    }
    return images;
  } catch (err) {
    console.error("[ocr/extract] PDF render failed:", err);
    return [];
  }
}

/* ───────── OCR backends ───────── */

async function ocrWithNvidia(pageImages: Buffer[], apiKey: string): Promise<OcrExtractResult> {
  const texts: string[] = [];
  let totalConf = 0;
  for (const img of pageImages) {
    try {
      const r = await nvidiaOcrRecognize(img, { apiKey });
      texts.push(r.text);
      totalConf += r.confidence;
    } catch (err) {
      console.error("[ocr/extract] Nvidia OCR page failed:", err);
      texts.push("");
    }
  }
  return {
    text: texts.join("\n\n"),
    method: "nvidia-ocr",
    pages: pageImages.length,
    avgConfidence: pageImages.length > 0 ? totalConf / pageImages.length : 0,
  };
}

async function ocrWithTesseract(pageImages: Buffer[]): Promise<OcrExtractResult> {
  const Tesseract = await import("tesseract.js");
  const texts: string[] = [];
  let totalConf = 0;
  for (const img of pageImages) {
    try {
      const { data } = await Tesseract.recognize(img, "eng");
      texts.push(data.text);
      totalConf += data.confidence;
    } catch (err) {
      console.error("[ocr/extract] Tesseract page failed:", err);
      texts.push("");
    }
  }
  return {
    text: texts.join("\n\n"),
    method: "tesseract",
    pages: pageImages.length,
    avgConfidence: pageImages.length > 0 ? totalConf / pageImages.length : 0,
  };
}
