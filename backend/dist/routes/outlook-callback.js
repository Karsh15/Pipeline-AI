"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.outlookCallbackHandler = outlookCallbackHandler;
const graph_1 = require("../lib/graph");
const supabase_1 = require("../lib/supabase");
async function outlookCallbackHandler(req, res) {
    const { code, error, error_description } = req.query;
    const frontendBase = process.env.APP_URL ?? "http://localhost:5173";
    const backendBase = process.env.BACKEND_URL ?? "http://localhost:4000";
    if (error || !code) {
        const desc = error_description ?? error ?? "unknown";
        console.error("[outlook/callback] auth error:", desc);
        return res.redirect(`${frontendBase}/?outlook=error&reason=${encodeURIComponent(desc)}`);
    }
    try {
        const redirectUri = `${backendBase}/api/outlook/callback`;
        const tokens = await (0, graph_1.exchangeCodeForTokens)(code, redirectUri);
        const db = (0, supabase_1.supabaseAdmin)();
        await db.from("outlook_tokens").upsert({
            email: tokens.email,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: tokens.expires_at.toISOString(),
            tenant_id: tokens.tenant_id,
            updated_at: new Date().toISOString(),
        }, { onConflict: "email" });
        res.redirect(`${frontendBase}/?outlook=connected&email=${encodeURIComponent(tokens.email)}`);
    }
    catch (err) {
        console.error("[outlook/callback] token exchange error:", err);
        const msg = err instanceof Error ? err.message : "unknown";
        res.redirect(`${frontendBase}/?outlook=error&reason=${encodeURIComponent(msg)}`);
    }
}
