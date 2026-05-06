import React, { useCallback, useRef, useState } from "react";

const ACCEPTED = [".csv", ".xlsx", ".xls"];
const ACCEPTED_MIME = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

function hasValidExtension(name) {
  return ACCEPTED.some((ext) => name.toLowerCase().endsWith(ext));
}

export default function UploadZone({ onFile }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handleFile = useCallback(
    (file) => {
      if (!file) return;
      if (!hasValidExtension(file.name)) {
        setError(`"${file.name}" is not supported. Please upload a .csv, .xlsx, or .xls file.`);
        return;
      }
      setError(null);
      onFile(file);
    },
    [onFile]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      handleFile(e.dataTransfer.files[0]);
    },
    [handleFile]
  );

  const onDragOver = (e) => {
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = () => setDragging(false);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">GL Analyzer</h1>
          <p className="mt-2 text-gray-500">
            Upload your general ledger and let Claude classify every row.
          </p>
        </div>

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => inputRef.current?.click()}
          className={[
            "cursor-pointer rounded-2xl border-2 border-dashed px-8 py-16 text-center transition-colors select-none",
            dragging
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/40",
          ].join(" ")}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            onChange={(e) => handleFile(e.target.files[0])}
          />

          {/* Cloud upload icon */}
          <svg
            className={`mx-auto mb-4 h-14 w-14 ${dragging ? "text-blue-500" : "text-gray-400"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16v-8m0 0-3 3m3-3 3 3M6.5 19a4.5 4.5 0 1 1 .9-8.9A5.5 5.5 0 1 1 17.5 19H6.5z"
            />
          </svg>

          <p className="text-lg font-medium text-gray-700">
            {dragging ? "Drop to upload" : "Drag & drop your GL file here"}
          </p>
          <p className="mt-1 text-sm text-gray-500">or click to browse</p>
          <p className="mt-3 text-xs text-gray-400">.csv · .xlsx · .xls · max 20 MB</p>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
