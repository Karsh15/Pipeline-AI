import type { Request, Response } from "express";
import { exchangeCodeForTokens } from "../lib/graph";
import { supabaseAdmin } from "../lib/supabase";

export async function outlookCallbackHandler(req: Request, res: Response) {
  const { code, error, error_description } = req.query as Record<string, string>;
  const frontendBase = process.env.APP_URL ?? "http://localhost:5173";
  const backendBase  = process.env.BACKEND_URL ?? "http://localhost:4000";

  if (error || !code) {
    const desc = error_description ?? error ?? "unknown";
    console.error("[outlook/callback] auth error:", desc);
    return res.redirect(`${frontendBase}/?outlook=error&reason=${encodeURIComponent(desc)}`);
  }

  try {
    const redirectUri = `${backendBase}/api/outlook/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const db = supabaseAdmin();

    await db.from("outlook_tokens").upsert({
      email:         tokens.email,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at:    tokens.expires_at.toISOString(),
      tenant_id:     tokens.tenant_id,
      updated_at:    new Date().toISOString(),
    }, { onConflict: "email" });

    res.redirect(`${frontendBase}/?outlook=connected&email=${encodeURIComponent(tokens.email)}`);
  } catch (err) {
    console.error("[outlook/callback] token exchange error:", err);
    const msg = err instanceof Error ? err.message : "unknown";
    res.redirect(`${frontendBase}/?outlook=error&reason=${encodeURIComponent(msg)}`);
  }
}
