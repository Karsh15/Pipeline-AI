import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { randomUUID } from "crypto";
import { extractDocumentText } from "@/lib/ocr/extract";

// Sanitize a filename for safe storage paths (Supabase rejects /, whitespace, etc.)
function sanitizeName(name: string): string {
  // Keep just the basename — strip any folder path from webkitRelativePath
  const base = name.replace(/^.*[\\/]/, "");
  // Replace illegal / risky chars
  return base.replace(/[^\w.\-]+/g, "_");
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin();
  const formData = await req.formData();
  const dealId   = (formData.get("dealId") || formData.get("deal_id")) as string;
  const file     = formData.get("file") as File | null;
  // Optional: the original relative path inside a dropped folder, for logging
  const relPath  = (formData.get("relativePath") as string | null) || file?.name || "";

  if (!dealId || !file) {
    return NextResponse.json({ error: "dealId and file required" }, { status: 400 });
  }

  // Collision-proof unique path per file (uuid ensures no duplicate keys across parallel uploads)
  const safeName    = sanitizeName(file.name);
  const ext         = safeName.split(".").pop()?.toLowerCase() ?? "bin";
  const storagePath = `${dealId}/${randomUUID()}_${safeName}`;
  const fileBuffer  = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await db.storage
    .from("deal-document")
    .upload(storagePath, fileBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert:      false,
    });

  if (uploadErr) {
    console.error(`[process-documents] upload error for "${relPath}":`, uploadErr);
    return NextResponse.json(
      { error: `Storage upload failed for ${safeName}: ${uploadErr.message}` },
      { status: 500 }
    );
  }

  const { data: urlData } = db.storage.from("deal-document").getPublicUrl(storagePath);

  // Classify document type from filename
  const nameLower = safeName.toLowerCase();
  let documentType: "rent_roll" | "t12" | "om" | "excel" | "unknown" = "unknown";
  if (nameLower.includes("rent") || nameLower.includes("roll"))           documentType = "rent_roll";
  else if (nameLower.includes("t12") || nameLower.includes("financial"))  documentType = "t12";
  else if (nameLower.includes("om") || nameLower.includes("offering"))    documentType = "om";
  else if (ext === "xlsx" || ext === "xls")                               documentType = "excel";

  // Run OCR immediately on upload so extraction agents never re-fetch from storage
  let ocrText   = "";
  let ocrMethod = "none";
  let ocrPages  = 0;
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
    // Non-fatal — agents will fall back to fetching from URL
  }

  // Save document record — use the ORIGINAL filename for display
  const { data: doc, error: docErr } = await db
    .from("documents")
    .insert({
      deal_id:       dealId,
      file_url:      urlData.publicUrl,
      file_name:     relPath || file.name,
      document_type: documentType,
      ocr_text:      ocrText   || null,
      ocr_method:    ocrMethod || null,
      ocr_pages:     ocrPages  || null,
    })
    .select()
    .single();

  if (docErr) {
    console.error(`[process-documents] DB insert error for "${relPath}":`, docErr);
    return NextResponse.json({ error: docErr.message }, { status: 500 });
  }

  // Advance deal to ingestion — no ai_jobs insert here; one job is created by the extraction run
  await db.from("deals").update({ status: "ingestion" }).eq("id", dealId);

  return NextResponse.json({ success: true, document: doc });
}
