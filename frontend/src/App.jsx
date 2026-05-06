import React, { useCallback, useState } from "react";
import { analyzeFile, uploadFile } from "./api.js";
import ExportBar from "./components/ExportBar.jsx";
import GLGrid from "./components/GLGrid.jsx";
import SummaryPanel from "./components/SummaryPanel.jsx";
import UploadZone from "./components/UploadZone.jsx";

const STAGE = { UPLOAD: "upload", ANALYZING: "analyzing", REVIEW: "review" };

export default function App() {
  const [stage, setStage] = useState(STAGE.UPLOAD);
  const [fileId, setFileId] = useState(null);
  const [uploadMeta, setUploadMeta] = useState(null); // { fileName, rowCount }
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  const handleFile = useCallback(async (file) => {
    setError(null);
    setStage(STAGE.ANALYZING);

    try {
      const uploadRes = await uploadFile(file);
      setFileId(uploadRes.file_id);
      setUploadMeta({ fileName: file.name, rowCount: uploadRes.row_count });

      const analyzeRes = await analyzeFile(uploadRes.file_id);
      setRows(analyzeRes.enriched_rows);
      setSummary(analyzeRes.summary);
      setStage(STAGE.REVIEW);
    } catch (err) {
      const msg =
        err.response?.data?.detail ?? err.message ?? "An unexpected error occurred.";
      setError(msg);
      setStage(STAGE.UPLOAD);
    }
  }, []);

  const handleStartOver = useCallback(() => {
    setStage(STAGE.UPLOAD);
    setFileId(null);
    setUploadMeta(null);
    setRows([]);
    setSummary(null);
    setError(null);
  }, []);

  // Recompute summary whenever rows change (reflects manual edits)
  const liveSummary = summary
    ? recomputeSummary(rows, summary)
    : null;

  if (stage === STAGE.UPLOAD) {
    return (
      <>
        <UploadZone onFile={handleFile} />
        {error && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-red-600 px-6 py-3 text-sm text-white shadow-lg">
            {error}
          </div>
        )}
      </>
    );
  }

  if (stage === STAGE.ANALYZING) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-5">
        <Spinner />
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-700">Claude is classifying your GL…</p>
          {uploadMeta && (
            <p className="mt-1 text-sm text-gray-500">
              {uploadMeta.fileName} · {uploadMeta.rowCount.toLocaleString()} rows
            </p>
          )}
        </div>
      </div>
    );
  }

  // STAGE.REVIEW
  return (
    <div className="flex flex-col h-screen bg-gray-100 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-bold text-gray-900">GL Analyzer</h1>
          {uploadMeta && (
            <p className="text-xs text-gray-500">
              {uploadMeta.fileName} · {rows.length.toLocaleString()} rows
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            Classified by Claude
          </span>
        </div>
      </header>

      {/* Summary */}
      {liveSummary && <SummaryPanel summary={liveSummary} />}

      {/* Grid — fills remaining space */}
      <div className="flex-1 overflow-hidden">
        <GLGrid fileId={fileId} rows={rows} onRowsChange={setRows} />
      </div>

      {/* Export bar */}
      <ExportBar fileId={fileId} onStartOver={handleStartOver} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live summary recomputation
// ---------------------------------------------------------------------------

function recomputeSummary(rows, baseSummary) {
  const assetBreakdown = {};
  const yearBreakdown = {};
  let debitTotal = 0;
  let creditTotal = 0;
  let flagged = 0;

  for (const row of rows) {
    if (row.debit_credit === "Debit") debitTotal += Math.abs(row.amount);
    else if (row.debit_credit === "Credit") creditTotal += Math.abs(row.amount);

    if (row.ai_confidence < 0.7 && !row.manually_edited) flagged++;

    assetBreakdown[row.asset_type] = (assetBreakdown[row.asset_type] ?? 0) + 1;
    if (row.year) yearBreakdown[row.year] = (yearBreakdown[row.year] ?? 0) + 1;
  }

  return {
    ...baseSummary,
    total_debit_amount: Math.round(debitTotal * 100) / 100,
    total_credit_amount: Math.round(creditTotal * 100) / 100,
    net_balance: Math.round((debitTotal - creditTotal) * 100) / 100,
    flagged_for_review: flagged,
    asset_type_breakdown: assetBreakdown,
    year_breakdown: yearBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="h-14 w-14 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
  );
}
