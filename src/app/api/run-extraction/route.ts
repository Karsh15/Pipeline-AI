import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { chat, safeParse, MODELS } from "@/lib/llm";
import { extractDocumentText } from "@/lib/ocr/extract";

/**
 * Get document text — reads cached ocr_text from DB first (set at upload time).
 * Falls back to live OCR from Supabase Storage only if the cache is empty.
 */
async function getDocumentText(
  doc: { file_url: string; file_name: string; ocr_text?: string | null; ocr_method?: string | null; ocr_pages?: number | null }
): Promise<{ text: string; method: string; pages: number; confidence: number; cached: boolean }> {
  // Use cached OCR text if available
  if (doc.ocr_text) {
    return {
      text: doc.ocr_text,
      method: doc.ocr_method || "cached",
      pages: doc.ocr_pages || 0,
      confidence: 0,
      cached: true,
    };
  }

  // Cache miss — run OCR live and store result back to DB for next time
  const res = await fetch(doc.file_url);
  if (!res.ok) {
    console.error(`[extract] fetch failed ${res.status} for ${doc.file_name}`);
    return { text: "", method: "fetch-fail", pages: 0, confidence: 0, cached: false };
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  try {
    const result = await extractDocumentText(buffer, doc.file_name, {
      nvidiaApiKey: process.env.NVIDIA_API_KEY,
      pdfScale: 1.5,
    });
    // Back-fill the cache so future runs skip this
    const db = supabaseAdmin();
    await db.from("documents").update({
      ocr_text:   result.text,
      ocr_method: result.method,
      ocr_pages:  result.pages ?? 0,
    }).eq("file_url", doc.file_url);
    return {
      text: result.text,
      method: result.method,
      pages: result.pages,
      confidence: result.avgConfidence,
      cached: false,
    };
  } catch (err) {
    console.error(`[extract] OCR error for ${doc.file_name}:`, err);
    return { text: "", method: "error", pages: 0, confidence: 0, cached: false };
  }
}

// Classify a file into a semantic bucket using both folder name and filename.
// file_name is stored as the full relative path (e.g. "Financials/Dec2023.xlsx")
// so folder-level naming like "Agreements/", "STR/", "PIP/" is captured here.
type DocBucket = "om" | "financial" | "rent_roll" | "legal" | "capex" | "market" | "other";
function classifyDoc(fileName: string): DocBucket {
  const n = fileName.toLowerCase().replace(/[\\/]/g, " ");  // treat path separators as spaces

  // Folder-level signals (broad match — folder name alone is enough)
  if (/\bfinancials?\b/.test(n))                                               return "financial";
  if (/\bagreements?\b/.test(n))                                               return "legal";
  if (/\boffering[\s_-]*memorandum\b|\bom\b/.test(n))                         return "om";
  if (/\bpip\b/.test(n))                                                       return "capex";   // Property Improvement Plan
  if (/\bstr\b/.test(n))                                                       return "market";  // STR = comp / market data
  if (/\brent[\s_-]*roll\b/.test(n))                                           return "rent_roll";

  // Filename-level signals (more specific)
  if (/\b(memorandum|flyer|teaser|package|brochure)\b/.test(n))               return "om";
  if (/\b(rr|roll)\b/.test(n))                                                 return "rent_roll";
  if (/\b(t12|t-12|p&?l|pnl|profit|income|ebitda|operating|statement)\b/.test(n)) return "financial";
  if (/\b(lease|ground[\s_-]*lease|franchise|legal|contract|license)\b/.test(n))   return "legal";
  if (/\b(capex|cap[\s_-]*ex|capital|reserve|fffe|renovation|improvement)\b/.test(n)) return "capex";
  if (/\b(str|market|comp|demand|supply|stats?|report|survey)\b/.test(n))     return "market";

  return "other";
}

// Budget-aware excerpt builder — priority buckets get 90% of budget, excluded buckets are skipped entirely
function excerpt(
  docs: { name: string; text: string; bucket: DocBucket }[],
  budget: number,
  priority: DocBucket[] = [],
  exclude: DocBucket[] = [],
): string {
  if (!docs.length) return "";
  const filtered = exclude.length ? docs.filter(d => !exclude.includes(d.bucket)) : docs;
  if (!filtered.length) return "";

  const primary   = priority.length ? filtered.filter(d =>  priority.includes(d.bucket)) : filtered;
  const secondary = priority.length ? filtered.filter(d => !priority.includes(d.bucket)) : [];

  // Primary docs get 90% of budget; secondary get remaining 10% (just enough for context)
  const primaryBudget   = primary.length   > 0 ? Math.floor(budget * (secondary.length ? 0.90 : 1.0)) : 0;
  const secondaryBudget = budget - primaryBudget;
  const primaryPer      = primary.length   > 0 ? Math.floor(primaryBudget   / primary.length)   : 0;
  const secondaryPer    = secondary.length > 0 ? Math.max(300, Math.floor(secondaryBudget / secondary.length)) : 0;

  const parts: string[] = [];
  for (const d of primary)   parts.push(`=== FILE: ${d.name} (${d.bucket}) ===\n${d.text.substring(0, primaryPer)}`);
  for (const d of secondary) parts.push(`=== FILE: ${d.name} (${d.bucket}) ===\n${d.text.substring(0, secondaryPer)}`);
  return parts.join("\n\n").substring(0, budget);
}

function emit(controller: ReadableStreamDefaultController, enc: TextEncoder, data: object) {
  // Swallow errors from a closed controller — the client may have disconnected
  // mid-pipeline (browser refresh, network drop, etc.) but the agents keep running
  // so their DB writes still land. A crashed emit would abort the rest of the pipeline.
  try {
    controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== "ERR_INVALID_STATE") throw err;
  }
}

function stateCoords(state: string): { lat: number; lng: number } {
  const map: Record<string, [number, number]> = {
    AL:[32.8,-86.8],AK:[64.2,-153.4],AZ:[34.0,-111.9],AR:[34.8,-92.2],CA:[36.8,-119.4],
    CO:[39.1,-105.4],CT:[41.6,-72.7],DE:[39.0,-75.5],FL:[27.6,-81.5],GA:[32.2,-83.4],
    HI:[20.2,-156.3],ID:[44.2,-114.5],IL:[40.3,-89.0],IN:[40.3,-86.1],IA:[42.0,-93.2],
    KS:[38.5,-98.4],KY:[37.8,-84.9],LA:[31.2,-91.8],ME:[44.7,-69.4],MD:[39.1,-76.8],
    MA:[42.3,-71.8],MI:[44.3,-85.4],MN:[46.4,-93.1],MS:[32.7,-89.7],MO:[38.5,-92.3],
    MT:[47.0,-110.5],NE:[41.5,-99.9],NV:[38.5,-117.1],NH:[43.7,-71.6],NJ:[40.2,-74.7],
    NM:[34.8,-106.2],NY:[42.2,-74.9],NC:[35.6,-79.8],ND:[47.5,-100.5],OH:[40.4,-82.8],
    OK:[35.6,-96.9],OR:[44.6,-122.1],PA:[40.6,-77.2],RI:[41.7,-71.5],SC:[33.9,-80.9],
    SD:[44.4,-100.2],TN:[35.9,-86.7],TX:[31.5,-99.3],UT:[39.3,-111.1],VT:[44.1,-72.7],
    VA:[37.8,-78.2],WA:[47.4,-121.5],WV:[38.9,-80.4],WI:[44.3,-90.1],WY:[43.0,-107.6],
    DC:[38.9,-77.0],
  };
  const c = map[state?.toUpperCase()];
  if (c) return { lat: c[0] + (Math.random()-0.5)*0.4, lng: c[1] + (Math.random()-0.5)*0.4 };
  return { lat: 39.5, lng: -98.4 };
}

export async function POST(req: NextRequest) {
  const enc = new TextEncoder();
  const { dealId } = await req.json() as { dealId: string };
  const db = supabaseAdmin();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Ensure an extraction job row exists, mark it running
        const { data: existing } = await db.from("ai_jobs")
          .select("id").eq("deal_id", dealId).eq("job_type", "extraction").limit(1);
        if (existing?.length) {
          await db.from("ai_jobs").update({ status: "running" })
            .eq("id", existing[0].id);
        } else {
          await db.from("ai_jobs").insert({ deal_id: dealId, job_type: "extraction", status: "running" });
        }
        await db.from("deals").update({ status: "extraction" }).eq("id", dealId);

        emit(controller, enc, { type: "stage", stage: "extraction" });

        // Fetch documents — select cached OCR text columns too
        const { data: docs } = await db.from("documents")
          .select("id, deal_id, file_url, file_name, document_type, ocr_text, ocr_method, ocr_pages").eq("deal_id", dealId);

        if (!docs?.length) {
          emit(controller, enc, { type: "error", message: "No documents found for this deal" });
          controller.close(); return;
        }

        // Parse every doc and keep per-file text with classification
        const parsedDocs: { id: string; name: string; text: string; bucket: DocBucket }[] = [];
        for (const doc of docs) {
          const isCached = !!doc.ocr_text;
          emit(controller, enc, { type: "log", agent: "ocr", message: `${isCached ? "📦 cached" : "🔍 OCR"} ${doc.file_name}...` });
          const { text, method, pages, confidence, cached } = await getDocumentText(doc);
          const bucket = classifyDoc(doc.file_name);
          parsedDocs.push({ id: doc.id, name: doc.file_name, text, bucket });
          const confStr = confidence ? ` @ ${confidence.toFixed(0)}%` : "";
          const pagesStr = pages > 1 ? `, ${pages}p` : "";
          const cacheTag = cached ? " [cached]" : " [live OCR]";
          emit(controller, enc, {
            type: "log", agent: "ocr",
            message: `  ↳ ${bucket.toUpperCase()} · ${method}${pagesStr}${confStr} · ${text.length.toLocaleString()} chars${cacheTag}`,
          });
        }

        const totalChars = parsedDocs.reduce((s, d) => s + d.text.length, 0);
        emit(controller, enc, { type: "log", agent: "ocr", message: `✓ Extracted ${totalChars.toLocaleString()} chars across ${parsedDocs.length} docs` });

        // ─── STAGE 2: Per-file distillation ───────────────────────────────
        // When the deal has MANY files, summarize each into a compact "fact
        // sheet" so every doc gets seen. For small deals (<= 3 files) raw
        // text fits agents' budget fine — skip distillation.
        const SKIP_DISTILL_THRESHOLD = 3;
        const shouldDistill = parsedDocs.length > SKIP_DISTILL_THRESHOLD || totalChars > 40000;

        if (!shouldDistill) {
          emit(controller, enc, { type: "log", agent: "distill", message: `↷ Skipping distillation (${parsedDocs.length} file${parsedDocs.length!==1?"s":""}, small corpus) — agents will use raw text.` });
        }

        if (shouldDistill) emit(controller, enc, { type: "log", agent: "distill", message: `▶ Distilling ${parsedDocs.length} documents in parallel...` });

        const distillOne = async (d: { id: string; name: string; text: string; bucket: DocBucket }) => {
          if (d.text.length < 200) return { ...d, facts: d.text };  // tiny file — keep as-is
          // Chunk long text and summarize each chunk — keep chunks small so Groq 8B can handle them
          const CHUNK = 8000;
          // Cap total chunks per doc to avoid burning API quota on one huge file
          const MAX_CHUNKS = 6;
          const chunks: string[] = [];
          for (let i = 0; i < d.text.length && chunks.length < MAX_CHUNKS; i += CHUNK)
            chunks.push(d.text.substring(i, i + CHUNK));
          const summaries: string[] = [];
          for (const chunk of chunks) {
            try {
              const reply = await chat({
                agent: "distill",
                model: MODELS.LIGHT,
                max_tokens: 300,
                temperature: 0.0,
                messages: [
                  { role: "system", content: "Extract CRE facts only. Output bullet points (one per line): numbers, dates, names, percentages, dollar amounts. Reply NO_DATA if no relevant data." },
                  { role: "user", content: `File: ${d.name}\n---\n${chunk}` },
                ],
              });
              if (reply && !/^\s*NO_DATA\s*$/i.test(reply.trim())) summaries.push(reply.trim());
            } catch (err) {
              console.error(`[distill] failed for ${d.name}:`, err);
            }
          }
          return { ...d, facts: summaries.join("\n").substring(0, 3500) };
        };

        let distilled: (typeof parsedDocs[0] & { facts: string })[];
        if (shouldDistill) {
          distilled = [];
          const CONCURRENCY = 2;
          for (let i = 0; i < parsedDocs.length; i += CONCURRENCY) {
            const batch = parsedDocs.slice(i, i + CONCURRENCY);
            const results = await Promise.all(batch.map(distillOne));
            distilled.push(...results);
            emit(controller, enc, { type: "log", agent: "distill", message: `  ↳ ${Math.min(i + CONCURRENCY, parsedDocs.length)}/${parsedDocs.length} distilled` });
          }
          const distilledTotal = distilled.reduce((s, d) => s + d.facts.length, 0);
          emit(controller, enc, { type: "log", agent: "distill", message: `✓ Distilled ${parsedDocs.length} docs → ${distilledTotal.toLocaleString()} chars of facts (from ${totalChars.toLocaleString()} raw)` });
        } else {
          // Use raw text when corpus is small
          distilled = parsedDocs.map(d => ({ ...d, facts: d.text }));
        }

        // Upfront time estimate for the full pipeline
        const totalEta = 10 + 20 + 12 + 10 + 10 + 10 + 15;
        emit(controller, enc, { type: "log", agent: "ocr", message: `⏱ Estimated agents runtime: ~${totalEta}s (7 agents, sequential)` });

        // Agents now consume DISTILLED FACTS (for summary/questions/criteria/risks),
        // OR raw text (for metadata/financial/unit_mix which need numeric tables intact).
        const buildContext = (budget: number, priority: DocBucket[] = [], exclude: DocBucket[] = []) =>
          excerpt(distilled.map(d => ({ name: d.name, text: d.facts, bucket: d.bucket })), budget, priority, exclude);

        const buildRawContext = (budget: number, priority: DocBucket[] = [], exclude: DocBucket[] = []) =>
          excerpt(parsedDocs, budget, priority, exclude);

        // Helper: run one agent in isolation with full debug — failure never blocks the next agent
        // Agents 1+2 run sequentially (financial data feeds criteria).
        // Agents 3-6 (summary, questions, criteria, risks) run in parallel — each uses its own key.
        const BUDGET = 5000; // per-agent input chars — reduced to cut token usage
        const ESTIMATES: Record<string, number> = {
          metadata:  12, financial: 20, unit_mix: 12,
          summary:   12, questions:  8, criteria: 10, risks: 12,
        };

        const runAgent = async (name: string, fn: () => Promise<{ ok?: boolean; rawPreview?: string; summary?: string }>) => {
          const eta = ESTIMATES[name] ?? 10;
          emit(controller, enc, { type: "agent_start", agent: name, etaSeconds: eta });
          emit(controller, enc, { type: "log", agent: name, message: `▶ ${name} · est. ~${eta}s` });
          const t0 = Date.now();
          try {
            const result = await fn();
            const dt = (Date.now() - t0) / 1000;
            const variance = dt - eta;
            const vStr = variance >= 0 ? `+${variance.toFixed(1)}s` : `${variance.toFixed(1)}s`;
            if (result?.summary) emit(controller, enc, { type: "log", agent: name, message: `✓ ${result.summary} · ${dt.toFixed(1)}s (${vStr})` });
            else                 emit(controller, enc, { type: "log", agent: name, message: `✓ ${name} done · ${dt.toFixed(1)}s (${vStr})` });
            emit(controller, enc, { type: "agent_done", agent: name, durationSeconds: dt });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const dt = ((Date.now() - t0) / 1000).toFixed(1);
            console.error(`[run-extraction] agent '${name}' failed:`, err);
            emit(controller, enc, { type: "log", agent: name, message: `⚠ ${name} FAILED after ${dt}s: ${msg.substring(0, 200)}` });
            emit(controller, enc, { type: "agent_done", agent: name });
          }
        };

        // Log LLM reply preview + emit full JSON as agent_result so UI can render it
        const debugReply = (agent: string, raw: string) => {
          const preview = raw.substring(0, 180).replace(/\s+/g, " ");
          emit(controller, enc, { type: "log", agent, message: `  ↳ llm: ${preview}${raw.length > 180 ? "…" : ""}` });
          try {
            const parsed = JSON.parse(safeParseHelper(raw));
            emit(controller, enc, { type: "agent_result", agent, json: parsed });
          } catch {
            emit(controller, enc, { type: "agent_result", agent, raw: raw.substring(0, 4000) });
          }
        };
        // Inline helper so we don't circular-import safeParse just for cleanJson
        function safeParseHelper(s: string) {
          if (!s) return "{}";
          let x = s.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
          const start = Math.min(
            ...["{", "["].map(ch => { const i = x.indexOf(ch); return i === -1 ? Infinity : i; })
          );
          if (!Number.isFinite(start)) return "{}";
          x = x.slice(start);
          let depth = 0, inStr = false, esc = false, end = -1;
          const open = x[0], close = open === "{" ? "}" : "]";
          for (let i = 0; i < x.length; i++) {
            const c = x[i];
            if (esc) { esc = false; continue; }
            if (c === "\\") { esc = true; continue; }
            if (c === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (c === open)  depth++;
            if (c === close) { depth--; if (depth === 0) { end = i; break; } }
          }
          return end >= 0 ? x.slice(0, end + 1) : x;
        }

        // ── Agent 1: Metadata (uses cloud 70B model — high quality required) ──
        await runAgent("metadata", async () => {
          emit(controller, enc, { type: "log", agent: "metadata", message: "Extracting property metadata (cloud 70B model)..." });
          // Use raw text — metadata values (address, units, price) are in document headers
          // metadata: needs OM/market/rent_roll headers — exclude raw P&L tables and legal docs
          const ctx = buildRawContext(14000, ["om", "market", "rent_roll"], ["financial", "legal", "capex"]);
          emit(controller, enc, { type: "log", agent: "metadata", message: `  ↳ context: ${ctx.length.toLocaleString()} chars (raw)` });

          const raw = await chat({
            agent: "metadata",
            model: MODELS.STANDARD,
            max_tokens: 1024,
            temperature: 0.1,
            messages: [{
              role: "system",
              content: "You are a CRE analyst. Extract metadata from the OM and related docs. Output ONLY a raw JSON object. No preamble, no markdown. Never guess — if a field is genuinely missing, use 0 or empty string.",
            }, {
              role: "user",
              content: `Find these fields in the documents below and return JSON:
{"name":"","propertyType":"","assetType":"","address":"","city":"","state":"","units":0,"yearBuilt":0,"renovationYear":0,"broker":"","brokerPhone":"","brokerEmail":"","brokerWebsite":"","brand":"","guidancePrice":0,"dealLead":"","floors":0,"parkingSpaces":0,"lotSizeAcres":0,"occupancyRate":0,"constructionType":"","zoning":"","marketName":"","submarket":"","loanAmount":0,"loanType":"","interestRate":0,"loanMaturity":"","managementCompany":"","franchiseExpiry":"","amenitiesSummary":""}

EXTRACTION RULES:
- "name": full property title (e.g. "Fairfield by Marriott Inn & Suites Omaha Downtown").
- "propertyType": Hotel, Multifamily, Office, Retail, Industrial.
- "assetType": Hospitality, Residential, Commercial, Industrial.
- "address": ONLY the street (e.g. "1501 Nicholas St"). Do NOT include city/state.
- "city": just city name. Strip leading hotel words like "Suites", "Inn", "Hotel".
- "state": 2-letter USPS code (e.g. "NE").
- "units": hotel rooms/keys or apartment units as integer.
- "yearBuilt": 4-digit year of original construction.
- "renovationYear": most recent renovation/PIP completion year. 0 if not found.
- "broker": brokerage firm only (CBRE, JLL, Marcus & Millichap, Newmark, HFF, Eastdil, etc).
- "brokerPhone": broker contact phone number (e.g. "+1 402-555-1234"). Empty if not found.
- "brokerEmail": broker contact email address. Empty if not found.
- "brokerWebsite": broker firm website (e.g. "cbre.com"). Empty if not found.
- "brand": hotel flag (Marriott, Hilton, IHG, Hyatt, Choice, Wyndham, etc). Empty for non-hotel.
- "dealLead": named broker/contact person (e.g. "Adam A. Lewis"). NOT the firm.
- "guidancePrice": asking price in dollars as integer. If unpriced use 0.
- "floors": number of building floors/stories as integer. 0 if not found.
- "parkingSpaces": total parking spaces as integer. 0 if not found.
- "lotSizeAcres": land/site area in acres as decimal (e.g. 3.5). 0 if not found.
- "occupancyRate": current occupancy as percentage 0-100 (e.g. 87.5). 0 if not found.
- "constructionType": building construction type (e.g. "Concrete", "Wood Frame", "Steel", "Masonry"). Empty if not found.
- "zoning": zoning classification (e.g. "C-2", "R-3", "MU-1"). Empty if not found.
- "marketName": primary market name (e.g. "Nashville", "Dallas-Fort Worth"). Empty if not found.
- "submarket": submarket or neighborhood (e.g. "Downtown", "Midtown", "Airport"). Empty if not found.
- "loanAmount": existing loan/debt amount in dollars as integer. 0 if not found.
- "loanType": loan type (e.g. "CMBS", "Bridge", "Conventional", "SBA"). Empty if not found.
- "interestRate": existing loan interest rate as decimal (e.g. 5.25). 0 if not found.
- "loanMaturity": loan maturity date or year (e.g. "2027" or "March 2027"). Empty if not found.
- "managementCompany": property/hotel management company name. Empty if not found.
- "franchiseExpiry": franchise/flag agreement expiry date or year. Empty if not found.
- "amenitiesSummary": comma-separated list of key amenities (e.g. "Pool, Fitness Center, Restaurant, Meeting Rooms"). Empty if not found.

DOCUMENTS:
${ctx}`,
            }],
          });
          debugReply("metadata", raw);
          const metaJson = safeParse<Record<string, unknown>>(raw, {});

          // Regex fallbacks for commonly missed fields — scan FULL raw text
          const allText = parsedDocs.map(d => d.text).join(" ");

          if (!metaJson.city || !metaJson.state) {
            const m = allText.substring(0, 20000).match(/([A-Z][a-zA-Z][a-zA-Z\s-]{1,25}),\s*([A-Z]{2})\s+\d{5}\b/);
            if (m) {
              if (!metaJson.city)  metaJson.city  = m[1].trim();
              if (!metaJson.state) metaJson.state = m[2];
            }
          }
          if (!metaJson.guidancePrice) {
            const scan = allText.substring(0, 40000);
            // Pattern 1: "Guidance Price: $42,500,000" or "Asking Price: $42.5M"
            const m1 = scan.match(/(?:guidance|asking|offering|purchase|list|sale)\s*price[:\s–-]*\$?\s*([\d,]+(?:\.\d+)?)\s*(M|MM|million|B|K)?/i);
            // Pattern 2: standalone "$42,500,000" or "$42.5 million" near price keywords
            const m2 = scan.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(M|MM|million|B|K)\b/i);
            for (const m of [m1, m2]) {
              if (!m) continue;
              let n = parseFloat(m[1].replace(/,/g, ""));
              const suffix = (m[2] || "").toUpperCase();
              if (suffix === "B") n *= 1_000_000_000;
              else if (/M|MM|MILLION/.test(suffix)) n *= 1_000_000;
              else if (suffix === "K") n *= 1_000;
              if (n > 100_000) { metaJson.guidancePrice = Math.round(n); break; }
            }
          }
          if (!metaJson.units) {
            // "113 Rooms" / "113 guest rooms" / "113 keys" — avoid matching "2021 Rooms" (year) or "12 rooms" (tiny)
            const matches = [...allText.matchAll(/\b(\d{2,4})\s*(?:-\s*)?(?:keys?|rooms?|guest\s*rooms?|units?)\b/gi)];
            for (const m of matches) {
              const n = parseInt(m[1], 10);
              // Hotel rooms typically 40-2000; skip year-like numbers (1900-2100)
              if (n >= 40 && n <= 2000 && !(n >= 1900 && n <= 2100)) {
                metaJson.units = n;
                break;
              }
            }
          }
          if (!metaJson.yearBuilt) {
            const m = allText.match(/(?:built|constructed|opened|year\s+built|construction|renovated)[^\n]{0,30}?(19\d{2}|20[0-2]\d)\b/i);
            if (m) {
              const y = parseInt(m[1], 10);
              if (y >= 1900 && y <= new Date().getFullYear()) metaJson.yearBuilt = y;
            }
          }
          // Clean leaked hotel-name tokens from city
          if (typeof metaJson.city === "string") {
            metaJson.city = metaJson.city
              .replace(/^(?:Inn|Suites?|Hotel|Resort|Marriott|Hilton|Hyatt|Holiday|Residence|Fairfield|Hampton|Courtyard|Downtown|Airport)\s+/i, "")
              .trim();
          }

          const coords = stateCoords(metaJson.state as string || "");
          const n = (k: string) => ((metaJson[k] as number) > 0 ? metaJson[k] as number : undefined);
          const s = (k: string) => (metaJson[k] as string) || undefined;
          await db.from("deals").update({
            name:               s("name"),
            address:            s("address"),
            city:               s("city"),
            state:              s("state"),
            asset_type:         s("assetType"),
            property_type:      s("propertyType"),
            broker:             s("broker"),
            broker_phone:       s("brokerPhone"),
            broker_email:       s("brokerEmail"),
            broker_website:     s("brokerWebsite"),
            brand:              s("brand"),
            deal_lead:          s("dealLead"),
            guidance_price:     n("guidancePrice"),
            units:              n("units"),
            year_built:         n("yearBuilt"),
            renovation_year:    n("renovationYear"),
            floors:             n("floors"),
            parking_spaces:     n("parkingSpaces"),
            lot_size_acres:     n("lotSizeAcres"),
            occupancy_rate:     n("occupancyRate"),
            construction_type:  s("constructionType"),
            zoning:             s("zoning"),
            market_name:        s("marketName"),
            submarket:          s("submarket"),
            loan_amount:        n("loanAmount"),
            loan_type:          s("loanType"),
            interest_rate:      n("interestRate"),
            loan_maturity:      s("loanMaturity"),
            management_company: s("managementCompany"),
            franchise_expiry:   s("franchiseExpiry"),
            amenities_summary:  s("amenitiesSummary"),
            lat: coords.lat, lng: coords.lng,
          }).eq("id", dealId);

          const metaFields = ["name","address","city","state","assetType","propertyType","broker","brokerPhone","brokerEmail","brokerWebsite","brand","guidancePrice","units","yearBuilt","renovationYear","dealLead","floors","parkingSpaces","lotSizeAcres","occupancyRate","constructionType","zoning","marketName","submarket","loanAmount","loanType","interestRate","loanMaturity","managementCompany","franchiseExpiry","amenitiesSummary"];
          const metaInserts = metaFields
            .filter(f => metaJson[f])
            .map(f => ({ deal_id: dealId, field_name: f, value: String(metaJson[f]), confidence_score: 0.92, source_document_id: parsedDocs[0]?.id }));
          await db.from("extracted_data").delete().eq("deal_id", dealId).in("field_name", metaFields);
          if (metaInserts.length) await db.from("extracted_data").insert(metaInserts);

          return { summary: `${metaJson.name || "(no name)"} · ${metaJson.city || "?"}, ${metaJson.state || "?"} · ${metaInserts.length}/${metaFields.length} fields · $${((metaJson.guidancePrice as number)||0).toLocaleString()}` };
        });

        // ── Agent 2: Financials ───────────────────────────────────────────
        await runAgent("financial", async () => {
          emit(controller, enc, { type: "log", agent: "financial", message: "Parsing T-12 financial statements..." });

          // All financial text — used for both regex and LLM fallback
          const allText = parsedDocs
            .filter(d => d.bucket === "financial" || d.bucket === "om")
            .map(d => d.text).join("\n");

          // ─────────────────────────────────────────────────────────────────
          // PHASE 1: Pure regex extraction — zero LLM tokens
          // Handles the T-12 Summary page which has clean "Label ... Total" rows.
          // Also detects rolling month columns (e.g. 08-2024…07-2025).
          // ─────────────────────────────────────────────────────────────────

          // Detect rolling month header (MM-YYYY format repeated 12 times)
          const rollingMonths: string[] = [];
          for (const line of allText.split("\n")) {
            const hits = [...line.matchAll(/\b(\d{2}-20\d{2})\b/g)].map(m => m[1]);
            if (hits.length >= 12) { rollingMonths.push(...hits.slice(0, 12)); break; }
          }
          // Standard calendar month → m1..m12 mapping (fallback)
          const calMap: Record<string,number> = {
            jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12
          };

          // Parse a money string like "2,676,473.78" or "-329,950.69" → integer
          const parseMoney = (s: string): number => {
            const v = parseFloat(s.replace(/,/g, ""));
            return isNaN(v) ? 0 : Math.round(v);
          };

          // Parse a data row from the T-12 text.
          // Lines look like:  "Total Operating Revenue  250447  203712  242966 ... 2676473"
          // or tab-separated:  "Gross Operating Profit\t54513\t37418\t...\t627540"
          // Returns { ttm, m1..m12 } where columns align with rollingMonths order.
          const parseDataLine = (line: string): Record<string, number> | null => {
            // Split on 2+ spaces or tabs, filter to numeric tokens
            const parts = line.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
            // Need at least label + 1 number
            const nums = parts.slice(1).map(p => ({ raw: p, v: parseMoney(p) }))
              .filter(x => /^-?[\d,]+\.?\d*$/.test(x.raw));
            if (nums.length === 0) return null;
            const result: Record<string, number> = {};
            // Last number is always the Total/TTM column
            result.ttm = nums[nums.length - 1].v;
            // If we have 12 or 13 numbers, the first 12 are monthly
            const monthNums = nums.length >= 12 ? nums.slice(0, 12) : nums.slice(0, nums.length - 1);
            monthNums.forEach((n, i) => { result[`m${i + 1}`] = n.v; });
            return result;
          };

          type FinRow = {metric:string; category?:string; y2021?:number; y2022?:number; y2023?:number; y2024?:number; y2025?:number; ttm?:number; m1?:number; m2?:number; m3?:number; m4?:number; m5?:number; m6?:number; m7?:number; m8?:number; m9?:number; m10?:number; m11?:number; m12?:number};

          // Label → {metric, category} map for every line we want to capture
          const LABEL_MAP: Record<string, { metric: string; category: "income"|"expense" }> = {
            // Revenue
            "total room revenue":                { metric: "Total Room Revenue",               category: "income"  },
            "total transient revenue":           { metric: "Total Transient Revenue",          category: "income"  },
            "total group revenue":               { metric: "Total Group Revenue",              category: "income"  },
            "other operated departments":        { metric: "Other Operated Departments",       category: "income"  },
            "miscellaneous income":              { metric: "Miscellaneous Income",             category: "income"  },
            "total operating revenue":           { metric: "Total Revenue",                    category: "income"  },
            "total revenue":                     { metric: "Total Revenue",                    category: "income"  },
            // Dept expenses
            "room payroll":                      { metric: "Room Payroll",                     category: "expense" },
            "total rooms salaries & wages":      { metric: "Room Payroll",                     category: "expense" },
            "rooms expenses":                    { metric: "Rooms Expenses",                   category: "expense" },
            "total rooms other expenses":        { metric: "Rooms Expenses",                   category: "expense" },
            "total rooms expenses":              { metric: "Total Rooms Expenses",             category: "expense" },
            "other operated depts expenses":     { metric: "Other Operated Depts Expenses",    category: "expense" },
            "total departmental expenses":       { metric: "Total Departmental Expenses",      category: "expense" },
            "total departmental income":         { metric: "Total Departmental Income",        category: "income"  },
            "rooms dept profit (loss)":          { metric: "Rooms Dept Profit",                category: "income"  },
            "rooms dept profit":                 { metric: "Rooms Dept Profit",                category: "income"  },
            // Undistributed
            "administration & general":          { metric: "Administration & General",         category: "expense" },
            "information & telecom systems":     { metric: "Information & Telecom",            category: "expense" },
            "information & telecom":             { metric: "Information & Telecom",            category: "expense" },
            "sales & marketing":                 { metric: "Sales & Marketing",                category: "expense" },
            "property operations & maintenance": { metric: "Property Operations & Maintenance",category: "expense" },
            "utilities":                         { metric: "Utilities",                        category: "expense" },
            "total undistributed expenses":      { metric: "Total Undistributed Expenses",     category: "expense" },
            "total expense":                     { metric: "Total Expenses",                   category: "expense" },
            "total expenses":                    { metric: "Total Expenses",                   category: "expense" },
            // Profit lines
            "gross operating profit":            { metric: "Gross Operating Profit",           category: "income"  },
            "management fees":                   { metric: "Management Fees",                  category: "expense" },
            "income before non-oper expenses":   { metric: "Income Before Non-Oper",           category: "income"  },
            "income before non-operating":       { metric: "Income Before Non-Oper",           category: "income"  },
            // Non-operating
            "total non-operating expenses":      { metric: "Total Non-Operating Expenses",     category: "expense" },
            "depreciation & amortization":       { metric: "Depreciation & Amortization",      category: "expense" },
            "depreciation and amortization":     { metric: "Depreciation & Amortization",      category: "expense" },
            "interest":                          { metric: "Interest",                         category: "expense" },
            "ebitda":                            { metric: "EBITDA",                           category: "income"  },
            "net income":                        { metric: "Net Income",                       category: "income"  },
            // MF lines
            "gross potential rent":              { metric: "Gross Potential Rent",             category: "income"  },
            "vacancy & concessions":             { metric: "Vacancy & Concessions",            category: "expense" },
            "bad debt":                          { metric: "Bad Debt",                         category: "expense" },
            "other income":                      { metric: "Other Income",                     category: "income"  },
            "effective gross income":            { metric: "Effective Gross Income",           category: "income"  },
            "net operating income":              { metric: "Net Operating Income",             category: "income"  },
            "total operating expenses":          { metric: "Total Operating Expenses",         category: "expense" },
          };

          const regexRows: FinRow[] = [];
          const seen = new Set<string>();

          for (const line of allText.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            // Normalize label: lowercase, collapse spaces
            const labelRaw = trimmed.split(/\s{2,}|\t/)[0].trim().toLowerCase().replace(/\s+/g, " ");
            const mapped = LABEL_MAP[labelRaw];
            if (!mapped) continue;
            if (seen.has(mapped.metric)) continue; // take first occurrence only
            const nums = parseDataLine(trimmed);
            if (!nums || !nums.ttm) continue;
            seen.add(mapped.metric);
            regexRows.push({ metric: mapped.metric, category: mapped.category, ...nums });
          }

          // KPI rows: Occupancy, ADR, RevPAR, Rooms Available, Rooms Sold
          const parseKpiLine = (pattern: RegExp): number => {
            const m = allText.match(pattern);
            return m ? parseFloat(m[1].replace(/,/g,"")) || 0 : 0;
          };
          const kpiOccupancy = parseKpiLine(/%Occupancy%[^\n]*?([\d.]+)\s*$/m) ||
                               parseKpiLine(/\bOccupancy\b[^\n]*?([\d.]+)%/i);
          const kpiADR       = parseKpiLine(/\bADR\b[^\n]*?([\d,]+\.?\d*)\s*$/m);
          const kpiRevPAR    = parseKpiLine(/\bRevPAR\b[^\n]*?([\d,]+\.?\d*)\s*$/m);
          const kpiRevenue   = parseKpiLine(/Total Operating Revenue[^\n]*?([\d,]+\.?\d*)\s*$/m) ||
                               parseKpiLine(/Total Revenue[^\n]*?([\d,]+\.?\d*)\s*$/m);
          const kpiGOP       = parseKpiLine(/Gross Operating Profit[^\n]*?([-\d,]+\.?\d*)\s*$/m);
          const kpiEBITDA    = parseKpiLine(/\bEBITDA\b[^\n]*?([-\d,]+\.?\d*)\s*$/m);
          const kpiNetIncome = parseKpiLine(/Net Income[^\n]*?([-\d,]+\.?\d*)\s*$/m);
          const kpiCapRate   = parseKpiLine(/\bcap\s*rate\b[^\n]*?([\d.]+)%/i) ||
                               parseKpiLine(/going[\s-]*in\s*cap[^\n]*?([\d.]+)%/i);

          emit(controller, enc, { type: "log", agent: "financial",
            message: `  ↳ regex: ${regexRows.length} rows · occ=${kpiOccupancy}% ADR=$${kpiADR} RevPAR=$${kpiRevPAR} Rev=$${kpiRevenue?.toLocaleString()} GOP=$${kpiGOP?.toLocaleString()} EBITDA=$${kpiEBITDA?.toLocaleString()}` });

          // ─────────────────────────────────────────────────────────────────
          // PHASE 2: LLM fallback — only if regex found too few rows
          // Uses a tiny 4000-char context slice, max_tokens 800.
          // ─────────────────────────────────────────────────────────────────
          let llmRows: FinRow[] = [];
          if (regexRows.length < 8) {
            emit(controller, enc, { type: "log", agent: "financial", message: `  ↳ regex underperformed (${regexRows.length} rows) — running LLM fallback...` });
            const ctxSlice = allText.slice(0, 4000);
            const monthNote = rollingMonths.length === 12
              ? `Months in order: ${rollingMonths.join(", ")} → m1…m12.`
              : "Months: Jan→m1 … Dec→m12.";
            try {
              const raw = await chat({
                agent: "financial", model: MODELS.STANDARD, max_tokens: 900, temperature: 0.0,
                messages: [{
                  role: "system",
                  content: `Extract hotel P&L rows. Raw JSON only. Integers only. Omit zero fields. ${monthNote} Last column=ttm. category: income or expense.`,
                }, {
                  role: "user",
                  content: `Return: {"financials":[{"metric":"","category":"income","ttm":0,"m1":0}]}\nDOCUMENTS:\n${ctxSlice}`,
                }],
              });
              debugReply("financial", raw);
              const parsed = safeParse<{ financials?: FinRow[] }>(raw, {});
              llmRows = parsed.financials || [];
            } catch (err) {
              console.error("[financial] LLM fallback failed:", err);
            }
          }

          // Merge: regex rows take precedence; LLM fills any gaps
          const mergedMap = new Map<string, FinRow>();
          for (const r of [...regexRows, ...llmRows]) {
            const key = r.metric.toLowerCase();
            if (!mergedMap.has(key)) mergedMap.set(key, r);
          }

          // Inject regex KPIs as guarantee rows
          const ensureRow = (metric: string, category: "income"|"expense", ttm: number) => {
            if (!ttm) return;
            const key = metric.toLowerCase();
            if (!mergedMap.has(key)) mergedMap.set(key, { metric, category, ttm: Math.round(ttm) });
          };
          ensureRow("Total Revenue",         "income",  kpiRevenue);
          ensureRow("Gross Operating Profit","income",  kpiGOP);
          ensureRow("EBITDA",                "income",  kpiEBITDA);
          if (kpiNetIncome !== 0) ensureRow("Net Income", "income", kpiNetIncome);

          const finJson = {
            noi:          kpiGOP || kpiEBITDA || 0,
            capRate:      kpiCapRate,
            totalRevenue: kpiRevenue,
            occupancy:    kpiOccupancy,
            adr:          kpiADR,
            revpar:       kpiRevPAR,
            financials:   Array.from(mergedMap.values()),
          };

          // ── Derive missing financial metrics using CRE formulas ────────────
          if (finJson.financials?.length) {
            const fin = finJson.financials;
            const find = (names: string[]) => fin.find(r => names.some(n => r.metric.toLowerCase().includes(n.toLowerCase())));
            const PERIOD_KEYS = ["y2021","y2022","y2023","y2024","y2025","ttm","m1","m2","m3","m4","m5","m6","m7","m8","m9","m10","m11","m12"] as const;
            type PK = typeof PERIOD_KEYS[number];
            const get = (r: FinRow | undefined, k: PK): number => (r ? (r[k] as number) || 0 : 0);

            const rowGPR      = find(["Gross Potential Rent","GPR"]);
            const rowVac      = find(["Vacancy","Concession"]);
            const rowBadDebt  = find(["Bad Debt"]);
            const rowOther    = find(["Other Income"]);
            const rowEGI      = find(["Effective Gross Income","EGI"]);
            const rowOpEx     = find(["Total Operating Expenses","Total OpEx","Total Expenses"]);
            const rowNOI      = find(["Net Operating Income","NOI","EBITDA"]);

            // Fill EGI = GPR - Vacancy - BadDebt + OtherIncome
            if (rowEGI && rowGPR) {
              for (const k of PERIOD_KEYS) {
                if (!get(rowEGI, k) && get(rowGPR, k)) {
                  (rowEGI as unknown as Record<string,number>)[k] = Math.round(
                    get(rowGPR, k) - get(rowVac, k) - get(rowBadDebt, k) + get(rowOther, k)
                  );
                }
              }
            }
            // Fill NOI = EGI - Total OpEx
            if (rowNOI && rowEGI && rowOpEx) {
              for (const k of PERIOD_KEYS) {
                if (!get(rowNOI, k) && get(rowEGI, k)) {
                  (rowNOI as unknown as Record<string,number>)[k] = Math.round(get(rowEGI, k) - get(rowOpEx, k));
                }
              }
            }
            // Fill TTM from month sum if months exist but TTM is 0
            for (const r of fin) {
              if (!r.ttm) {
                const monthSum = (["m1","m2","m3","m4","m5","m6","m7","m8","m9","m10","m11","m12"] as PK[])
                  .reduce((s, k) => s + get(r, k), 0);
                if (monthSum > 0) (r as unknown as Record<string,number>).ttm = Math.round(monthSum);
              }
            }
            // Backfill NOI + cap rate on deal if still missing
            const noiTTM = get(rowNOI, "ttm");
            if (noiTTM > 0 && !finJson.noi) finJson.noi = noiTTM;
          }

          // Persist top-level metrics on the deal (after formula derivation)
          const dealUpdate2: Record<string, number> = {};
          if (finJson.noi)     dealUpdate2.noi     = finJson.noi;
          if (finJson.capRate) dealUpdate2.cap_rate = finJson.capRate;
          // Derive cap rate if we have both NOI and guidance price
          if (!finJson.capRate && finJson.noi) {
            const { data: dealRow } = await db.from("deals").select("guidance_price").eq("id", dealId).single();
            const gp = (dealRow as { guidance_price?: number } | null)?.guidance_price;
            if (gp && gp > 0) {
              const derivedCap = parseFloat(((finJson.noi / gp) * 100).toFixed(2));
              dealUpdate2.cap_rate = derivedCap;
            }
          }
          if (Object.keys(dealUpdate2).length) {
            await db.from("deals").update(dealUpdate2).eq("id", dealId);
          }

          // Insert year-by-year financial rows
          if (finJson.financials?.length) {
            // Compute per_unit and pct_egi for every row using TTM values
            const { data: dealInfo } = await db.from("deals").select("units").eq("id", dealId).single();
            const totalUnits = (dealInfo as { units?: number } | null)?.units || 0;
            const find2 = (names: string[]) => finJson.financials!.find(r => names.some(n => r.metric.toLowerCase().includes(n.toLowerCase())));
            const egiRow = find2(["Effective Gross Income","EGI","Total Revenue","Total Operating Revenue"]);
            const egiTTM = egiRow ? (egiRow.ttm || 0) : (kpiRevenue || 0);

            const rows = finJson.financials
              .filter(r => {
                if (!r.metric) return false;
                // Accept if ANY numeric field has a non-zero value — don't hardcode year list
                // because docs may contain y2019, y2020, etc. that aren't in our schema's
                // known year columns (those values get folded into ttm below).
                return Object.entries(r).some(([k, v]) =>
                  k !== "metric" && k !== "category" && typeof v === "number" && v !== 0
                );
              })
              .map(r => {
                // Fallback TTM: sum m1..m12 if no TTM was given (common with partial-year docs).
                // Then fall back to the most recent year column that's populated.
                const monthlySum = [r.m1,r.m2,r.m3,r.m4,r.m5,r.m6,r.m7,r.m8,r.m9,r.m10,r.m11,r.m12]
                  .reduce((s: number, v) => s + (v || 0), 0);
                const latestYear = r.y2025 || r.y2024 || r.y2023 || r.y2022 || r.y2021
                  || (r as unknown as { y2020?: number; y2019?: number }).y2020
                  || (r as unknown as { y2019?: number }).y2019 || 0;
                const ttmVal = r.ttm || monthlySum || latestYear || 0;
                const perUnit = totalUnits > 0 && ttmVal !== 0 ? Math.round(ttmVal / totalUnits) : 0;
                const pctEgi  = egiTTM > 0 && ttmVal !== 0 ? parseFloat(((ttmVal / egiTTM) * 100).toFixed(1)) : 0;
                return {
                  deal_id: dealId,
                  category: (r.category === "expense" ? "expense" : "income") as "income" | "expense",
                  sub_category: r.metric,
                  y2021: r.y2021 || 0, y2022: r.y2022 || 0, y2023: r.y2023 || 0,
                  y2024: r.y2024 || 0, y2025: r.y2025 || 0, ttm: ttmVal,
                  m1: r.m1||0, m2: r.m2||0, m3: r.m3||0, m4: r.m4||0,
                  m5: r.m5||0, m6: r.m6||0, m7: r.m7||0, m8: r.m8||0,
                  m9: r.m9||0, m10: r.m10||0, m11: r.m11||0, m12: r.m12||0,
                  per_unit: perUnit,
                  pct_egi:  pctEgi,
                };
              });
            await db.from("financials").delete().eq("deal_id", dealId);
            if (rows.length) await db.from("financials").insert(rows);
          }

          // Save KPIs (occupancy, ADR, RevPAR) as extracted_data rows for Why panel
          const kpiRows: { deal_id: string; field_name: string; value: string; confidence_score: number; source_document_id: string | null }[] = [];
          if (finJson.occupancy) kpiRows.push({ deal_id: dealId, field_name: "occupancy", value: String(finJson.occupancy), confidence_score: 0.9, source_document_id: parsedDocs[0]?.id ?? null });
          if (finJson.adr)       kpiRows.push({ deal_id: dealId, field_name: "adr",       value: String(finJson.adr),       confidence_score: 0.9, source_document_id: parsedDocs[0]?.id ?? null });
          if (finJson.revpar)    kpiRows.push({ deal_id: dealId, field_name: "revpar",    value: String(finJson.revpar),    confidence_score: 0.9, source_document_id: parsedDocs[0]?.id ?? null });
          if (kpiRows.length) {
            await db.from("extracted_data").delete().eq("deal_id", dealId).in("field_name", ["occupancy", "adr", "revpar"]);
            await db.from("extracted_data").insert(kpiRows);
          }

          return { summary: `NOI $${(finJson.noi||0).toLocaleString()} · Cap ${finJson.capRate||0}% · Rev $${(finJson.totalRevenue||0).toLocaleString()} · Occ ${finJson.occupancy||0}% · ADR $${finJson.adr||0} · ${finJson.financials?.length||0} line items` };
        });

        // ── Agent 2b: Unit Mix ────────────────────────────────────────────
        await runAgent("unit_mix", async () => {
          const umText = parsedDocs
            .filter(d => d.bucket === "rent_roll" || d.bucket === "om")
            .map(d => d.text).join("\n");

          // ── Phase 1: regex — parse structured unit mix / room type tables ──
          // Hotel format:  "King Standard   45   3   215.00   240.00"
          //                 type           tot  vac  rate    market
          // MF format:     "1 BR / 1 BA    24   2   750   1400"
          //                 type           tot  vac  sqft  rent

          type UMRegex = {
            unitType: string; totalUnits: number; vacantUnits: number;
            avgSqft: number; avgBaseRent: number; avgTotalRent: number;
            marketRent: number; avgUtilities: number; latestLeaseUp: string;
          };

          const regexRows: UMRegex[] = [];
          const seenTypes = new Set<string>();

          // Hotel room-type patterns: label followed by numbers
          // Matches lines like: "King Standard  45  3  215.00  240.00  ..."
          const hotelTypePattern = /^((?:king|queen|double|twin|suite|studio|ada|accessible|deluxe|premium|standard|junior|penthouse|loft|family|connecting|roll-in|mobility)[^\t\n]{0,40?})\s{2,}(\d+)\s+(\d+)\s+([\d.]+)/im;
          // MF patterns: "1 BR" / "Studio" / "2 Bed" etc
          const mfTypePattern = /^(studio|efficiency|\d+\s*(?:br|bed|bedroom|ba|bath)[^\t\n]{0,30}|commercial|retail|office)\s{2,}(\d+)\s+(\d+)\s+([\d,.]+)\s+([\d,.]+)/im;

          const parseMoney2 = (s: string) => parseFloat(s.replace(/[,$]/g,"")) || 0;

          // Line-by-line scan
          for (const line of umText.split("\n")) {
            const t = line.trim();
            if (!t || t.length < 8) continue;

            // Try hotel room type
            const hm = t.match(/^(.{4,40}?)\s{2,}(\d{1,4})\s+(\d{1,3})\s+([\d.]+)\s*([\d.]*)/);
            if (hm) {
              const label = hm[1].trim();
              const total = parseInt(hm[2]);
              const vacant = parseInt(hm[3]);
              const rate1  = parseMoney2(hm[4]);
              const rate2  = parseMoney2(hm[5] || "0");
              // Only keep rows that look like unit types (total 1-2000, rate reasonable)
              if (total >= 1 && total <= 2000 && rate1 > 0 && !seenTypes.has(label.toLowerCase())) {
                const isHotel = /king|queen|double|twin|suite|ada|standard|deluxe|premium/i.test(label);
                const isMF    = /studio|\d\s*br|bed|bath|efficiency|commercial/i.test(label);
                if (isHotel || isMF) {
                  seenTypes.add(label.toLowerCase());
                  regexRows.push({
                    unitType:      label,
                    totalUnits:    total,
                    vacantUnits:   vacant,
                    avgSqft:       (!isHotel && rate2 > 200 && rate2 < 5000) ? rate2 : 0,
                    avgBaseRent:   isHotel ? rate1 : (rate2 > 0 && rate2 < rate1 * 3 ? rate1 : 0),
                    avgTotalRent:  isHotel ? rate2 || rate1 : 0,
                    marketRent:    0,
                    avgUtilities:  0,
                    latestLeaseUp: "",
                  });
                }
              }
            }
          }

          // Regex summary row: total units, total vacant, avg rate from footer/totals lines
          const totalLineMatch = umText.match(/(?:total|totals?)\s*:?\s*(\d+)\s+(\d+)\s+([\d.]+)/im);
          const totalUnitsRegex   = totalLineMatch ? parseInt(totalLineMatch[1]) : 0;
          const totalVacantRegex  = totalLineMatch ? parseInt(totalLineMatch[2]) : 0;
          const avgRateRegex      = totalLineMatch ? parseMoney2(totalLineMatch[3]) : 0;

          emit(controller, enc, { type: "log", agent: "unit_mix",
            message: `  ↳ regex: ${regexRows.length} types · total=${totalUnitsRegex} vacant=${totalVacantRegex} avgRate=$${avgRateRegex}` });

          // ── Phase 2: LLM — only if regex found nothing ──────────────────
          type UMRow = { unitType:string; totalUnits:number; vacantUnits:number; avgSqft?:number; avgBaseRent?:number; avgTotalRent?:number; avgRent?:number; marketRent?:number; avgUtilities?:number; latestLeaseUp?:string; physicalOcc?:number };
          let llmRows: UMRow[] = [];

          if (regexRows.length === 0) {
            emit(controller, enc, { type: "log", agent: "unit_mix", message: "  ↳ regex empty — running LLM fallback..." });
            const ctx = umText.slice(0, 5000);
            try {
              const raw = await chat({
                agent: "unit_mix", model: MODELS.STANDARD, max_tokens: 800, temperature: 0.0,
                messages: [{
                  role: "system",
                  content: "CRE analyst. Extract unit/room mix. Raw JSON only. No prose. Omit zero fields.",
                }, {
                  role: "user",
                  content: `Extract every distinct unit/room type. Return JSON:
{"unitMix":[{"unitType":"","totalUnits":0,"vacantUnits":0,"avgSqft":0,"avgBaseRent":0,"avgTotalRent":0,"marketRent":0,"avgUtilities":0,"latestLeaseUp":"","physicalOcc":0}]}

Rules:
- totalUnits: count of that type. vacantUnits: currently empty.
- avgBaseRent: contract/current rent ($/mo for MF, nightly for hotel).
- avgTotalRent: rent + utilities. marketRent: asking/market rate.
- physicalOcc: % occupied for this type (0-100).
- latestLeaseUp: most recent move-in date "YYYY-MM" if found.
- SUM of totalUnits = total property units.

DOCUMENTS:\n${ctx}`,
                }],
              });
              debugReply("unit_mix", raw);
              llmRows = safeParse<{ unitMix?: UMRow[] }>(raw, {}).unitMix || [];
            } catch (err) {
              console.error("[unit_mix] LLM failed:", err);
            }
          }

          // Merge regex + LLM, regex wins on duplicates
          const merged: UMRow[] = regexRows.length
            ? regexRows.map(r => ({ ...r, avgRent: r.avgBaseRent || r.avgTotalRent }))
            : llmRows;

          // Derive annual_revenue and loss_to_lease per type
          let rows = merged
            .filter(u => u.unitType && (u.totalUnits || 0) > 0)
            .map(u => {
              const base   = u.avgBaseRent || (u as UMRegex).avgBaseRent || 0;
              const total  = u.avgTotalRent || u.avgRent || base;
              const market = u.marketRent   || (u as UMRegex).marketRent || 0;
              const sqft   = u.avgSqft      || 0;
              const units  = u.totalUnits   || 0;
              const vacant = u.vacantUnits  || 0;
              const physOcc = u.physicalOcc
                ? u.physicalOcc
                : units > 0 ? parseFloat((((units - vacant) / units) * 100).toFixed(1)) : 0;
              const annualRev = total > 0 ? Math.round(total * units * 12) : 0;
              const lossToLease = market > 0 && base > 0 ? parseFloat((market - base).toFixed(2)) : 0;
              return {
                deal_id:        dealId,
                unit_type:      u.unitType,
                total_units:    units,
                vacant_units:   vacant,
                avg_sqft:       sqft,
                avg_base_rent:  base,
                avg_total_rent: total,
                avg_rent:       total || base,
                latest_lease_up: u.latestLeaseUp || null,
                avg_utilities:  u.avgUtilities || 0,
                market_rent:    market,
                annual_revenue: annualRev,
                loss_to_lease:  lossToLease,
                physical_occ:   physOcc,
              };
            });

          // Fallback: single generic row from deal record
          if (!rows.length) {
            const { data: dealRow } = await db.from("deals").select("units,property_type,occupancy_rate").eq("id", dealId).single();
            if (dealRow?.units && dealRow.units > 0) {
              const label = /hotel|hospitality/i.test(dealRow.property_type || "") ? "Guest Rooms" : "Units";
              rows = [{
                deal_id: dealId, unit_type: label, total_units: dealRow.units, vacant_units: 0,
                avg_sqft: 0, avg_base_rent: 0, avg_total_rent: 0, avg_rent: 0,
                latest_lease_up: null, avg_utilities: 0,
                market_rent: 0, annual_revenue: 0, loss_to_lease: 0,
                physical_occ: dealRow.occupancy_rate || 0,
              }];
            }
          }

          await db.from("unit_mix").delete().eq("deal_id", dealId);
          if (rows.length) await db.from("unit_mix").insert(rows);

          const totalU  = rows.reduce((s, r) => s + r.total_units, 0);
          const totalV  = rows.reduce((s, r) => s + r.vacant_units, 0);
          const occ     = totalU > 0 ? (((totalU - totalV) / totalU) * 100).toFixed(1) : "0";
          const annRev  = rows.reduce((s, r) => s + r.annual_revenue, 0);
          return { summary: `${rows.length} types · ${totalU} units · ${occ}% occ · $${(annRev/1000).toFixed(0)}K annual rev` };
        });

        // ── Agents 3-6: run in PARALLEL — each has its own API key ──────────
        // summary, questions, criteria, risks are fully independent.
        // Running them concurrently cuts wall-clock time by ~3x and spreads
        // load across 4 separate NVIDIA keys so no single key is overloaded.
        emit(controller, enc, { type: "log", agent: "ocr", message: "▶ Running agents 3-6 in parallel (summary · questions · criteria · risks)..." });

        await Promise.all([

          // ── Agent 3: Summary ────────────────────────────────────────────
          runAgent("summary", async () => {
            const ctx = buildContext(BUDGET, ["om", "market"], ["financial", "rent_roll", "legal", "capex"]);
            const raw = await chat({
              agent: "summary",
              model: MODELS.STANDARD,
              max_tokens: 512,
              temperature: 0.2,
              messages: [{
                role: "system",
                content: "Senior CRE analyst. Output ONLY a raw JSON object — no markdown, no preamble, no trailing text.",
              }, {
                role: "user",
                content: `Read the documents and write TWO things:
1. brokerNarrative: 2-3 sentence investment pitch (asset quality, NOI, location upside, price).
2. locationInsight: 1-2 sentence location observation (market, demand drivers, nearby demand generators).

Base everything on FACTS from the docs — do not guess.
Return JSON: {"brokerNarrative":"","locationInsight":""}

DOCUMENTS:\n${ctx}`,
              }],
            });
            debugReply("summary", raw);
            const sumJson = safeParse<{ brokerNarrative?: string; locationInsight?: string }>(raw, {});
            if (sumJson.brokerNarrative || sumJson.locationInsight) {
              await db.from("deals").update({
                broker_narrative: sumJson.brokerNarrative || "",
                location_insight: sumJson.locationInsight || "",
              }).eq("id", dealId);
            }
            return { summary: `narrative ${sumJson.brokerNarrative ? "✓" : "✗"}, location ${sumJson.locationInsight ? "✓" : "✗"}` };
          }),

          // ── Agent 4: Questions ──────────────────────────────────────────
          runAgent("questions", async () => {
            const ctx = buildContext(BUDGET, ["om", "financial", "market"], ["legal", "capex"]);
            const raw = await chat({
              agent: "questions",
              model: MODELS.LIGHT,
              max_tokens: 768,
              temperature: 0.2,
              messages: [{
                role: "system",
                content: "CRE due diligence analyst. Output ONLY a raw JSON object — no markdown, no preamble.",
              }, {
                role: "user",
                content: `Generate exactly 7 sharp due diligence questions a buyer would ask before closing this deal.
Each question must be specific to THIS property (use real numbers/facts from the docs).
Categories: Financial, Legal, Operational, Market, Physical.
Return JSON: {"questions":[{"question":"","category":""}]}

DOCUMENTS:\n${ctx}`,
              }],
            });
            debugReply("questions", raw);
            const qJson = safeParse<{ questions?: {question:string;category:string}[] }>(raw, {});
            if (qJson.questions?.length) {
              await db.from("questions").delete().eq("deal_id", dealId);
              await db.from("questions").insert(
                qJson.questions.map(q => ({ deal_id: dealId, question: q.question, category: q.category || "General" }))
              );
            }
            return { summary: `${qJson.questions?.length || 0} questions generated` };
          }),

          // ── Agent 5: Criteria ───────────────────────────────────────────
          runAgent("criteria", async () => {
            const ctx = buildContext(BUDGET, ["financial", "om", "rent_roll"], ["legal", "capex", "market"]);
            const raw = await chat({
              agent: "criteria",
              model: MODELS.STANDARD,
              max_tokens: 768,
              temperature: 0.1,
              messages: [{
                role: "system",
                content: "CRE underwriter. Output ONLY a raw JSON object — no markdown, no preamble.",
              }, {
                role: "user",
                content: `Evaluate this deal against standard CRE acquisition criteria using REAL numbers from the docs.
For each criterion: state the typical requirement, the actual value found, and whether it meets the bar.

Criteria to evaluate (use ALL of these):
- Deal Size (min $5M guidance price)
- NOI Margin (min 30% of EGI)
- Cap Rate (target 6-9%)
- Occupancy (min 80%)
- Year Built (prefer post-1980)
- DSCR (min 1.20x if debt exists)
- Expense Ratio (max 55% of revenue)

Return JSON: {"criteria":[{"criteria":"","requirement":"","actual":"","meets":true}]}

DOCUMENTS:\n${ctx}`,
              }],
            });
            debugReply("criteria", raw);
            const crJson = safeParse<{ criteria?: {criteria:string;requirement:string;actual:string;meets:boolean}[] }>(raw, {});
            if (crJson.criteria?.length) {
              await db.from("criteria").delete().eq("deal_id", dealId);
              await db.from("criteria").insert(crJson.criteria.map(c => ({ deal_id: dealId, ...c })));
            }
            return { summary: `${crJson.criteria?.length || 0} criteria (${crJson.criteria?.filter(c=>c.meets).length || 0} pass)` };
          }),

          // ── Agent 6: Risks ──────────────────────────────────────────────
          runAgent("risks", async () => {
            const ctx = buildContext(BUDGET, ["legal", "capex", "financial", "om"], ["rent_roll", "market"]);
            const raw = await chat({
              agent: "risks",
              model: MODELS.STANDARD,
              max_tokens: 1024,
              temperature: 0.15,
              messages: [{
                role: "system",
                content: "CRE risk analyst. Output ONLY a raw JSON object — no markdown, no preamble.",
              }, {
                role: "user",
                content: `Identify all material risks for a buyer of this property. Be specific — use real facts from the docs.
Severity scale: critical (deal-breaker), high (major concern), medium (monitor), low (minor).
Also provide 3-5 AI explanations for the most important extracted data fields (e.g. NOI, cap rate, occupancy).

Return JSON:
{"risks":[{"description":"","severity":"critical|high|medium|low"}],"explanations":[{"fieldName":"","explanationText":"","sourceSnippet":"","sourcePage":0}]}

DOCUMENTS:\n${ctx}`,
              }],
            });
            debugReply("risks", raw);
            const rJson = safeParse<{ risks?: {description:string;severity:string}[]; explanations?: {fieldName:string;explanationText:string;sourceSnippet:string;sourcePage:number}[] }>(raw, {});
            if (rJson.risks?.length) {
              await db.from("risks").delete().eq("deal_id", dealId);
              await db.from("risks").insert(
                rJson.risks.map(r => ({ deal_id: dealId, description: r.description, severity: r.severity || "medium" }))
              );
            }
            if (rJson.explanations?.length) {
              await db.from("ai_explanations").delete().eq("deal_id", dealId);
              await db.from("ai_explanations").insert(
                rJson.explanations.map(e => ({
                  deal_id: dealId, field_name: e.fieldName, explanation_text: e.explanationText,
                  source_document_id: parsedDocs[0]?.id || null,
                  source_page: e.sourcePage || null, source_snippet: e.sourceSnippet || null,
                }))
              );
            }
            return { summary: `${rJson.risks?.length || 0} risks, ${rJson.explanations?.length || 0} explanations` };
          }),

        ]); // end Promise.all

        // ── Finalize ──────────────────────────────────────────────────────
        await db.from("ai_jobs").update({ status: "completed", result: { agents: 6 } })
          .eq("deal_id", dealId).eq("job_type", "extraction");
        await db.from("deals").update({ status: "underwriting" }).eq("id", dealId);

        emit(controller, enc, { type: "complete", stage: "underwriting" });
        try { controller.close(); } catch { /* browser already disconnected */ }
      } catch (err) {
        console.error("[run-extraction] fatal:", err);
        const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
        emit(controller, enc, { type: "error", message: msg });
        await db.from("ai_jobs").update({ status: "failed", result: { error: msg } })
          .eq("deal_id", dealId).eq("job_type", "extraction");
        try { controller.close(); } catch { /* browser already disconnected */ }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
