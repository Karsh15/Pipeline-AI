import type { Request, Response } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { chat, safeParse, MODELS } from "../lib/llm";

function emit(res: Response, data: object) {
  try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ }
}

export async function runUnderwritingHandler(req: Request, res: Response) {
  const { dealId } = req.body as { dealId: string };
  const db = supabaseAdmin();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    await db.from("deals").update({ status: "underwriting" }).eq("id", dealId);
    emit(res, { type: "stage", stage: "underwriting" });

    const { data: deal }       = await db.from("deals").select("*").eq("id", dealId).single();
    const { data: financials } = await db.from("financials").select("*").eq("deal_id", dealId);
    const { data: unitMix }    = await db.from("unit_mix").select("*").eq("deal_id", dealId);
    const { data: risks }      = await db.from("risks").select("*").eq("deal_id", dealId);

    // Build compact context: deal scalars + top financial rows only
    const d = deal as Record<string, unknown>;
    const compactDeal = {
      name: d.name, assetType: d.asset_type, units: d.units,
      guidancePrice: d.guidance_price, noi: d.noi, capRate: d.cap_rate,
      dscr: d.dscr, occupancy: d.occupancy_rate, yearBuilt: d.year_built,
      loanAmount: d.loan_amount, loanType: d.loan_type, interestRate: d.interest_rate,
    };
    const topFinancials = (financials || [])
      .filter((r: Record<string,unknown>) => r.ttm && Number(r.ttm) !== 0)
      .slice(0, 12)
      .map((r: Record<string,unknown>) => ({ m: r.sub_category, cat: r.category, ttm: r.ttm }));
    const compactRisks = (risks || []).slice(0, 5).map((r: Record<string,unknown>) => ({ d: r.description, s: r.severity }));
    const context = JSON.stringify({ deal: compactDeal, financials: topFinancials, risks: compactRisks }).substring(0, 4000);

    emit(res, { type: "log", agent: "underwriting", message: "Calculating underwritten NOI..." });

    const uwRaw = await chat({
      agent: "underwriting",
      model: MODELS.STANDARD,
      max_tokens: 800,
      messages: [{
        role: "system",
        content: "CRE underwriter. Output ONLY raw JSON, no markdown. Start with { end with }.",
      }, {
        role: "user",
        content: `Underwrite this deal. Return JSON: {"underwrittenNOI":0,"stabilizedCapRate":0,"effectiveGrossIncome":0,"vacancyLoss":0,"operatingExpenses":0,"netOperatingIncome":0,"debtService":0,"dscr":0,"cashOnCash":0,"irr5yr":0,"exitCapRate":0,"buyBoxScore":0,"recommendation":"buy|watch|pass","rationale":"2-3 sentences","keyAssumptions":["a1","a2"]}
DEAL:\n${context}`,
      }],
    });

    const uwJson = safeParse<Record<string, unknown>>(uwRaw, {});
    const uwFields = ["underwrittenNOI","stabilizedCapRate","effectiveGrossIncome","vacancyLoss","operatingExpenses","netOperatingIncome","debtService","dscr","cashOnCash","irr5yr","exitCapRate","buyBoxScore","recommendation","rationale"];

    const inserts = uwFields.filter(f => uwJson[f] !== undefined).map(f => ({
      deal_id: dealId, field_name: f, value: String(uwJson[f]), confidence_score: 0.88, source_document_id: null,
    }));
    if (inserts.length) {
      await db.from("extracted_data").delete().eq("deal_id", dealId).in("field_name", uwFields);
      await db.from("extracted_data").insert(inserts);
    }

    const dealUpdate: Record<string, number> = {};
    const uwNOI = Number(uwJson.underwrittenNOI || uwJson.netOperatingIncome || 0);
    const uwCap = Number(uwJson.stabilizedCapRate || uwJson.exitCapRate || 0);
    if (uwNOI > 1000 && (!deal?.noi || deal.noi === 0)) dealUpdate.noi      = uwNOI;
    if (uwCap > 0 && (!deal?.cap_rate || Number(deal.cap_rate) === 0)) dealUpdate.cap_rate = uwCap;
    if (Object.keys(dealUpdate).length) await db.from("deals").update(dealUpdate).eq("id", dealId);

    const explanations = [
      { field_name: "underwrittenNOI", explanation_text: `Underwritten NOI of $${(uwJson.underwrittenNOI as number||0).toLocaleString()} reflects stabilized operations. ${uwJson.rationale||""}` },
      { field_name: "buyBoxScore", explanation_text: `Buy Box Score of ${uwJson.buyBoxScore}/100 based on ${(uwJson.keyAssumptions as string[]||[]).join(", ")}.` },
      { field_name: "recommendation", explanation_text: `Recommendation: ${String(uwJson.recommendation||"").toUpperCase()} — ${uwJson.rationale||""}` },
    ];
    for (const ex of explanations) {
      await db.from("ai_explanations").upsert({ deal_id: dealId, field_name: ex.field_name, explanation_text: ex.explanation_text, source_document_id: null });
    }

    emit(res, { type: "log", agent: "underwriting", message: `✓ Underwritten NOI: $${(uwJson.underwrittenNOI as number||0).toLocaleString()}` });
    emit(res, { type: "log", agent: "underwriting", message: `✓ Recommendation: ${String(uwJson.recommendation||"").toUpperCase()}` });

    await db.from("ai_jobs").insert({ deal_id: dealId, job_type: "underwriting", status: "completed", result: uwJson });
    await db.from("deals").update({ status: "review" }).eq("id", dealId);
    emit(res, { type: "complete", stage: "review", result: uwJson });
  } catch (err) {
    emit(res, { type: "error", message: String(err) });
  } finally {
    res.end();
  }
}
