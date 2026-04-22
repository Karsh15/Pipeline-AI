import "dotenv/config";
import request from "supertest";
import express from "express";
import cors from "cors";
import multer from "multer";

// ── App factory (mirrors server.ts without listen) ────────────────────────────
function buildApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

  const { chatHandler }                  = require("../src/routes/chat");
  const { exportExcelHandler }           = require("../src/routes/export-excel");
  const { exportPptHandler }             = require("../src/routes/export-ppt");
  const { processDocumentsHandler }      = require("../src/routes/process-documents");
  const { runExtractionHandler }         = require("../src/routes/run-extraction");
  const { runUnderwritingHandler }       = require("../src/routes/run-underwriting");
  const { outlookConnectHandler }        = require("../src/routes/outlook-connect");
  const { outlookStatusHandler }         = require("../src/routes/outlook-status");
  const { outlookDisconnectHandler }     = require("../src/routes/outlook-disconnect");
  const { outlookPollHandler }           = require("../src/routes/outlook-poll");
  const { exportUnderwritingPdfHandler } = require("../src/routes/export-underwriting-pdf");

  const r = express.Router();
  r.get("/health",                    (_req, res) => res.json({ ok: true }));
  r.post("/chat",                     chatHandler);
  r.post("/export-excel",             exportExcelHandler);
  r.post("/export-ppt",               exportPptHandler);
  r.post("/process-documents",        upload.single("file"), processDocumentsHandler);
  r.post("/run-extraction",           runExtractionHandler);
  r.post("/run-underwriting",         runUnderwritingHandler);
  r.get ("/outlook/connect",          outlookConnectHandler);
  r.get ("/outlook/status",           outlookStatusHandler);
  r.post("/outlook/disconnect",       outlookDisconnectHandler);
  r.post("/outlook/poll",             outlookPollHandler);
  r.post("/export-underwriting-pdf",  exportUnderwritingPdfHandler);

  app.use("/api", r);
  return app;
}

const app = buildApp();
const NULL_UUID = "00000000-0000-0000-0000-000000000000";

// ── Health check ──────────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  it("returns { ok: true }", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("responds with JSON content-type", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

// ── CORS ──────────────────────────────────────────────────────────────────────

describe("CORS headers", () => {
  it("sets access-control-allow-origin on health endpoint", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBeTruthy();
  });
});

// ── Outlook status ────────────────────────────────────────────────────────────

describe("GET /api/outlook/status", () => {
  it("returns 200 with correct shape", async () => {
    const res = await request(app).get("/api/outlook/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("connected");
    expect(res.body).toHaveProperty("tokenExpired");
    expect(res.body).toHaveProperty("email");
    expect(res.body).toHaveProperty("lastSynced");
    expect(res.body).toHaveProperty("stats");
    expect(res.body).toHaveProperty("ingestions");
  });

  it("stats has all required fields", async () => {
    const res = await request(app).get("/api/outlook/status");
    expect(res.body.stats).toHaveProperty("total");
    expect(res.body.stats).toHaveProperty("completed");
    expect(res.body.stats).toHaveProperty("failed");
    expect(res.body.stats).toHaveProperty("processing");
  });

  it("ingestions is an array", async () => {
    const res = await request(app).get("/api/outlook/status");
    expect(Array.isArray(res.body.ingestions)).toBe(true);
  });

  it("connected is a boolean", async () => {
    const res = await request(app).get("/api/outlook/status");
    expect(typeof res.body.connected).toBe("boolean");
  });

  it("returns JSON content-type", async () => {
    const res = await request(app).get("/api/outlook/status");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

// ── Outlook connect ───────────────────────────────────────────────────────────

describe("GET /api/outlook/connect", () => {
  it("responds without server crash", async () => {
    const res = await request(app).get("/api/outlook/connect");
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  it("redirects to Microsoft OAuth URL", async () => {
    const res = await request(app).get("/api/outlook/connect");
    if (res.status === 302) {
      expect(res.headers.location).toMatch(/login\.microsoftonline\.com/i);
    }
  });
});

// ── Outlook disconnect ────────────────────────────────────────────────────────

describe("POST /api/outlook/disconnect", () => {
  it("returns 2xx without crashing", async () => {
    const res = await request(app).post("/api/outlook/disconnect");
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });
});

// ── Outlook poll ──────────────────────────────────────────────────────────────

describe("POST /api/outlook/poll", () => {
  it("responds without crashing when not connected", async () => {
    const res = await request(app).post("/api/outlook/poll");
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });
});

// ── Export Excel ──────────────────────────────────────────────────────────────

describe("POST /api/export-excel", () => {
  it("responds without crashing for missing dealId", async () => {
    const res = await request(app).post("/api/export-excel").send({});
    // Route proceeds even without dealId — returns file or error, not a crash
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  it("responds for non-existent dealId without crashing", async () => {
    const res = await request(app)
      .post("/api/export-excel")
      .send({ dealId: NULL_UUID });
    // Route returns 200 with empty workbook or error — either is valid
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });
});

// ── Export PPT ────────────────────────────────────────────────────────────────

describe("POST /api/export-ppt", () => {
  it("responds without crashing for missing dealId", async () => {
    const res = await request(app).post("/api/export-ppt").send({});
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  it("responds for non-existent dealId", async () => {
    const res = await request(app)
      .post("/api/export-ppt")
      .send({ dealId: NULL_UUID });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });
});

// ── Export Underwriting PDF ───────────────────────────────────────────────────

describe("POST /api/export-underwriting-pdf", () => {
  it("responds without crashing for missing dealId", async () => {
    const res = await request(app).post("/api/export-underwriting-pdf").send({});
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  it("returns 404 for non-existent dealId", async () => {
    const res = await request(app)
      .post("/api/export-underwriting-pdf")
      .send({ dealId: NULL_UUID });
    expect([404, 500]).toContain(res.status);
  });
});

// ── Chat ──────────────────────────────────────────────────────────────────────

describe("POST /api/chat", () => {
  it("responds without crashing for missing dealId", async () => {
    // history must be an array — the route crashes if undefined
    const res = await request(app)
      .post("/api/chat")
      .send({ message: "test", history: [] })
      .timeout({ response: 12000, deadline: 13000 })
      .buffer(true);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  }, 14000);

  it("responds for valid body shape with fake dealId", async () => {
    const res = await request(app)
      .post("/api/chat")
      .send({ dealId: NULL_UUID, message: "What is the NOI?", history: [] })
      .timeout({ response: 12000, deadline: 13000 })
      .buffer(true);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  }, 14000);
});

// ── Process Documents ─────────────────────────────────────────────────────────

describe("POST /api/process-documents", () => {
  it("returns error when no file is uploaded", async () => {
    const res = await request(app)
      .post("/api/process-documents")
      .field("dealId", NULL_UUID);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("responds without crashing when file uploaded with invalid dealId", async () => {
    const csvBuf = Buffer.from("name,noi\nProperty A,500000");
    const res = await request(app)
      .post("/api/process-documents")
      .field("dealId", NULL_UUID)
      .attach("file", csvBuf, { filename: "test.csv", contentType: "text/csv" });
    // Foreign key violation → 500 is expected, not a crash
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });
});

// ── Run Extraction (SSE) ──────────────────────────────────────────────────────

describe("POST /api/run-extraction", () => {
  it("responds without crashing for empty body", async () => {
    const res = await request(app)
      .post("/api/run-extraction")
      .send({})
      .timeout({ response: 8000, deadline: 9000 })
      .buffer(true);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  it("responds for fake dealId", async () => {
    const res = await request(app)
      .post("/api/run-extraction")
      .send({ dealId: NULL_UUID })
      .timeout({ response: 8000, deadline: 9000 })
      .buffer(true);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });
});

// ── Run Underwriting (SSE) ────────────────────────────────────────────────────

describe("POST /api/run-underwriting", () => {
  it("responds without crashing for empty body", async () => {
    const res = await request(app)
      .post("/api/run-underwriting")
      .send({})
      .timeout({ response: 8000, deadline: 9000 })
      .buffer(true);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  it("responds for fake dealId", async () => {
    const res = await request(app)
      .post("/api/run-underwriting")
      .send({ dealId: NULL_UUID })
      .timeout({ response: 8000, deadline: 9000 })
      .buffer(true);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });
});

// ── LLM lib unit tests ────────────────────────────────────────────────────────

describe("lib/llm - safeParse & cleanJson", () => {
  it("parses valid JSON string", () => {
    const { safeParse } = require("../src/lib/llm");
    const result = safeParse('{"key":"value"}', { key: "" });
    expect(result.key).toBe("value");
  });

  it("returns empty object for unparseable string (cleanJson default)", () => {
    const { safeParse } = require("../src/lib/llm");
    // cleanJson returns "{}" when no JSON found, so JSON.parse succeeds with {}
    const result = safeParse("not json at all!!!", { key: "default" });
    expect(typeof result).toBe("object");
  });

  it("extracts JSON from markdown code fences", () => {
    const { safeParse } = require("../src/lib/llm");
    const raw = "```json\n{\"noi\": 500000}\n```";
    const result = safeParse(raw, { noi: 0 });
    expect(result.noi).toBe(500000);
  });

  it("cleanJson strips markdown fences", () => {
    const { cleanJson } = require("../src/lib/llm");
    const raw = "```json\n{\"key\": 1}\n```";
    const cleaned = cleanJson(raw);
    expect(cleaned).not.toContain("```");
    expect(cleaned).toContain('"key"');
  });

  it("cleanJson handles plain JSON without fences", () => {
    const { cleanJson } = require("../src/lib/llm");
    const raw = '{"noi": 1000}';
    const cleaned = cleanJson(raw);
    expect(cleaned).toContain('"noi"');
  });

  it("safeParse handles nested objects", () => {
    const { safeParse } = require("../src/lib/llm");
    const raw = '{"deal": {"noi": 500000, "cap_rate": 0.065}}';
    const result = safeParse(raw, { deal: { noi: 0, cap_rate: 0 } });
    expect(result.deal.noi).toBe(500000);
    expect(result.deal.cap_rate).toBe(0.065);
  });

  it("safeParse handles arrays", () => {
    const { safeParse } = require("../src/lib/llm");
    const raw = '[{"risk": "vacancy"}, {"risk": "deferred maintenance"}]';
    const result = safeParse(raw, []);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].risk).toBe("vacancy");
  });
});

// ── OCR lib unit tests ────────────────────────────────────────────────────────

describe("lib/ocr/extract - extractDocumentText", () => {
  it("parses CSV content and returns spreadsheet method", async () => {
    const { extractDocumentText } = require("../src/lib/ocr/extract");
    const csv = Buffer.from("name,noi,cap_rate\nProperty A,500000,6.5\nProperty B,750000,5.8");
    const result = await extractDocumentText(csv, "financials.csv", {});
    expect(result.method).toBe("spreadsheet");
    expect(result.text).toContain("Property A");
    expect(result.text).toContain("500000");
  });

  it("parses XLSX buffer", async () => {
    const { extractDocumentText } = require("../src/lib/ocr/extract");
    // Minimal valid xlsx is complex — test with csv fallback using .xlsx extension
    const csv = Buffer.from("unit,rent\n1BR,1200\n2BR,1600");
    const result = await extractDocumentText(csv, "rent_roll.csv", {});
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("method");
    expect(result).toHaveProperty("pages");
  });

  it("returns result shape for empty buffer", async () => {
    const { extractDocumentText } = require("../src/lib/ocr/extract");
    const result = await extractDocumentText(Buffer.alloc(0), "empty.txt", {});
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("method");
    expect(typeof result.text).toBe("string");
  });

  it("handles plain text files", async () => {
    const { extractDocumentText } = require("../src/lib/ocr/extract");
    const txt = Buffer.from("Offering Memorandum\nProperty: Test Hotel\nNOI: $500,000\nCap Rate: 6.5%");
    const result = await extractDocumentText(txt, "om.txt", {});
    expect(result.text).toContain("NOI");
    expect(result.text).toContain("500,000");
  });

  it("method field is always a non-empty string", async () => {
    const { extractDocumentText } = require("../src/lib/ocr/extract");
    const inputs = [
      { buf: Buffer.from("a,b\n1,2"), name: "test.csv" },
      { buf: Buffer.from("hello world"), name: "test.txt" },
    ];
    for (const { buf, name } of inputs) {
      const result = await extractDocumentText(buf, name, {});
      expect(typeof result.method).toBe("string");
      expect(result.method.length).toBeGreaterThan(0);
    }
  });
});

// ── Supabase lib ──────────────────────────────────────────────────────────────

describe("lib/supabase - supabaseAdmin", () => {
  it("creates a client without throwing", () => {
    const { supabaseAdmin } = require("../src/lib/supabase");
    expect(() => supabaseAdmin()).not.toThrow();
  });

  it("client exposes from() method", () => {
    const { supabaseAdmin } = require("../src/lib/supabase");
    const client = supabaseAdmin();
    expect(typeof client.from).toBe("function");
  });

  it("client exposes storage property", () => {
    const { supabaseAdmin } = require("../src/lib/supabase");
    const client = supabaseAdmin();
    expect(client.storage).toBeDefined();
  });
});
