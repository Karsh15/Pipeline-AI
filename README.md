# Pipeline-AI — CRE Deal Analysis Platform

An AI-powered deal pipeline for commercial real estate (CRE) acquisitions. Upload offering memorandums, rent rolls, T-12 operating statements, and other deal documents. Seven specialized AI agents extract every key metric — financials, unit mix, deal metadata, risk factors, investment criteria, and a full underwriting model — in under 60 seconds.

---

## What it does

| Stage | What happens |
|---|---|
| **Document ingestion** | Upload PDFs, Word docs, spreadsheets, or scanned images. OCR runs automatically on scanned pages. |
| **7-agent extraction** | Parallel agents powered by NVIDIA NIM (DeepSeek V3.2 + Llama 70B) pull structured data from raw text. |
| **Financial dashboard** | Annual P&L (2021–TTM), monthly T-12 view, per-unit and % EGI metrics, YoY trend badges. |
| **Unit mix table** | Unit type breakdown with avg rent, avg SF, occupancy, and lease-up data. |
| **Underwriting model** | Automated NOI recast, DSCR, cap rate, and buy/pass recommendation with assumptions. |
| **Deal tracker** | Kanban-style pipeline: Lead → Active → LOI → Closed / Passed. |

---

## Tech stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4, Framer Motion |
| **Backend** | Next.js Route Handlers (Edge-compatible), Server-Sent Events for live progress |
| **Database** | Supabase (PostgreSQL + Storage + RLS) |
| **Primary LLM** | NVIDIA NIM — DeepSeek V3.2 for financial reasoning, Llama 3.3-70B for extraction |
| **Fallback LLM** | Groq (llama-3.3-70b-versatile → llama-3.1-8b-instant cascade on 429) |
| **Local LLM** | Ollama (optional, set `USE_LOCAL_LLM=true`) |
| **OCR** | NVIDIA NIM vision model (primary) → Tesseract.js (fallback) |
| **PDF parsing** | `unpdf` (serverless PDF.js — no worker required, Turbopack-safe) |
| **Spreadsheet parsing** | SheetJS (xlsx) |

---

## Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- An [NVIDIA NIM](https://integrate.api.nvidia.com) API key (free credits available)
- A [Groq](https://console.groq.com) API key (free tier works, used as LLM fallback)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Karsh15/Pipeline-AI.git
cd Pipeline-AI
npm install
```

### 2. Configure environment variables

Create `.env.local` in the project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# NVIDIA NIM (primary LLM + OCR)
NVIDIA_API_KEY=nvapi-...

# Groq (LLM fallback)
GROQ_API_KEY=gsk_...

# Optional: Ollama local LLM
# USE_LOCAL_LLM=false
# OLLAMA_URL=http://localhost:11434
# OLLAMA_MODEL=qwen2.5:3b-instruct-q4_K_M

# Optional: override default NVIDIA model
# NVIDIA_MODEL=meta/llama-3.3-70b-instruct
```

### 3. Run Supabase migrations

Open your Supabase project → **SQL Editor** and run the following schema:

```sql
-- Deals table
create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text default 'lead',
  address text,
  units integer,
  year_built integer,
  property_type text,
  guidance_price numeric,
  noi numeric,
  cap_rate numeric,
  dscr numeric,
  extracted_data jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Documents table
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete cascade,
  name text not null,
  storage_path text not null,
  size integer,
  type text,
  created_at timestamptz default now()
);

-- Financials table
create table if not exists financials (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete cascade,
  category text,
  sub_category text,
  y2019 numeric default 0, y2020 numeric default 0,
  y2021 numeric default 0, y2022 numeric default 0,
  y2023 numeric default 0, y2024 numeric default 0,
  y2025 numeric default 0, ttm numeric default 0,
  m1 numeric default 0,  m2 numeric default 0,
  m3 numeric default 0,  m4 numeric default 0,
  m5 numeric default 0,  m6 numeric default 0,
  m7 numeric default 0,  m8 numeric default 0,
  m9 numeric default 0,  m10 numeric default 0,
  m11 numeric default 0, m12 numeric default 0,
  per_unit numeric default 0,
  pct_egi numeric default 0,
  created_at timestamptz default now()
);

-- Unit mix table
create table if not exists unit_mix (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete cascade,
  unit_type text,
  units integer default 0,
  occupancy numeric default 0,
  avg_base_rent numeric default 0,
  avg_sqft numeric default 0,
  avg_total_rent numeric default 0,
  latest_lease_up text,
  avg_utilities numeric default 0,
  created_at timestamptz default now()
);

-- Enable RLS and allow reads/writes
alter table deals      enable row level security;
alter table documents  enable row level security;
alter table financials enable row level security;
alter table unit_mix   enable row level security;

create policy "anon read deals"       on deals      for select using (true);
create policy "anon read documents"   on documents  for select using (true);
create policy "anon read financials"  on financials for select using (true);
create policy "anon read unit_mix"    on unit_mix   for select using (true);
create policy "anon write deals"      on deals      for all    using (true);
create policy "anon write documents"  on documents  for all    using (true);
create policy "anon write financials" on financials for all    using (true);
create policy "anon write unit_mix"   on unit_mix   for all    using (true);
```

Also create a Supabase Storage bucket named **`deal-documents`** (private access).

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How the pipeline works

```
Upload documents
      │
      ▼
/api/run-extraction  (SSE stream — real-time progress shown in browser)
      │
      ├─ OCR / text extraction
      │    unpdf (native text PDFs) → NVIDIA NIM vision OCR (scanned) → Tesseract.js (fallback)
      │
      ├─ Agent 1: metadata      (Llama 3.3-70B)   → deal name, address, units, year built
      ├─ Agent 2: financial     (DeepSeek V3.2)   → P&L rows, annual + monthly columns
      ├─ Agent 3: unit_mix      (Llama 3.3-70B)   → unit types, rents, occupancy
      ├─ Agent 4: summary       (Llama 3.3-70B)   → investment thesis paragraph
      ├─ Agent 5: questions     (Llama 3.1-8B)    → top 5 diligence questions
      ├─ Agent 6: criteria      (Llama 3.3-70B)   → investment criteria scoring
      └─ Agent 7: risks         (DeepSeek V3.2)   → risk factors with severity ratings
            │
            ▼
      /api/run-underwriting  (auto-triggered after extraction)
            │
            └─ Underwriting agent (DeepSeek V3.2) → recast NOI, DSCR, IRR, recommendation
```

### LLM provider cascade

Each agent follows this fallback chain automatically:

```
NVIDIA NIM  ──(504/404/429)──▶  Groq llama-3.3-70b-versatile
                                      │
                                 (429/413)
                                      ▼
                               Groq llama-3.1-8b-instant
                                      │
                                  (failure)
                                      ▼
                               Ollama  (if USE_LOCAL_LLM=true)
```

NVIDIA NIM has a hard 30-second client timeout — if the gateway is slow, it fails fast and Groq takes over instead of blocking the whole pipeline for 60+ seconds.

### Model routing

| Task | Model | Reason |
|---|---|---|
| Financial, risks, underwriting | `deepseek-ai/deepseek-v3.2` | Deep math + multi-step reasoning |
| Metadata, unit mix, summary, criteria | `meta/llama-3.3-70b-instruct` | Strong extraction, fast |
| Questions, distillation | `meta/llama-3.1-8b-instruct` | Simple generation, cheapest |

---

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── run-extraction/route.ts    # 7-agent SSE pipeline
│   │   ├── run-underwriting/route.ts  # underwriting agent
│   │   ├── upload-document/route.ts   # Supabase Storage upload
│   │   └── why/route.ts               # AI explanation for any metric
│   └── page.tsx                       # deal list / kanban
├── components/
│   ├── DealWorkspace.tsx              # main deal view + extraction trigger
│   ├── FinancialDashboard.tsx         # P&L table, annual/monthly toggle
│   ├── UnitMixTable.tsx               # unit type breakdown
│   ├── UnderwritingPanel.tsx          # DSCR, IRR, recommendation
│   └── WhyPanel.tsx                   # AI "why this number?" explainer
└── lib/
    ├── llm.ts                         # unified LLM client (NVIDIA/Groq/Ollama)
    ├── supabase.ts                    # typed Supabase client + DB types
    └── ocr/
        ├── extract.ts                 # 4-tier document text extractor
        └── nvidiaOcr.ts               # NVIDIA NIM vision OCR
```

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side writes) |
| `NVIDIA_API_KEY` | Yes | NVIDIA NIM API key (`nvapi-...`) |
| `GROQ_API_KEY` | Yes | Groq API key (LLM fallback) |
| `USE_LOCAL_LLM` | No | `true` to prefer Ollama over cloud (default: `true`) |
| `OLLAMA_URL` | No | Ollama base URL (default: `http://localhost:11434`) |
| `OLLAMA_MODEL` | No | Ollama model name (default: `qwen2.5:3b-instruct-q4_K_M`) |
| `NVIDIA_MODEL` | No | Override default NVIDIA NIM model |

---

## Production deployment

Designed for Vercel:

```bash
vercel deploy
```

Set all `.env.local` variables as Vercel environment variables. The 30-second NVIDIA NIM client timeout sits safely below Vercel's 60-second function limit, so the cascade to Groq fires before any timeout error.

---

## License

MIT
