# GL Analyzer

> AI-powered general ledger classifier — upload a CSV or XLSX, let Claude label every row, edit inline, export.

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white&labelColor=20232a)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white&labelColor=1a1a2e)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white&labelColor=0f172a)
![FastAPI](https://img.shields.io/badge/FastAPI-0.11x-009688?logo=fastapi&logoColor=white&labelColor=0d1117)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white&labelColor=1a1a2e)
![Claude](https://img.shields.io/badge/Claude-Sonnet_4.6-D97706?logo=anthropic&logoColor=white&labelColor=1c1c1e)
![Railway](https://img.shields.io/badge/API-Railway-0B0D0E?logo=railway&logoColor=white)
![Vercel](https://img.shields.io/badge/Frontend-Vercel-000000?logo=vercel&logoColor=white)

---

## Demo

<!-- Replace the block below with your actual recording once the app is live.
     Recommended: record with Loom or QuickTime → convert to GIF with gifski or ezgif.com
     Drop the file in docs/demo.gif and update the src. -->

<div align="center">
  <img
    src="docs/demo.gif"
    alt="GL Analyzer demo — drag-drop upload, Claude classification spinner, editable grid with debit/credit toggles, export"
    width="780"
    style="border-radius:8px; border:1px solid #e2e8f0;"
  />
  <br/>
  <em>Upload → Classify → Review → Export</em>
</div>

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                 │
│                                                                 │
│  UploadZone  ──drop──►  App.jsx  ──stage──►  GLGrid            │
│  (drag & drop)          (state machine)      (editable table)   │
│                              │                    │             │
│                         SummaryPanel          ExportBar         │
│                         (live KPIs)           (JSON / CSV)      │
└──────────────────────────────┼────────────────────┼────────────┘
                    HTTPS      │           PATCH /row│
                    (Vercel →  │           on edit   │
                     Railway)  ▼                     │
┌─────────────────────────────────────────────────────────────────┐
│                    FastAPI  (Railway)                           │
│                                                                 │
│  POST /upload          POST /analyze/{file_id}                  │
│  └─ parser.py          └─ enricher.py                           │
│     • detect cols         • batch 50 rows                       │
│     • normalize             • build prompt                      │
│     • GLRow list            • call Claude API                   │
│                             • parse JSON response               │
│  GET  /export/{id}          • EnrichedGLRow list                │
│  PATCH /row/{id}/{row}                                          │
└────────────────────────────────┬────────────────────────────────┘
                                 │  HTTPS
                                 ▼
                    ┌────────────────────────┐
                    │   Anthropic Claude API  │
                    │   claude-sonnet-4-6     │
                    │   • debit / credit      │
                    │   • asset type          │
                    │   • confidence score    │
                    └────────────────────────┘
```

### Data flow

| Step | What happens |
|------|-------------|
| **Upload** | Browser POSTs the file → `parser.py` detects column roles with heuristics (date >80% parse rate, longest-avg-string description, `^\d[\d\-]*\d$` account code pattern) → returns `list[GLRow]` keyed by UUID `file_id` |
| **Analyze** | `enricher.py` batches rows in groups of 50, sends structured JSON to Claude, receives `[{row_id, debit_credit, year, asset_type, ai_confidence}]`, merges into `EnrichedGLRow` |
| **Review** | React grid renders rows; `ai_confidence < 0.7` → yellow highlight; any dropdown/field change → optimistic update + `PATCH /row` → `manually_edited = true` |
| **Export** | `GET /export/{file_id}?format=json\|csv` streams the enriched dataset; `include_raw=true` preserves original columns |

---

## Local development

### Prerequisites

- Python 3.11+
- Node 18+
- An [Anthropic API key](https://console.anthropic.com)

### 1 — Clone and configure

```bash
git clone <repo-url>
cd gl-analyzer
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY=sk-ant-...
```

### 2 — Run the API

```bash
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8000
# Docs at http://localhost:8000/docs
```

### 3 — Run the frontend

```bash
cd frontend
npm install
npm run dev
# App at http://localhost:5173 (Vite proxies /upload, /analyze, etc. → :8000)
```

---

## Deployment

### API → Railway

```bash
npm i -g @railway/cli
railway login && railway init
railway up
```

Set these environment variables on the **api** service in the Railway dashboard:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` |
| `MAX_FILE_SIZE_MB` | `20` |
| `MAX_ROWS_PER_FILE` | `10000` |

### Frontend → Vercel

```bash
npm i -g vercel
cd frontend
vercel
```

Set this environment variable on the **frontend** Vercel project:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://<your-railway-api-domain>` |

> **Railway internal networking:** if you keep the frontend on Railway instead of Vercel, set `API_INTERNAL_URL` on the frontend service to `${{api.RAILWAY_PRIVATE_DOMAIN}}` — nginx will proxy API calls over the private network without leaving Railway's infrastructure.

---

## Project structure

```
gl_analyzer/
├── api/
│   ├── main.py          # FastAPI routes: /upload /analyze /row /export /health
│   ├── schemas.py       # Pydantic models: GLRow, EnrichedGLRow, UploadResponse …
│   ├── parser.py        # CSV/XLSX → GLRow list with column-detection heuristics
│   ├── enricher.py      # Claude enrichment in batches of 50, with fallback
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx                   # Upload → Analyzing → Review state machine
│   │   ├── api.js                    # Axios wrapper
│   │   └── components/
│   │       ├── UploadZone.jsx        # Drag-drop, extension validation
│   │       ├── GLGrid.jsx            # Sortable, paginated, inline-editable table
│   │       ├── SummaryPanel.jsx      # KPI cards + inline asset-type bar chart
│   │       └── ExportBar.jsx         # JSON / CSV download, Start Over
│   ├── nginx.conf                    # Production nginx (envsubst template)
│   └── start.sh                      # Resolves API_INTERNAL_URL, starts nginx
├── docs/
│   └── demo.gif                      # ← add your recording here
├── requirements.txt
├── railway.json
├── .env.example
└── README.md
```

## Key conventions

- Claude enrichment: batches of 50 rows; rows Claude omits get `Unknown / 0.0` confidence.
- `ai_confidence < 0.7` → yellow row highlight; `manually_edited = true` → orange "Edited" badge.
- Every inline edit fires `PATCH /row/{file_id}/{row_id}` with an optimistic UI update and rollback on failure.
- Max upload: 20 MB · 10 000 rows · `.csv / .xlsx / .xls` only.
- Financial amounts are never written to server logs in plain text.
# General-Ledger-Analyzer
