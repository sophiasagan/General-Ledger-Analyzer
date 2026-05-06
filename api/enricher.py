from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import anthropic

from api.schemas import EnrichedGLRow, GLRow

logger = logging.getLogger(__name__)

_BATCH_SIZE = 50

_SYSTEM_PROMPT = (
    "You are an expert accountant. For each GL row provided, return a JSON array "
    "where each element contains: row_id, debit_credit (Debit or Credit), year (integer), "
    "asset_type (Asset/Liability/Equity/Revenue/Expense), ai_confidence (0.0-1.0). "
    "Rules: positive amounts are typically Debits for asset/expense accounts and Credits "
    "for liability/equity/revenue. Negative amounts reverse this. Use account names and "
    "codes as context. Return ONLY valid JSON array, no explanation."
)

_UNKNOWN_FIELDS: dict[str, Any] = {
    "debit_credit": "Unknown",
    "asset_type": "Unknown",
    "ai_confidence": 0.0,
}


def enrich_rows(rows: list[GLRow]) -> list[EnrichedGLRow]:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    enriched_index: dict[int, dict[str, Any]] = {}

    for batch_start in range(0, len(rows), _BATCH_SIZE):
        batch = rows[batch_start : batch_start + _BATCH_SIZE]
        ai_results = _enrich_batch(client, batch)
        enriched_index.update(ai_results)

    result: list[EnrichedGLRow] = []
    for row in rows:
        ai_fields = enriched_index.get(row.row_id, {})
        year = ai_fields.get("year") or _year_from_date(row.date)
        result.append(
            EnrichedGLRow(
                **row.model_dump(),
                debit_credit=ai_fields.get("debit_credit", "Unknown"),
                year=year,
                asset_type=ai_fields.get("asset_type", "Unknown"),
                ai_confidence=ai_fields.get("ai_confidence", 0.0),
            )
        )

    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _enrich_batch(client: anthropic.Anthropic, batch: list[GLRow]) -> dict[int, dict[str, Any]]:
    payload = [
        {
            "row_id": row.row_id,
            "date": row.date,
            "description": row.description,
            "account_code": row.account_code,
            "account_name": row.account_name,
            "amount": row.amount,
        }
        for row in batch
    ]

    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": json.dumps(payload)}],
        )
        raw_text = message.content[0].text
    except anthropic.APIError as exc:
        logger.warning("Claude API error on batch starting at row %d: %s", batch[0].row_id, exc)
        return _fallback_for_batch(batch)

    parsed = _parse_response(raw_text, batch)
    return parsed


def _parse_response(raw_text: str, batch: list[GLRow]) -> dict[int, dict[str, Any]]:
    text = _strip_markdown_fences(raw_text)

    try:
        items = json.loads(text)
        if not isinstance(items, list):
            raise ValueError("Expected a JSON array")
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Failed to parse Claude response as JSON: %s — raw: %.200s", exc, raw_text)
        return _fallback_for_batch(batch)

    result: dict[int, dict[str, Any]] = {}
    for item in items:
        try:
            row_id = int(item["row_id"])
            result[row_id] = {
                "debit_credit": _coerce_debit_credit(item.get("debit_credit")),
                "year": _coerce_year(item.get("year")),
                "asset_type": _coerce_asset_type(item.get("asset_type")),
                "ai_confidence": _coerce_confidence(item.get("ai_confidence")),
            }
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning("Skipping malformed item in Claude response: %s — item: %s", exc, item)

    # Any row the model omitted gets fallback values
    for row in batch:
        if row.row_id not in result:
            logger.warning("Claude omitted row_id %d; applying fallback", row.row_id)
            result[row.row_id] = dict(_UNKNOWN_FIELDS)

    return result


def _fallback_for_batch(batch: list[GLRow]) -> dict[int, dict[str, Any]]:
    return {row.row_id: dict(_UNKNOWN_FIELDS) for row in batch}


def _strip_markdown_fences(text: str) -> str:
    # Remove ```json ... ``` or ``` ... ``` wrappers
    stripped = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    stripped = re.sub(r"\s*```$", "", stripped)
    return stripped.strip()


# ---------------------------------------------------------------------------
# Value coercers — each returns the canonical value or its Unknown fallback
# ---------------------------------------------------------------------------

_VALID_DEBIT_CREDIT = {"Debit", "Credit", "Unknown"}
_VALID_ASSET_TYPES = {"Asset", "Liability", "Equity", "Revenue", "Expense", "Unknown"}


def _coerce_debit_credit(value: Any) -> str:
    if isinstance(value, str) and value in _VALID_DEBIT_CREDIT:
        return value
    return "Unknown"


def _coerce_asset_type(value: Any) -> str:
    if isinstance(value, str) and value in _VALID_ASSET_TYPES:
        return value
    return "Unknown"


def _coerce_confidence(value: Any) -> float:
    try:
        f = float(value)
        return max(0.0, min(1.0, f))
    except (TypeError, ValueError):
        return 0.0


def _coerce_year(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _year_from_date(date_str: str) -> int:
    """Best-effort year extraction from a raw date string when Claude omits year."""
    match = re.search(r"\b(19|20)\d{2}\b", date_str)
    return int(match.group()) if match else 0
