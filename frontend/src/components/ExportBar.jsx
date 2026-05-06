import React from "react";
import { exportUrl } from "../api.js";

export default function ExportBar({ fileId, onStartOver }) {
  function triggerDownload(format) {
    const url = exportUrl(fileId, format, true);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gl_export_${fileId}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between gap-4">
      <div className="flex gap-3">
        <button
          onClick={() => triggerDownload("json")}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          <DownloadIcon />
          Export as JSON
        </button>
        <button
          onClick={() => triggerDownload("csv")}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 transition-colors"
        >
          <DownloadIcon />
          Export as CSV
        </button>
      </div>

      <button
        onClick={onStartOver}
        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition-colors"
      >
        Start Over
      </button>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 4v12m0 0-4-4m4 4 4-4" />
    </svg>
  );
}
