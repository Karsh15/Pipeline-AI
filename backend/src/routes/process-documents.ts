import type { Request, Response } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { randomUUID } from "crypto";
import { extractDocumentText } from "../lib/ocr/extract";

function sanitizeName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  return base.replace(/[^\w.\-]+/g, "_");
}

export async function processDocumentsHandler(req: Request, res: Response) {
  const db = supabaseAdmin();
  const dealId  = (req.body.dealId || req.body.deal_id) as string;
  const file    = req.file;
  const relPath = (req.body.relativePath as string | null) || file?.originalname || "";

  if (!dealId || !file) {
    res.status(400).json({ error: "dealId and file required" });
    return;
  }

  const safeName    = sanitizeName(file.originalname);
  const ext         = safeName.split(".").pop()?.toLowerCase() ?? "bin";
  const storagePath = `${dealId}/${randomUUID()}_${safeName}`;
  const fileBuffer  = file.buffer;

  const { error: uploadErr } = await db.storage
    .from("deal-document")
    .upload(storagePath, fileBuffer, {
      contentType: file.mimetype || "application/octet-stream",
      upsert: false,
    });

  if (uploadErr) {
    console.error(`[process-documents] upload error for "${relPath}":`, uploadErr);
    res.status(500).json({ error: `Storage upload failed for ${safeName}: ${uploadErr.message}` });
    return;
  }

  const { data: urlData } = db.storage.from("deal-document").getPublicUrl(storagePath);

  const nameLower = safeName.toLowerCase();
  let documentType: "rent_roll" | "t12" | "om" | "excel" | "unknown" = "unknown";
  if (nameLower.includes("rent") || nameLower.includes("roll"))          documentType = "rent_roll";
  else if (nameLower.includes("t12") || nameLower.includes("financial")) documentType = "t12";
  else if (nameLower.includes("om") || nameLower.includes("offering"))   documentType = "om";
  else if (ext === "xlsx" || ext === "xls")                              documentType = "excel";

  let ocrText = "", ocrMethod = "none", ocrPages = 0;
  try {
    const ocrResult = await extractDocumentText(fileBuffer, safeName, {
      nvidiaApiKey: process.env.NVIDIA_API_KEY,
      pdfScale: 1.5,
    });
    ocrText   = ocrResult.text;
    ocrMethod = ocrResult.method;
    ocrPages  = ocrResult.pages ?? 0;
  } catch (err) {
    console.error(`[process-documents] OCR failed for "${safeName}":`, err);
  }

  const { data: doc, error: docErr } = await db
    .from("documents")
    .insert({
      deal_id:       dealId,
      file_url:      urlData.publicUrl,
      file_name:     relPath || file.originalname,
      document_type: documentType,
      ocr_text:      ocrText   || null,
      ocr_method:    ocrMethod || null,
      ocr_pages:     ocrPages  || null,
    })
    .select()
    .single();

  if (docErr) {
    console.error(`[process-documents] DB insert error for "${relPath}":`, docErr);
    res.status(500).json({ error: docErr.message });
    return;
  }

  await db.from("deals").update({ status: "ingestion" }).eq("id", dealId);
  res.json({ success: true, document: doc });
}
