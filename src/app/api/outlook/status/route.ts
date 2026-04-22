import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const db = supabaseAdmin();

  // Check if any Outlook account is connected
  const { data: tokenRow } = await db
    .from("outlook_tokens")
    .select("email, expires_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  const connected = !!tokenRow;
  const tokenExpired = tokenRow
    ? new Date(tokenRow.expires_at as string) < new Date()
    : false;

  // Fetch recent ingestions (last 50)
  const { data: ingestions } = await db
    .from("email_ingestions")
    .select(`
      id,
      outlook_message_id,
      deal_id,
      subject,
      sender_name,
      sender_email,
      received_at,
      attachment_count,
      status,
      error_message,
      created_at
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  // Count stats
  const total     = ingestions?.length ?? 0;
  const completed = ingestions?.filter(i => i.status === "completed").length ?? 0;
  const failed    = ingestions?.filter(i => i.status === "failed").length ?? 0;
  const processing = ingestions?.filter(i => i.status === "processing").length ?? 0;

  return NextResponse.json({
    connected,
    tokenExpired,
    email:       tokenRow?.email ?? null,
    lastSynced:  tokenRow?.updated_at ?? null,
    stats: { total, completed, failed, processing },
    ingestions:  ingestions ?? [],
  });
}
