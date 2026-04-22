"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runExtractionHandler = runExtractionHandler;
const supabase_1 = require("../lib/supabase");
const llm_1 = require("../lib/llm");
const extract_1 = require("../lib/ocr/extract");
function emit(res, data) {
    try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
    catch { /* client disconnected */ }
}
function classifyDoc(fileName) {
    const n = fileName.toLowerCase().replace(/[\\/]/g, " ");
    if (/\bfinancials?\b/.test(n))
        return "financial";
    if (/\bagreements?\b/.test(n))
        return "legal";
    if (/\boffering[\s_-]*memorandum\b|\bom\b/.test(n))
        return "om";
    if (/\bpip\b/.test(n))
        return "capex";
    if (/\bstr\b/.test(n))
        return "market";
    if (/\brent[\s_-]*roll\b/.test(n))
        return "rent_roll";
    if (/\b(memorandum|flyer|teaser|package|brochure)\b/.test(n))
        return "om";
    if (/\b(rr|roll)\b/.test(n))
        return "rent_roll";
    if (/\b(t12|t-12|p&?l|pnl|profit|income|ebitda|operating|statement)\b/.test(n))
        return "financial";
    if (/\b(lease|ground[\s_-]*lease|franchise|legal|contract|license)\b/.test(n))
        return "legal";
    if (/\b(capex|cap[\s_-]*ex|capital|reserve|fffe|renovation|improvement)\b/.test(n))
        return "capex";
    if (/\b(str|market|comp|demand|supply|stats?|report|survey)\b/.test(n))
        return "market";
    return "other";
}
function excerpt(docs, budget, priority = [], exclude = []) {
    if (!docs.length)
        return "";
    const filtered = exclude.length ? docs.filter(d => !exclude.includes(d.bucket)) : docs;
    if (!filtered.length)
        return "";
    const primary = priority.length ? filtered.filter(d => priority.includes(d.bucket)) : filtered;
    const secondary = priority.length ? filtered.filter(d => !priority.includes(d.bucket)) : [];
    const primaryBudget = primary.length > 0 ? Math.floor(budget * (secondary.length ? 0.90 : 1.0)) : 0;
    const secondaryBudget = budget - primaryBudget;
    const primaryPer = primary.length > 0 ? Math.floor(primaryBudget / primary.length) : 0;
    const secondaryPer = secondary.length > 0 ? Math.max(300, Math.floor(secondaryBudget / secondary.length)) : 0;
    const parts = [];
    for (const d of primary)
        parts.push(`=== FILE: ${d.name} (${d.bucket}) ===\n${d.text.substring(0, primaryPer)}`);
    for (const d of secondary)
        parts.push(`=== FILE: ${d.name} (${d.bucket}) ===\n${d.text.substring(0, secondaryPer)}`);
    return parts.join("\n\n").substring(0, budget);
}
function stateCoords(state) {
    const map = {
        AL: [32.8, -86.8], AK: [64.2, -153.4], AZ: [34.0, -111.9], AR: [34.8, -92.2], CA: [36.8, -119.4],
        CO: [39.1, -105.4], CT: [41.6, -72.7], DE: [39.0, -75.5], FL: [27.6, -81.5], GA: [32.2, -83.4],
        HI: [20.2, -156.3], ID: [44.2, -114.5], IL: [40.3, -89.0], IN: [40.3, -86.1], IA: [42.0, -93.2],
        KS: [38.5, -98.4], KY: [37.8, -84.9], LA: [31.2, -91.8], ME: [44.7, -69.4], MD: [39.1, -76.8],
        MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.4, -93.1], MS: [32.7, -89.7], MO: [38.5, -92.3],
        MT: [47.0, -110.5], NE: [41.5, -99.9], NV: [38.5, -117.1], NH: [43.7, -71.6], NJ: [40.2, -74.7],
        NM: [34.8, -106.2], NY: [42.2, -74.9], NC: [35.6, -79.8], ND: [47.5, -100.5], OH: [40.4, -82.8],
        OK: [35.6, -96.9], OR: [44.6, -122.1], PA: [40.6, -77.2], RI: [41.7, -71.5], SC: [33.9, -80.9],
        SD: [44.4, -100.2], TN: [35.9, -86.7], TX: [31.5, -99.3], UT: [39.3, -111.1], VT: [44.1, -72.7],
        VA: [37.8, -78.2], WA: [47.4, -121.5], WV: [38.9, -80.4], WI: [44.3, -90.1], WY: [43.0, -107.6],
        DC: [38.9, -77.0],
    };
    const c = map[state?.toUpperCase()];
    if (c)
        return { lat: c[0] + (Math.random() - 0.5) * 0.4, lng: c[1] + (Math.random() - 0.5) * 0.4 };
    return { lat: 39.5, lng: -98.4 };
}
function safeParseHelper(s) {
    if (!s)
        return "{}";
    let x = s.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
    const start = Math.min(...["{", "["].map(ch => { const i = x.indexOf(ch); return i === -1 ? Infinity : i; }));
    if (!Number.isFinite(start))
        return "{}";
    x = x.slice(start);
    let depth = 0, inStr = false, esc = false, end = -1;
    const open = x[0], close = open === "{" ? "}" : "]";
    for (let i = 0; i < x.length; i++) {
        const c = x[i];
        if (esc) {
            esc = false;
            continue;
        }
        if (c === "\\") {
            esc = true;
            continue;
        }
        if (c === '"') {
            inStr = !inStr;
            continue;
        }
        if (inStr)
            continue;
        if (c === open)
            depth++;
        if (c === close) {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    return end >= 0 ? x.slice(0, end + 1) : x;
}
async function getDocumentText(doc) {
    if (doc.ocr_text) {
        return { text: doc.ocr_text, method: doc.ocr_method || "cached", pages: doc.ocr_pages || 0, confidence: 0, cached: true };
    }
    const fetchRes = await fetch(doc.file_url);
    if (!fetchRes.ok) {
        console.error(`[extract] fetch failed ${fetchRes.status} for ${doc.file_name}`);
        return { text: "", method: "fetch-fail", pages: 0, confidence: 0, cached: false };
    }
    const buffer = Buffer.from(await fetchRes.arrayBuffer());
    try {
        const result = await (0, extract_1.extractDocumentText)(buffer, doc.file_name, { nvidiaApiKey: process.env.NVIDIA_API_KEY, pdfScale: 1.5 });
        const db = (0, supabase_1.supabaseAdmin)();
        await db.from("documents").update({ ocr_text: result.text, ocr_method: result.method, ocr_pages: result.pages ?? 0 }).eq("file_url", doc.file_url);
        return { text: result.text, method: result.method, pages: result.pages, confidence: result.avgConfidence, cached: false };
    }
    catch (err) {
        console.error(`[extract] OCR error for ${doc.file_name}:`, err);
        return { text: "", method: "error", pages: 0, confidence: 0, cached: false };
    }
}
async function runExtractionHandler(req, res) {
    const { dealId } = req.body;
    const db = (0, supabase_1.supabaseAdmin)();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    try {
        const { data: existing } = await db.from("ai_jobs")
            .select("id").eq("deal_id", dealId).eq("job_type", "extraction").limit(1);
        if (existing?.length) {
            await db.from("ai_jobs").update({ status: "running" }).eq("id", existing[0].id);
        }
        else {
            await db.from("ai_jobs").insert({ deal_id: dealId, job_type: "extraction", status: "running" });
        }
        await db.from("deals").update({ status: "extraction" }).eq("id", dealId);
        emit(res, { type: "stage", stage: "extraction" });
        const { data: docs } = await db.from("documents")
            .select("id, deal_id, file_url, file_name, document_type, ocr_text, ocr_method, ocr_pages").eq("deal_id", dealId);
        if (!docs?.length) {
            emit(res, { type: "error", message: "No documents found for this deal" });
            res.end();
            return;
        }
        const parsedDocs = [];
        for (const doc of docs) {
            const isCached = !!doc.ocr_text;
            emit(res, { type: "log", agent: "ocr", message: `${isCached ? "📦 cached" : "🔍 OCR"} ${doc.file_name}...` });
            const { text, method, pages, confidence, cached } = await getDocumentText(doc);
            const bucket = classifyDoc(doc.file_name);
            parsedDocs.push({ id: doc.id, name: doc.file_name, text, bucket });
            const confStr = confidence ? ` @ ${confidence.toFixed(0)}%` : "";
            const pagesStr = pages > 1 ? `, ${pages}p` : "";
            const cacheTag = cached ? " [cached]" : " [live OCR]";
            emit(res, { type: "log", agent: "ocr", message: `  ↳ ${bucket.toUpperCase()} · ${method}${pagesStr}${confStr} · ${text.length.toLocaleString()} chars${cacheTag}` });
        }
        const totalChars = parsedDocs.reduce((s, d) => s + d.text.length, 0);
        emit(res, { type: "log", agent: "ocr", message: `✓ Extracted ${totalChars.toLocaleString()} chars across ${parsedDocs.length} docs` });
        const SKIP_DISTILL_THRESHOLD = 3;
        const shouldDistill = parsedDocs.length > SKIP_DISTILL_THRESHOLD || totalChars > 40000;
        if (!shouldDistill) {
            emit(res, { type: "log", agent: "distill", message: `↷ Skipping distillation (${parsedDocs.length} files, small corpus) — using raw text.` });
        }
        const distillOne = async (d) => {
            if (d.text.length < 200)
                return { ...d, facts: d.text };
            const CHUNK = 8000, MAX_CHUNKS = 6;
            const chunks = [];
            for (let i = 0; i < d.text.length && chunks.length < MAX_CHUNKS; i += CHUNK)
                chunks.push(d.text.substring(i, i + CHUNK));
            const summaries = [];
            for (const chunk of chunks) {
                try {
                    const reply = await (0, llm_1.chat)({
                        agent: "distill", model: llm_1.MODELS.LIGHT, max_tokens: 300, temperature: 0.0,
                        messages: [
                            { role: "system", content: "Extract CRE facts only. Output bullet points: numbers, dates, names, percentages, dollar amounts. Reply NO_DATA if no relevant data." },
                            { role: "user", content: `File: ${d.name}\n---\n${chunk}` },
                        ],
                    });
                    if (reply && !/^\s*NO_DATA\s*$/i.test(reply.trim()))
                        summaries.push(reply.trim());
                }
                catch (err) {
                    console.error(`[distill] failed for ${d.name}:`, err);
                }
            }
            return { ...d, facts: summaries.join("\n").substring(0, 3500) };
        };
        let distilled;
        if (shouldDistill) {
            emit(res, { type: "log", agent: "distill", message: `▶ Distilling ${parsedDocs.length} documents in parallel...` });
            distilled = [];
            const CONCURRENCY = 2;
            for (let i = 0; i < parsedDocs.length; i += CONCURRENCY) {
                const batch = parsedDocs.slice(i, i + CONCURRENCY);
                const results = await Promise.all(batch.map(distillOne));
                distilled.push(...results);
                emit(res, { type: "log", agent: "distill", message: `  ↳ ${Math.min(i + CONCURRENCY, parsedDocs.length)}/${parsedDocs.length} distilled` });
            }
            const distilledTotal = distilled.reduce((s, d) => s + d.facts.length, 0);
            emit(res, { type: "log", agent: "distill", message: `✓ Distilled ${parsedDocs.length} docs → ${distilledTotal.toLocaleString()} chars (from ${totalChars.toLocaleString()} raw)` });
        }
        else {
            distilled = parsedDocs.map(d => ({ ...d, facts: d.text }));
        }
        const BUDGET = 5000;
        const ESTIMATES = { metadata: 12, financial: 20, unit_mix: 12, summary: 12, questions: 8, criteria: 10, risks: 12 };
        const buildContext = (budget, priority = [], exclude = []) => excerpt(distilled.map(d => ({ name: d.name, text: d.facts, bucket: d.bucket })), budget, priority, exclude);
        const buildRawContext = (budget, priority = [], exclude = []) => excerpt(parsedDocs, budget, priority, exclude);
        const debugReply = (agent, raw) => {
            const preview = raw.substring(0, 180).replace(/\s+/g, " ");
            emit(res, { type: "log", agent, message: `  ↳ llm: ${preview}${raw.length > 180 ? "…" : ""}` });
            try {
                const parsed = JSON.parse(safeParseHelper(raw));
                emit(res, { type: "agent_result", agent, json: parsed });
            }
            catch {
                emit(res, { type: "agent_result", agent, raw: raw.substring(0, 4000) });
            }
        };
        const runAgent = async (name, fn) => {
            const eta = ESTIMATES[name] ?? 10;
            emit(res, { type: "agent_start", agent: name, etaSeconds: eta });
            emit(res, { type: "log", agent: name, message: `▶ ${name} · est. ~${eta}s` });
            const t0 = Date.now();
            try {
                const result = await fn();
                const dt = (Date.now() - t0) / 1000;
                const vStr = (dt - eta) >= 0 ? `+${(dt - eta).toFixed(1)}s` : `${(dt - eta).toFixed(1)}s`;
                if (result?.summary)
                    emit(res, { type: "log", agent: name, message: `✓ ${result.summary} · ${dt.toFixed(1)}s (${vStr})` });
                else
                    emit(res, { type: "log", agent: name, message: `✓ ${name} done · ${dt.toFixed(1)}s (${vStr})` });
                emit(res, { type: "agent_done", agent: name, durationSeconds: dt });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const dt = ((Date.now() - t0) / 1000).toFixed(1);
                console.error(`[run-extraction] agent '${name}' failed:`, err);
                emit(res, { type: "log", agent: name, message: `⚠ ${name} FAILED after ${dt}s: ${msg.substring(0, 200)}` });
                emit(res, { type: "agent_done", agent: name });
            }
        };
        // ── Agent 1: Metadata ─────────────────────────────────────────────────────
        await runAgent("metadata", async () => {
            emit(res, { type: "log", agent: "metadata", message: "Extracting property metadata..." });
            const ctx = buildRawContext(14000, ["om", "market", "rent_roll"], ["financial", "legal", "capex"]);
            emit(res, { type: "log", agent: "metadata", message: `  ↳ context: ${ctx.length.toLocaleString()} chars (raw)` });
            const raw = await (0, llm_1.chat)({
                agent: "metadata", model: llm_1.MODELS.STANDARD, max_tokens: 1024, temperature: 0.1,
                messages: [{
                        role: "system",
                        content: "You are a CRE analyst. Extract metadata from the OM and related docs. Output ONLY a raw JSON object. No preamble, no markdown. Never guess — if a field is genuinely missing, use 0 or empty string.",
                    }, {
                        role: "user",
                        content: `Find these fields in the documents below and return JSON:
{"name":"","propertyType":"","assetType":"","address":"","city":"","state":"","units":0,"yearBuilt":0,"renovationYear":0,"broker":"","brokerPhone":"","brokerEmail":"","brokerWebsite":"","brand":"","guidancePrice":0,"dealLead":"","floors":0,"parkingSpaces":0,"lotSizeAcres":0,"occupancyRate":0,"constructionType":"","zoning":"","marketName":"","submarket":"","loanAmount":0,"loanType":"","interestRate":0,"loanMaturity":"","managementCompany":"","franchiseExpiry":"","amenitiesSummary":""}

EXTRACTION RULES:
- "name": full property title. - "propertyType": Hotel, Multifamily, Office, Retail, Industrial.
- "assetType": Hospitality, Residential, Commercial, Industrial. - "address": ONLY the street.
- "city": just city name. - "state": 2-letter USPS code. - "units": rooms/keys or apartment units.
- "broker": brokerage firm only. - "brand": hotel flag. - "dealLead": named broker contact person.
- "guidancePrice": asking price in dollars as integer.

DOCUMENTS:
${ctx}`,
                    }],
            });
            debugReply("metadata", raw);
            const metaJson = (0, llm_1.safeParse)(raw, {});
            const allText = parsedDocs.map(d => d.text).join(" ");
            if (!metaJson.city || !metaJson.state) {
                const m = allText.substring(0, 20000).match(/([A-Z][a-zA-Z][a-zA-Z\s-]{1,25}),\s*([A-Z]{2})\s+\d{5}\b/);
                if (m) {
                    if (!metaJson.city)
                        metaJson.city = m[1].trim();
                    if (!metaJson.state)
                        metaJson.state = m[2];
                }
            }
            if (!metaJson.guidancePrice) {
                const scan = allText.substring(0, 40000);
                const m1 = scan.match(/(?:guidance|asking|offering|purchase|list|sale)\s*price[:\s–-]*\$?\s*([\d,]+(?:\.\d+)?)\s*(M|MM|million|B|K)?/i);
                const m2 = scan.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(M|MM|million|B|K)\b/i);
                for (const m of [m1, m2]) {
                    if (!m)
                        continue;
                    let n = parseFloat(m[1].replace(/,/g, ""));
                    const suffix = (m[2] || "").toUpperCase();
                    if (suffix === "B")
                        n *= 1000000000;
                    else if (/M|MM|MILLION/.test(suffix))
                        n *= 1000000;
                    else if (suffix === "K")
                        n *= 1000;
                    if (n > 100000) {
                        metaJson.guidancePrice = Math.round(n);
                        break;
                    }
                }
            }
            if (!metaJson.units) {
                const matches = [...allText.matchAll(/\b(\d{2,4})\s*(?:-\s*)?(?:keys?|rooms?|guest\s*rooms?|units?)\b/gi)];
                for (const m of matches) {
                    const n = parseInt(m[1], 10);
                    if (n >= 40 && n <= 2000 && !(n >= 1900 && n <= 2100)) {
                        metaJson.units = n;
                        break;
                    }
                }
            }
            if (typeof metaJson.city === "string") {
                metaJson.city = metaJson.city.replace(/^(?:Inn|Suites?|Hotel|Resort|Marriott|Hilton|Hyatt|Holiday|Residence|Fairfield|Hampton|Courtyard|Downtown|Airport)\s+/i, "").trim();
            }
            const coords = stateCoords(metaJson.state || "");
            const n = (k) => (metaJson[k] > 0 ? metaJson[k] : undefined);
            const s = (k) => metaJson[k] || undefined;
            await db.from("deals").update({
                name: s("name"), address: s("address"), city: s("city"), state: s("state"),
                asset_type: s("assetType"), property_type: s("propertyType"),
                broker: s("broker"), broker_phone: s("brokerPhone"), broker_email: s("brokerEmail"),
                broker_website: s("brokerWebsite"), brand: s("brand"), deal_lead: s("dealLead"),
                guidance_price: n("guidancePrice"), units: n("units"), year_built: n("yearBuilt"),
                renovation_year: n("renovationYear"), floors: n("floors"), parking_spaces: n("parkingSpaces"),
                lot_size_acres: n("lotSizeAcres"), occupancy_rate: n("occupancyRate"),
                construction_type: s("constructionType"), zoning: s("zoning"),
                market_name: s("marketName"), submarket: s("submarket"),
                loan_amount: n("loanAmount"), loan_type: s("loanType"), interest_rate: n("interestRate"),
                loan_maturity: s("loanMaturity"), management_company: s("managementCompany"),
                franchise_expiry: s("franchiseExpiry"), amenities_summary: s("amenitiesSummary"),
                lat: coords.lat, lng: coords.lng,
            }).eq("id", dealId);
            const metaFields = ["name", "address", "city", "state", "assetType", "propertyType", "broker", "brokerPhone", "brokerEmail", "brokerWebsite", "brand", "guidancePrice", "units", "yearBuilt", "renovationYear", "dealLead", "floors", "parkingSpaces", "lotSizeAcres", "occupancyRate", "constructionType", "zoning", "marketName", "submarket", "loanAmount", "loanType", "interestRate", "loanMaturity", "managementCompany", "franchiseExpiry", "amenitiesSummary"];
            const metaInserts = metaFields.filter(f => metaJson[f]).map(f => ({ deal_id: dealId, field_name: f, value: String(metaJson[f]), confidence_score: 0.92, source_document_id: parsedDocs[0]?.id }));
            await db.from("extracted_data").delete().eq("deal_id", dealId).in("field_name", metaFields);
            if (metaInserts.length)
                await db.from("extracted_data").insert(metaInserts);
            return { summary: `${metaJson.name || "(no name)"} · ${metaJson.city || "?"}, ${metaJson.state || "?"} · ${metaInserts.length}/${metaFields.length} fields` };
        });
        // ── Agent 2: Financials ───────────────────────────────────────────────────
        await runAgent("financial", async () => {
            emit(res, { type: "log", agent: "financial", message: "Parsing T-12 financial statements..." });
            const allText = parsedDocs.filter(d => d.bucket === "financial" || d.bucket === "om").map(d => d.text).join("\n");
            const parseMoney = (s) => { const v = parseFloat(s.replace(/,/g, "")); return isNaN(v) ? 0 : Math.round(v); };
            const parseDataLine = (line) => {
                const parts = line.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
                const nums = parts.slice(1).map(p => ({ raw: p, v: parseMoney(p) })).filter(x => /^-?[\d,]+\.?\d*$/.test(x.raw));
                if (!nums.length)
                    return null;
                const result = {};
                result.ttm = nums[nums.length - 1].v;
                const monthNums = nums.length >= 12 ? nums.slice(0, 12) : nums.slice(0, nums.length - 1);
                monthNums.forEach((n, i) => { result[`m${i + 1}`] = n.v; });
                return result;
            };
            const LABEL_MAP = {
                "total room revenue": { metric: "Total Room Revenue", category: "income" }, "total operating revenue": { metric: "Total Revenue", category: "income" }, "total revenue": { metric: "Total Revenue", category: "income" }, "gross operating profit": { metric: "Gross Operating Profit", category: "income" }, "ebitda": { metric: "EBITDA", category: "income" }, "net income": { metric: "Net Income", category: "income" }, "gross potential rent": { metric: "Gross Potential Rent", category: "income" }, "effective gross income": { metric: "Effective Gross Income", category: "income" }, "net operating income": { metric: "Net Operating Income", category: "income" }, "total rooms expenses": { metric: "Total Rooms Expenses", category: "expense" }, "rooms expenses": { metric: "Rooms Expenses", category: "expense" }, "total departmental expenses": { metric: "Total Departmental Expenses", category: "expense" }, "administration & general": { metric: "Administration & General", category: "expense" }, "sales & marketing": { metric: "Sales & Marketing", category: "expense" }, "property operations & maintenance": { metric: "Property Operations & Maintenance", category: "expense" }, "utilities": { metric: "Utilities", category: "expense" }, "total undistributed expenses": { metric: "Total Undistributed Expenses", category: "expense" }, "total expenses": { metric: "Total Expenses", category: "expense" }, "management fees": { metric: "Management Fees", category: "expense" }, "total operating expenses": { metric: "Total Operating Expenses", category: "expense" }, "vacancy & concessions": { metric: "Vacancy & Concessions", category: "expense" }, "depreciation & amortization": { metric: "Depreciation & Amortization", category: "expense" },
            };
            const regexRows = [];
            const seen = new Set();
            for (const line of allText.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                const labelRaw = trimmed.split(/\s{2,}|\t/)[0].trim().toLowerCase().replace(/\s+/g, " ");
                const mapped = LABEL_MAP[labelRaw];
                if (!mapped || seen.has(mapped.metric))
                    continue;
                const nums = parseDataLine(trimmed);
                if (!nums?.ttm)
                    continue;
                seen.add(mapped.metric);
                regexRows.push({ metric: mapped.metric, category: mapped.category, ...nums });
            }
            const parseKpiLine = (pattern) => { const m = allText.match(pattern); return m ? parseFloat(m[1].replace(/,/g, "")) || 0 : 0; };
            const kpiOccupancy = parseKpiLine(/%Occupancy%[^\n]*?([\d.]+)\s*$/m) || parseKpiLine(/\bOccupancy\b[^\n]*?([\d.]+)%/i);
            const kpiADR = parseKpiLine(/\bADR\b[^\n]*?([\d,]+\.?\d*)\s*$/m);
            const kpiRevPAR = parseKpiLine(/\bRevPAR\b[^\n]*?([\d,]+\.?\d*)\s*$/m);
            const kpiRevenue = parseKpiLine(/Total Operating Revenue[^\n]*?([\d,]+\.?\d*)\s*$/m) || parseKpiLine(/Total Revenue[^\n]*?([\d,]+\.?\d*)\s*$/m);
            const kpiGOP = parseKpiLine(/Gross Operating Profit[^\n]*?([-\d,]+\.?\d*)\s*$/m);
            const kpiEBITDA = parseKpiLine(/\bEBITDA\b[^\n]*?([-\d,]+\.?\d*)\s*$/m);
            const kpiCapRate = parseKpiLine(/\bcap\s*rate\b[^\n]*?([\d.]+)%/i);
            emit(res, { type: "log", agent: "financial", message: `  ↳ regex: ${regexRows.length} rows · occ=${kpiOccupancy}% ADR=$${kpiADR} RevPAR=$${kpiRevPAR}` });
            let llmRows = [];
            if (regexRows.length < 8) {
                emit(res, { type: "log", agent: "financial", message: `  ↳ regex underperformed (${regexRows.length} rows) — LLM fallback...` });
                const ctxSlice = allText.slice(0, 4000);
                try {
                    const raw = await (0, llm_1.chat)({ agent: "financial", model: llm_1.MODELS.STANDARD, max_tokens: 900, temperature: 0.0, messages: [{ role: "system", content: "Extract hotel P&L rows. Raw JSON only. Integers only. Omit zero fields. Last column=ttm." }, { role: "user", content: `Return: {"financials":[{"metric":"","category":"income","ttm":0,"m1":0}]}\nDOCUMENTS:\n${ctxSlice}` }] });
                    debugReply("financial", raw);
                    llmRows = (0, llm_1.safeParse)(raw, {}).financials || [];
                }
                catch (err) {
                    console.error("[financial] LLM fallback failed:", err);
                }
            }
            const mergedMap = new Map();
            for (const r of [...regexRows, ...llmRows]) {
                const key = r.metric.toLowerCase();
                if (!mergedMap.has(key))
                    mergedMap.set(key, r);
            }
            const noi = kpiGOP || kpiEBITDA || 0;
            const dealUpd = {};
            if (noi)
                dealUpd.noi = noi;
            if (kpiCapRate)
                dealUpd.cap_rate = kpiCapRate;
            if (!kpiCapRate && noi) {
                const { data: dealRow } = await db.from("deals").select("guidance_price").eq("id", dealId).single();
                const gp = dealRow?.guidance_price;
                if (gp && gp > 0)
                    dealUpd.cap_rate = parseFloat(((noi / gp) * 100).toFixed(2));
            }
            if (Object.keys(dealUpd).length)
                await db.from("deals").update(dealUpd).eq("id", dealId);
            const { data: dealInfo } = await db.from("deals").select("units").eq("id", dealId).single();
            const totalUnits = dealInfo?.units || 0;
            const egiRow = Array.from(mergedMap.values()).find(r => /effective gross income|egi|total revenue|total operating revenue/i.test(r.metric));
            const egiTTM = egiRow ? (egiRow.ttm || 0) : (kpiRevenue || 0);
            const rows = Array.from(mergedMap.values())
                .filter(r => r.metric && Object.entries(r).some(([k, v]) => k !== "metric" && k !== "category" && typeof v === "number" && v !== 0))
                .map(r => {
                const monthlySum = [r.m1, r.m2, r.m3, r.m4, r.m5, r.m6, r.m7, r.m8, r.m9, r.m10, r.m11, r.m12].reduce((s, v) => s + (v || 0), 0);
                const ttmVal = r.ttm || monthlySum || r.y2025 || r.y2024 || r.y2023 || r.y2022 || r.y2021 || 0;
                const perUnit = totalUnits > 0 && ttmVal ? Math.round(ttmVal / totalUnits) : 0;
                const pctEgi = egiTTM > 0 && ttmVal ? parseFloat(((ttmVal / egiTTM) * 100).toFixed(1)) : 0;
                return {
                    deal_id: dealId, category: (r.category === "expense" ? "expense" : "income"),
                    sub_category: r.metric, y2021: r.y2021 || 0, y2022: r.y2022 || 0, y2023: r.y2023 || 0, y2024: r.y2024 || 0, y2025: r.y2025 || 0, ttm: ttmVal,
                    m1: r.m1 || 0, m2: r.m2 || 0, m3: r.m3 || 0, m4: r.m4 || 0, m5: r.m5 || 0, m6: r.m6 || 0,
                    m7: r.m7 || 0, m8: r.m8 || 0, m9: r.m9 || 0, m10: r.m10 || 0, m11: r.m11 || 0, m12: r.m12 || 0,
                    per_unit: perUnit, pct_egi: pctEgi,
                };
            });
            await db.from("financials").delete().eq("deal_id", dealId);
            if (rows.length)
                await db.from("financials").insert(rows);
            return { summary: `NOI $${(noi || 0).toLocaleString()} · Cap ${kpiCapRate || 0}% · Rev $${(kpiRevenue || 0).toLocaleString()} · ${rows.length} line items` };
        });
        // ── Agent 2b: Unit Mix ────────────────────────────────────────────────────
        await runAgent("unit_mix", async () => {
            const umText = parsedDocs.filter(d => d.bucket === "rent_roll" || d.bucket === "om").map(d => d.text).join("\n");
            const parseMoney2 = (s) => parseFloat(s.replace(/[,$]/g, "")) || 0;
            const regexRows = [];
            const seenTypes = new Set();
            for (const line of umText.split("\n")) {
                const t = line.trim();
                if (!t || t.length < 8)
                    continue;
                const hm = t.match(/^(.{4,40}?)\s{2,}(\d{1,4})\s+(\d{1,3})\s+([\d.]+)\s*([\d.]*)/);
                if (hm) {
                    const label = hm[1].trim();
                    const total = parseInt(hm[2]);
                    const vacant = parseInt(hm[3]);
                    const rate1 = parseMoney2(hm[4]);
                    const rate2 = parseMoney2(hm[5] || "0");
                    if (total >= 1 && total <= 2000 && rate1 > 0 && !seenTypes.has(label.toLowerCase())) {
                        const isHotel = /king|queen|double|twin|suite|ada|standard|deluxe|premium/i.test(label);
                        const isMF = /studio|\d\s*br|bed|bath|efficiency|commercial/i.test(label);
                        if (isHotel || isMF) {
                            seenTypes.add(label.toLowerCase());
                            regexRows.push({ unitType: label, totalUnits: total, vacantUnits: vacant, avgBaseRent: isHotel ? rate1 : 0, avgTotalRent: isHotel ? (rate2 || rate1) : 0 });
                        }
                    }
                }
            }
            let llmRows = [];
            if (!regexRows.length) {
                try {
                    const raw = await (0, llm_1.chat)({ agent: "unit_mix", model: llm_1.MODELS.STANDARD, max_tokens: 800, temperature: 0.0, messages: [{ role: "system", content: "CRE analyst. Extract unit/room mix. Raw JSON only." }, { role: "user", content: `Extract every distinct unit/room type. Return JSON:\n{"unitMix":[{"unitType":"","totalUnits":0,"vacantUnits":0,"avgBaseRent":0,"avgRent":0,"marketRent":0}]}\n\nDOCUMENTS:\n${umText.slice(0, 5000)}` }] });
                    debugReply("unit_mix", raw);
                    llmRows = (0, llm_1.safeParse)(raw, {}).unitMix || [];
                }
                catch (err) {
                    console.error("[unit_mix] LLM failed:", err);
                }
            }
            const merged = regexRows.length ? regexRows : llmRows;
            let rows = merged.filter(u => u.unitType && (u.totalUnits || 0) > 0).map(u => {
                const base = u.avgBaseRent || 0;
                const total = u.avgTotalRent || u.avgRent || base;
                const units = u.totalUnits || 0;
                const vacant = u.vacantUnits || 0;
                const physOcc = u.physicalOcc ?? (units > 0 ? parseFloat((((units - vacant) / units) * 100).toFixed(1)) : 0);
                return { deal_id: dealId, unit_type: u.unitType, total_units: units, vacant_units: vacant, avg_sqft: u.avgSqft || 0, avg_base_rent: base, avg_total_rent: total, avg_rent: total || base, latest_lease_up: u.latestLeaseUp || null, avg_utilities: u.avgUtilities || 0, market_rent: u.marketRent || 0, annual_revenue: total > 0 ? Math.round(total * units * 12) : 0, loss_to_lease: (u.marketRent || 0) > 0 && base > 0 ? parseFloat(((u.marketRent || 0) - base).toFixed(2)) : 0, physical_occ: physOcc };
            });
            if (!rows.length) {
                const { data: dealRow } = await db.from("deals").select("units,property_type,occupancy_rate").eq("id", dealId).single();
                if (dealRow?.units && dealRow.units > 0) {
                    rows = [{ deal_id: dealId, unit_type: /hotel|hospitality/i.test(dealRow.property_type || "") ? "Guest Rooms" : "Units", total_units: dealRow.units, vacant_units: 0, avg_sqft: 0, avg_base_rent: 0, avg_total_rent: 0, avg_rent: 0, latest_lease_up: null, avg_utilities: 0, market_rent: 0, annual_revenue: 0, loss_to_lease: 0, physical_occ: dealRow.occupancy_rate || 0 }];
                }
            }
            await db.from("unit_mix").delete().eq("deal_id", dealId);
            if (rows.length)
                await db.from("unit_mix").insert(rows);
            const totalU = rows.reduce((s, r) => s + r.total_units, 0);
            const totalV = rows.reduce((s, r) => s + r.vacant_units, 0);
            const occ = totalU > 0 ? (((totalU - totalV) / totalU) * 100).toFixed(1) : "0";
            return { summary: `${rows.length} types · ${totalU} units · ${occ}% occ` };
        });
        // ── Agents 3–6: parallel ──────────────────────────────────────────────────
        emit(res, { type: "log", agent: "ocr", message: "▶ Running agents 3-6 in parallel (summary · questions · criteria · risks)..." });
        await Promise.all([
            runAgent("summary", async () => {
                const ctx = buildContext(BUDGET, ["om", "market"], ["financial", "rent_roll", "legal", "capex"]);
                const raw = await (0, llm_1.chat)({ agent: "summary", model: llm_1.MODELS.STANDARD, max_tokens: 512, temperature: 0.2, messages: [{ role: "system", content: "Senior CRE analyst. Output ONLY a raw JSON object — no markdown, no preamble." }, { role: "user", content: `Write brokerNarrative (2-3 sentences) and locationInsight (1-2 sentences). Return JSON: {"brokerNarrative":"","locationInsight":""}\n\nDOCUMENTS:\n${ctx}` }] });
                debugReply("summary", raw);
                const j = (0, llm_1.safeParse)(raw, {});
                if (j.brokerNarrative || j.locationInsight)
                    await db.from("deals").update({ broker_narrative: j.brokerNarrative || "", location_insight: j.locationInsight || "" }).eq("id", dealId);
                return { summary: `narrative ${j.brokerNarrative ? "✓" : "✗"}, location ${j.locationInsight ? "✓" : "✗"}` };
            }),
            runAgent("questions", async () => {
                const ctx = buildContext(BUDGET, ["om", "financial", "market"], ["legal", "capex"]);
                const raw = await (0, llm_1.chat)({ agent: "questions", model: llm_1.MODELS.LIGHT, max_tokens: 768, temperature: 0.2, messages: [{ role: "system", content: "CRE due diligence analyst. Output ONLY a raw JSON object — no markdown." }, { role: "user", content: `Generate 7 sharp due diligence questions specific to THIS property. Return JSON: {"questions":[{"question":"","category":""}]}\n\nDOCUMENTS:\n${ctx}` }] });
                debugReply("questions", raw);
                const j = (0, llm_1.safeParse)(raw, {});
                if (j.questions?.length) {
                    await db.from("questions").delete().eq("deal_id", dealId);
                    await db.from("questions").insert(j.questions.map(q => ({ deal_id: dealId, question: q.question, category: q.category || "General" })));
                }
                return { summary: `${j.questions?.length || 0} questions` };
            }),
            runAgent("criteria", async () => {
                const ctx = buildContext(BUDGET, ["financial", "om", "rent_roll"], ["legal", "capex", "market"]);
                const raw = await (0, llm_1.chat)({ agent: "criteria", model: llm_1.MODELS.STANDARD, max_tokens: 768, temperature: 0.1, messages: [{ role: "system", content: "CRE underwriter. Output ONLY a raw JSON object." }, { role: "user", content: `Evaluate deal against 7 acquisition criteria (Deal Size ≥$5M, NOI Margin ≥30%, Cap Rate 6-9%, Occupancy ≥80%, Year Built ≥1980, DSCR ≥1.20, Expense Ratio ≤55%). Return JSON: {"criteria":[{"criteria":"","requirement":"","actual":"","meets":true}]}\n\nDOCUMENTS:\n${ctx}` }] });
                debugReply("criteria", raw);
                const j = (0, llm_1.safeParse)(raw, {});
                if (j.criteria?.length) {
                    await db.from("criteria").delete().eq("deal_id", dealId);
                    await db.from("criteria").insert(j.criteria.map(c => ({ deal_id: dealId, ...c })));
                }
                return { summary: `${j.criteria?.length || 0} criteria (${j.criteria?.filter(c => c.meets).length || 0} pass)` };
            }),
            runAgent("risks", async () => {
                const ctx = buildContext(BUDGET, ["legal", "capex", "financial", "om"], ["rent_roll", "market"]);
                const raw = await (0, llm_1.chat)({ agent: "risks", model: llm_1.MODELS.STANDARD, max_tokens: 1024, temperature: 0.15, messages: [{ role: "system", content: "CRE risk analyst. Output ONLY a raw JSON object." }, { role: "user", content: `Identify material risks and provide 3-5 AI explanations. Return JSON:\n{"risks":[{"description":"","severity":"critical|high|medium|low"}],"explanations":[{"fieldName":"","explanationText":"","sourceSnippet":"","sourcePage":0}]}\n\nDOCUMENTS:\n${ctx}` }] });
                debugReply("risks", raw);
                const j = (0, llm_1.safeParse)(raw, {});
                if (j.risks?.length) {
                    await db.from("risks").delete().eq("deal_id", dealId);
                    await db.from("risks").insert(j.risks.map(r => ({ deal_id: dealId, description: r.description, severity: r.severity || "medium" })));
                }
                if (j.explanations?.length) {
                    await db.from("ai_explanations").delete().eq("deal_id", dealId);
                    await db.from("ai_explanations").insert(j.explanations.map(e => ({ deal_id: dealId, field_name: e.fieldName, explanation_text: e.explanationText, source_document_id: parsedDocs[0]?.id || null, source_page: e.sourcePage || null, source_snippet: e.sourceSnippet || null })));
                }
                return { summary: `${j.risks?.length || 0} risks, ${j.explanations?.length || 0} explanations` };
            }),
        ]);
        await db.from("ai_jobs").update({ status: "completed", result: { agents: 6 } }).eq("deal_id", dealId).eq("job_type", "extraction");
        await db.from("deals").update({ status: "underwriting" }).eq("id", dealId);
        emit(res, { type: "complete", stage: "underwriting" });
    }
    catch (err) {
        console.error("[run-extraction] fatal:", err);
        const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
        emit(res, { type: "error", message: msg });
        await db.from("ai_jobs").update({ status: "failed", result: { error: msg } }).eq("deal_id", dealId).eq("job_type", "extraction");
    }
    finally {
        res.end();
    }
}
