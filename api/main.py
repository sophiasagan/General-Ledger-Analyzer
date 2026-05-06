from __future__ import annotations

import csv
import io
import logging
import uuid
from collections import defaultdict
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from api.enricher import enrich_rows
from api.parser import ParseError, parse_gl_file
from api.schemas import (
    AnalyzeResponse,
    EnrichedGLRow,
    GLRow,
    RowPatchRequest,
    SummaryStats,
    UploadResponse,
)

logger = logging.getLogger(__name__)

_MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB

# file_id → list[GLRow] (insertion order preserved for sample_rows)
_raw_store: dict[str, list[GLRow]] = {}

# file_id → {row_id → EnrichedGLRow} (O(1) patch lookups)
_enriched_store: dict[str, dict[int, EnrichedGLRow]] = {}

app = FastAPI(title="GL Analyzer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": "claude-sonnet-4-6"}


@app.post("/upload", response_model=UploadResponse)
async def upload(file: UploadFile = File(...)) -> UploadResponse:
    _validate_filename(file.filename)

    raw_bytes = await file.read()
    if len(raw_bytes) > _MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 20 MB limit.")

    try:
        rows = parse_gl_file(raw_bytes, file.filename)
    except ParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not rows:
        raise HTTPException(status_code=422, detail="The file contained no data rows.")

    file_id = str(uuid.uuid4())
    _raw_store[file_id] = rows

    detected_columns = list(rows[0].raw_columns.keys()) if rows else []
    logger.info(
        "upload file_id=%s rows=%d columns=%s",
        file_id,
        len(rows),
        detected_columns,
    )

    return UploadResponse(
        file_id=file_id,
        row_count=len(rows),
        detected_columns=detected_columns,
        sample_rows=rows[:5],
    )


@app.post("/analyze/{file_id}", response_model=AnalyzeResponse)
def analyze(file_id: str) -> AnalyzeResponse:
    rows = _get_raw_or_404(file_id)

    enriched_list = enrich_rows(rows)

    by_row_id: dict[int, EnrichedGLRow] = {r.row_id: r for r in enriched_list}
    _enriched_store[file_id] = by_row_id

    summary = _build_summary(enriched_list)
    logger.info(
        "analyze file_id=%s rows=%d flagged=%d",
        file_id,
        summary.total_rows,
        summary.flagged_for_review,
    )

    return AnalyzeResponse(
        file_id=file_id,
        enriched_rows=enriched_list,
        summary=summary,
    )


@app.patch("/row/{file_id}/{row_id}", response_model=EnrichedGLRow)
def patch_row(file_id: str, row_id: int, body: RowPatchRequest) -> EnrichedGLRow:
    enriched_map = _get_enriched_or_404(file_id)

    if row_id not in enriched_map:
        raise HTTPException(status_code=404, detail=f"row_id {row_id} not found in file {file_id}.")

    existing = enriched_map[row_id]
    updated = existing.model_copy(
        update={
            "debit_credit": body.debit_credit,
            "year": body.year,
            "asset_type": body.asset_type,
            "manually_edited": True,
        }
    )
    enriched_map[row_id] = updated

    logger.info(
        "patch file_id=%s row_id=%d debit_credit=%s asset_type=%s manually_edited=True",
        file_id,
        row_id,
        body.debit_credit,
        body.asset_type,
    )
    return updated


@app.get("/export/{file_id}")
def export(
    file_id: str,
    format: Literal["json", "csv"] = Query(default="json"),
    include_raw: bool = Query(default=False),
) -> StreamingResponse:
    enriched_map = _get_enriched_or_404(file_id)
    rows = [enriched_map[k] for k in sorted(enriched_map)]

    if format == "json":
        return _export_json(file_id, rows, include_raw)
    return _export_csv(file_id, rows, include_raw)


# ---------------------------------------------------------------------------
# Export helpers
# ---------------------------------------------------------------------------

def _export_json(file_id: str, rows: list[EnrichedGLRow], include_raw: bool) -> StreamingResponse:
    import json

    serialized = []
    for row in rows:
        data = row.model_dump()
        if not include_raw:
            data.pop("raw_columns", None)
        serialized.append(data)

    payload = json.dumps(serialized, default=str)
    return StreamingResponse(
        iter([payload]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="gl_{file_id}.json"'},
    )


def _export_csv(file_id: str, rows: list[EnrichedGLRow], include_raw: bool) -> StreamingResponse:
    if not rows:
        raise HTTPException(status_code=404, detail="No enriched rows to export.")

    buf = io.StringIO()
    sample = rows[0].model_dump()
    base_fields = [f for f in sample if f != "raw_columns"]
    fieldnames = base_fields + (["raw_columns"] if include_raw else [])

    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        data = row.model_dump()
        if include_raw:
            data["raw_columns"] = str(data["raw_columns"])
        writer.writerow(data)

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="gl_{file_id}.csv"'},
    )


# ---------------------------------------------------------------------------
# Summary computation
# ---------------------------------------------------------------------------

def _build_summary(rows: list[EnrichedGLRow]) -> SummaryStats:
    total_debit = 0.0
    total_credit = 0.0
    flagged = 0
    asset_breakdown: dict[str, int] = defaultdict(int)
    year_breakdown: dict[int, int] = defaultdict(int)

    for row in rows:
        if row.debit_credit == "Debit":
            total_debit += abs(row.amount)
        elif row.debit_credit == "Credit":
            total_credit += abs(row.amount)

        if row.ai_confidence < 0.7:
            flagged += 1

        asset_breakdown[row.asset_type] += 1
        year_breakdown[row.year] += 1

    return SummaryStats(
        total_rows=len(rows),
        total_debit_amount=round(total_debit, 2),
        total_credit_amount=round(total_credit, 2),
        net_balance=round(total_debit - total_credit, 2),
        flagged_for_review=flagged,
        asset_type_breakdown=dict(asset_breakdown),
        year_breakdown=dict(year_breakdown),
    )


# ---------------------------------------------------------------------------
# Store accessors
# ---------------------------------------------------------------------------

def _get_raw_or_404(file_id: str) -> list[GLRow]:
    rows = _raw_store.get(file_id)
    if rows is None:
        raise HTTPException(status_code=404, detail=f"file_id {file_id!r} not found. Upload the file first.")
    return rows


def _get_enriched_or_404(file_id: str) -> dict[int, EnrichedGLRow]:
    enriched = _enriched_store.get(file_id)
    if enriched is None:
        raise HTTPException(
            status_code=404,
            detail=f"file_id {file_id!r} has not been analyzed yet. Call POST /analyze/{file_id} first.",
        )
    return enriched


def _validate_filename(filename: str | None) -> None:
    if not filename:
        raise HTTPException(status_code=422, detail="Uploaded file has no filename.")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("csv", "xlsx", "xls"):
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '.{ext}'. Upload a .csv, .xlsx, or .xls file.",
        )
