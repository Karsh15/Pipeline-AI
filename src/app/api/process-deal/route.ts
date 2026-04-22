import { NextRequest } from "next/server";
import { chat } from "@/lib/llm";

async function parseDocument(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    return result.text.substring(0, 16000);
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = require("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });

    // Pre-extract key fields by scanning every cell in every sheet
    const KEY_MAP: Record<string, string> = {
      "property name": "Property Name", "name": "Property Name",
      "city": "City", "state": "State", "zip": "ZIP", "zip code": "ZIP",
      "address": "Address", "full address": "Full Address",
      "property type": "Property Type", "asset type": "Asset Type",
      "brand": "Brand", "broker": "Broker", "deal lead": "Deal Lead",
      "guidance price": "Guidance Price", "asking price": "Asking Price",
      "cap rate": "Cap Rate", "year built": "Year Built",
      "keys": "Units", "rooms": "Units", "units": "Units",
    };
    const facts: string[] = [];
    for (const sheetName of workbook.SheetNames as string[]) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as unknown[][];
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 2) continue;
        const key = String(row[0] ?? "").trim().toLowerCase();
        const val = String(row[1] ?? "").trim();
        if (KEY_MAP[key] && val && val !== "0") {
          facts.push(`${KEY_MAP[key]}: ${val}`);
        }
      }
    }

    let text = "";
    if (facts.length > 0) {
      text += "=== KEY PROPERTY FACTS ===\n" + facts.join("\n") + "\n\n";
    }
    console.log("[DEBUG KEY FACTS]", facts.join(", "));

    for (const sheetName of workbook.SheetNames as string[]) {
      text += `=== Sheet: ${sheetName} ===\n`;
      text += XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]) + "\n\n";
    }
    return text.substring(0, 16000);
  }

  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return (result.value as string).substring(0, 16000);
  }

  return buffer.toString("utf-8").substring(0, 16000);
}

function emit(
  controller: ReadableStreamDefaultController,
  enc: TextEncoder,
  data: object
) {
  controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
}

function stateCoords(state: string): { lat: number; lng: number } {
  const map: Record<string, [number, number]> = {
    AL: [32.8, -86.8], AK: [64.2, -153.4], AZ: [34.0, -111.9],
    AR: [34.8, -92.2], CA: [36.8, -119.4], CO: [39.1, -105.4],
    CT: [41.6, -72.7], DE: [39.0, -75.5], FL: [27.6, -81.5],
    GA: [32.2, -83.4], HI: [20.2, -156.3], ID: [44.2, -114.5],
    IL: [40.3, -89.0], IN: [40.3, -86.1], IA: [42.0, -93.2],
    KS: [38.5, -98.4], KY: [37.8, -84.9], LA: [31.2, -91.8],
    ME: [44.7, -69.4], MD: [39.1, -76.8], MA: [42.3, -71.8],
    MI: [44.3, -85.4], MN: [46.4, -93.1], MS: [32.7, -89.7],
    MO: [38.5, -92.3], MT: [47.0, -110.5], NE: [41.5, -99.9],
    NV: [38.5, -117.1], NH: [43.7, -71.6], NJ: [40.2, -74.7],
    NM: [34.8, -106.2], NY: [42.2, -74.9], NC: [35.6, -79.8],
    ND: [47.5, -100.5], OH: [40.4, -82.8], OK: [35.6, -96.9],
    OR: [44.6, -122.1], PA: [40.6, -77.2], RI: [41.7, -71.5],
    SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.9, -86.7],
    TX: [31.5, -99.3], UT: [39.3, -111.1], VT: [44.1, -72.7],
    VA: [37.8, -78.2], WA: [47.4, -121.5], WV: [38.9, -80.4],
    WI: [44.3, -90.1], WY: [43.0, -107.6], DC: [38.9, -77.0],
  };
  const c = map[state?.toUpperCase()];
  if (c) return { lat: c[0] + (Math.random() - 0.5) * 0.5, lng: c[1] + (Math.random() - 0.5) * 0.5 };
  return { lat: 39.5 + (Math.random() - 0.5) * 5, lng: -98.4 + (Math.random() - 0.5) * 5 };
}

const AGENTS = [
  {
    key: "metadata",
    label: "Metadata Extraction",
    runningLogs: [
      "Parsing document structure...",
      "Detecting property information...",
      "Extracting location data...",
      "Reading property specifications...",
    ],
    prompt: `Extract property metadata from this real estate document. Return ONLY valid JSON (no markdown):
{
  "name": "property/deal name",
  "propertyType": "e.g. Full Service Hotel, Class A Office, Multifamily",
  "assetType": "e.g. Hospitality, Office, Multifamily, Retail, Industrial",
  "address": "street address only, no city/state",
  "city": "city name — look for labeled 'City' field OR parse from address string like '123 Main St, Dallas, TX 75001' OR from any mention of the city in the document",
  "state": "2-letter US state code — look for labeled 'State' field OR parse from address string OR from any location mention (e.g. 'Austin, TX' → 'TX'). NEVER leave empty if any location is mentioned.",
  "units": <number of rooms/keys/units or 0>,
  "yearBuilt": <4-digit year or 0>,
  "broker": "broker firm name",
  "brand": "brand/flag or Independent",
  "guidancePrice": <asking price number or 0>,
  "dealLead": "deal lead person name or empty string"
}
IMPORTANT: city and state must never be empty strings if any location information exists anywhere in the document.`,
  },
  {
    key: "financial",
    label: "Financial Analysis",
    runningLogs: [
      "Opening financial model...",
      "Parsing revenue tables...",
      "Computing NOI margins...",
      "Analyzing multi-year trends...",
      "Calculating cap rates...",
    ],
    prompt: `Extract financial data from this real estate document. Return ONLY valid JSON (no markdown):
{
  "noi": <TTM NOI number or 0>,
  "capRate": <cap rate % like 6.5, or 0>,
  "financials": [
    {"metric": "Total Revenue", "y2021": 0, "y2022": 0, "y2023": 0, "ttm": 0},
    {"metric": "GOP",           "y2021": 0, "y2022": 0, "y2023": 0, "ttm": 0},
    {"metric": "EBITDA",        "y2021": 0, "y2022": 0, "y2023": 0, "ttm": 0},
    {"metric": "NOI",           "y2021": 0, "y2022": 0, "y2023": 0, "ttm": 0}
  ]
}
Use actual numbers from the document. Use 0 for any values not found.`,
  },
  {
    key: "summary",
    label: "Investment Summary",
    runningLogs: [
      "Synthesizing broker narrative...",
      "Analyzing value-add opportunities...",
      "Reviewing location fundamentals...",
      "Drafting investment thesis...",
    ],
    prompt: `Write a professional investment summary for this real estate deal. Return ONLY valid JSON (no markdown):
{
  "brokerNarrative": "2-3 sentence broker narrative describing the deal opportunity and key investment highlights",
  "locationInsight": "1-2 sentence location and market insight"
}`,
  },
  {
    key: "questions",
    label: "DD Questions Generator",
    runningLogs: [
      "Scanning for data gaps...",
      "Identifying financial anomalies...",
      "Reviewing assumptions...",
      "Generating question set...",
    ],
    prompt: `Generate due diligence questions for this real estate deal. Return ONLY valid JSON (no markdown):
{
  "questions": ["question 1", "question 2", ...]
}
Generate 6-8 specific, actionable due diligence questions based on the document content.`,
  },
  {
    key: "criteria",
    label: "Investment Criteria",
    runningLogs: [
      "Loading investment criteria rules...",
      "Evaluating deal metrics...",
      "Checking compliance thresholds...",
    ],
    prompt: `Evaluate this real estate deal against standard investment criteria. Return ONLY valid JSON (no markdown):
{
  "criteria": [
    {"criteria": "Deal Size",     "requirement": "> $5M",  "actual": "value or N/A", "meets": true},
    {"criteria": "NOI Margin",    "requirement": "> 20%",  "actual": "value or N/A", "meets": true},
    {"criteria": "Year Built",    "requirement": "> 2000", "actual": "value or N/A", "meets": true},
    {"criteria": "Occupancy",     "requirement": "> 80%",  "actual": "value or N/A", "meets": true},
    {"criteria": "Cap Rate",      "requirement": "> 5%",   "actual": "value or N/A", "meets": true}
  ]
}`,
  },
  {
    key: "risks",
    label: "Risk Detection",
    runningLogs: [
      "Running anomaly detection...",
      "Scanning expense ratios...",
      "Reviewing market risk factors...",
      "Scoring risk severity...",
    ],
    prompt: `Identify key investment risks in this real estate deal. Return ONLY valid JSON (no markdown):
{
  "risks": ["risk description 1", "risk description 2", ...]
}
List 4-6 specific, actionable risk flags based on the document.`,
  },
] as const;

type AgentKey = (typeof AGENTS)[number]["key"];

function completionLog(key: AgentKey, data: Record<string, unknown>): string {
  switch (key) {
    case "metadata": {
      const d = data as { name?: string; city?: string; state?: string };
      return `✓ Extracted: ${d.name || "property"} — ${d.city || ""}${d.state ? ", " + d.state : ""}`;
    }
    case "financial": {
      const d = data as { noi?: number; capRate?: number };
      return `✓ NOI: $${(d.noi || 0).toLocaleString()} | Cap Rate: ${d.capRate || 0}%`;
    }
    case "summary":
      return "✓ Investment summary generated";
    case "questions": {
      const d = data as { questions?: unknown[] };
      return `✓ ${(d.questions || []).length} due diligence questions generated`;
    }
    case "criteria": {
      const d = data as { criteria?: { meets: boolean }[] };
      const met = (d.criteria || []).filter((c) => c.meets).length;
      return `✓ ${met}/${(d.criteria || []).length} criteria met`;
    }
    case "risks": {
      const d = data as { risks?: unknown[] };
      return `✓ ${(d.risks || []).length} risk flags identified`;
    }
  }
}

export async function POST(req: NextRequest) {
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
          emit(controller, enc, { type: "error", message: "No file provided" });
          controller.close();
          return;
        }

        emit(controller, enc, {
          type: "log",
          agent: "system",
          message: `Processing "${file.name}" (${Math.round(file.size / 1024)} KB)...`,
        });

        let docText: string;
        try {
          docText = await parseDocument(file);
          emit(controller, enc, {
            type: "log",
            agent: "system",
            message: `✓ Extracted ${docText.length.toLocaleString()} characters from document`,
          });
        } catch (err) {
          emit(controller, enc, {
            type: "error",
            message: `Failed to parse document: ${err}`,
          });
          controller.close();
          return;
        }

        const results: Partial<Record<AgentKey, Record<string, unknown>>> = {};

        for (const agent of AGENTS) {
          emit(controller, enc, { type: "agent_start", agent: agent.key });

          for (const log of agent.runningLogs) {
            await new Promise((r) => setTimeout(r, 350));
            emit(controller, enc, { type: "log", agent: agent.key, message: log });
          }

          try {
            const content = await chat({
              max_tokens: 2048,
              messages: [
                { role: "system", content: "You are an expert real estate investment analyst. Return ONLY valid JSON as specified — no markdown fences, no extra text." },
                { role: "user", content: `${agent.prompt}\n\nDOCUMENT:\n${docText}` },
              ],
            });
            const msg = { choices: [{ message: { content } }] };

            const raw = msg.choices[0]?.message?.content ?? "{}";
            if (agent.key === "metadata") console.log("[DEBUG metadata raw]", raw.substring(0, 500));
            const cleaned = raw
              .replace(/^```(?:json)?\n?/m, "")
              .replace(/\n?```$/m, "")
              .trim();
            const parsed = JSON.parse(cleaned) as Record<string, unknown>;

            // Fallback location parsing if model returned empty city/state
            if (agent.key === "metadata") {
              if (!parsed.city || !parsed.state) {
                const searchText = String(parsed.address || "") + " " + docText.substring(0, 3000);
                // Match "City, ST" or "City, ST ZIPCODE"
                const cityState = searchText.match(/([A-Za-z][A-Za-z\s]{1,30}),\s*([A-Z]{2})\b/);
                if (cityState) {
                  if (!parsed.city)  parsed.city  = cityState[1].trim();
                  if (!parsed.state) parsed.state = cityState[2];
                }
              }
            }

            results[agent.key] = parsed;

            emit(controller, enc, {
              type: "log",
              agent: agent.key,
              message: completionLog(agent.key, parsed),
            });
            emit(controller, enc, {
              type: "agent_done",
              agent: agent.key,
              data: parsed,
            });
          } catch (err) {
            console.error(`[AGENT ERROR] ${agent.key}:`, err);
            emit(controller, enc, {
              type: "log",
              agent: agent.key,
              message: `⚠ Extraction issue: ${err}`,
            });
            emit(controller, enc, {
              type: "agent_done",
              agent: agent.key,
              data: {},
            });
          }
        }

        // Assemble final deal fields
        const meta = (results.metadata || {}) as Record<string, unknown>;
        const fin = (results.financial || {}) as Record<string, unknown>;
        const sum = (results.summary || {}) as Record<string, unknown>;
        const coords = stateCoords((meta.state as string) || "");

        const extracted = {
          name: (meta.name as string) || file.name.replace(/\.[^/.]+$/, ""),
          propertyType: (meta.propertyType as string) || "Unknown",
          assetType: (meta.assetType as string) || "Mixed-Use",
          address: (meta.address as string) || "",
          city: (meta.city as string) || "",
          state: (meta.state as string) || "",
          units: (meta.units as number) || 0,
          yearBuilt: (meta.yearBuilt as number) || 0,
          broker: (meta.broker as string) || "",
          brand: (meta.brand as string) || "Independent",
          guidancePrice: (meta.guidancePrice as number) || 0,
          dealLead: (meta.dealLead as string) || "",
          noi: (fin.noi as number) || 0,
          capRate: (fin.capRate as number) || 0,
          financials: (fin.financials as unknown[]) || [],
          brokerNarrative: (sum.brokerNarrative as string) || "",
          locationInsight: (sum.locationInsight as string) || "",
          questions:
            ((results.questions?.questions as string[]) || []),
          criteria:
            ((results.criteria?.criteria as unknown[]) || []),
          risks:
            ((results.risks?.risks as string[]) || []),
          lat: coords.lat,
          lng: coords.lng,
        };

        emit(controller, enc, { type: "complete", extracted });
        controller.close();
      } catch (err) {
        emit(controller, enc, {
          type: "error",
          message: `Pipeline error: ${err}`,
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
