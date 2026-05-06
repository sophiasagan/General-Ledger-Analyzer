from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class GLRow(BaseModel):
    row_id: int
    date: str
    description: str
    account_code: Optional[str] = None
    account_name: Optional[str] = None
    amount: float
    raw_columns: dict[str, Any]


class EnrichedGLRow(GLRow):
    debit_credit: Literal["Debit", "Credit", "Unknown"]
    year: int
    asset_type: Literal["Asset", "Liability", "Equity", "Revenue", "Expense", "Unknown"]
    ai_confidence: float = Field(ge=0.0, le=1.0)
    manually_edited: bool = False


class UploadResponse(BaseModel):
    file_id: str
    row_count: int
    detected_columns: list[str]
    sample_rows: list[GLRow]


class SummaryStats(BaseModel):
    total_rows: int
    total_debit_amount: float
    total_credit_amount: float
    net_balance: float
    flagged_for_review: int          # ai_confidence < 0.7
    asset_type_breakdown: dict[str, int]
    year_breakdown: dict[int, int]


class AnalyzeResponse(BaseModel):
    file_id: str
    enriched_rows: list[EnrichedGLRow]
    summary: SummaryStats


class ExportRequest(BaseModel):
    file_id: str
    format: Literal["json", "csv"]
    include_raw: bool


class RowPatchRequest(BaseModel):
    debit_credit: Literal["Debit", "Credit", "Unknown"]
    year: int
    asset_type: Literal["Asset", "Liability", "Equity", "Revenue", "Expense", "Unknown"]
