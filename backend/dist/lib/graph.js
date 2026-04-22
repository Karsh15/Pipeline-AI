"use strict";
/**
 * Microsoft Graph API client
 * Handles OAuth2 token lifecycle + fetching deal emails + attachments.
 * All requests go server-side — tokens are never exposed to the browser.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AZURE_SCOPES = void 0;
exports.getAuthUrl = getAuthUrl;
exports.exchangeCodeForTokens = exchangeCodeForTokens;
exports.refreshAccessToken = refreshAccessToken;
exports.fetchDealEmails = fetchDealEmails;
exports.fetchAttachments = fetchAttachments;
exports.attachmentToBuffer = attachmentToBuffer;
exports.stripHtml = stripHtml;
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
// Evaluated lazily at call time so process.env is fully populated by Next.js
function tenant() {
    return process.env.AZURE_TENANT_ID ?? "common";
}
function tokenUrl() {
    return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`;
}
exports.AZURE_SCOPES = [
    "openid",
    "email",
    "offline_access",
    "Mail.Read",
    "Mail.ReadBasic",
    "User.Read",
].join(" ");
// ── OAuth2 helpers ───────────────────────────────────────────────────────────
function getAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
        client_id: process.env.AZURE_CLIENT_ID,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: exports.AZURE_SCOPES,
        response_mode: "query",
        ...(state ? { state } : {}),
    });
    return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize?${params}`;
}
async function exchangeCodeForTokens(code, redirectUri) {
    const res = await fetch(tokenUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: process.env.AZURE_CLIENT_ID,
            client_secret: process.env.AZURE_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
            scope: exports.AZURE_SCOPES,
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Token exchange failed: ${err}`);
    }
    const json = await res.json();
    // Get user email from /me
    const me = await fetchMe(json.access_token);
    return {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: new Date(Date.now() + json.expires_in * 1000),
        email: me.mail || me.userPrincipalName,
        tenant_id: process.env.AZURE_TENANT_ID,
    };
}
async function refreshAccessToken(refreshToken) {
    const res = await fetch(tokenUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: process.env.AZURE_CLIENT_ID,
            client_secret: process.env.AZURE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
            scope: exports.AZURE_SCOPES,
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Token refresh failed: ${err}`);
    }
    const json = await res.json();
    return {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: new Date(Date.now() + json.expires_in * 1000),
    };
}
// ── Graph API helpers ────────────────────────────────────────────────────────
async function graphGet(accessToken, path, params) {
    const url = new URL(`${GRAPH_BASE}${path}`);
    if (params)
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Graph ${path} → ${res.status}: ${body}`);
    }
    return res.json();
}
async function fetchMe(accessToken) {
    return graphGet(accessToken, "/me", { $select: "mail,userPrincipalName" });
}
// ── Email fetching ───────────────────────────────────────────────────────────
const DEAL_KEYWORDS = [
    "offering memorandum", "om ", " om,", " om.",
    "deal", "property", "acquisition", "investment opportunity",
    "for sale", "noi", "cap rate", "asking price",
    "rent roll", "t-12", "t12", "pro forma", "proforma",
    "multifamily", "hotel", "hospitality", "commercial real estate",
    "cre", "industrial", "retail", "office",
];
/** Fetch unread emails received since `since` that look like CRE deal mails */
async function fetchDealEmails(accessToken, since) {
    const sinceIso = since.toISOString();
    // Filter: received after `since`, has attachment OR subject contains deal keywords
    const filter = `receivedDateTime ge ${sinceIso}`;
    const data = await graphGet(accessToken, "/me/messages", {
        $filter: filter,
        $select: "id,subject,receivedDateTime,from,hasAttachments,body",
        $top: "50",
        $orderby: "receivedDateTime desc",
    });
    const messages = data.value ?? [];
    // Client-side filter: keep only emails that look like deal flow
    return messages.filter(m => {
        const text = (m.subject + " " + m.body.content).toLowerCase();
        return DEAL_KEYWORDS.some(kw => text.includes(kw)) || m.hasAttachments;
    });
}
/** Download all non-inline attachments for a message */
async function fetchAttachments(accessToken, messageId) {
    const data = await graphGet(accessToken, `/me/messages/${messageId}/attachments`, { $select: "id,name,contentType,size,contentBytes,isInline" });
    return (data.value ?? []).filter(a => !a.isInline &&
        a.size < 50 * 1024 * 1024 && // skip files >50 MB
        (a.name.match(/\.(pdf|xlsx?|docx?|png|jpg|jpeg|tiff?)$/i) != null ||
            a.contentType.includes("pdf") ||
            a.contentType.includes("spreadsheet") ||
            a.contentType.includes("word")));
}
/** Convert base64 attachment content to a Buffer */
function attachmentToBuffer(attachment) {
    return Buffer.from(attachment.contentBytes, "base64");
}
/** Strip HTML tags from email body for plain text context */
function stripHtml(html) {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s{2,}/g, " ")
        .trim();
}
