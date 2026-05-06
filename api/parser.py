from __future__ import annotations

import io
import re
from typing import Optional

import pandas as pd

from api.schemas import GLRow

_ACCOUNT_CODE_RE = re.compile(r"^\d[\d\-]*\d$|^\d+$")


class ParseError(Exception):
    pass


def parse_gl_file(file_bytes: bytes, filename: str) -> list[GLRow]:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    df = _load_dataframe(file_bytes, ext, filename)
    df = _strip_whitespace(df)

    col_map = _detect_columns(df)

    rows: list[GLRow] = []
    for idx, (_, row) in enumerate(df.iterrows(), start=1):
        raw = {str(k): (None if pd.isna(v) else v) for k, v in row.items()}

        date_val = _get_str(row, col_map.get("date"))
        description = _get_str(row, col_map.get("description")) or ""
        amount = _get_float(row, col_map.get("amount"))
        account_code = _get_account_code(row, col_map.get("account_code"))
        account_name = _get_str(row, col_map.get("account_name"))

        rows.append(
            GLRow(
                row_id=idx,
                date=date_val or "",
                description=description,
                account_code=account_code,
                account_name=account_name,
                amount=amount,
                raw_columns=raw,
            )
        )

    return rows


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _load_dataframe(file_bytes: bytes, ext: str, filename: str) -> pd.DataFrame:
    if ext == "csv":
        return _load_csv(file_bytes)
    if ext in ("xlsx", "xls"):
        return _load_excel(file_bytes, ext)
    raise ParseError(
        f"Unsupported file type '{filename}'. Please upload a .csv, .xlsx, or .xls file."
    )


def _load_csv(file_bytes: bytes) -> pd.DataFrame:
    for encoding in ("utf-8", "latin-1"):
        try:
            df = pd.read_csv(io.BytesIO(file_bytes), encoding=encoding, dtype=str)
            if df.empty or df.columns.size == 0:
                raise ParseError("The CSV file is empty or has no columns.")
            return df
        except UnicodeDecodeError:
            continue
        except pd.errors.EmptyDataError:
            raise ParseError("The CSV file is empty.")
        except pd.errors.ParserError as exc:
            raise ParseError(f"Could not parse CSV: {exc}") from exc
    raise ParseError("Could not decode the CSV file. Ensure it is UTF-8 or Latin-1 encoded.")


def _load_excel(file_bytes: bytes, ext: str) -> pd.DataFrame:
    engine = "openpyxl" if ext == "xlsx" else "xlrd"
    try:
        df = pd.read_excel(io.BytesIO(file_bytes), engine=engine, dtype=str)
        if df.empty or df.columns.size == 0:
            raise ParseError("The spreadsheet is empty or has no columns.")
        return df
    except Exception as exc:
        raise ParseError(f"Could not read spreadsheet: {exc}") from exc


def _strip_whitespace(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [str(c).strip() for c in df.columns]
    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].str.strip()
    return df


# ---------------------------------------------------------------------------
# Column detection
# ---------------------------------------------------------------------------

def _detect_columns(df: pd.DataFrame) -> dict[str, str]:
    col_map: dict[str, str] = {}
    remaining = list(df.columns)

    date_col = _find_date_column(df, remaining)
    if date_col:
        col_map["date"] = date_col
        remaining.remove(date_col)

    amount_col = _find_amount_column(df, remaining)
    if amount_col:
        col_map["amount"] = amount_col
        remaining.remove(amount_col)

    account_code_col = _find_account_code_column(df, remaining)
    if account_code_col:
        col_map["account_code"] = account_code_col
        remaining.remove(account_code_col)

    account_name_col = _find_account_name_column(df, remaining, exclude=col_map.get("account_code"))
    if account_name_col:
        col_map["account_name"] = account_name_col
        remaining.remove(account_name_col)

    description_col = _find_description_column(df, remaining)
    if description_col:
        col_map["description"] = description_col

    return col_map


def _find_date_column(df: pd.DataFrame, candidates: list[str]) -> Optional[str]:
    # Prefer columns whose name hints at a date, evaluated first
    name_hints = [c for c in candidates if re.search(r"\bdate\b|\bdt\b|\bperiod\b", c, re.I)]
    ordered = name_hints + [c for c in candidates if c not in name_hints]

    for col in ordered:
        series = df[col].dropna()
        if series.empty:
            continue
        parsed = pd.to_datetime(series, errors="coerce", infer_datetime_format=True)
        hit_rate = parsed.notna().sum() / len(series)
        if hit_rate > 0.8:
            return col
    return None


def _find_amount_column(df: pd.DataFrame, candidates: list[str]) -> Optional[str]:
    name_hints = [
        c for c in candidates
        if re.search(r"\bamount\b|\bamt\b|\bdebit\b|\bcredit\b|\bvalue\b|\bbalance\b", c, re.I)
    ]
    ordered = name_hints + [c for c in candidates if c not in name_hints]

    for col in ordered:
        series = df[col].dropna()
        if series.empty:
            continue
        # Strip common currency symbols and thousands separators before coercing
        cleaned = series.str.replace(r"[$,£€¥\s]", "", regex=True)
        numeric = pd.to_numeric(cleaned, errors="coerce")
        hit_rate = numeric.notna().sum() / len(series)
        if hit_rate > 0.8:
            return col
    return None


def _find_account_code_column(df: pd.DataFrame, candidates: list[str]) -> Optional[str]:
    name_hints = [
        c for c in candidates
        if re.search(r"\baccount.?code\b|\bacc.?code\b|\bcode\b|\baccount.?no\b|\bacct\b", c, re.I)
    ]
    ordered = name_hints + [c for c in candidates if c not in name_hints]

    for col in ordered:
        series = df[col].dropna().astype(str)
        if series.empty:
            continue
        match_rate = series.apply(lambda v: bool(_ACCOUNT_CODE_RE.match(v.strip()))).sum() / len(series)
        avg_len = series.str.len().mean()
        # Account codes tend to be short (2–10 chars) and match the pattern
        if match_rate > 0.7 and avg_len <= 15:
            return col
    return None


def _find_account_name_column(
    df: pd.DataFrame, candidates: list[str], exclude: Optional[str]
) -> Optional[str]:
    name_hints = [
        c for c in candidates
        if re.search(r"\baccount.?name\b|\bacc.?name\b|\baccount\b", c, re.I) and c != exclude
    ]
    if name_hints:
        return name_hints[0]
    return None


def _find_description_column(df: pd.DataFrame, candidates: list[str]) -> Optional[str]:
    # Pick the text column with the highest average string length
    best_col: Optional[str] = None
    best_avg = -1.0

    for col in candidates:
        series = df[col].dropna().astype(str)
        if series.empty:
            continue
        avg_len = series.str.len().mean()
        if avg_len > best_avg:
            best_avg = avg_len
            best_col = col

    return best_col


# ---------------------------------------------------------------------------
# Value extractors
# ---------------------------------------------------------------------------

def _get_str(row: pd.Series, col: Optional[str]) -> Optional[str]:
    if col is None or col not in row.index:
        return None
    val = row[col]
    if pd.isna(val):
        return None
    return str(val).strip() or None


def _get_float(row: pd.Series, col: Optional[str]) -> float:
    if col is None or col not in row.index:
        return 0.0
    val = row[col]
    if pd.isna(val):
        return 0.0
    cleaned = re.sub(r"[$,£€¥\s]", "", str(val))
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _get_account_code(row: pd.Series, col: Optional[str]) -> Optional[str]:
    val = _get_str(row, col)
    return val if val else None
