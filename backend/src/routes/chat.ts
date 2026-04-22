import type { Request, Response } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { chat, MODELS } from "../lib/llm";

export async function chatHandler(req: Request, res: Response) {
  const { dealId, message, history } = req.body as {
    dealId: string;
    message: string;
    history: { role: "user" | "assistant"; content: string }[];
  };

  const db = supabaseAdmin();

  const [
    { data: deal }, { data: financials }, { data: risks },
    { data: questions }, { data: unitMix }, { data: criteria },
  ] = await Promise.all([
    db.from("deals").select("*").eq("id", dealId).single(),
    db.from("financials").select("*").eq("deal_id", dealId),
    db.from("risks").select("*").eq("deal_id", dealId),
    db.from("questions").select("*").eq("deal_id", dealId),
    db.from("unit_mix").select("*").eq("deal_id", dealId),
    db.from("criteria").select("*").eq("deal_id", dealId),
  ]);

  const context = `
DEAL: ${deal?.name || "Unknown"} — ${deal?.city || ""}, ${deal?.state || ""}
Asset Type: ${deal?.asset_type || ""} | Units: ${deal?.units || 0} | Year Built: ${deal?.year_built || ""}
Guidance Price: $${(deal?.guidance_price || 0).toLocaleString()} | NOI: $${(deal?.noi || 0).toLocaleString()} | Cap Rate: ${deal?.cap_rate || 0}%
Broker: ${deal?.broker || ""} | Status: ${deal?.status || ""}

FINANCIALS: ${JSON.stringify(financials?.slice(0, 5) || [])}
UNIT MIX: ${JSON.stringify(unitMix?.slice(0, 8) || [])}
RISKS: ${(risks || []).map(r => `[${r.severity.toUpperCase()}] ${r.description}`).join("\n")}
CRITERIA: ${(criteria || []).map(c => `${c.criteria}: ${c.actual} (${c.meets ? "PASS" : "FAIL"})`).join(", ")}
DD QUESTIONS: ${(questions || []).map(q => q.question).slice(0, 5).join("; ")}
BROKER NARRATIVE: ${deal?.broker_narrative || ""}
LOCATION INSIGHT: ${deal?.location_insight || ""}
`.trim();

  const messages = [
    {
      role: "system" as const,
      content: `You are an expert CRE investment analyst AI. You have full access to the deal data below. Answer questions precisely, cite specific numbers, and provide actionable insights. Format financial figures clearly.\n\nDEAL CONTEXT:\n${context}`,
    },
    ...(history || []).slice(-8),
    { role: "user" as const, content: message },
  ];

  const reply = await chat({
    agent: "chat",
    model: MODELS.REASONING,
    max_tokens: 1024,
    messages,
  }) || "I couldn't generate a response.";

  const { data: explanations } = await db
    .from("ai_explanations")
    .select("field_name, source_snippet, source_page")
    .eq("deal_id", dealId)
    .limit(3);

  const citations = (explanations || [])
    .filter(e => e.source_snippet)
    .map(e => ({ field: e.field_name, snippet: e.source_snippet, page: e.source_page }));

  res.json({ reply, citations });
}
