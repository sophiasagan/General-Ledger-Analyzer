import React, { useCallback, useMemo, useState } from "react";
import { patchRow } from "../api.js";

const PAGE_SIZE = 50;

const ASSET_TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense", "Unknown"];
const DEBIT_CREDIT_OPTS = ["Debit", "Credit", "Unknown"];

const COLUMNS = [
  { key: "row_id",        label: "Row #",        sortable: true,  width: "w-14"  },
  { key: "date",          label: "Date",          sortable: true,  width: "w-28"  },
  { key: "description",   label: "Description",   sortable: true,  width: "flex-1" },
  { key: "account_name",  label: "Account",       sortable: true,  width: "w-36"  },
  { key: "amount",        label: "Amount",        sortable: true,  width: "w-28"  },
  { key: "debit_credit",  label: "Debit/Credit",  sortable: true,  width: "w-32"  },
  { key: "year",          label: "Year",          sortable: true,  width: "w-20"  },
  { key: "asset_type",    label: "Asset Type",    sortable: true,  width: "w-32"  },
  { key: "manually_edited", label: "Edited?",     sortable: false, width: "w-16"  },
];

function fmtAmount(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

export default function GLGrid({ fileId, rows, onRowsChange }) {
  const [sortKey, setSortKey] = useState("row_id");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState({}); // row_id → true while PATCH in-flight

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, sortKey, sortAsc]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (key) => {
    if (key === sortKey) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
    setPage(0);
  };

  const handleChange = useCallback(
    async (row, field, value) => {
      const updated = { ...row, [field]: value };
      // Optimistic update
      onRowsChange((prev) => prev.map((r) => (r.row_id === row.row_id ? updated : r)));

      setSaving((s) => ({ ...s, [row.row_id]: true }));
      try {
        const saved = await patchRow(fileId, row.row_id, {
          debit_credit: updated.debit_credit,
          year: Number(updated.year),
          asset_type: updated.asset_type,
        });
        onRowsChange((prev) => prev.map((r) => (r.row_id === row.row_id ? saved : r)));
      } catch {
        // Revert on failure
        onRowsChange((prev) => prev.map((r) => (r.row_id === row.row_id ? row : r)));
      } finally {
        setSaving((s) => { const n = { ...s }; delete n[row.row_id]; return n; });
      }
    },
    [fileId, onRowsChange]
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Scrollable table */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-full text-sm border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-gray-50">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  className={[
                    "whitespace-nowrap border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide select-none",
                    col.sortable ? "cursor-pointer hover:text-blue-600" : "",
                    col.width,
                  ].join(" ")}
                >
                  {col.label}
                  {col.sortable && sortKey === col.key && (
                    <span className="ml-1 text-blue-500">{sortAsc ? "↑" : "↓"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {pageRows.map((row) => {
              const flagged = row.ai_confidence < 0.7 && !row.manually_edited;
              const isSaving = saving[row.row_id];
              return (
                <tr
                  key={row.row_id}
                  className={[
                    "group transition-colors",
                    flagged ? "bg-yellow-50 hover:bg-yellow-100" : "hover:bg-gray-50",
                    isSaving ? "opacity-60" : "",
                  ].join(" ")}
                >
                  {/* Row # */}
                  <td className="border-b border-gray-100 px-3 py-2 text-gray-400">{row.row_id}</td>

                  {/* Date */}
                  <td className="border-b border-gray-100 px-3 py-2 text-gray-600 whitespace-nowrap">
                    {row.date}
                  </td>

                  {/* Description */}
                  <td className="border-b border-gray-100 px-3 py-2 text-gray-800 max-w-xs truncate">
                    <span title={row.description}>{row.description}</span>
                  </td>

                  {/* Account */}
                  <td className="border-b border-gray-100 px-3 py-2 text-gray-600">
                    <span className="block truncate max-w-[144px]" title={row.account_name ?? row.account_code ?? "—"}>
                      {row.account_name ?? row.account_code ?? <span className="text-gray-300">—</span>}
                    </span>
                  </td>

                  {/* Amount */}
                  <td className={[
                    "border-b border-gray-100 px-3 py-2 text-right font-mono tabular-nums",
                    row.debit_credit === "Debit" ? "text-blue-700" : row.debit_credit === "Credit" ? "text-green-700" : "text-gray-700",
                  ].join(" ")}>
                    {fmtAmount(row.amount)}
                  </td>

                  {/* Debit/Credit dropdown */}
                  <td className="border-b border-gray-100 px-3 py-2">
                    <select
                      value={row.debit_credit}
                      disabled={isSaving}
                      onChange={(e) => handleChange(row, "debit_credit", e.target.value)}
                      className={[
                        "rounded border px-2 py-0.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-offset-0",
                        row.debit_credit === "Debit"
                          ? "border-blue-300 bg-blue-50 text-blue-700 focus:ring-blue-400"
                          : row.debit_credit === "Credit"
                          ? "border-green-300 bg-green-50 text-green-700 focus:ring-green-400"
                          : "border-gray-300 bg-gray-50 text-gray-500 focus:ring-gray-400",
                      ].join(" ")}
                    >
                      {DEBIT_CREDIT_OPTS.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </td>

                  {/* Year */}
                  <td className="border-b border-gray-100 px-3 py-2">
                    <input
                      type="number"
                      value={row.year}
                      disabled={isSaving}
                      onChange={(e) => handleChange(row, "year", Number(e.target.value))}
                      className="w-16 rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </td>

                  {/* Asset Type dropdown */}
                  <td className="border-b border-gray-100 px-3 py-2">
                    <select
                      value={row.asset_type}
                      disabled={isSaving}
                      onChange={(e) => handleChange(row, "asset_type", e.target.value)}
                      className="rounded border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      {ASSET_TYPES.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </td>

                  {/* Edited badge */}
                  <td className="border-b border-gray-100 px-3 py-2 text-center">
                    {row.manually_edited && (
                      <span className="inline-block rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                        Edited
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-2 text-sm text-gray-600">
          <span>
            Rows {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border px-3 py-1 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border px-3 py-1 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
