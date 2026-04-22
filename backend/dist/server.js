"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const multer_1 = __importDefault(require("multer"));
const chat_1 = require("./routes/chat");
const export_excel_1 = require("./routes/export-excel");
const export_ppt_1 = require("./routes/export-ppt");
const process_documents_1 = require("./routes/process-documents");
const run_extraction_1 = require("./routes/run-extraction");
const run_underwriting_1 = require("./routes/run-underwriting");
const outlook_connect_1 = require("./routes/outlook-connect");
const outlook_callback_1 = require("./routes/outlook-callback");
const outlook_status_1 = require("./routes/outlook-status");
const outlook_poll_1 = require("./routes/outlook-poll");
const outlook_disconnect_1 = require("./routes/outlook-disconnect");
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || "4000", 10);
// Allow the Vite dev server + your deployed frontend domain
const ALLOWED = [
    "http://localhost:5173",
    process.env.APP_URL || "",
].filter(Boolean);
app.use((0, cors_1.default)({ origin: ALLOWED, credentials: true }));
app.use(express_1.default.json({ limit: "10mb" }));
// Multer: memory storage for document uploads
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });
// ── Routes ────────────────────────────────────────────────────────────────────
// Dual-mount: /api/... (dev) and /... (production via Passenger strip)
const routes = (r) => {
    r.post("/chat", chat_1.chatHandler);
    r.post("/export-excel", export_excel_1.exportExcelHandler);
    r.post("/export-ppt", export_ppt_1.exportPptHandler);
    r.post("/process-documents", upload.single("file"), process_documents_1.processDocumentsHandler);
    r.post("/run-extraction", run_extraction_1.runExtractionHandler);
    r.post("/run-underwriting", run_underwriting_1.runUnderwritingHandler);
    r.get("/outlook/connect", outlook_connect_1.outlookConnectHandler);
    r.get("/outlook/callback", outlook_callback_1.outlookCallbackHandler);
    r.get("/outlook/status", outlook_status_1.outlookStatusHandler);
    r.post("/outlook/poll", outlook_poll_1.outlookPollHandler);
    r.post("/outlook/disconnect", outlook_disconnect_1.outlookDisconnectHandler);
    r.get("/health", (_req, res) => res.json({ ok: true }));
};
const apiRouter = express_1.default.Router();
routes(apiRouter);
app.use("/api", apiRouter);
app.use("/", apiRouter);
app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
