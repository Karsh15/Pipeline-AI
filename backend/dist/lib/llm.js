"use strict";
// Unified LLM client — NVIDIA NIM only, with per-agent API key routing and cross-key failover.
// Mimics the OpenAI chat.completions.create shape so existing code works unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODELS = void 0;
exports.chat = chat;
exports.cleanJson = cleanJson;
exports.safeParse = safeParse;
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";
const NVIDIA_TIMEOUT_MS = parseInt(process.env.NVIDIA_TIMEOUT_MS || "90000", 10);
/**
 * Per-agent NVIDIA API key routing.
 *
 * Each agent gets a dedicated key from .env.local so rate-limit/queue pressure
 * on one key doesn't affect the others. If the assigned key fails, we fail over
 * to any other key in the pool.
 *
 * Supported env vars (all optional except NVIDIA_API_KEY):
 *   NVIDIA_API_KEY                — default / fallback key (required)
 *   NVIDIA_API_KEY_METADATA       — metadata agent
 *   NVIDIA_API_KEY_FINANCIAL      — financial agent
 *   NVIDIA_API_KEY_UNIT_MIX       — unit mix agent
 *   NVIDIA_API_KEY_SUMMARY        — summary agent
 *   NVIDIA_API_KEY_QUESTIONS      — questions agent
 *   NVIDIA_API_KEY_CRITERIA       — criteria agent
 *   NVIDIA_API_KEY_RISKS          — risks agent
 *   NVIDIA_API_KEY_UNDERWRITING   — underwriting agent
 *   NVIDIA_API_KEY_DISTILL        — distillation
 */
function keyFor(agent) {
    if (agent) {
        const specific = process.env[`NVIDIA_API_KEY_${agent.toUpperCase()}`];
        if (specific)
            return specific;
    }
    return process.env.NVIDIA_API_KEY;
}
/** Collect all distinct NVIDIA keys from env for failover pool. */
function allKeys() {
    const keys = new Set();
    for (const [name, val] of Object.entries(process.env)) {
        if (name.startsWith("NVIDIA_API_KEY") && val)
            keys.add(val);
    }
    return Array.from(keys);
}
/**
 * Tiered per-agent model routing.
 *   LIGHT       — fast tasks (distillation, questions)
 *   STANDARD    — main extraction (metadata, unit mix, summary, criteria)
 *   REASONING   — financial / risks / underwriting (math + multi-step logic)
 */
exports.MODELS = {
    LIGHT: "meta/llama-3.1-8b-instruct",
    STANDARD: "meta/llama-3.3-70b-instruct",
    REASONING: "meta/llama-3.3-70b-instruct",
};
function truncateMessages(messages, maxChars) {
    const total = messages.reduce((s, m) => s + m.content.length, 0);
    if (total <= maxChars)
        return messages;
    return messages.map(m => {
        if (m.role !== "user" || m.content.length < 500)
            return m;
        const budget = Math.max(500, Math.floor(m.content.length * (maxChars / total)));
        return { ...m, content: m.content.slice(0, budget) + "\n\n[…truncated for length…]" };
    });
}
async function nvidiaCall(apiKey, opts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NVIDIA_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                model: opts.model && opts.model.includes("/") ? opts.model : NVIDIA_MODEL,
                messages: truncateMessages(opts.messages, 80000),
                max_tokens: opts.max_tokens ?? 1024,
                temperature: opts.temperature ?? 0.2,
                stream: false,
            }),
            signal: controller.signal,
        });
    }
    catch (err) {
        if (err.name === "AbortError") {
            const timeoutErr = new Error(`NVIDIA NIM client timeout after ${NVIDIA_TIMEOUT_MS / 1000}s`);
            timeoutErr.status = 504;
            throw timeoutErr;
        }
        throw err;
    }
    finally {
        clearTimeout(timer);
    }
    if (!res.ok) {
        const body = await res.text();
        const err = new Error(`NVIDIA NIM HTTP ${res.status}: ${body.slice(0, 300)}`);
        err.status = res.status;
        throw err;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
}
/**
 * Chat completion with per-agent key routing and cross-key failover.
 *
 * Strategy:
 *   1. Try the agent-specific key (NVIDIA_API_KEY_<AGENT>) if set.
 *   2. On 429/503/504, try each remaining key in the pool.
 *   3. On other errors, bubble up immediately.
 */
async function chat(opts) {
    const primary = keyFor(opts.agent);
    if (!primary) {
        throw new Error("NVIDIA_API_KEY is not set in .env.local — required for LLM inference.");
    }
    // Build ordered key list: primary first, then any other distinct keys as failover
    const pool = allKeys();
    const ordered = [primary, ...pool.filter(k => k !== primary)];
    let lastErr;
    for (let i = 0; i < ordered.length; i++) {
        const key = ordered[i];
        try {
            return await nvidiaCall(key, opts);
        }
        catch (err) {
            lastErr = err;
            const status = err?.status;
            const isRetryable = status === 429 || status === 503 || status === 504 || status === 502;
            const label = opts.agent ? `[${opts.agent}]` : "[llm]";
            if (isRetryable && i < ordered.length - 1) {
                console.warn(`${label} nvidia key #${i + 1} ${status} — failing over to next key`);
                continue;
            }
            throw err;
        }
    }
    throw lastErr ?? new Error("All NVIDIA keys failed.");
}
/**
 * Robust JSON extractor for model outputs.
 * Strips markdown fences and prose preambles, then extracts the first balanced
 * JSON object or array.
 */
function cleanJson(raw) {
    if (!raw)
        return "{}";
    let s = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
    const start = Math.min(...["{", "["].map(ch => { const i = s.indexOf(ch); return i === -1 ? Infinity : i; }));
    if (!Number.isFinite(start))
        return "{}";
    s = s.slice(start);
    let depth = 0, inStr = false, esc = false, end = -1;
    const open = s[0], close = open === "{" ? "}" : "]";
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (esc) {
            esc = false;
            continue;
        }
        if (c === "\\") {
            esc = true;
            continue;
        }
        if (c === '"') {
            inStr = !inStr;
            continue;
        }
        if (inStr)
            continue;
        if (c === open)
            depth++;
        if (c === close) {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    return end >= 0 ? s.slice(0, end + 1) : s;
}
/** Parse JSON safely — returns fallback if invalid. */
function safeParse(raw, fallback) {
    try {
        return JSON.parse(cleanJson(raw));
    }
    catch {
        return fallback;
    }
}
