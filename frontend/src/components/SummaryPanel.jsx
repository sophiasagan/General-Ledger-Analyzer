import React, { useMemo } from "react";

const ASSET_COLORS = {
  Asset:     "bg-blue-500",
  Liability: "bg-purple-500",
  Equity:    "bg-indigo-500",
  Revenue:   "bg-green-500",
  Expense:   "bg-orange-500",
  Unknown:   "bg-gray-400",
};

function fmt(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

export default function SummaryPanel({ summary }) {
  const {
    total_debit_amount = 0,
    total_credit_amount = 0,
    net_balance = 0,
    flagged_for_review = 0,
    asset_type_breakdown = {},
  } = summary;

  const totalAssets = useMemo(
    () => Object.values(asset_type_breakdown).reduce((a, b) => a + b, 0),
    [asset_type_breakdown]
  );

  const netColor =
    net_balance > 0
      ? "text-blue-600"
      : net_balance < 0
      ? "text-red-600"
      : "text-gray-700";

  return (
    <div className="bg-white border-b border-gray-200 px-6 py-4 space-y-4">
      {/* KPI row */}
      <div className="flex flex-wrap gap-4">
        <StatCard
          label="Total Debits"
          value={fmt(total_debit_amount)}
          accent="border-blue-500 text-blue-700"
        />
        <StatCard
          label="Total Credits"
          value={fmt(total_credit_amount)}
          accent="border-green-500 text-green-700"
        />
        <StatCard
          label="Net Balance"
          value={fmt(net_balance)}
          accent={`border-gray-300 ${netColor}`}
        />
        {flagged_for_review > 0 && (
          <StatCard
            label="Flagged for Review"
            value={flagged_for_review}
            accent="border-yellow-400 text-yellow-700"
          />
        )}
      </div>

      {/* Asset type breakdown */}
      {totalAssets > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Asset Type Breakdown
          </p>
          <div className="space-y-1.5">
            {Object.entries(asset_type_breakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => {
                const pct = totalAssets > 0 ? (count / totalAssets) * 100 : 0;
                return (
                  <div key={type} className="flex items-center gap-3">
                    <span className="w-20 text-xs text-gray-600 text-right shrink-0">
                      {type}
                    </span>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${ASSET_COLORS[type] ?? "bg-gray-400"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-10 text-xs text-gray-500">{count}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className={`border-l-4 pl-3 py-1 ${accent}`}>
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
