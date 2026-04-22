import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";

import { chatHandler } from "./routes/chat";
import { exportExcelHandler } from "./routes/export-excel";
import { exportPptHandler } from "./routes/export-ppt";
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
  process.env.APP_URL || "",
].filter(Boolean);

app.use(cors({ origin: ALLOWED, credentials: true }));
app.use(express.json({ limit: "10mb" }));

// Multer: memory storage for document uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

// ── Routes ────────────────────────────────────────────────────────────────────
app.post("/api/chat",              chatHandler);
app.post("/api/export-excel",      exportExcelHandler);
app.post("/api/export-ppt",        exportPptHandler);
app.post("/api/process-documents", upload.single("file"), processDocumentsHandler);
app.post("/api/run-extraction",    runExtractionHandler);
app.post("/api/run-underwriting",  runUnderwritingHandler);

app.get ("/api/outlook/connect",    outlookConnectHandler);
app.get ("/api/outlook/callback",   outlookCallbackHandler);
app.get ("/api/outlook/status",     outlookStatusHandler);
app.post("/api/outlook/poll",       outlookPollHandler);
app.post("/api/outlook/disconnect", outlookDisconnectHandler);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
