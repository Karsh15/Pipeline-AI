/**
 * POST /api/outlook/poll
 *
 * Checks the connected Outlook inbox for new deal emails since the last poll.
 * For each email that looks like a CRE deal:
 *   1. Creates a new deal record
 *   2. Downloads attachments and uploads them to Supabase Storage
 *   3. Kicks off the full 7-agent extraction pipeline
 *   4. Records the ingestion in email_ingestions table
 *
 * Called by the UI (manual trigger) and can be called by a cron via GET.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import {
  fetchDealEmails,
  fetchAttachments,
  attachmentToBuffer,
  refreshAccessToken,
  stripHtml,
  type GraphMessage,
} from "@/lib/graph";
import { extractDocumentText } from "@/lib/ocr/extract";

// ── Token management ─────────────────────────────────────────────────────────

async function getValidToken(): Promise<{
  accessToken: string;
  email: string;
} | null> {
  const db = supabaseAdmin();
  const { data: row } = await db
    .from("outlook_tokens")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (!row) return null;

  const expires = new Date(row.expires_at as string);
  const now     = new Date();
  const buffer  = 5 * 60 * 1000; // refresh 5 min before expiry

  if (expires.getTime() - now.getTime() < buffer) {
    try {
      const refreshed = await refreshAccessToken(row.refresh_token as string);
      await db.from("outlook_tokens").update({
        access_token:  refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at:    refreshed.expires_at.toISOString(),
        updated_at:    now.toISOString(),
      }).eq("email", row.email);
      return { accessToken: refreshed.access_token, email: row.email as string };
    } catch (err) {
      console.error("[outlook/poll] token refresh failed:", err);
      return null;
    }
  }

  return { accessToken: row.access_token as string, email: row.email as string };
}

// ── Last-poll watermark ──────────────────────────────────────────────────────

async function getLastPollTime(): Promise<Date> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("email_ingestions")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (data?.created_at) return new Date(data.created_at as string);
  // Default: look back 7 days on first run
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

// ── Deal name from email ─────────────────────────────────────────────────────

function dealNameFromEmail(msg: GraphMessage): string {
  let subject = msg.subject ?? "Untitled Deal";
  // Strip common prefixes: RE:, FW:, FWD:, [External]
  subject = subject.replace(/^(re|fw|fwd|fw'd):\s*/i, "").trim();
  subject = subject.replace(/^\[external\]\s*/i, "").trim();
  // Truncate to reasonable length
  return subject.slice(0, 120) || "Deal from Email";
}

// ── Sanitize filename for storage ────────────────────────────────────────────

function sanitizeName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  return base.replace(/[^\w.\-]+/g, "_");
}

// ── Classify document type from filename ─────────────────────────────────────

function classifyDoc(name: string): "rent_roll" | "t12" | "om" | "excel" | "unknown" {
  const n = name.toLowerCase();
  if (n.includes("rent") || n.includes("roll"))           return "rent_roll";
  if (n.includes("t12") || n.includes("financial"))       return "t12";
  if (n.includes("om")  || n.includes("offering"))        return "om";
  if (n.match(/\.xlsx?$/))                                 return "excel";
  return "unknown";
}

// ── Trigger extraction pipeline (fire-and-forget) ────────────────────────────

async function triggerPipeline(dealId: string): Promise<void> {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  try {
    // Fire the extraction route as a background request — don't await the stream
    fetch(`${base}/api/run-extraction`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ dealId }),
    }).catch(err => console.error(`[outlook/poll] pipeline trigger failed for ${dealId}:`, err));
  } catch (err) {
    console.error("[outlook/poll] pipeline spawn error:", err);
  }
}

// ── Process a single email into a deal ──────────────────────────────────────

async function processEmail(
  msg:         GraphMessage,
  accessToken: string,
  db:          ReturnType<typeof supabaseAdmin>
): Promise<{ dealId: string | null; error?: string }> {
  // Check dedup — skip if we already processed this Graph message ID
  const { data: existing } = await db
    .from("email_ingestions")
    .select("id, deal_id")
    .eq("outlook_message_id", msg.id)
    .maybeSingle();

  if (existing) {
    return { dealId: existing.deal_id as string | null };
  }

  // Create ingestion record immediately (status=processing)
  const { data: ingestion } = await db.from("email_ingestions").insert({
    outlook_message_id: msg.id,
    subject:            msg.subject,
    sender_name:        msg.from?.emailAddress?.name  ?? null,
    sender_email:       msg.from?.emailAddress?.address ?? null,
    received_at:        msg.receivedDateTime,
    attachment_count:   0,
    status:             "processing",
  }).select().single();

  const ingestionId = ingestion?.id as string;

  try {
    // 1. Create deal
    const dealName = dealNameFromEmail(msg);
    const { data: deal, error: dealErr } = await db
      .from("deals")
      .insert({
        name:       dealName,
        status:     "lead",
        broker:     msg.from?.emailAddress?.name  ?? null,
        broker_email: msg.from?.emailAddress?.address ?? null,
        broker_narrative: stripHtml(msg.body?.content ?? "").slice(0, 2000) || null,
      })
      .select()
      .single();

    if (dealErr || !deal) throw new Error(`Deal insert failed: ${dealErr?.message}`);
    const dealId = deal.id as string;

    // 2. Download attachments
    let attachmentCount = 0;
    if (msg.hasAttachments) {
      const attachments = await fetchAttachments(accessToken, msg.id);
      attachmentCount = attachments.length;

      for (const att of attachments) {
        const safeName    = sanitizeName(att.name);
        const ext         = safeName.split(".").pop()?.toLowerCase() ?? "bin";
        const storagePath = `${dealId}/${randomUUID()}_${safeName}`;
        const buffer      = attachmentToBuffer(att);

        // Upload to Supabase Storage
        const { error: uploadErr } = await db.storage
          .from("deal-document")
          .upload(storagePath, buffer, {
            contentType: att.contentType || "application/octet-stream",
            upsert:      false,
          });

        if (uploadErr) {
          console.error(`[outlook/poll] storage upload failed for ${att.name}:`, uploadErr.message);
          continue;
        }

        const { data: urlData } = db.storage
          .from("deal-document")
          .getPublicUrl(storagePath);

        // Run OCR immediately and cache result
        let ocrText   = "";
        let ocrMethod = "none";
        let ocrPages  = 0;
        try {
          const ocrResult = await extractDocumentText(buffer, safeName, {
            nvidiaApiKey: process.env.NVIDIA_API_KEY,
            pdfScale: 1.5,
          });
          ocrText   = ocrResult.text;
          ocrMethod = ocrResult.method;
          ocrPages  = ocrResult.pages ?? 0;
        } catch (e) {
          console.warn(`[outlook/poll] OCR failed for ${att.name}:`, e);
        }

        // Insert document record
        await db.from("documents").insert({
          deal_id:       dealId,
          file_url:      urlData.publicUrl,
          file_name:     att.name,
          document_type: classifyDoc(safeName),
          ocr_text:      ocrText   || null,
          ocr_method:    ocrMethod || null,
          ocr_pages:     ocrPages  || null,
        });
      }

      // Advance deal to ingestion if we uploaded any docs
      if (attachmentCount > 0) {
        await db.from("deals").update({ status: "ingestion" }).eq("id", dealId);
      }
    }

    // 3. Store email body as a document if there are no useful attachments
    if (attachmentCount === 0 && msg.body?.content) {
      const bodyText = stripHtml(msg.body.content);
      if (bodyText.length > 200) {
        const safeName    = `email_body_${Date.now()}.txt`;
        const storagePath = `${dealId}/${randomUUID()}_${safeName}`;
        const buffer      = Buffer.from(bodyText, "utf-8");

        const { error: uploadErr } = await db.storage
          .from("deal-document")
          .upload(storagePath, buffer, { contentType: "text/plain", upsert: false });

        if (!uploadErr) {
          const { data: urlData } = db.storage.from("deal-document").getPublicUrl(storagePath);
          await db.from("documents").insert({
            deal_id:       dealId,
            file_url:      urlData.publicUrl,
            file_name:     safeName,
            document_type: "om",
            ocr_text:      bodyText,
            ocr_method:    "text",
            ocr_pages:     1,
          });
          await db.from("deals").update({ status: "ingestion" }).eq("id", dealId);
        }
      }
    }

    // 4. Mark ingestion complete
    await db.from("email_ingestions").update({
      deal_id:          dealId,
      attachment_count: attachmentCount,
      status:           "completed",
    }).eq("id", ingestionId);

    // 5. Fire extraction pipeline (non-blocking)
    await triggerPipeline(dealId);

    return { dealId };
  } catch (err) {
    const msg2 = err instanceof Error ? err.message : String(err);
    console.error("[outlook/poll] processEmail error:", msg2);
    if (ingestionId) {
      await db.from("email_ingestions").update({
        status:        "failed",
        error_message: msg2,
      }).eq("id", ingestionId);
    }
    return { dealId: null, error: msg2 };
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(_req: NextRequest) {
  const db = supabaseAdmin();

  const token = await getValidToken();
  if (!token) {
    return NextResponse.json({ error: "No Outlook account connected" }, { status: 401 });
  }

  const since = await getLastPollTime();

  let emails;
  try {
    emails = await fetchDealEmails(token.accessToken, since);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Graph API error: ${msg}` }, { status: 502 });
  }

  if (!emails.length) {
    return NextResponse.json({ processed: 0, skipped: 0, deals: [] });
  }

  const results: Array<{ subject: string; dealId: string | null; error?: string }> = [];

  for (const email of emails) {
    const result = await processEmail(email, token.accessToken, db);
    results.push({ subject: email.subject, ...result });
  }

  const processed = results.filter(r => r.dealId && !r.error).length;
  const failed    = results.filter(r => r.error).length;

  return NextResponse.json({
    processed,
    failed,
    skipped: emails.length - processed - failed,
    deals:   results,
    since:   since.toISOString(),
    email:   token.email,
  });
}

// Allow cron / scheduled ping via GET (e.g. Vercel cron job)
export async function GET(req: NextRequest) {
  return POST(req);
}
