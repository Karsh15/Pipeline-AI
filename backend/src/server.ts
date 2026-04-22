import "dotenv/config";

// Promise.try was added in Node 26 — polyfill for older runtimes
if (typeof (Promise as unknown as Record<string, unknown>).try !== "function") {
  (Promise as unknown as Record<string, unknown>).try = function <T>(fn: () => T | Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      try { resolve(fn()); } catch (e) { reject(e); }
    });
  };
}

import express from "express";
import cors from "cors";
import multer from "multer";

import { chatHandler } from "./routes/chat";
import { exportExcelHandler } from "./routes/export-excel";
import { exportPptHandler } from "./routes/export-ppt";
import { exportUnderwritingPdfHandler } from "./routes/export-underwriting-pdf";
import { processDocumentsHandler } from "./routes/process-documents";
import { runExtractionHandler } from "./routes/run-extraction";
import { runUnderwritingHandler } from "./routes/run-underwriting";
import { outlookConnectHandler } from "./routes/outlook-connect";
import { outlookCallbackHandler } from "./routes/outlook-callback";
import { outlookStatusHandler } from "./routes/outlook-status";
import { outlookPollHandler } from "./routes/outlook-poll";
import { outlookDisconnectHandler } from "./routes/outlook-disconnect";

const app  = express();
const PORT = parseInt(process.env.PORT || "4000", 10);

// Allow the Vite dev server + your deployed frontend domain
const ALLOWED = [
  "http://localhost:5173",
  "https://site68128-lr1ovs.scloudsite101.com",
  process.env.APP_URL || "",
].filter(Boolean);

app.use(cors({ origin: ALLOWED, credentials: true }));
app.use(express.json({ limit: "10mb" }));

// Multer: memory storage for document uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

// ── Routes ────────────────────────────────────────────────────────────────────
// Dual-mount: /api/... (dev) and /... (production via Passenger strip)
const routes = (r: express.Router) => {
  r.post("/chat",              chatHandler);
  r.post("/export-excel",           exportExcelHandler);
  r.post("/export-ppt",             exportPptHandler);
  r.post("/export-underwriting-pdf", exportUnderwritingPdfHandler);
  r.post("/process-documents", upload.single("file"), processDocumentsHandler);
  r.post("/run-extraction",    runExtractionHandler);
  r.post("/run-underwriting",  runUnderwritingHandler);

  r.get ("/outlook/connect",    outlookConnectHandler);
  r.get ("/outlook/callback",   outlookCallbackHandler);
  r.get ("/outlook/status",     outlookStatusHandler);
  r.post("/outlook/poll",       outlookPollHandler);
  r.post("/outlook/disconnect", outlookDisconnectHandler);

  r.get("/health", (_req, res) => res.json({ ok: true }));
};

const apiRouter = express.Router();
routes(apiRouter);
app.use("/api", apiRouter);
app.use("/",    apiRouter);

app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
