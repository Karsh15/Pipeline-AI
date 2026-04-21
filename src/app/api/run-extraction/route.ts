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

// Classify a filename into a semantic bucket so agents can focus on relevant docs
type DocBucket = "om" | "financial" | "rent_roll" | "legal" | "capex" | "market" | "other";
function classifyDoc(fileName: string): DocBucket {
  const n = fileName.toLowerCase();
  if (/\b(om|offering|memorandum|flyer|teaser|package|brochure)\b/.test(n)) return "om";
  if (/\b(rent[\s_-]*roll|rr|roll)\b/.test(n))                              return "rent_roll";
  if (/\b(t12|t-12|p&?l|pnl|profit|financial|income|ebitda|operating)\b/.test(n)) return "financial";
  if (/\b(lease|ground[\s_-]*lease|agreement|franchise|legal)\b/.test(n))   return "legal";
  if (/\b(capex|cap[\s_-]*ex|capital|reserve|fffe)\b/.test(n))              return "capex";
  if (/\b(str|market|comp|demand|supply|stats?)\b/.test(n))                 return "market";
  return "other";
}

// Budget-aware excerpt builder — fair share across docs, preferring priority buckets
function excerpt(docs: { name: string; text: string; bucket: DocBucket }[], budget: number, priority: DocBucket[] = []): string {
  if (!docs.length) return "";
  // Priority docs first — they get the BULK of the budget (70%), others share the remainder
  const primary = docs.filter(d => priority.includes(d.bucket));
  const secondary = docs.filter(d => !priority.includes(d.bucket));

  const primaryBudget = primary.length > 0 ? Math.floor(budget * 0.70) : 0;
  const secondaryBudget = budget - primaryBudget;

  const primaryPer = primary.length > 0 ? Math.floor(primaryBudget / primary.length) : 0;
  const secondaryPer = secondary.length > 0 ? Math.max(400, Math.floor(secondaryBudget / secondary.length)) : 0;

  const parts: string[] = [];
  for (const d of primary) {
    parts.push(`=== FILE: ${d.name} (${d.bucket}) ===\n${d.text.substring(0, primaryPer)}`);
  }
  for (const d of secondary) {
    parts.push(`=== FILE: ${d.name} (${d.bucket}) ===\n${d.text.substring(0, secondaryPer)}`);
  }
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
                prefer: "nvidia",  // NVIDIA NIM — no TPM rate limit issues
                model: MODELS.LIGHT,
                max_tokens: 400,
                temperature: 0.1,
                messages: [
                  { role: "system", content: "CRE analyst. Extract key facts only — numbers, dates, names, metrics. Bullet points, one per line. Output 'NO_DATA' if no CRE data." },
                  { role: "user", content: `Doc: ${d.name}\n\n${chunk}` },
                ],
              });
              if (reply && !/^\s*NO_DATA\s*$/i.test(reply.trim())) summaries.push(reply.trim());
            } catch (err) {
              console.error(`[distill] failed for ${d.name}:`, err);
            }
          }
          return { ...d, facts: summaries.join("\n").substring(0, 4000) };
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
        const buildContext = (budget: number, priority: DocBucket[] = []) =>
          excerpt(distilled.map(d => ({ name: d.name, text: d.facts, bucket: d.bucket })), budget, priority);

        const buildRawContext = (budget: number, priority: DocBucket[] = []) =>
          excerpt(parsedDocs, budget, priority);

        // Helper: run one agent in isolation with full debug — failure never blocks the next agent
        const BUDGET = 6000; // per-agent input chars
        // Estimated time per agent (seconds). These are typical durations we
        // observe under "cloud" Groq 70B + local Qwen 3B fallback.
        const ESTIMATES: Record<string, number> = {
          metadata:  10,
          financial: 20,
          unit_mix:  12,
          summary:   10,
          questions: 10,
          criteria:  10,
          risks:     15,
        };

        const runAgent = async (name: string, fn: () => Promise<{ ok?: boolean; rawPreview?: string; summary?: string }>) => {
          const eta = ESTIMATES[name] ?? 10;
          emit(controller, enc, { type: "agent_start", agent: name, etaSeconds: eta });
          emit(controller, enc, { type: "log", agent: name, message: `▶ starting ${name} · est. ~${eta}s` });
          const t0 = Date.now();
          try {
            const result = await fn();
            const dt = (Date.now() - t0) / 1000;
            const delta = dt - eta;
            const variance = delta >= 0 ? `+${delta.toFixed(1)}s vs est.` : `${delta.toFixed(1)}s vs est.`;
            if (result?.summary) emit(controller, enc, { type: "log", agent: name, message: `✓ ${result.summary} · ${dt.toFixed(1)}s (${variance})` });
            else                 emit(controller, enc, { type: "log", agent: name, message: `✓ ${name} done · ${dt.toFixed(1)}s (${variance})` });
            emit(controller, enc, { type: "agent_done", agent: name, durationSeconds: dt });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const dt = ((Date.now() - t0) / 1000).toFixed(1);
            console.error(`[run-extraction] agent '${name}' failed:`, err);
            emit(controller, enc, { type: "log", agent: name, message: `⚠ ${name} FAILED after ${dt}s: ${msg.substring(0, 250)}` });
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
          const ctx = buildRawContext(14000, ["om", "market", "rent_roll"]);
          emit(controller, enc, { type: "log", agent: "metadata", message: `  ↳ context: ${ctx.length.toLocaleString()} chars (raw)` });

          const raw = await chat({
            prefer: "cloud",
            model: MODELS.STANDARD,  // Llama 3.3 70B — good enough for structured extraction
            max_tokens: 1024,
            temperature: 0.1,
            messages: [{
              role: "system",
              content: "You are a CRE analyst. Extract metadata from the OM and related docs. Output ONLY a raw JSON object. No preamble, no markdown. Never guess — if a field is genuinely missing, use 0 or empty string.",
            }, {
              role: "user",
              content: `Find these fields in the documents below and return JSON:
{"name":"","propertyType":"","assetType":"","address":"","city":"","state":"","units":0,"yearBuilt":0,"broker":"","brand":"","guidancePrice":0,"dealLead":""}

EXTRACTION RULES:
- "name": full property title (e.g. "Fairfield by Marriott Inn & Suites Omaha Downtown").
- "propertyType": Hotel, Multifamily, Office, Retail, Industrial.
- "assetType": Hospitality, Residential, Commercial, Industrial.
- "address": ONLY the street (e.g. "1501 Nicholas St"). Do NOT include city/state.
- "city": just city name (e.g. "Omaha"). Strip leading hotel words like "Suites", "Inn", "Hotel".
- "state": 2-letter USPS code (e.g. "NE").
- "units": hotel rooms/keys or apartment units as integer. Look for patterns like "113 rooms", "250 keys", "180 units".
- "yearBuilt": 4-digit year of construction. Patterns: "Built 2008", "constructed in 2015", "Year Built: 2020".
- "broker": brokerage firm only (CBRE, JLL, Marcus & Millichap, Newmark, HFF, Eastdil, Hodges Ward Elliott, etc).
- "brand": hotel flag (Marriott, Hilton, IHG, Hyatt, Choice, Wyndham, Best Western, etc). Empty for non-hotel.
- "dealLead": named broker (e.g. "Adam A. Lewis"). NOT the firm.
- "guidancePrice": asking price in dollars as integer (e.g. 42500000). If "Request for Offers" / "Unpriced" / "Call for Offers", use 0.

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
          await db.from("deals").update({
            name:           metaJson.name          as string || undefined,
            address:        metaJson.address       as string || undefined,
            city:           metaJson.city          as string || undefined,
            state:          metaJson.state         as string || undefined,
            asset_type:     metaJson.assetType     as string || undefined,
            property_type:  metaJson.propertyType  as string || undefined,
            broker:         metaJson.broker        as string || undefined,
            brand:          metaJson.brand         as string || undefined,
            deal_lead:      metaJson.dealLead      as string || undefined,
            guidance_price: (metaJson.guidancePrice as number) > 0 ? metaJson.guidancePrice as number : undefined,
            units:          (metaJson.units         as number) > 0 ? metaJson.units         as number : undefined,
            year_built:     (metaJson.yearBuilt     as number) > 0 ? metaJson.yearBuilt     as number : undefined,
            lat: coords.lat, lng: coords.lng,
          }).eq("id", dealId);

          const metaFields = ["name","address","city","state","assetType","propertyType","broker","brand","guidancePrice","units","yearBuilt","dealLead"];
          const metaInserts = metaFields
            .filter(f => metaJson[f])
            .map(f => ({ deal_id: dealId, field_name: f, value: String(metaJson[f]), confidence_score: 0.92, source_document_id: parsedDocs[0]?.id }));
          await db.from("extracted_data").delete().eq("deal_id", dealId).in("field_name", metaFields);
          if (metaInserts.length) await db.from("extracted_data").insert(metaInserts);

          return { summary: `${metaJson.name || "(no name)"} · ${metaJson.city || "?"}, ${metaJson.state || "?"} · ${metaInserts.length}/${metaFields.length} fields · $${((metaJson.guidancePrice as number)||0).toLocaleString()}` };
        });

        // ── Agent 2: Financials (cloud 70B — reads P&L / T-12 tables) ──────
        await runAgent("financial", async () => {
          emit(controller, enc, { type: "log", agent: "financial", message: "Parsing financial model (cloud 70B model)..." });
          // Use raw text — P&L tables have the actual dollar amounts
          const ctx = buildRawContext(12000, ["financial", "om"]);
          emit(controller, enc, { type: "log", agent: "financial", message: `  ↳ context: ${ctx.length.toLocaleString()} chars (raw)` });
          // Retry with smaller context on NIM timeouts; cloudChain falls back to Groq if NIM keeps failing.
          let raw = "";
          const financialCtxSizes = [12000, 8000, 5000];
          let lastFinErr: unknown;
          let succeeded = false;
          for (const ctxSize of financialCtxSizes) {
            const ctxSlice = ctx.slice(0, ctxSize);
            try {
              raw = await chat({
                prefer: "cloud",
                model: MODELS.REASONING,
                max_tokens: 2048,
                temperature: 0.1,
            messages: [{
              role: "system",
              content: `You are a CRE financial analyst. Extract REAL dollar amounts from P&L / T-12 / operating statement tables. OUTPUT raw JSON only — no markdown, no prose.
RULES:
- Use EXACT numbers from the document. Never output 0 if the number exists in the document.
- Hotel P&L mappings: "Total Revenue"/"Total Operating Revenue" → "Total Revenue"; "GOP"/"Gross Operating Profit" → "Gross Operating Profit"; "EBITDA" → "EBITDA"; "NOI" → "Net Operating Income"; "Total Expenses"/"Total Costs" → "Total Operating Expenses"
- Year columns: 2021→y2021, 2022→y2022, 2023→y2023, 2024→y2024, 2025→y2025
- Month columns: Jan→m1, Feb→m2, Mar→m3, Apr→m4, May→m5, Jun→m6, Jul→m7, Aug→m8, Sep→m9, Oct→m10, Nov→m11, Dec→m12
- TTM / "Trailing 12" / rightmost Total column → ttm field
- All dollar amounts as integers (strip $, commas, decimals)
- Include EVERY revenue and expense line found, not just standard ones`,
            }, {
              role: "user",
              content: `Extract the hotel's financial performance from the P&L / T-12 / STR tables below.

CRITICAL INSTRUCTIONS:
Return JSON (omit fields that are 0, only include rows with actual data found):
{"noi":0,"capRate":0,"totalRevenue":0,"occupancy":0,"adr":0,"revpar":0,"financials":[{"metric":"<name>","category":"income|expense","y2021":0,"y2022":0,"y2023":0,"y2024":0,"y2025":0,"ttm":0,"m1":0,"m2":0,"m3":0,"m4":0,"m5":0,"m6":0,"m7":0,"m8":0,"m9":0,"m10":0,"m11":0,"m12":0}]}

DOCUMENTS:
${ctxSlice}`,
              }],
              });
              succeeded = true;
              break;
            } catch (err) {
              const status = (err as { status?: number })?.status;
              if (status === 504 || status === 429 || status === 503 || status === 404) {
                lastFinErr = err;
                emit(controller, enc, { type: "log", agent: "financial", message: `  ↳ NIM timeout at ${ctxSize} chars, retrying with ${Math.min(ctxSize, financialCtxSizes[financialCtxSizes.indexOf(ctxSize)+1] ?? 0)} chars…` });
                continue;
              }
              throw err;
            }
          }
          if (!succeeded) throw lastFinErr ?? new Error("DeepSeek NIM failed after all retries");
          debugReply("financial", raw!);
          type FinRow = {metric:string; category?:string; y2021?:number; y2022?:number; y2023?:number; y2024?:number; y2025?:number; ttm?:number; m1?:number; m2?:number; m3?:number; m4?:number; m5?:number; m6?:number; m7?:number; m8?:number; m9?:number; m10?:number; m11?:number; m12?:number; perUnit?:number; pctEgi?:number};
          const finJson = safeParse<{ noi?: number; capRate?: number; totalRevenue?: number; occupancy?: number; adr?: number; revpar?: number; financials?: FinRow[] }>(raw, {});

          // Regex fallbacks — scan aggressively
          const allText = parsedDocs.map(d => d.text).join(" ");
          if (!finJson.noi) {
            const m = allText.match(/\b(?:NOI|Net Operating Income|EBITDA)\b[^\n]{0,80}?\$?\s*([\d,]+(?:\.\d+)?)\s*(M|MM|million|K)?/i);
            if (m) {
              let n = parseFloat(m[1].replace(/,/g, ""));
              const suffix = m[2] || "";
              if (/M|MM|million/i.test(suffix)) n *= 1_000_000;
              else if (/K/i.test(suffix)) n *= 1_000;
              if (n > 10000) finJson.noi = Math.round(n);
            }
          }
          if (!finJson.capRate) {
            const m = allText.match(/\b(?:cap(?:italization)?\s*rate|going[\s-]*in\s*cap)[^\n]{0,30}?([\d.]+)\s*%/i);
            if (m) {
              const r = parseFloat(m[1]);
              if (r > 0 && r < 30) finJson.capRate = r;
            }
          }
          if (!finJson.occupancy) {
            const m = allText.match(/\b(?:occupancy|occ(?:\.|\s))[^\n]{0,30}?([\d.]+)\s*%/i);
            if (m) {
              const v = parseFloat(m[1]);
              if (v > 0 && v <= 100) finJson.occupancy = v;
            }
          }
          if (!finJson.adr) {
            const m = allText.match(/\bADR\b[^\n]{0,30}?\$?\s*([\d,]+\.?\d*)/i);
            if (m) {
              const v = parseFloat(m[1].replace(/,/g, ""));
              if (v > 20 && v < 2000) finJson.adr = v;
            }
          }

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
            const egiRow = find2(["Effective Gross Income","EGI"]);
            const egiTTM = egiRow ? (egiRow.ttm || 0) : 0;

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
                const perUnit = totalUnits > 0 && ttmVal > 0 ? Math.round(ttmVal / totalUnits) : (r.perUnit || 0);
                const pctEgi  = egiTTM > 0 && ttmVal > 0 ? parseFloat(((ttmVal / egiTTM) * 100).toFixed(1)) : (r.pctEgi || 0);
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

        // ── Agent 2b: Unit Mix (cloud 70B — reads rent-roll / OM tables) ───
        await runAgent("unit_mix", async () => {
          // Use raw text so room-type tables don't get summarized away
          const ctx = buildRawContext(10000, ["rent_roll", "om", "financial"]);
          emit(controller, enc, { type: "log", agent: "unit_mix", message: `  ↳ context: ${ctx.length.toLocaleString()} chars (raw)` });
          const raw = await chat({
            prefer: "cloud",
            model: MODELS.STANDARD,  // Llama 3.3 70B — good at structured tables
            max_tokens: 1536,
            temperature: 0.1,
            messages: [{
              role: "system", content: "CRE analyst. Extract unit mix from the document. Output ONLY a raw JSON object. No prose.",
            }, {
              role: "user",
              content: `Extract the full unit / room mix from the documents. Look in rent roll, unit mix tables, and the OM.

RULES:
- Return every distinct unit/room type with ALL fields below.
- Multifamily bedroom types: "Studio/0BR", "1 BR", "2 BR", "3 BR", "4 BR", "Commercial", "Other".
- Hotel room types: "King Standard", "Queen Standard", "King Suite", "Double Queen", "ADA King", etc.
- totalUnits = count of that type.
- vacantUnits = number currently vacant/available.
- avgSqft = average square footage for that unit type (0 if not found).
- avgBaseRent = average base/contract rent in dollars/month (MF) or nightly rate (hotel).
- avgTotalRent = average total rent including utilities/fees (0 if same as base).
- avgRent = same as avgTotalRent if available, else avgBaseRent.
- latestLeaseUp = most recent lease-up date or move-in date string (e.g. "2024-03", empty if unknown).
- avgUtilities = average utility allowance per unit in dollars (0 if not found).
- SUM of all totalUnits should equal total property units.

Return JSON:
{"unitMix":[{"unitType":"","totalUnits":0,"vacantUnits":0,"avgSqft":0,"avgBaseRent":0,"avgTotalRent":0,"avgRent":0,"latestLeaseUp":"","avgUtilities":0}]}

DOCUMENTS:
${ctx}`,
            }],
          });
          debugReply("unit_mix", raw);
          type UMRow = { unitType:string; totalUnits:number; vacantUnits:number; avgSqft?:number; avgBaseRent?:number; avgTotalRent?:number; avgRent?:number; latestLeaseUp?:string; avgUtilities?:number };
          const umJson = safeParse<{ unitMix?: UMRow[] }>(raw, {});
          let rows = (umJson.unitMix || [])
            .filter(u => u.unitType && u.totalUnits > 0)
            .map(u => ({
              deal_id: dealId,
              unit_type:      u.unitType,
              total_units:    u.totalUnits    || 0,
              vacant_units:   u.vacantUnits   || 0,
              avg_sqft:       u.avgSqft       || 0,
              avg_base_rent:  u.avgBaseRent   || 0,
              avg_total_rent: u.avgTotalRent  || u.avgRent || 0,
              avg_rent:       u.avgRent       || u.avgTotalRent || u.avgBaseRent || 0,
              latest_lease_up: u.latestLeaseUp || null,
              avg_utilities:  u.avgUtilities  || 0,
            }));

          // Fallback: if agent returned nothing but deal has a `units` count, create a single generic row
          if (!rows.length) {
            const { data: deal } = await db.from("deals").select("units,property_type").eq("id", dealId).single();
            if (deal?.units && deal.units > 0) {
              const label = /hotel|hospitality/i.test(deal.property_type || "") ? "Guest Rooms" : "Units";
              rows = [{ deal_id: dealId, unit_type: label, total_units: deal.units, vacant_units: 0, avg_sqft: 0, avg_base_rent: 0, avg_total_rent: 0, avg_rent: 0, latest_lease_up: null, avg_utilities: 0 }];
            }
          }

          await db.from("unit_mix").delete().eq("deal_id", dealId);
          if (rows.length) await db.from("unit_mix").insert(rows);
          const total = rows.reduce((s, r) => s + r.total_units, 0);
          return { summary: `${rows.length} unit type${rows.length!==1?"s":""} · ${total} total units` };
        });

        // ── Agent 3: Summary ──────────────────────────────────────────────
        await runAgent("summary", async () => {
          const ctx = buildContext(BUDGET, ["om", "market"]);
          const raw = await chat({
            prefer: "cloud",
            model: MODELS.STANDARD,  // Llama 70B — good narrative
            max_tokens: 1024,
            messages: [{
              role: "system", content: "Real estate analyst. Output ONLY a raw JSON object. No preamble.",
            }, {
              role: "user",
              content: `Write an investment summary. Return JSON:
{"brokerNarrative":"2-3 sentence investment narrative","locationInsight":"1-2 sentence location insight"}

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
        });

        // ── Agent 4: Questions ────────────────────────────────────────────
        await runAgent("questions", async () => {
          const ctx = buildContext(BUDGET);
          const raw = await chat({
            prefer: "cloud",
            model: MODELS.LIGHT,  // Llama 8B — fast and plenty for DD question generation
            max_tokens: 1024,
            messages: [{
              role: "system", content: "CRE analyst. Output ONLY a raw JSON object. No preamble.",
            }, {
              role: "user",
              content: `Generate 6-8 due diligence questions with categories. Return JSON:
{"questions":[{"question":"","category":"Financial|Legal|Operational|Market|Physical"}]}

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
        });

        // ── Agent 5: Criteria ─────────────────────────────────────────────
        await runAgent("criteria", async () => {
          const ctx = buildContext(BUDGET, ["financial", "om", "rent_roll"]);
          const raw = await chat({
            prefer: "cloud",
            model: MODELS.STANDARD,  // Llama 70B — good at meets/fails logic
            max_tokens: 1024,
            messages: [{
              role: "system", content: "CRE underwriter. Output ONLY a raw JSON object. No preamble.",
            }, {
              role: "user",
              content: `Evaluate investment criteria. Return JSON:
{"criteria":[{"criteria":"","requirement":"","actual":"","meets":true}]}
Include: Deal Size, NOI Margin, Year Built, Occupancy, Cap Rate.

DOCUMENTS:\n${ctx}`,
            }],
          });
          debugReply("criteria", raw);
          const crJson = safeParse<{ criteria?: {criteria:string;requirement:string;actual:string;meets:boolean}[] }>(raw, {});
          if (crJson.criteria?.length) {
            await db.from("criteria").delete().eq("deal_id", dealId);
            await db.from("criteria").insert(crJson.criteria.map(c => ({ deal_id: dealId, ...c })));
          }
          return { summary: `${crJson.criteria?.length || 0} criteria evaluated (${crJson.criteria?.filter(c=>c.meets).length || 0} pass)` };
        });

        // ── Agent 6: Risks + Explanations ─────────────────────────────────
        await runAgent("risks", async () => {
          const ctx = buildContext(BUDGET, ["legal", "capex", "financial"]);
          const raw = await chat({
            prefer: "cloud",
            model: MODELS.REASONING,  // DeepSeek V3 — deep reasoning for real risk analysis
            max_tokens: 1536,
            messages: [{
              role: "system", content: "CRE risk analyst. Output ONLY a raw JSON object. No preamble.",
            }, {
              role: "user",
              content: `Identify risks and AI explanations for key data points. Return JSON:
{"risks":[{"description":"","severity":"critical|high|medium|low"}],"explanations":[{"fieldName":"noi","explanationText":"","sourceSnippet":"","sourcePage":1}]}

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
        });

        // ── Finalize ──────────────────────────────────────────────────────
        await db.from("ai_jobs").update({ status: "completed", result: { agents: 6 } })
          .eq("deal_id", dealId).eq("job_type", "extraction");
        await db.from("deals").update({ status: "underwriting" }).eq("id", dealId);

        emit(controller, enc, { type: "complete", stage: "underwriting" });
        controller.close();
      } catch (err) {
        console.error("[run-extraction] fatal:", err);
        const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
        emit(controller, enc, { type: "error", message: msg });
        await db.from("ai_jobs").update({ status: "failed", result: { error: msg } })
          .eq("deal_id", dealId).eq("job_type", "extraction");
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
