"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDocumentText = extractDocumentText;
const nvidiaOcr_1 = require("./nvidiaOcr");
const MIN_TEXT_ITEMS_PER_PAGE = 10; // heuristic: is the PDF text-based?
/* ───────── Top-level dispatcher ───────── */
async function extractDocumentText(buffer, fileName, opts = {}) {
    const name = fileName.toLowerCase();
    if (/\.(xlsx|xls|csv|ods|tsv)$/.test(name)) {
        const text = extractSpreadsheet(buffer);
        return { text, method: "spreadsheet", pages: 1, avgConfidence: 100 };
    }
    if (name.endsWith(".docx")) {
        const mammoth = await Promise.resolve().then(() => __importStar(require("mammoth")));
        const { value } = await mammoth.extractRawText({ buffer });
        return { text: value, method: "docx", pages: 1, avgConfidence: 100 };
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
        if (!pageImages.length)
            return { text: "", method: "empty", pages: 0, avgConfidence: 0 };
        if (opts.nvidiaApiKey) {
            return await ocrWithNvidia(pageImages, opts.nvidiaApiKey);
        }
        return await ocrWithTesseract(pageImages);
    }
    if (/\.(jpg|jpeg|png|tiff|tif|bmp|webp)$/.test(name)) {
        if (opts.nvidiaApiKey) {
            const r = await (0, nvidiaOcr_1.nvidiaOcrRecognize)(buffer, { apiKey: opts.nvidiaApiKey });
            return { text: r.text, method: "nvidia-ocr", pages: 1, avgConfidence: r.confidence };
        }
        return await ocrWithTesseract([buffer]);
    }
    // Plain text fallback
    return { text: buffer.toString("utf-8"), method: "empty", pages: 1, avgConfidence: 0 };
}
/* ───────── Spreadsheet ───────── */
function extractSpreadsheet(buffer) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheets = [];
    for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet)
            continue;
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const nonEmpty = rows.filter((r) => r.some((c) => c !== "" && c != null));
        if (!nonEmpty.length)
            continue;
        const lines = nonEmpty.map((row) => row.map((c) => formatCell(c)).join("\t").trimEnd());
        sheets.push(`=== SHEET: ${sheetName} ===\n${lines.join("\n")}`);
    }
    return sheets.join("\n\n");
}
function formatCell(cell) {
    if (cell == null || cell === "")
        return "";
    if (cell instanceof Date) {
        const m = String(cell.getMonth() + 1).padStart(2, "0");
        const d = String(cell.getDate()).padStart(2, "0");
        return `${m}/${d}/${cell.getFullYear()}`;
    }
    if (typeof cell === "number")
        return Number.isInteger(cell) ? cell.toString() : cell.toFixed(2);
    return String(cell).trim();
}
async function extractPdfNative(buffer) {
    // Use unpdf (serverless PDF.js build) — it ships its own worker-free build,
    // so Turbopack's chunking of pdfjs-dist doesn't break it.
    const { getDocumentProxy } = await Promise.resolve().then(() => __importStar(require("unpdf")));
    const doc = await getDocumentProxy(new Uint8Array(buffer));
    const pages = [];
    let totalItems = 0, successPages = 0;
    for (let i = 1; i <= doc.numPages; i++) {
        try {
            const page = await doc.getPage(i);
            const tc = await page.getTextContent();
            totalItems += tc.items.length;
            successPages++;
            pages.push({ pageNumber: i, text: reconstructPageText(tc.items) });
        }
        catch {
            pages.push({ pageNumber: i, text: "" });
        }
    }
    const avgItems = successPages > 0 ? totalItems / successPages : 0;
    return { pages, isTextBased: avgItems >= MIN_TEXT_ITEMS_PER_PAGE && successPages > 0 };
}
function reconstructPageText(items) {
    const sorted = items.filter((it) => it.str !== undefined && it.transform).sort((a, b) => {
        const yDiff = (b.transform[5]) - (a.transform[5]);
        if (Math.abs(yDiff) > 3)
            return yDiff;
        return (a.transform[4]) - (b.transform[4]);
    });
    const lines = [];
    let current = [];
    let lastY = sorted[0]?.transform?.[5] ?? 0;
    for (const it of sorted) {
        const y = it.transform[5];
        if (!it.str)
            continue;
        if (Math.abs(y - lastY) > 3) {
            if (current.length)
                lines.push(current.join(" ").trim());
            current = [];
            lastY = y;
        }
        current.push(it.str);
    }
    if (current.length)
        lines.push(current.join(" ").trim());
    return lines.filter((l) => l.length).join("\n");
}
/* ───────── Render PDF pages to images (for OCR) ───────── */
async function renderPdfPages(buffer, scale) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { pdf } = await Promise.resolve().then(() => __importStar(require("pdf-to-img")));
        const document = await pdf(buffer, { scale });
        const images = [];
        for await (const image of document) {
            images.push(Buffer.from(image));
        }
        return images;
    }
    catch (err) {
        console.error("[ocr/extract] PDF render failed:", err);
        return [];
    }
}
/* ───────── OCR backends ───────── */
async function ocrWithNvidia(pageImages, apiKey) {
    const texts = [];
    let totalConf = 0;
    for (const img of pageImages) {
        try {
            const r = await (0, nvidiaOcr_1.nvidiaOcrRecognize)(img, { apiKey });
            texts.push(r.text);
            totalConf += r.confidence;
        }
        catch (err) {
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
async function ocrWithTesseract(pageImages) {
    const Tesseract = await Promise.resolve().then(() => __importStar(require("tesseract.js")));
    const texts = [];
    let totalConf = 0;
    for (const img of pageImages) {
        try {
            const { data } = await Tesseract.recognize(img, "eng");
            texts.push(data.text);
            totalConf += data.confidence;
        }
        catch (err) {
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
