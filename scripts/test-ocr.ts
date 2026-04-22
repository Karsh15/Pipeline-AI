/**
 * OCR test harness — walks given folders recursively and runs our extractor
 * (the same one the /api/run-extraction route uses) on every supported file.
 *
 * Usage:
 *   npx tsx scripts/test-ocr.ts "C:\path\to\folder" ["C:\path\to\another"] ...
 */

import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { extractDocumentText } from "../src/lib/ocr/extract";

// Load .env.local so NVIDIA_API_KEY is available
import { config } from "dotenv";
config({ path: ".env.local" });

const ACCEPTED = new Set([
  ".pdf", ".xlsx", ".xls", ".csv", ".ods", ".tsv", ".docx",
  ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp",
]);

async function walk(dir: string, out: string[]) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (ACCEPTED.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
}

function pad(s: string | number, w: number, right = false): string {
  const str = String(s);
  if (str.length >= w) return str.substring(0, w);
  const fill = " ".repeat(w - str.length);
  return right ? fill + str : str + fill;
}

async function main() {
  const folders = process.argv.slice(2);
  if (!folders.length) {
    console.error("Usage: npx tsx scripts/test-ocr.ts <folder> [<folder> ...]");
    process.exit(1);
  }

  const hasNvidia = !!process.env.NVIDIA_API_KEY;
  console.log(`\nNVIDIA key: ${hasNvidia ? "✓ present (will use NVIDIA OCR for scanned PDFs)" : "✗ missing (will use Tesseract fallback)"}\n`);

  const global = { files: 0, ok: 0, fail: 0, totalChars: 0, totalMs: 0,
                   byMethod: {} as Record<string, { count: number; chars: number; ms: number }> };

  for (const folder of folders) {
    try { await stat(folder); } catch {
      console.log(`❌ FOLDER NOT FOUND: ${folder}\n`);
      continue;
    }
    const files: string[] = [];
    await walk(folder, files);

    console.log("═".repeat(110));
    console.log(`📁 ${folder}`);
    console.log(`   ${files.length} files found`);
    console.log("═".repeat(110));
    console.log(pad("FILE", 55) + pad("METHOD", 14) + pad("PAGES", 7, true) + pad("CONF%", 8, true) + pad("CHARS", 10, true) + pad("MS", 8, true) + "  PREVIEW");
    console.log("─".repeat(110));

    for (const filePath of files) {
      const rel = path.relative(folder, filePath);
      const displayName = rel.length > 50 ? "…" + rel.substring(rel.length - 49) : rel;
      try {
        const buffer = await readFile(filePath);
        const t0 = Date.now();
        const r = await extractDocumentText(buffer, path.basename(filePath), {
          nvidiaApiKey: process.env.NVIDIA_API_KEY,
          pdfScale: 1.5,
        });
        const ms = Date.now() - t0;
        const preview = r.text.substring(0, 40).replace(/\s+/g, " ");
        console.log(
          pad(displayName, 55) +
          pad(r.method, 14) +
          pad(r.pages, 7, true) +
          pad(r.avgConfidence.toFixed(0), 8, true) +
          pad(r.text.length.toLocaleString(), 10, true) +
          pad(ms.toLocaleString(), 8, true) +
          "  " + preview
        );
        global.ok++;
        global.totalChars += r.text.length;
        global.totalMs += ms;
        const m = global.byMethod[r.method] ||= { count: 0, chars: 0, ms: 0 };
        m.count++; m.chars += r.text.length; m.ms += ms;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(pad(displayName, 55) + "ERROR         " + "       " + "        " + "          " + "        " + "  " + msg.substring(0, 60));
        global.fail++;
      }
      global.files++;
    }
    console.log();
  }

  console.log("═".repeat(110));
  console.log("📊 OVERALL SUMMARY");
  console.log("═".repeat(110));
  console.log(`Files processed: ${global.files}`);
  console.log(`Succeeded:       ${global.ok}`);
  console.log(`Failed:          ${global.fail}`);
  console.log(`Total chars:     ${global.totalChars.toLocaleString()}`);
  console.log(`Total time:      ${(global.totalMs / 1000).toFixed(1)}s (${global.files ? (global.totalMs / global.files).toFixed(0) : 0} ms/file avg)`);
  console.log();
  console.log("Method breakdown:");
  for (const [method, s] of Object.entries(global.byMethod)) {
    console.log(`  ${pad(method, 14)} ${pad(s.count, 4, true)} files  ${pad(s.chars.toLocaleString(), 10, true)} chars  ${pad((s.ms / 1000).toFixed(1), 7, true)}s`);
  }
  console.log();
}

main().catch(err => { console.error(err); process.exit(1); });
