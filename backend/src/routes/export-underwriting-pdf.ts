import type { Request, Response } from "express";
import { supabaseAdmin } from "../lib/supabase";
import type { TDocumentDefinitions, Content, TableCell } from "pdfmake/interfaces";
import fs from "fs";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: Printer }    = require("pdfmake/js/Printer.js") as { default: new (fonts: unknown, vfs: unknown, urlResolver: unknown) => { createPdfKitDocument(def: unknown): Promise<import("stream").Readable> } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: URLResolver } = require("pdfmake/js/URLResolver.js") as { default: new (vfs: unknown) => { setUrlAccessPolicy(cb: () => boolean): void; addBinary(name: string, data: Buffer): void } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vfs = (require("pdfmake/js/virtual-fs.js") as { default: { writeFileSync(name: string, data: Buffer): void } }).default;

// Load local font files into pdfmake's virtual filesystem
const FONTS_DIR = path.resolve(__dirname, "../../fonts");
for (const filename of ["Roboto-Regular.ttf", "Roboto-Medium.ttf", "Roboto-Italic.ttf", "Roboto-MediumItalic.ttf"]) {
  vfs.writeFileSync(filename, fs.readFileSync(path.join(FONTS_DIR, filename)));
}

const _urlResolver = new URLResolver(vfs);
_urlResolver.setUrlAccessPolicy(() => false);

const _fonts = {
  Roboto: {
    normal:      "Roboto-Regular.ttf",
    bold:        "Roboto-Medium.ttf",
    italics:     "Roboto-Italic.ttf",
    bolditalics: "Roboto-MediumItalic.ttf",
  },
};

const _printer = new Printer(_fonts, vfs, _urlResolver);

function getPdfBuffer(docDef: unknown): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    _printer.createPdfKitDocument(docDef)
      .then(doc => {
        const chunks: Buffer[] = [];
        doc.on("data", (c: Buffer) => chunks.push(c));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
        (doc as unknown as { end(): void }).end();
      })
      .catch(reject);
  });
}

// ── Color palette ─────────────────────────────────────────────────────────────
const NAVY   = "#0A1628";
const BLUE   = "#1E3A5F";
const ACCENT = "#E8622A";
const GOLD   = "#C9A84C";
const LIGHT  = "#F4F6F9";
const GRAY   = "#64748B";
const WHITE  = "#FFFFFF";
const BLACK  = "#0F172A";
const GREEN  = "#16A34A";
const RED    = "#DC2626";


// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt$ = (n: number | null | undefined, decimals = 0) =>
  n != null && n !== 0
    ? "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : "—";

const fmtN = (n: number | null | undefined) =>
  n != null && n !== 0 ? Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—";

const fmtPct = (n: number | null | undefined) =>
  n != null && n !== 0 ? `${Number(n).toFixed(1)}%` : "—";

const fmtX = (n: number | null | undefined) =>
  n != null && n !== 0 ? `${Number(n).toFixed(2)}x` : "—";

function kpiBlock(label: string, value: string, sub?: string): Content {
  return {
    stack: [
      { text: label, fontSize: 7.5, color: GRAY, bold: false },
      { text: value, fontSize: 14, bold: true, color: BLACK, margin: [0, 2, 0, 0] },
      ...(sub ? [{ text: sub, fontSize: 7, color: GRAY }] : []),
    ],
    margin: [0, 0, 0, 0],
  };
}

function sectionHeader(title: string): Content {
  return {
    columns: [
      {
        canvas: [{ type: "rect", x: 0, y: 6, w: 4, h: 14, r: 2, color: ACCENT }],
        width: 10,
      },
      { text: title, fontSize: 11, bold: true, color: BLUE, margin: [4, 4, 0, 0] },
    ],
    margin: [0, 16, 0, 6],
  };
}

function divider(): Content {
  return { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: "#DDE2EA" }], margin: [0, 4, 0, 4] };
}

function pageHeader(dealName: string, pageTitle: string): Content {
  return {
    columns: [
      {
        stack: [
          { text: "CONFIDENTIAL OFFERING MEMORANDUM", fontSize: 7, color: GOLD, bold: true, characterSpacing: 1.5 },
          { text: dealName, fontSize: 9, color: WHITE, bold: true, margin: [0, 2, 0, 0] },
        ],
      },
      { text: pageTitle, fontSize: 8, color: GOLD, bold: true, alignment: "right", margin: [0, 8, 0, 0] },
    ],
    fillColor: NAVY,
    margin: [-40, -40, -40, 12],
  };
}

// ── Financial table helpers ───────────────────────────────────────────────────
const INCOME_ORDER = [
  "rooms revenue", "food & beverage", "meeting & banquet", "other operated depts",
  "spa & recreation", "retail", "parking", "miscellaneous income",
  "gross operating revenue", "gross potential rent", "other income", "effective gross income",
  "base rent", "laundry", "pet fees", "late fees",
];
const EXPENSE_ORDER = [
  "rooms expense", "f&b expense", "spa expense", "departmental expenses",
  "total departmental expenses",
  "administrative & general", "sales & marketing", "franchise fees", "property operations",
  "utilities", "payroll & benefits", "management fees",
  "gross operating profit",
  "insurance", "real estate taxes", "property taxes", "ff&e reserve", "reserve for replacement",
  "total fixed charges",
  "ebitda", "net operating income",
  "debt service",
];

function sortRows<T extends { sub_category: string; category: string }>(rows: T[]): T[] {
  const order = [...INCOME_ORDER, ...EXPENSE_ORDER];
  return [...rows].sort((a, b) => {
    const ai = order.findIndex(k => a.sub_category.toLowerCase().includes(k));
    const bi = order.findIndex(k => b.sub_category.toLowerCase().includes(k));
    if (a.category !== b.category) return a.category === "income" ? -1 : 1;
    if (ai === -1 && bi === -1) return a.sub_category.localeCompare(b.sub_category);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

const HIGHLIGHT_ROWS = new Set([
  "gross operating revenue", "effective gross income", "gross potential rent",
  "gross operating profit", "ebitda", "net operating income",
  "total departmental expenses", "total fixed charges",
]);

function isHighlight(label: string): boolean {
  return HIGHLIGHT_ROWS.has(label.toLowerCase());
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function exportUnderwritingPdfHandler(req: Request, res: Response) {
  const { dealId } = req.body as { dealId: string };
  const db = supabaseAdmin();

  const [
    { data: deal },
    { data: financials },
    { data: unitMix },
    { data: risks },
    { data: questions },
    { data: criteria },
    { data: extracted },
  ] = await Promise.all([
    db.from("deals").select("*").eq("id", dealId).single(),
    db.from("financials").select("*").eq("deal_id", dealId),
    db.from("unit_mix").select("*").eq("deal_id", dealId),
    db.from("risks").select("*").eq("deal_id", dealId),
    db.from("questions").select("*").eq("deal_id", dealId),
    db.from("criteria").select("*").eq("deal_id", dealId),
    db.from("extracted_data").select("*").eq("deal_id", dealId),
  ]);

  if (!deal) { res.status(404).json({ error: "Deal not found" }); return; }

  const d = deal as Record<string, unknown>;
  const dealName = (d.name as string) || "Property";
  const address  = [d.address, d.city, d.state].filter(Boolean).join(", ");

  // Extract field_name → value map from extracted_data
  const extMap: Record<string, string> = {};
  for (const row of (extracted || []) as Array<{ field_name: string; value: string }>) {
    extMap[row.field_name] = row.value;
  }

  // Detect year columns from financial data
  const YEAR_COLS = ["y2021", "y2022", "y2023", "y2024", "y2025"] as const;
  const finRows = (financials || []) as Array<Record<string, number> & { sub_category: string; category: string }>;
  const activeYears = YEAR_COLS.filter(y => finRows.some(r => r[y] && r[y] !== 0));
  const yearLabels: Record<string, string> = { y2021: "2021", y2022: "2022", y2023: "2023", y2024: "2024", y2025: "2025" };
  const colKeys = [...activeYears, "ttm"] as string[];
  const colLabels = [...activeYears.map(y => yearLabels[y]), "TTM"];

  // ── PAGE 1: Property Summary ───────────────────────────────────────────────

  const noi        = (d.noi as number)            || finRows.find(r => r.sub_category.toLowerCase().includes("net operating income"))?.ttm || 0;
  const capRate    = (d.cap_rate as number)        || 0;
  const dscr       = (d.dscr as number)            || 0;
  const occ        = (d.occupancy_rate as number)  || 0;
  const guidPrice  = (d.guidance_price as number)  || 0;
  const adr        = parseFloat(extMap["adr"] || "0") || 0;
  const revpar     = parseFloat(extMap["revpar"] || "0") || 0;
  const units      = (d.units as number)           || 0;
  const yearBuilt  = (d.year_built as number)      || 0;
  const renYear    = (d.renovation_year as number) || 0;

  const kpiItems: Content[] = [
    kpiBlock("Guidance Price",   guidPrice ? fmt$(guidPrice) : "TBD"),
    kpiBlock("NOI (TTM)",        fmt$(noi),  capRate ? `${fmtPct(capRate)} Cap` : undefined),
    kpiBlock("DSCR",             fmtX(dscr), dscr > 0 && dscr < 1.2 ? "Below 1.20x" : undefined),
    kpiBlock("Occupancy",        fmtPct(occ)),
    kpiBlock("Units / Rooms",    fmtN(units)),
    ...(adr    > 0 ? [kpiBlock("ADR",    fmt$(adr))]    : []),
    ...(revpar > 0 ? [kpiBlock("RevPAR", fmt$(revpar))] : []),
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kpiRow: Content = {
    columns: kpiItems.map(item => ({ ...(item as any), width: "*" })),
    margin: [0, 0, 0, 12],
  } as Content;

  const propInfoRows: TableCell[][] = [
    [{ text: "Asset Type",       style: "propLabel" }, { text: (d.asset_type as string) || "—", style: "propValue" },
     { text: "Year Built",       style: "propLabel" }, { text: yearBuilt ? String(yearBuilt) : "—", style: "propValue" }],
    [{ text: "Property Type",    style: "propLabel" }, { text: (d.property_type as string) || "—", style: "propValue" },
     { text: "Renovation Year",  style: "propLabel" }, { text: renYear ? String(renYear) : "—", style: "propValue" }],
    [{ text: "Brand / Flag",     style: "propLabel" }, { text: (d.brand as string) || "—", style: "propValue" },
     { text: "Floors",           style: "propLabel" }, { text: fmtN(d.floors as number), style: "propValue" }],
    [{ text: "Market",           style: "propLabel" }, { text: (d.market_name as string) || "—", style: "propValue" },
     { text: "Parking Spaces",   style: "propLabel" }, { text: fmtN(d.parking_spaces as number), style: "propValue" }],
    [{ text: "Zoning",           style: "propLabel" }, { text: (d.zoning as string) || "—", style: "propValue" },
     { text: "Construction",     style: "propLabel" }, { text: (d.construction_type as string) || "—", style: "propValue" }],
    [{ text: "Mgmt Company",     style: "propLabel" }, { text: (d.management_company as string) || "—", style: "propValue" },
     { text: "Franchise Expiry", style: "propLabel" }, { text: (d.franchise_expiry as string) || "—", style: "propValue" }],
    [{ text: "Loan Amount",      style: "propLabel" }, { text: fmt$(d.loan_amount as number), style: "propValue" },
     { text: "Loan Type",        style: "propLabel" }, { text: (d.loan_type as string) || "—", style: "propValue" }],
    [{ text: "Interest Rate",    style: "propLabel" }, { text: fmtPct(d.interest_rate as number), style: "propValue" },
     { text: "Loan Maturity",    style: "propLabel" }, { text: (d.loan_maturity as string) || "—", style: "propValue" }],
  ];

  const brokerSection: Content = d.broker
    ? {
        stack: [
          sectionHeader("Broker Contact"),
          {
            table: {
              widths: [100, "*", 100, "*"],
              body: [
                [{ text: "Broker / Firm", style: "propLabel" }, { text: d.broker as string, style: "propValue" },
                 { text: "Deal Lead",     style: "propLabel" }, { text: (d.deal_lead as string) || "—", style: "propValue" }],
                [{ text: "Phone",         style: "propLabel" }, { text: (d.broker_phone as string) || "—", style: "propValue" },
                 { text: "Email",         style: "propLabel" }, { text: (d.broker_email as string) || "—", style: "propValue" }],
              ],
            },
            layout: "lightHorizontalLines",
          } as Content,
        ],
      }
    : { text: "" };

  const summarySection: Content = extMap["summary"]
    ? {
        stack: [
          sectionHeader("Executive Summary"),
          { text: extMap["summary"], fontSize: 8.5, color: BLACK, lineHeight: 1.5 },
        ],
      }
    : { text: "" };

  const locationSection: Content = d.location_insight
    ? {
        stack: [
          sectionHeader("Location & Market Insight"),
          { text: d.location_insight as string, fontSize: 8.5, color: BLACK, lineHeight: 1.5 },
        ],
      }
    : { text: "" };

  // ── PAGE 2: Operating Statement ─────────────────────────────────────────────

  const sortedFin = sortRows(finRows);
  const finTableHeader: TableCell[] = [
    { text: "Line Item",  style: "tableHeader", fillColor: BLUE },
    ...colLabels.map(l => ({ text: l, style: "tableHeader", fillColor: BLUE, alignment: "right" } as TableCell)),
    { text: "Per Unit",   style: "tableHeader", fillColor: BLUE, alignment: "right" },
    { text: "% EGI",      style: "tableHeader", fillColor: BLUE, alignment: "right" },
  ];

  const finTableBody: TableCell[][] = sortedFin.map(row => {
    const highlight = isHighlight(row.sub_category);
    const isTotal = row.sub_category.toLowerCase().includes("total");
    const bg = highlight ? LIGHT : undefined;
    const label = row.sub_category
      .split(" ")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return [
      { text: label, fontSize: 8, bold: highlight || isTotal, fillColor: bg } as TableCell,
      ...colKeys.map(k => ({
        text: row[k] && row[k] !== 0 ? fmt$(row[k] as number) : "—",
        fontSize: 8, bold: highlight, alignment: "right", fillColor: bg,
      } as TableCell)),
      { text: row.per_unit ? fmt$(row.per_unit) : "—",   fontSize: 8, alignment: "right", fillColor: bg } as TableCell,
      { text: row.pct_egi  ? fmtPct(row.pct_egi)  : "—", fontSize: 8, alignment: "right", fillColor: bg } as TableCell,
    ];
  });

  // ── PAGE 3: Unit Mix ──────────────────────────────────────────────────────
  const umRows = (unitMix || []) as Array<{
    unit_type: string; total_units: number; vacant_units: number;
    avg_sqft: number; avg_base_rent: number; avg_total_rent: number;
    market_rent: number; loss_to_lease: number; annual_revenue: number;
    physical_occ: number;
  }>;

  const umHeader: TableCell[] = [
    { text: "Unit Type",   style: "tableHeader", fillColor: BLUE },
    { text: "Total",       style: "tableHeader", fillColor: BLUE, alignment: "center" },
    { text: "Occupied",    style: "tableHeader", fillColor: BLUE, alignment: "center" },
    { text: "Occ %",       style: "tableHeader", fillColor: BLUE, alignment: "center" },
    { text: "Avg SF",      style: "tableHeader", fillColor: BLUE, alignment: "right" },
    { text: "Base Rent",   style: "tableHeader", fillColor: BLUE, alignment: "right" },
    { text: "Mkt Rent",    style: "tableHeader", fillColor: BLUE, alignment: "right" },
    { text: "L-T-L/Unit",  style: "tableHeader", fillColor: BLUE, alignment: "right" },
    { text: "Ann. Revenue",style: "tableHeader", fillColor: BLUE, alignment: "right" },
  ];

  const totUnits   = umRows.reduce((s, r) => s + r.total_units, 0);
  const totVacant  = umRows.reduce((s, r) => s + r.vacant_units, 0);
  const totOcc     = totUnits - totVacant;
  const totAnnRev  = umRows.reduce((s, r) => s + (r.annual_revenue || 0), 0);
  const totLTL     = umRows.reduce((s, r) => s + (r.loss_to_lease || 0) * r.total_units, 0);

  const umBody: TableCell[][] = umRows.map(row => {
    const occupied = row.total_units - row.vacant_units;
    const pctOcc   = row.total_units > 0
      ? ((occupied / row.total_units) * 100)
      : (row.physical_occ || 0);
    return [
      { text: row.unit_type,              fontSize: 8 } as TableCell,
      { text: fmtN(row.total_units),      fontSize: 8, alignment: "center" } as TableCell,
      { text: fmtN(occupied),             fontSize: 8, alignment: "center" } as TableCell,
      { text: fmtPct(pctOcc),             fontSize: 8, alignment: "center" } as TableCell,
      { text: fmtN(row.avg_sqft),         fontSize: 8, alignment: "right"  } as TableCell,
      { text: fmt$(row.avg_base_rent),    fontSize: 8, alignment: "right"  } as TableCell,
      { text: fmt$(row.market_rent),      fontSize: 8, alignment: "right"  } as TableCell,
      { text: fmt$(row.loss_to_lease),    fontSize: 8, alignment: "right"  } as TableCell,
      { text: fmt$(row.annual_revenue),   fontSize: 8, alignment: "right"  } as TableCell,
    ];
  });

  const umFooter: TableCell[] = [
    { text: "TOTAL / WTD AVG", fontSize: 8, bold: true, fillColor: LIGHT } as TableCell,
    { text: fmtN(totUnits),   fontSize: 8, bold: true, alignment: "center", fillColor: LIGHT } as TableCell,
    { text: fmtN(totOcc),     fontSize: 8, bold: true, alignment: "center", fillColor: LIGHT } as TableCell,
    { text: totUnits > 0 ? fmtPct((totOcc / totUnits) * 100) : "—", fontSize: 8, bold: true, alignment: "center", fillColor: LIGHT } as TableCell,
    { text: "—", fontSize: 8, alignment: "right", fillColor: LIGHT } as TableCell,
    { text: "—", fontSize: 8, alignment: "right", fillColor: LIGHT } as TableCell,
    { text: "—", fontSize: 8, alignment: "right", fillColor: LIGHT } as TableCell,
    { text: fmt$(totLTL / Math.max(totUnits, 1)), fontSize: 8, bold: true, alignment: "right", fillColor: LIGHT } as TableCell,
    { text: fmt$(totAnnRev), fontSize: 8, bold: true, alignment: "right", fillColor: LIGHT } as TableCell,
  ];

  // ── PAGE 4: Risks, Questions, Criteria ────────────────────────────────────
  const risksData   = (risks    || []) as Array<{ description: string; severity: string }>;
  const qData       = (questions || []) as Array<{ question: string; category: string }>;
  const critData    = (criteria  || []) as Array<{ criteria: string; requirement: string; actual: string; meets: boolean }>;

  const severityColor = (s: string) =>
    s === "critical" ? RED : s === "high" ? "#EA580C" : s === "medium" ? "#CA8A04" : GREEN;

  const risksBody: TableCell[][] = risksData.map(r => [
    { text: r.severity.toUpperCase(), fontSize: 7, bold: true, color: severityColor(r.severity), noWrap: true } as TableCell,
    { text: r.description, fontSize: 8 } as TableCell,
  ]);

  const qCategories = [...new Set(qData.map(q => q.category))];
  const qContent: Content[] = qCategories.map(cat => ({
    stack: [
      { text: cat, fontSize: 8.5, bold: true, color: BLUE, margin: [0, 6, 0, 2] },
      ...qData.filter(q => q.category === cat).map((q, i) => ({
        text: `${i + 1}. ${q.question}`,
        fontSize: 8, color: BLACK, margin: [8, 1, 0, 1],
      })),
    ],
  } as Content));

  const criteriaBody: TableCell[][] = critData.map(c => [
    { text: c.criteria,    fontSize: 8 } as TableCell,
    { text: c.requirement, fontSize: 8, alignment: "center" } as TableCell,
    { text: c.actual,      fontSize: 8, alignment: "center" } as TableCell,
    {
      text: c.meets ? "✓" : "✗",
      fontSize: 10,
      bold: true,
      color: c.meets ? GREEN : RED,
      alignment: "center",
    } as TableCell,
  ]);

  // ── Document definition ───────────────────────────────────────────────────
  const docDef: TDocumentDefinitions = {
    pageSize: "LETTER",
    pageOrientation: "portrait",
    pageMargins: [40, 60, 40, 50],
    defaultStyle: { font: "Roboto", fontSize: 9 },

    header: (currentPage: number, _pageCount: number): Content => ({
      columns: [
        {
          stack: [
            { text: "CONFIDENTIAL  ·  ANTIGRAVITY CRE", fontSize: 6, color: "#8899AA", bold: false, characterSpacing: 1 },
            { text: dealName, fontSize: 8.5, color: WHITE, bold: true, margin: [0, 1, 0, 0] },
          ],
          margin: [40, 8, 0, 0],
        },
        {
          stack: [
            {
              text: currentPage === 1 ? "PROPERTY SUMMARY"
                  : currentPage === 2 ? "OPERATING STATEMENT"
                  : currentPage === 3 ? "UNIT MIX"
                  : currentPage === 4 ? "RISKS & DUE DILIGENCE"
                  : "INVESTMENT SUMMARY",
              fontSize: 7, bold: true, color: GOLD, characterSpacing: 1.2, alignment: "right",
            },
            {
              canvas: [{ type: "rect", x: 0, y: 3, w: 36, h: 2, r: 1, color: ACCENT }],
              margin: [0, 0, 0, 0],
            },
          ],
          alignment: "right",
          margin: [0, 10, 40, 0],
        },
      ],
      fillColor: NAVY,
    }),

    footer: (currentPage: number, pageCount: number): Content => ({
      columns: [
        { text: `© ${new Date().getFullYear()} Antigravity CRE | Confidential`, fontSize: 7, color: GRAY, margin: [40, 0, 0, 0] },
        { text: address, fontSize: 7, color: GRAY, alignment: "center" },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7, color: GRAY, alignment: "right", margin: [0, 0, 40, 0] },
      ],
      margin: [0, 10, 0, 0],
    }),

    styles: {
      tableHeader: {
        fontSize: 8, bold: true, color: WHITE, alignment: "left",
        margin: [4, 4, 4, 4],
      },
      propLabel: {
        fontSize: 8, color: GRAY, bold: false,
      },
      propValue: {
        fontSize: 8.5, color: BLACK, bold: true,
      },
      h1: { fontSize: 26, bold: true, color: WHITE },
      h2: { fontSize: 13, bold: true, color: WHITE },
      sub: { fontSize: 9, color: GOLD },
    },

    content: [

      // ── PAGE 1: Cover / Property Summary ──────────────────────────────────

      // Hero: full-width navy cover block
      {
        table: {
          widths: ["*"],
          body: [[
            {
              stack: [
                // Eyebrow label
                {
                  text: "CONFIDENTIAL OFFERING MEMORANDUM",
                  fontSize: 7, bold: true, color: GOLD,
                  characterSpacing: 2, margin: [0, 0, 0, 10],
                },
                // Accent rule
                {
                  canvas: [{ type: "rect", x: 0, y: 0, w: 36, h: 3, r: 1.5, color: ACCENT }],
                  margin: [0, 0, 0, 10],
                },
                // Property name — large, bold
                {
                  text: dealName.toUpperCase(),
                  fontSize: 24, bold: true, color: WHITE,
                  lineHeight: 1.15, margin: [0, 0, 0, 10],
                },
                // Address
                {
                  text: address || "",
                  fontSize: 10, color: "#A8B8D0", margin: [0, 0, 0, 14],
                },
                // Badges row: Asset Type + Year Built
                {
                  columns: [
                    ...(d.asset_type ? [{
                      text: (d.asset_type as string).toUpperCase(),
                      fontSize: 7.5, bold: true, color: GOLD,
                      characterSpacing: 1.2,
                    }] : []),
                    ...(yearBuilt ? [{
                      text: `BUILT ${yearBuilt}`,
                      fontSize: 7.5, bold: true, color: "#A8B8D0",
                      characterSpacing: 1.2, alignment: "right" as const,
                    }] : []),
                  ],
                  columnGap: 8,
                },
              ],
              fillColor: NAVY,
              margin: [28, 28, 28, 28],
            },
          ]],
        },
        layout: "noBorders",
        margin: [-40, -60, -40, 20],
      } as Content,

      // KPI row
      kpiRow,
      divider(),

      // Property details table
      sectionHeader("Property Details"),
      {
        table: {
          widths: [100, "*", 100, "*"],
          body: propInfoRows,
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 0],
      } as Content,

      brokerSection,
      summarySection,
      locationSection,

      // ── PAGE 2: Operating Statement ────────────────────────────────────────
      { text: "", pageBreak: "before" },

      sectionHeader("Operating Statement"),
      {
        text: "All figures in USD. TTM = Trailing Twelve Months. Per Unit based on total unit/room count.",
        fontSize: 7, color: GRAY, margin: [0, 0, 0, 8],
      },

      finTableBody.length > 0
        ? {
            table: {
              headerRows: 1,
              widths: ["*", ...colKeys.map(() => 52), 52, 44],
              body: [finTableHeader, ...finTableBody],
            },
            layout: {
              hLineWidth: (i: number) => (i === 0 || i === 1) ? 1 : 0.3,
              vLineWidth: () => 0,
              hLineColor: (i: number) => (i === 0 || i === 1) ? BLUE : "#E2E8F0",
              paddingLeft:  () => 4,
              paddingRight: () => 4,
              paddingTop:   () => 3,
              paddingBottom:() => 3,
            },
          } as Content
        : { text: "No financial data available.", fontSize: 9, color: GRAY, margin: [0, 8, 0, 0] } as Content,

      // ── PAGE 3: Unit Mix ───────────────────────────────────────────────────
      { text: "", pageBreak: "before" },

      sectionHeader("Unit Mix & Rent Roll Summary"),

      // Portfolio KPIs
      {
        columns: [
          kpiBlock("Total Units",  fmtN(totUnits)),
          kpiBlock("Occupied",     fmtN(totOcc)),
          kpiBlock("Occupancy",    totUnits > 0 ? fmtPct((totOcc / totUnits) * 100) : "—"),
          kpiBlock("Annual Revenue", fmt$(totAnnRev)),
          kpiBlock("Avg Loss-to-Lease/Unit", fmt$(totLTL / Math.max(totUnits, 1))),
        ],
        margin: [0, 0, 0, 12],
      } as Content,

      divider(),

      umBody.length > 0
        ? {
            table: {
              headerRows: 1,
              widths: ["*", 40, 48, 44, 44, 52, 52, 52, 64],
              body: [umHeader, ...umBody, umFooter],
            },
            layout: {
              hLineWidth: (i: number) => i === 0 || i === 1 ? 1 : 0.3,
              vLineWidth: () => 0,
              hLineColor: (i: number) => (i === 0 || i === 1) ? BLUE : "#E2E8F0",
              paddingLeft:  () => 4,
              paddingRight: () => 4,
              paddingTop:   () => 3,
              paddingBottom:() => 3,
            },
          } as Content
        : { text: "No unit mix data available.", fontSize: 9, color: GRAY, margin: [0, 8, 0, 0] } as Content,

      // ── PAGE 4: Risks, Questions, Criteria ────────────────────────────────
      { text: "", pageBreak: "before" },

      // Risks
      ...(risksBody.length > 0
        ? [
            sectionHeader("Risk Assessment"),
            {
              table: {
                headerRows: 1,
                widths: [48, "*"],
                body: [
                  [
                    { text: "Severity", style: "tableHeader", fillColor: BLUE },
                    { text: "Description", style: "tableHeader", fillColor: BLUE },
                  ],
                  ...risksBody,
                ],
              },
              layout: {
                hLineWidth: (i: number) => i <= 1 ? 1 : 0.3,
                vLineWidth: () => 0,
                hLineColor: () => "#E2E8F0",
                paddingLeft: () => 4, paddingRight: () => 4,
                paddingTop: () => 3, paddingBottom: () => 3,
              },
              margin: [0, 0, 0, 16],
            } as Content,
          ]
        : []),

      // Criteria Scorecard
      ...(criteriaBody.length > 0
        ? [
            sectionHeader("Investment Criteria Scorecard"),
            {
              table: {
                headerRows: 1,
                widths: ["*", 80, 80, 30],
                body: [
                  [
                    { text: "Criteria",    style: "tableHeader", fillColor: BLUE },
                    { text: "Requirement", style: "tableHeader", fillColor: BLUE, alignment: "center" },
                    { text: "Actual",      style: "tableHeader", fillColor: BLUE, alignment: "center" },
                    { text: "Pass",        style: "tableHeader", fillColor: BLUE, alignment: "center" },
                  ],
                  ...criteriaBody,
                ],
              },
              layout: {
                hLineWidth: (i: number) => i <= 1 ? 1 : 0.3,
                vLineWidth: () => 0,
                hLineColor: () => "#E2E8F0",
                paddingLeft: () => 4, paddingRight: () => 4,
                paddingTop: () => 3, paddingBottom: () => 3,
              },
              margin: [0, 0, 0, 16],
            } as Content,
          ]
        : []),

      // Due Diligence Questions
      ...(qContent.length > 0
        ? [
            sectionHeader("Due Diligence Questions"),
            ...qContent,
          ]
        : []),

      // ── PAGE 5: AI Summary ─────────────────────────────────────────────────
      ...(extMap["summary"] || d.location_insight || d.broker_narrative
        ? [
            { text: "", pageBreak: "before" } as Content,
            sectionHeader("Investment Summary & AI Insights"),

            ...(extMap["summary"]
              ? [
                  { text: "Property Overview", fontSize: 9, bold: true, color: BLUE, margin: [0, 4, 0, 4] } as Content,
                  { text: extMap["summary"], fontSize: 8.5, color: BLACK, lineHeight: 1.6, margin: [0, 0, 0, 12] } as Content,
                ]
              : []),

            ...(d.location_insight
              ? [
                  { text: "Location & Market Analysis", fontSize: 9, bold: true, color: BLUE, margin: [0, 4, 0, 4] } as Content,
                  { text: d.location_insight as string, fontSize: 8.5, color: BLACK, lineHeight: 1.6, margin: [0, 0, 0, 12] } as Content,
                ]
              : []),

            ...(d.broker_narrative
              ? [
                  { text: "Broker Narrative", fontSize: 9, bold: true, color: BLUE, margin: [0, 4, 0, 4] } as Content,
                  { text: d.broker_narrative as string, fontSize: 8.5, color: BLACK, lineHeight: 1.6, margin: [0, 0, 0, 12] } as Content,
                ]
              : []),

            divider(),
            {
              text: "This document was generated by Antigravity CRE Pipeline AI. All figures are derived from uploaded offering materials and AI extraction. Verify all data independently before making investment decisions.",
              fontSize: 7, color: GRAY, lineHeight: 1.4, margin: [0, 8, 0, 0],
            } as Content,
          ]
        : []),
    ],
  };

  try {
    const buffer = await getPdfBuffer(docDef);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${dealName.replace(/[^a-z0-9]/gi, "_")}_underwriting.pdf"`);
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
  } catch (err) {
    console.error("[pdf] generation error", err);
    res.status(500).json({ error: "PDF generation failed", detail: String(err) });
  }
}
