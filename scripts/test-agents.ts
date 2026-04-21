/**
 * Verify metadata / financial / unit_mix agents on a real deal folder.
 * Runs OCR + LLM agents against disk files, no Supabase writes.
 *
 * Usage: npx tsx scripts/test-agents.ts "C:\path\to\deal\folder"
 */

import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { config } from "dotenv";
config({ path: ".env.local" });

import { extractDocumentText } from "../src/lib/ocr/extract";
import { chat, safeParse, MODELS } from "../src/lib/llm";

const ACCEPTED = new Set([".pdf", ".xlsx", ".xls", ".csv", ".docx"]);
const BUDGET = 7000;

type Bucket = "om" | "financial" | "rent_roll" | "other";
function classify(fn: string): Bucket {
  const n = fn.toLowerCase();
  if (/\b(om|offering|memorandum|flyer|teaser|brochure)\b/.test(n)) return "om";
  if (/\b(rent[\s_-]*roll|rr)\b/.test(n)) return "rent_roll";
  if (/\b(t12|p&?l|pnl|financial|income|operating|str)\b/.test(n)) return "financial";
  return "other";
}

async function walk(dir: string, out: string[]) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) await walk(f, out);
    else if (ACCEPTED.has(path.extname(e.name).toLowerCase())) out.push(f);
  }
}

function excerpt(docs: {name:string;text:string;bucket:Bucket}[], budget:number, priority:Bucket[]) {
  const primary = docs.filter(d => priority.includes(d.bucket));
  const secondary = docs.filter(d => !priority.includes(d.bucket));
  const primaryBudget = primary.length > 0 ? Math.floor(budget * 0.70) : 0;
  const secondaryBudget = budget - primaryBudget;
  const pri = primary.length > 0 ? Math.floor(primaryBudget / primary.length) : 0;
  const sec = secondary.length > 0 ? Math.max(400, Math.floor(secondaryBudget / secondary.length)) : 0;
  const parts: string[] = [];
  for (const d of primary)   parts.push(`=== FILE: ${d.name} (${d.bucket}) ===\n${d.text.substring(0, pri)}`);
  for (const d of secondary) parts.push(`=== FILE: ${d.name} (${d.bucket}) ===\n${d.text.substring(0, sec)}`);
  return parts.join("\n\n").substring(0, budget);
}

async function main() {
  const folder = process.argv[2];
  if (!folder) { console.error("Usage: npx tsx scripts/test-agents.ts <folder>"); process.exit(1); }
  try { await stat(folder); } catch { console.error(`Folder not found: ${folder}`); process.exit(1); }

  console.log(`\n📁 ${folder}\n`);
  const files: string[] = [];
  await walk(folder, files);

  const docs: {name:string;text:string;bucket:Bucket}[] = [];
  for (const f of files) {
    const buffer = await readFile(f);
    const r = await extractDocumentText(buffer, path.basename(f), {
      nvidiaApiKey: process.env.NVIDIA_API_KEY, pdfScale: 1.5,
    });
    const bucket = classify(path.basename(f));
    docs.push({ name: path.basename(f), text: r.text, bucket });
    console.log(`  ✓ ${path.basename(f)} [${bucket}] · ${r.method} · ${r.text.length.toLocaleString()} chars`);
  }

  console.log("\n──────── METADATA (Llama 70B) ────────");
  const metaCtx = excerpt(docs, BUDGET, ["om", "rent_roll"]);
  const metaRaw = await chat({
    prefer: "cloud",
    model: MODELS.STANDARD,
    max_tokens: 1024,
    messages: [
      { role: "system", content: "CRE analyst. Output ONLY raw JSON. Use 0 or empty string for unknowns." },
      { role: "user", content: `Extract metadata. Return JSON:
{"name":"","propertyType":"","assetType":"","address":"","city":"","state":"","units":0,"yearBuilt":0,"broker":"","brand":"","guidancePrice":0,"dealLead":""}

DOCUMENTS:\n${metaCtx}` },
    ],
  });
  const metaJson = safeParse<Record<string,unknown>>(metaRaw, {});
  console.log(JSON.stringify(metaJson, null, 2));

  console.log("\n──────── FINANCIAL (DeepSeek V3) ────────");
  const finCtx = excerpt(docs, 16000, ["financial", "om"]);
  const finRaw = await chat({
    prefer: "cloud",
    model: MODELS.REASONING,
    max_tokens: 2048,
    messages: [
      { role: "system", content: "CRE financial analyst. Pull real numbers from P&L tables. Output ONLY raw JSON. Never output 0 if the doc has the figure." },
      { role: "user", content: `Extract the hotel's financial performance from the P&L tables below.

CRITICAL:
- Read the TOTAL column at the right of P&L tables (period total).
- Hotels use EBITDA — treat it as NOI.
- TTM = the "Total" column in trailing-12-month reports. Put TTM in BOTH "ttm" and the matching fiscal year.
- Filenames "YE 2023" / "YE 2024" → y2023 / y2024.
- All numbers are integers, in dollars (strip "$", ",").
- DO NOT return 0 if the doc has the number.

Return JSON:
{"noi":<ttm NOI/EBITDA>,"capRate":<number>,"totalRevenue":<ttm revenue>,"financials":[{"metric":"Total Revenue","y2021":0,"y2022":0,"y2023":0,"ttm":0},{"metric":"Gross Operating Profit","y2021":0,"y2022":0,"y2023":0,"ttm":0},{"metric":"EBITDA","y2021":0,"y2022":0,"y2023":0,"ttm":0},{"metric":"NOI","y2021":0,"y2022":0,"y2023":0,"ttm":0}]}

DOCUMENTS:\n${finCtx}` },
    ],
  });
  const finJson = safeParse<Record<string,unknown>>(finRaw, {});
  console.log(JSON.stringify(finJson, null, 2));

  console.log("\n──────── UNIT MIX (Llama 70B) ────────");
  const umCtx = excerpt(docs, BUDGET, ["rent_roll", "om"]);
  const umRaw = await chat({
    prefer: "cloud",
    model: MODELS.STANDARD,
    max_tokens: 1536,
    messages: [
      { role: "system", content: "CRE analyst. Output ONLY raw JSON." },
      { role: "user", content: `Extract unit mix. Return JSON:
{"unitMix":[{"unitType":"","totalUnits":0,"vacantUnits":0,"avgRent":0}]}

For hotels use room type (King Standard, Queen Suite, King Suite). avgRent = avg nightly ADR.

DOCUMENTS:\n${umCtx}` },
    ],
  });
  const umJson = safeParse<Record<string,unknown>>(umRaw, {});
  console.log(JSON.stringify(umJson, null, 2));

  console.log();
}

main().catch(e => { console.error(e); process.exit(1); });
