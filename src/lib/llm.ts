// Unified LLM client — routes to Ollama (local), NVIDIA NIM (cloud), or Groq (cloud).
// Mimics Groq/OpenAI chat.completions.create shape so existing code works unchanged.

import Groq from "groq-sdk";

const OLLAMA_URL   = process.env.OLLAMA_URL   || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b-instruct-q4_K_M";
const USE_LOCAL    = (process.env.USE_LOCAL_LLM || "true").toLowerCase() === "true";

// NVIDIA NIM hosts llama-3.3-70b, deepseek-v3, and many others via OpenAI-compatible API.
const NVIDIA_BASE   = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL  = process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";
const NVIDIA_KEY    = process.env.NVIDIA_API_KEY;

/**
 * Tiered per-agent model routing:
 *   LIGHT       — fast, cheap tasks (distillation, simple generation)
 *   STANDARD    — normal extraction (metadata, unit mix, summary, criteria)
 *   REASONING   — financial / risk / underwriting (needs deep math + logic)
 */
export const MODELS = {
  LIGHT:     "meta/llama-3.1-8b-instruct",    // NIM: fast, cheap distillation
  STANDARD:  "meta/llama-3.3-70b-instruct",   // NIM: main extraction agents
  REASONING: "deepseek-ai/deepseek-v3.2",     // NIM: financial reasoning (latest DeepSeek)
} as const;

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatOptions {
  messages:     ChatMessage[];
  max_tokens?:  number;
  temperature?: number;
  model?:       string;
  /**
   * Which backend to prefer:
   *   - "local"   = use Ollama (default if USE_LOCAL_LLM=true)
   *   - "cloud"   = cloud providers (NVIDIA first, Groq as backup)
   *   - "nvidia"  = force NVIDIA NIM
   *   - "groq"    = force Groq
   *   - "auto"    = follow USE_LOCAL_LLM env (default)
   */
  prefer?: "local" | "cloud" | "nvidia" | "groq" | "auto";
}

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY is not set in .env.local — required for cloud agents.");
    }
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

// Truncate user messages so combined prompt stays under the provider's limit.
// NVIDIA / Groq can technically handle more, but large payloads cause 504/413.
function truncateMessages(messages: ChatMessage[], maxChars: number): ChatMessage[] {
  const total = messages.reduce((s, m) => s + m.content.length, 0);
  if (total <= maxChars) return messages;
  // Shorten only user messages (system + assistant are usually small)
  return messages.map(m => {
    if (m.role !== "user" || m.content.length < 500) return m;
    const budget = Math.max(500, Math.floor(m.content.length * (maxChars / total)));
    return { ...m, content: m.content.slice(0, budget) + "\n\n[…truncated for length…]" };
  });
}

async function nvidiaChat(opts: ChatOptions): Promise<string> {
  if (!NVIDIA_KEY) throw new Error("NVIDIA_API_KEY is not set — required for NVIDIA NIM inference.");
  // Give up after 30s instead of waiting for NIM's ~60s gateway timeout — lets cloudChain
  // fall through to Groq sooner when NIM is slow.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NVIDIA_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        // Use opts.model if it's a NIM-shaped path (vendor/name), otherwise fall back to default.
        // Groq-style names like "llama-3.3-70b-versatile" get replaced with NVIDIA_MODEL.
        model:       opts.model && opts.model.includes("/") ? opts.model : NVIDIA_MODEL,
        messages:    truncateMessages(opts.messages, 80_000),  // ~60K tokens max for NIM
        max_tokens:  opts.max_tokens ?? 1024,
        temperature: opts.temperature ?? 0.2,
        stream:      false,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    // AbortError = our 30s timeout fired. Masquerade as 504 so cloudChain retries next provider.
    if ((err as Error).name === "AbortError") {
      const timeoutErr = new Error("NVIDIA NIM client timeout after 30s");
      (timeoutErr as Error & { status?: number }).status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`NVIDIA NIM HTTP ${res.status}: ${body.slice(0, 300)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

async function ollamaChat(opts: ChatOptions): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model:    OLLAMA_MODEL,
      messages: opts.messages,
      stream:   false,
      options:  {
        temperature: opts.temperature ?? 0.2,
        num_predict: opts.max_tokens  ?? 1024,
      },
    }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json() as { message?: { content?: string } };
  return json.message?.content ?? "";
}

async function groqChat(opts: ChatOptions): Promise<string> {
  // Groq doesn't host DeepSeek / NIM-style models — map them to Groq's best Llama.
  const requested = opts.model ?? "llama-3.3-70b-versatile";
  const groqModel = requested.includes("/") ? "llama-3.3-70b-versatile" : requested;
  // Cascading model fallback: 70B rate-limited/too-large → 8B with tighter truncation.
  const fallbacks: { model: string; maxChars: number }[] = groqModel === "llama-3.3-70b-versatile"
    ? [
        { model: "llama-3.3-70b-versatile", maxChars: 60_000 },  // ~128K ctx, safe budget
        { model: "llama-3.1-8b-instant",    maxChars: 20_000 },  // ~32K ctx, tight
      ]
    : [{ model: groqModel, maxChars: 20_000 }];

  let lastErr: unknown;
  for (const { model, maxChars } of fallbacks) {
    try {
      const r = await getGroq().chat.completions.create({
        model,
        max_tokens:  opts.max_tokens ?? 1024,
        temperature: opts.temperature ?? 0.2,
        messages:    truncateMessages(opts.messages, maxChars),
      });
      return r.choices[0]?.message?.content ?? "";
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      // 429 = rate limit, 413 = payload too large — try next model; otherwise give up
      if (status !== 429 && status !== 413) throw err;
      console.warn(`[llm] ${model} rate-limited or oversized (${status}), trying next fallback...`);
    }
  }
  throw lastErr;
}

/**
 * Unified chat completion.
 * Returns the raw string content of the assistant's reply.
 * Falls back to Groq if Ollama fails and GROQ_API_KEY is present.
 */
/**
 * Cloud chain — tries providers in order, falling back on rate limits.
 * NVIDIA first (massive free quota), Groq second (faster), Ollama last (local).
 */
async function cloudChain(opts: ChatOptions): Promise<string> {
  const providers: { name: string; fn: () => Promise<string>; enabled: boolean }[] = [
    { name: "nvidia",  fn: () => nvidiaChat(opts),  enabled: !!NVIDIA_KEY },
    { name: "groq",    fn: () => groqChat(opts),    enabled: !!process.env.GROQ_API_KEY },
    { name: "ollama",  fn: () => ollamaChat(opts),  enabled: true },
  ].filter(p => p.enabled);

  let lastErr: unknown;
  for (const p of providers) {
    try {
      return await p.fn();
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status === 429 || status === 402 || status === 503 || status === 504 || status === 413 || status === 404) {
        console.warn(`[llm] ${p.name} rate-limited/unavailable (${status}) — trying next provider`);
        continue;
      }
      // Non-rate-limit errors from NVIDIA/Groq: still try Ollama as last resort
      if (p.name !== "ollama") {
        console.warn(`[llm] ${p.name} failed with:`, (err as Error).message?.slice(0, 120));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("All LLM providers failed.");
}

export async function chat(opts: ChatOptions): Promise<string> {
  const prefer = opts.prefer ?? "auto";

  if (prefer === "nvidia") return await nvidiaChat(opts);
  if (prefer === "groq")   return await groqChat(opts);
  if (prefer === "local")  {
    try { return await ollamaChat(opts); }
    catch (err) {
      console.error("[llm] Ollama failed, trying cloud:", err);
      return await cloudChain(opts);
    }
  }

  // auto / cloud → cloud chain (nvidia → groq → ollama)
  if (prefer === "auto" && USE_LOCAL) {
    try { return await ollamaChat(opts); }
    catch (err) {
      console.warn("[llm] Ollama failed, falling back to cloud:", (err as Error).message);
      return await cloudChain(opts);
    }
  }
  return await cloudChain(opts);
}

/**
 * Robust JSON extractor for small-model outputs.
 * Strips markdown fences, prose preambles like "Based on the document..."
 * and extracts the first balanced JSON object or array.
 */
export function cleanJson(raw: string): string {
  if (!raw) return "{}";
  let s = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();

  // Find the first { or [ and extract balanced JSON
  const start = Math.min(
    ...["{", "["].map(ch => { const i = s.indexOf(ch); return i === -1 ? Infinity : i; })
  );
  if (!Number.isFinite(start)) return "{}";
  s = s.slice(start);

  // Scan to find the matching closing bracket (handles nested + strings)
  let depth = 0, inStr = false, esc = false, end = -1;
  const open = s[0], close = open === "{" ? "}" : "]";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open)  depth++;
    if (c === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  return end >= 0 ? s.slice(0, end + 1) : s;
}

/** Parse JSON safely — returns fallback if invalid. */
export function safeParse<T>(raw: string, fallback: T): T {
  try { return JSON.parse(cleanJson(raw)) as T; }
  catch { return fallback; }
}
