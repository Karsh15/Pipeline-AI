import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "../lib/supabase";
import {
  fetchDealEmails, fetchAttachments, attachmentToBuffer,
  refreshAccessToken, stripHtml, type GraphMessage,
} from "../lib/graph";
import { extractDocumentText } from "../lib/ocr/extract";

async function getValidToken(): Promise<{ accessToken: string; email: string } | null> {
  const db = supabaseAdmin();
  const { data: row } = await db.from("outlook_tokens").select("*").order("updated_at", { ascending: false }).limit(1).single();
  if (!row) return null;

  const expires = new Date(row.expires_at as string);
  if (expires.getTime() - Date.now() < 5 * 60 * 1000) {
    try {
      const refreshed = await refreshAccessToken(row.refresh_token as string);
      await db.from("outlook_tokens").update({
        access_token: refreshed.access_token, refresh_token: refreshed.refresh_token,
        expires_at: refreshed.expires_at.toISOString(), updated_at: new Date().toISOString(),
      }).eq("email", row.email);
      return { accessToken: refreshed.access_token, email: row.email as string };
    } catch (err) {
      console.error("[outlook/poll] token refresh failed:", err);
      return null;
    }
  }
  return { accessToken: row.access_token as string, email: row.email as string };
}

async function getLastPollTime(): Promise<Date> {
  const db = supabaseAdmin();
  const { data } = await db.from("email_ingestions").select("created_at").order("created_at", { ascending: false }).limit(1).single();
  if (data?.created_at) return new Date(data.created_at as string);
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

function dealNameFromEmail(msg: GraphMessage): string {
  let subject = msg.subject ?? "Untitled Deal";
  subject = subject.replace(/^(re|fw|fwd|fw'd):\s*/i, "").trim();
  subject = subject.replace(/^\[external\]\s*/i, "").trim();
  return subject.slice(0, 120) || "Deal from Email";
}

function sanitizeName(name: string): string {
  return name.replace(/^.*[\\/]/, "").replace(/[^\w.\-]+/g, "_");
}

function classifyDoc(name: string): "rent_roll" | "t12" | "om" | "excel" | "unknown" {
  const n = name.toLowerCase();
  if (n.includes("rent") || n.includes("roll"))     return "rent_roll";
  if (n.includes("t12") || n.includes("financial")) return "t12";
  if (n.includes("om")  || n.includes("offering"))  return "om";
  if (n.match(/\.xlsx?$/))                           return "excel";
  return "unknown";
}

async function triggerPipeline(dealId: string): Promise<void> {
  const base = process.env.BACKEND_URL ?? "http://localhost:4000";
  fetch(`${base}/api/run-extraction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealId }),
  }).catch(err => console.error(`[outlook/poll] pipeline trigger failed for ${dealId}:`, err));
}

async function processEmail(
  msg: GraphMessage,
  accessToken: string,
  db: ReturnType<typeof supabaseAdmin>
): Promise<{ dealId: string | null; error?: string }> {
  const { data: existing } = await db.from("email_ingestions").select("id, deal_id").eq("outlook_message_id", msg.id).maybeSingle();
  if (existing) return { dealId: existing.deal_id as string | null };

  const { data: ingestion } = await db.from("email_ingestions").insert({
    outlook_message_id: msg.id,
    subject:            msg.subject,
    sender_name:        msg.from?.emailAddress?.name    ?? null,
    sender_email:       msg.from?.emailAddress?.address ?? null,
    received_at:        msg.receivedDateTime,
    attachment_count:   0,
    status:             "processing",
  }).select().single();

  const ingestionId = ingestion?.id as string;

  try {
    const dealName = dealNameFromEmail(msg);
    const { data: deal, error: dealErr } = await db.from("deals").insert({
      name:             dealName,
      status:           "lead",
      broker:           msg.from?.emailAddress?.name    ?? null,
      broker_email:     msg.from?.emailAddress?.address ?? null,
      broker_narrative: stripHtml(msg.body?.content ?? "").slice(0, 2000) || null,
    }).select().single();

    if (dealErr || !deal) throw new Error(`Deal insert failed: ${dealErr?.message}`);
    const dealId = deal.id as string;

    let attachmentCount = 0;
    if (msg.hasAttachments) {
      const attachments = await fetchAttachments(accessToken, msg.id);
      attachmentCount = attachments.length;

      for (const att of attachments) {
        const safeName    = sanitizeName(att.name);
        const storagePath = `${dealId}/${randomUUID()}_${safeName}`;
        const buffer      = attachmentToBuffer(att);

        const { error: uploadErr } = await db.storage.from("deal-document").upload(storagePath, buffer, { contentType: att.contentType || "application/octet-stream", upsert: false });
        if (uploadErr) { console.error(`[outlook/poll] storage upload failed for ${att.name}:`, uploadErr.message); continue; }

        const { data: urlData } = db.storage.from("deal-document").getPublicUrl(storagePath);

        let ocrText = "", ocrMethod = "none", ocrPages = 0;
        try {
          const ocrResult = await extractDocumentText(buffer, safeName, { nvidiaApiKey: process.env.NVIDIA_API_KEY, pdfScale: 1.5 });
          ocrText = ocrResult.text; ocrMethod = ocrResult.method; ocrPages = ocrResult.pages ?? 0;
        } catch (e) { console.warn(`[outlook/poll] OCR failed for ${att.name}:`, e); }

        await db.from("documents").insert({ deal_id: dealId, file_url: urlData.publicUrl, file_name: att.name, document_type: classifyDoc(safeName), ocr_text: ocrText||null, ocr_method: ocrMethod||null, ocr_pages: ocrPages||null });
      }

      if (attachmentCount > 0) await db.from("deals").update({ status: "ingestion" }).eq("id", dealId);
    }

    if (attachmentCount === 0 && msg.body?.content) {
      const bodyText = stripHtml(msg.body.content);
      if (bodyText.length > 200) {
        const safeName    = `email_body_${Date.now()}.txt`;
        const storagePath = `${dealId}/${randomUUID()}_${safeName}`;
        const buffer      = Buffer.from(bodyText, "utf-8");
        const { error: uploadErr } = await db.storage.from("deal-document").upload(storagePath, buffer, { contentType: "text/plain", upsert: false });
        if (!uploadErr) {
          const { data: urlData } = db.storage.from("deal-document").getPublicUrl(storagePath);
          await db.from("documents").insert({ deal_id: dealId, file_url: urlData.publicUrl, file_name: safeName, document_type: "om", ocr_text: bodyText, ocr_method: "text", ocr_pages: 1 });
          await db.from("deals").update({ status: "ingestion" }).eq("id", dealId);
        }
      }
    }

    await db.from("email_ingestions").update({ deal_id: dealId, attachment_count: attachmentCount, status: "completed" }).eq("id", ingestionId);
    await triggerPipeline(dealId);
    return { dealId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[outlook/poll] processEmail error:", errMsg);
    if (ingestionId) await db.from("email_ingestions").update({ status: "failed", error_message: errMsg }).eq("id", ingestionId);
    return { dealId: null, error: errMsg };
  }
}

export async function outlookPollHandler(_req: Request, res: Response) {
  const db = supabaseAdmin();
  const token = await getValidToken();
  if (!token) { res.status(401).json({ error: "No Outlook account connected" }); return; }

  const since = await getLastPollTime();
  let emails: GraphMessage[];
  try {
    emails = await fetchDealEmails(token.accessToken, since);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Graph API error: ${msg}` }); return;
  }

  if (!emails.length) { res.json({ processed: 0, skipped: 0, deals: [] }); return; }

  const results: Array<{ subject: string; dealId: string | null; error?: string }> = [];
  for (const email of emails) {
    const result = await processEmail(email, token.accessToken, db);
    results.push({ subject: email.subject, ...result });
  }

  const processed = results.filter(r => r.dealId && !r.error).length;
  const failed    = results.filter(r => r.error).length;
  res.json({ processed, failed, skipped: emails.length - processed - failed, deals: results, since: since.toISOString(), email: token.email });
}
