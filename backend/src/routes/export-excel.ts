import type { Request, Response } from "express";
import { supabaseAdmin } from "../lib/supabase";
import ExcelJS from "exceljs";

const ORANGE = "FFFF6B00";
const WHITE  = "FFFFFFFF";
const DARK   = "FF1E293B";

function header(ws: ExcelJS.Worksheet, col: string, label: string) {
  const cell = ws.getCell(col);
  cell.value = label;
  cell.font  = { bold: true, color: { argb: WHITE }, size: 11 };
  cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.border = { bottom: { style: "thin", color: { argb: ORANGE } } };
}

function currency(ws: ExcelJS.Worksheet, col: string, value: number | null) {
  const cell = ws.getCell(col);
  cell.value = value ?? 0;
  cell.numFmt = "$#,##0";
  cell.font   = { color: { argb: DARK } };
}

export async function exportExcelHandler(req: Request, res: Response) {
  const { dealId } = req.body as { dealId: string };
  const db = supabaseAdmin();

  const [
    { data: deal }, { data: financials }, { data: unitMix },
    { data: risks }, { data: criteria }, { data: extracted },
  ] = await Promise.all([
    db.from("deals").select("*").eq("id", dealId).single(),
    db.from("financials").select("*").eq("deal_id", dealId),
    db.from("unit_mix").select("*").eq("deal_id", dealId),
    db.from("risks").select("*").eq("deal_id", dealId),
    db.from("criteria").select("*").eq("deal_id", dealId),
    db.from("extracted_data").select("*").eq("deal_id", dealId),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Antigravity CRE OS";
  wb.created = new Date();

  // ── Tab 1: Summary ────────────────────────────────────────────────────────
  const ws1 = wb.addWorksheet("Deal Summary", { properties: { tabColor: { argb: ORANGE } } });
  ws1.columns = [{ width: 28 }, { width: 22 }, { width: 22 }, { width: 22 }];

  ws1.mergeCells("A1:D1");
  const titleCell = ws1.getCell("A1");
  titleCell.value = deal?.name || "Deal Summary";
  titleCell.font  = { bold: true, size: 18, color: { argb: ORANGE } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  ws1.getRow(1).height = 40;

  ws1.mergeCells("A2:D2");
  ws1.getCell("A2").value = `${deal?.address || ""}, ${deal?.city || ""}, ${deal?.state || ""}`;
  ws1.getCell("A2").font  = { size: 11, color: { argb: "FF64748B" } };
  ws1.getRow(2).height = 22;

  const summaryData: [string, string | number][] = [
    ["", ""],
    ["PROPERTY DETAILS", ""],
    ["Asset Type",      deal?.asset_type || ""],
    ["Property Type",   deal?.property_type || ""],
    ["Year Built",      deal?.year_built || ""],
    ["Total Units",     deal?.units || ""],
    ["Broker",          deal?.broker || ""],
    ["Brand / Flag",    deal?.brand || ""],
    ["Deal Lead",       deal?.deal_lead || ""],
    ["", ""],
    ["INVESTMENT METRICS", ""],
    ["Guidance Price",  deal?.guidance_price ? `$${(deal.guidance_price/1e6).toFixed(1)}M` : ""],
    ["NOI (TTM)",       deal?.noi ? `$${(deal.noi/1e6).toFixed(2)}M` : ""],
    ["Cap Rate",        deal?.cap_rate ? `${deal.cap_rate}%` : ""],
    ["Status",          (deal?.status || "").toUpperCase()],
  ];

  summaryData.forEach((row, i) => {
    const rowNum = i + 4;
    if (row[0]) {
      const labelCell = ws1.getCell(`A${rowNum}`);
      if (!row[1]) {
        labelCell.value = row[0];
        labelCell.font  = { bold: true, color: { argb: ORANGE }, size: 10 };
        labelCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6ED" } };
        ws1.mergeCells(`A${rowNum}:D${rowNum}`);
      } else {
        labelCell.value = row[0];
        labelCell.font  = { color: { argb: "FF64748B" }, size: 10 };
        ws1.getCell(`B${rowNum}`).value = row[1];
        ws1.getCell(`B${rowNum}`).font  = { bold: true, size: 10 };
      }
    }
  });

  // ── Tab 2: T12 Financials ─────────────────────────────────────────────────
  const ws2 = wb.addWorksheet("T12 Financials", { properties: { tabColor: { argb: "FF10B981" } } });
  ws2.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];
  ["A1","B1","C1","D1","E1"].forEach((col, i) =>
    header(ws2, col, ["METRIC","2021","2022","2023","TTM"][i])
  );
  (financials || []).forEach((row, i) => {
    const rn = i + 2;
    ws2.getCell(`A${rn}`).value = row.sub_category;
    ws2.getCell(`A${rn}`).font  = { bold: true };
    currency(ws2, `B${rn}`, row.y2021);
    currency(ws2, `C${rn}`, row.y2022);
    currency(ws2, `D${rn}`, row.y2023);
    currency(ws2, `E${rn}`, row.ttm);
    if (i % 2 === 0) {
      ["A","B","C","D","E"].forEach(c => {
        ws2.getCell(`${c}${rn}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      });
    }
  });

  // ── Tab 3: Unit Mix ───────────────────────────────────────────────────────
  const ws3 = wb.addWorksheet("Unit Mix", { properties: { tabColor: { argb: "FF6366F1" } } });
  ws3.columns = [{ width: 22 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];
  ["A1","B1","C1","D1","E1"].forEach((col, i) =>
    header(ws3, col, ["UNIT TYPE","TOTAL UNITS","VACANT","OCC %","AVG RENT"][i])
  );
  (unitMix || []).forEach((u, i) => {
    const rn = i + 2;
    const occ = u.total_units > 0 ? (((u.total_units - u.vacant_units) / u.total_units)*100).toFixed(1) + "%" : "—";
    ws3.getCell(`A${rn}`).value = u.unit_type;
    ws3.getCell(`B${rn}`).value = u.total_units;
    ws3.getCell(`C${rn}`).value = u.vacant_units;
    ws3.getCell(`D${rn}`).value = occ;
    currency(ws3, `E${rn}`, u.avg_rent);
  });

  // ── Tab 4: Underwriting ───────────────────────────────────────────────────
  const ws4 = wb.addWorksheet("Underwriting", { properties: { tabColor: { argb: "FFF59E0B" } } });
  ws4.columns = [{ width: 30 }, { width: 22 }];
  header(ws4, "A1", "METRIC");
  header(ws4, "B1", "VALUE");
  const uwFields = ["underwrittenNOI","stabilizedCapRate","dscr","cashOnCash","irr5yr","buyBoxScore","recommendation","rationale"];
  (extracted || []).filter(e => uwFields.includes(e.field_name)).forEach((f, i) => {
    const rn = i + 2;
    ws4.getCell(`A${rn}`).value = f.field_name;
    ws4.getCell(`A${rn}`).font  = { color: { argb: "FF64748B" } };
    ws4.getCell(`B${rn}`).value = f.value;
    ws4.getCell(`B${rn}`).font  = { bold: true };
  });

  // ── Tab 5: Risks ──────────────────────────────────────────────────────────
  const ws5 = wb.addWorksheet("Risks", { properties: { tabColor: { argb: "FFEF4444" } } });
  ws5.columns = [{ width: 60 }, { width: 14 }];
  header(ws5, "A1", "RISK DESCRIPTION");
  header(ws5, "B1", "SEVERITY");
  const colorMap: Record<string,string> = { critical:"FFEF4444", high:"FFF97316", medium:"FFF59E0B", low:"FF10B981" };
  (risks || []).forEach((r, i) => {
    const rn = i + 2;
    ws5.getCell(`A${rn}`).value = r.description;
    ws5.getCell(`B${rn}`).value = r.severity.toUpperCase();
    ws5.getCell(`B${rn}`).font  = { bold: true, color: { argb: colorMap[r.severity] || ORANGE } };
  });

  // ── Tab 6: Criteria ───────────────────────────────────────────────────────
  const ws6 = wb.addWorksheet("Criteria", { properties: { tabColor: { argb: "FF10B981" } } });
  ws6.columns = [{ width: 24 }, { width: 20 }, { width: 20 }, { width: 10 }];
  ["A1","B1","C1","D1"].forEach((col, i) =>
    header(ws6, col, ["CRITERIA","REQUIREMENT","ACTUAL","MEETS"][i])
  );
  (criteria || []).forEach((c, i) => {
    const rn = i + 2;
    ws6.getCell(`A${rn}`).value = c.criteria;
    ws6.getCell(`B${rn}`).value = c.requirement;
    ws6.getCell(`C${rn}`).value = c.actual;
    ws6.getCell(`D${rn}`).value = c.meets ? "✓ PASS" : "✗ FAIL";
    ws6.getCell(`D${rn}`).font  = { bold: true, color: { argb: c.meets ? "FF10B981" : "FFEF4444" } };
  });

  const buffer = await wb.xlsx.writeBuffer() as Buffer;
  const filename = `${(deal?.name || "deal").replace(/\s+/g,"_")}_underwriting.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}
