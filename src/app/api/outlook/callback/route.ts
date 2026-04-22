import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/graph";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const error = searchParams.get("error");

  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  if (error || !code) {
    const desc = searchParams.get("error_description") ?? error ?? "unknown";
    console.error("[outlook/callback] auth error:", desc);
    return NextResponse.redirect(`${base}/?outlook=error&reason=${encodeURIComponent(desc)}`);
  }

  try {
    const redirectUri = `${base}/api/outlook/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    const db = supabaseAdmin();

    // Upsert token row (keyed on email — one row per connected inbox)
    await db.from("outlook_tokens").upsert({
      email:         tokens.email,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at:    tokens.expires_at.toISOString(),
      tenant_id:     tokens.tenant_id,
      updated_at:    new Date().toISOString(),
    }, { onConflict: "email" });

    return NextResponse.redirect(`${base}/?outlook=connected&email=${encodeURIComponent(tokens.email)}`);
  } catch (err) {
    console.error("[outlook/callback] token exchange error:", err);
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(`${base}/?outlook=error&reason=${encodeURIComponent(msg)}`);
  }
}
