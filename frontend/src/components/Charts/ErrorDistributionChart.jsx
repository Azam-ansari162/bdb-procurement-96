import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
  Cell,
  Legend,
} from 'recharts';
import { AlertCircle, BarChart2, TrendingUp, Info } from 'lucide-react';
import { formatMW, formatUTC, formatDateTime } from '../../utils/format';

/**
 * Custom Tooltip for Forecast Error
 */
function CustomErrorTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload || {};
  const errorVal = data.error_mw ?? data.binCenter ?? 0;
  const isDeficit = errorVal > 0;

  return (
    <div className="bg-slate-900/95 border border-slate-700 rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs min-w-[240px]">
      <div className="border-b border-slate-800 pb-1.5 mb-1.5 flex justify-between items-center">
        <span className="font-bold text-slate-100">
          {data.startTime ? formatUTC(data.startTime) : `Bin: ${data.binLabel || formatMW(errorVal)}`}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
            isDeficit
              ? 'bg-rose-950/70 border border-rose-800 text-rose-300'
              : 'bg-emerald-950/70 border border-emerald-800 text-emerald-300'
          }`}
        >
          {isDeficit ? 'Deficit / Thermal Needed' : 'Surplus / Excess Wind'}
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="text-slate-400">Forecast Error (FC - Act):</span>
          <span className={`font-mono font-bold ${isDeficit ? 'text-rose-400' : 'text-emerald-400'}`}>
            {errorVal > 0 ? `+${Math.round(errorVal).toLocaleString()}` : Math.round(errorVal).toLocaleString()} MW
          </span>
        </div>

        {data.count !== undefined && (
          <div className="flex justify-between text-slate-400">
            <span>Period Count:</span>
            <span className="font-mono font-bold text-slate-200">{data.count}</span>
          </div>
        )}

        {data.actual_mw !== undefined && (
          <div className="flex justify-between text-slate-400">
            <span>Actual Outturn:</span>
            <span className="font-mono text-slate-300">{formatMW(data.actual_mw)}</span>
          </div>
        )}

        {data.forecast_mw !== undefined && (
          <div className="flex justify-between text-slate-400">
            <span>DA Forecast:</span>
            <span className="font-mono text-slate-300">{formatMW(data.forecast_mw)}</span>
          </div>
        )}
      </div>

      {isDeficit && (
        <div className="mt-2 pt-1.5 border-t border-slate-800 text-[10px] text-rose-300/90 flex items-center gap-1">
          <AlertCircle size={11} className="text-rose-400" />
          <span>Wind missed forecast — thermal dispatch required.</span>
        </div>
      )}
    </div>
  );
}

export default function ErrorDistributionChart({ timeseries = [] }) {
  const [viewMode, setViewMode] = useState('timeseries'); // 'timeseries' or 'histogram'

  // Precompute 200 MW binned histogram (SPEC.md Section 9.3.5)
  const histogramData = useMemo(() => {
    if (!timeseries || timeseries.length === 0) return [];

    const errors = timeseries
      .map((d) => d.error_mw)
      .filter((e) => e !== null && e !== undefined && !isNaN(e));
    if (errors.length === 0) return [];

    const binWidth = 200;
    const minErr = Math.floor(Math.min(...errors) / binWidth) * binWidth;
    const maxErr = Math.ceil(Math.max(...errors) / binWidth) * binWidth;

    const bins = {};
    for (let b = minErr; b <= maxErr; b += binWidth) {
      bins[b] = 0;
    }

    errors.forEach((e) => {
      const b = Math.floor(e / binWidth) * binWidth;
      bins[b] = (bins[b] || 0) + 1;
    });

    return Object.entries(bins).map(([b, count]) => {
      const binVal = Number(b);
      return {
        binCenter: binVal,
        binLabel: `${binVal >= 0 ? '+' : ''}${binVal} MW`,
        count,
        isPositive: binVal >= 0,
      };
    });
  }, [timeseries]);

  if (!timeseries || timeseries.length === 0) {
    return (
      <div className="h-[350px] flex items-center justify-center bg-[#1e293b] border border-slate-700/80 rounded-xl text-slate-500">
        No error data available.
      </div>
    );
  }

  return (
    <div className="bg-[#1e293b] border border-slate-700/80 rounded-xl p-5 shadow-xl flex flex-col h-full">
      {/* Header & Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
            <AlertCircle size={16} className="text-rose-400" />
            Forecast Error & Shortfall Risk
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Positive error (Forecast &gt; Actual) signals wind deficit requiring thermal procurement
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-700 text-xs">
          <button
            type="button"
            onClick={() => setViewMode('timeseries')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
              viewMode === 'timeseries'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Chronological (MW)
          </button>
          <button
            type="button"
            onClick={() => setViewMode('histogram')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
              viewMode === 'histogram'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            200MW Histogram
          </button>
        </div>
      </div>

      {/* Legend / Risk Callout */}
      <div className="flex items-center gap-4 text-[11px] mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 shadow-[0_0_6px_#f43f5e]" />
          <span className="text-rose-300 font-medium">Deficit / Extra Thermal Needed (+MW)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-teal-500 shadow-[0_0_6px_#14b8a6]" />
          <span className="text-teal-300 font-medium">Surplus Wind (-MW)</span>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="w-full h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          {viewMode === 'timeseries' ? (
            <BarChart
              data={timeseries}
              margin={{ top: 10, right: 15, left: 5, bottom: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} />

              <XAxis
                dataKey="startTime"
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                tickFormatter={(v) => formatUTC(v)}
                minTickGap={40}
              />

              <YAxis
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
                label={{
                  value: 'Error (MW)',
                  angle: -90,
                  position: 'insideLeft',
                  fill: '#94a3b8',
                  fontSize: 10,
                }}
              />

              <Tooltip content={<CustomErrorTooltip />} />

              {/* Reference line at 0 MW */}
              <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1.5} />

              <Bar dataKey="error_mw" name="Forecast Error">
                {timeseries.map((entry, index) => {
                  const isPositive = (entry.error_mw || 0) > 0;
                  return (
                    <Cell
                      key={`cell-${index}`}
                      fill={isPositive ? '#f43f5e' : '#14b8a6'}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          ) : (
            <BarChart
              data={histogramData}
              margin={{ top: 10, right: 15, left: 5, bottom: 25 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} />

              <XAxis
                dataKey="binLabel"
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                interval={Math.ceil(histogramData.length / 8)}
              />

              <YAxis
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                label={{
                  value: 'Periods Count',
                  angle: -90,
                  position: 'insideLeft',
                  fill: '#94a3b8',
                  fontSize: 10,
                }}
              />

              <Tooltip content={<CustomErrorTooltip />} />

              <Bar dataKey="count" name="Frequency">
                {histogramData.map((entry, index) => (
                  <Cell
                    key={`hist-cell-${index}`}
                    fill={entry.isPositive ? '#f43f5e' : '#14b8a6'}
                  />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
