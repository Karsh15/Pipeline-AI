import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import PptxGenJS from "pptxgenjs";

const ORANGE = "FF6B00";
const WHITE  = "FFFFFF";
const DARK   = "1E293B";
const LIGHT  = "FFF6ED";
const GRAY   = "64748B";

export async function POST(req: NextRequest) {
  const { dealId } = await req.json() as { dealId: string };
  const db = supabaseAdmin();

  const [{ data: deal }, { data: financials }, { data: unitMix }, { data: risks }, { data: criteria }, { data: extracted }] =
    await Promise.all([
      db.from("deals").select("*").eq("id", dealId).single(),
      db.from("financials").select("*").eq("deal_id", dealId),
      db.from("unit_mix").select("*").eq("deal_id", dealId),
      db.from("risks").select("*").eq("deal_id", dealId),
      db.from("criteria").select("*").eq("deal_id", dealId),
      db.from("extracted_data").select("*").eq("deal_id", dealId),
    ]);

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title  = deal?.name || "Deal Analysis";
  pptx.author = "Antigravity CRE OS";

  const masterOpts = { background: { color: WHITE } };

  const getField = (name: string) => extracted?.find(e => e.field_name === name)?.value || "";

  // ── Slide 1: Cover ────────────────────────────────────────────────────────
  const s1 = pptx.addSlide();
  s1.background = { color: DARK };
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.5, h: 5.63, fill: { color: ORANGE } });
  s1.addText(deal?.name || "Deal Analysis", {
    x: 0.8, y: 1.5, w: 8.5, h: 1.2,
    fontSize: 36, bold: true, color: WHITE, fontFace: "Calibri",
  });
  s1.addText(`${deal?.address || ""} · ${deal?.city || ""}, ${deal?.state || ""}`, {
    x: 0.8, y: 2.8, w: 8.5, h: 0.5, fontSize: 14, color: "AAAAAA",
  });
  s1.addText(`${(deal?.asset_type || "").toUpperCase()} · ${deal?.units || 0} UNITS · ${new Date().getFullYear()}`, {
    x: 0.8, y: 3.4, w: 8.5, h: 0.4, fontSize: 11, color: ORANGE, bold: true,
  });
  s1.addText("CONFIDENTIAL — AI-GENERATED UNDERWRITING ANALYSIS", {
    x: 0.8, y: 4.8, w: 8.5, h: 0.3, fontSize: 8, color: "888888",
  });

  // ── Slide 2: Deal Overview ────────────────────────────────────────────────
  const s2 = pptx.addSlide();
  s2.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.8, fill: { color: ORANGE } });
  s2.addText("DEAL OVERVIEW", { x: 0.4, y: 0.15, w: 9, h: 0.5, fontSize: 18, bold: true, color: WHITE });

  const metrics = [
    { label: "Guidance Price", value: deal?.guidance_price ? `$${(deal.guidance_price/1e6).toFixed(1)}M` : "—" },
    { label: "NOI (TTM)",      value: deal?.noi ? `$${(deal.noi/1e3).toFixed(0)}K` : "—" },
    { label: "Cap Rate",       value: deal?.cap_rate ? `${deal.cap_rate}%` : "—" },
    { label: "Total Units",    value: String(deal?.units || "—") },
    { label: "Year Built",     value: String(deal?.year_built || "—") },
    { label: "Broker",         value: deal?.broker || "—" },
  ];

  metrics.forEach((m, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.3 + col * 3.2;
    const y = 1.1 + row * 1.5;
    s2.addShape(pptx.ShapeType.rect, { x, y, w: 3.0, h: 1.2, fill: { color: "F8FAFC" }, line: { color: "E2E8F0", width: 1 } });
    s2.addText(m.value, { x, y: y + 0.1, w: 3.0, h: 0.7, fontSize: 22, bold: true, color: ORANGE, align: "center" });
    s2.addText(m.label, { x, y: y + 0.75, w: 3.0, h: 0.35, fontSize: 9, color: GRAY, align: "center" });
  });

  // ── Slide 3: Location ─────────────────────────────────────────────────────
  const s3 = pptx.addSlide();
  s3.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.8, fill: { color: ORANGE } });
  s3.addText("LOCATION & MARKET", { x: 0.4, y: 0.15, w: 9, h: 0.5, fontSize: 18, bold: true, color: WHITE });

  s3.addText(`${deal?.city || ""}, ${deal?.state || ""}`, {
    x: 0.4, y: 1.0, w: 9, h: 0.6, fontSize: 24, bold: true, color: DARK,
  });
  s3.addText(deal?.location_insight || "Location analysis pending.", {
    x: 0.4, y: 1.8, w: 9, h: 1.5, fontSize: 13, color: GRAY,
    bullet: false, paraSpaceAfter: 8,
  });
  s3.addText(deal?.broker_narrative || "Broker narrative pending.", {
    x: 0.4, y: 3.5, w: 9, h: 1.5, fontSize: 11, color: "94A3B8",
  });

  // ── Slide 4: Unit Mix ─────────────────────────────────────────────────────
  if (unitMix?.length) {
    const s4 = pptx.addSlide();
    s4.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.8, fill: { color: ORANGE } });
    s4.addText("UNIT MIX", { x: 0.4, y: 0.15, w: 9, h: 0.5, fontSize: 18, bold: true, color: WHITE });

    const headers = ["Unit Type", "Total Units", "Vacant", "Occ %", "Avg Rent"];
    headers.forEach((h, i) => {
      s4.addText(h, {
        x: 0.3 + i * 1.85, y: 1.0, w: 1.8, h: 0.4,
        fontSize: 9, bold: true, color: WHITE, align: "center",
        fill: { color: ORANGE },
      });
    });

    unitMix.slice(0, 8).forEach((u, ri) => {
      const y = 1.5 + ri * 0.48;
      const occ = u.total_units > 0 ? (((u.total_units - u.vacant_units) / u.total_units) * 100).toFixed(0) + "%" : "—";
      const rowData = [u.unit_type, String(u.total_units), String(u.vacant_units), occ, `$${u.avg_rent.toLocaleString()}`];
      rowData.forEach((val, ci) => {
        s4.addText(val, {
          x: 0.3 + ci * 1.85, y, w: 1.8, h: 0.42,
          fontSize: 10, align: "center", color: DARK,
          fill: { color: ri % 2 === 0 ? "F8FAFC" : WHITE },
        });
      });
    });
  }

  // ── Slide 5: Financials ───────────────────────────────────────────────────
  if (financials?.length) {
    const s5 = pptx.addSlide();
    s5.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.8, fill: { color: ORANGE } });
    s5.addText("T-12 FINANCIALS", { x: 0.4, y: 0.15, w: 9, h: 0.5, fontSize: 18, bold: true, color: WHITE });

    const fHeaders = ["Metric", "2021", "2022", "2023", "TTM"];
    fHeaders.forEach((h, i) => {
      s5.addText(h, {
        x: 0.3 + i * 1.85, y: 1.0, w: 1.8, h: 0.4,
        fontSize: 9, bold: true, color: WHITE, align: "center",
        fill: { color: ORANGE },
      });
    });

    const fmt = (n: number) => n ? `$${(n/1000).toFixed(0)}K` : "—";
    financials.slice(0, 8).forEach((f, ri) => {
      const y = 1.5 + ri * 0.48;
      const rowData = [f.sub_category, fmt(f.y2021), fmt(f.y2022), fmt(f.y2023), fmt(f.ttm)];
      rowData.forEach((val, ci) => {
        s5.addText(val, {
          x: 0.3 + ci * 1.85, y, w: 1.8, h: 0.42,
          fontSize: 10, align: ci === 0 ? "left" : "center",
          color: ci === 4 ? ORANGE : DARK,
          bold: ci === 4,
          fill: { color: ri % 2 === 0 ? "F8FAFC" : WHITE },
        });
      });
    });
  }

  // ── Slide 6: Risks ────────────────────────────────────────────────────────
  const s6 = pptx.addSlide();
  s6.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.8, fill: { color: "EF4444" } });
  s6.addText("KEY RISKS", { x: 0.4, y: 0.15, w: 9, h: 0.5, fontSize: 18, bold: true, color: WHITE });

  const severityColors: Record<string, string> = {
    critical: "EF4444", high: "F97316", medium: "F59E0B", low: "10B981",
  };

  (risks || []).slice(0, 6).forEach((r, i) => {
    const y = 1.0 + i * 0.72;
    s6.addShape(pptx.ShapeType.rect, { x: 0.3, y, w: 9.4, h: 0.6, fill: { color: "FEF2F2" }, line: { color: "FECACA" } });
    s6.addShape(pptx.ShapeType.rect, { x: 0.3, y, w: 0.12, h: 0.6, fill: { color: severityColors[r.severity] || ORANGE } });
    s6.addText(`[${r.severity.toUpperCase()}] ${r.description}`, {
      x: 0.55, y: y + 0.1, w: 9.0, h: 0.4, fontSize: 10, color: DARK,
    });
  });

  // ── Slide 7: Recommendation ───────────────────────────────────────────────
  const s7 = pptx.addSlide();
  const rec = getField("recommendation").toUpperCase();
  const recColor = rec === "BUY" ? "10B981" : rec === "WATCH" ? "F59E0B" : "EF4444";
  s7.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.8, fill: { color: ORANGE } });
  s7.addText("RECOMMENDATION", { x: 0.4, y: 0.15, w: 9, h: 0.5, fontSize: 18, bold: true, color: WHITE });

  s7.addShape(pptx.ShapeType.rect, { x: 3.5, y: 1.2, w: 3.0, h: 1.4, fill: { color: recColor }, line: { color: recColor } });
  s7.addText(rec || "REVIEW", { x: 3.5, y: 1.5, w: 3.0, h: 0.8, fontSize: 40, bold: true, color: WHITE, align: "center" });

  s7.addText(getField("rationale") || "Analysis pending final review.", {
    x: 0.6, y: 2.9, w: 8.8, h: 1.2, fontSize: 13, color: GRAY, align: "center",
  });

  const criteriaPass = (criteria || []).filter(c => c.meets).length;
  const criteriaTot  = (criteria || []).length;
  s7.addText(`Buy Box: ${criteriaPass}/${criteriaTot} criteria met · Buy Box Score: ${getField("buyBoxScore") || "—"}/100`, {
    x: 0.6, y: 4.3, w: 8.8, h: 0.4, fontSize: 11, color: ORANGE, align: "center", bold: true,
  });
  s7.addText("Generated by Antigravity CRE Underwriting OS", {
    x: 0, y: 5.1, w: 10, h: 0.3, fontSize: 8, color: "CCCCCC", align: "center",
  });

  const buffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${(deal?.name || "deal").replace(/\s+/g,"_")}_analysis.pptx"`,
    },
  });
}
