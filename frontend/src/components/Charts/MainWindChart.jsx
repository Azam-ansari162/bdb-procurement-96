import React, { useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceArea,
  Brush,
} from 'recharts';
import { Wind, Clock, AlertTriangle, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { formatMW, formatUTC, formatDateTime, getSettlementPeriod } from '../../utils/format';

/**
 * Custom High-Detail Trading Desk Tooltip
 */
function CustomMainTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0]?.payload || {};
  const {
    startTime,
    publishTime,
    horizon_hours,
    actual_mw,
    forecast_mw,
    firm_wind_p90_mw,
    error_mw,
    shortfall_mw,
  } = data;

  const sp = startTime ? getSettlementPeriod(startTime) : null;
  const isShortfall = error_mw > 0;

  return (
    <div className="bg-slate-900/95 border border-slate-700 rounded-xl p-3.5 shadow-2xl backdrop-blur-md text-xs font-sans min-w-[280px]">
      {/* Tooltip Header: Settlement Period & Delivery Time */}
      <div className="border-b border-slate-800 pb-2 mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 font-mono font-bold text-[11px]">
            SP {sp || '—'}
          </span>
          <span className="font-bold text-slate-100">{formatUTC(startTime)}</span>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">UTC</span>
      </div>

      {/* Forecast Lineage / Lead Horizon */}
      <div className="bg-slate-800/60 rounded-lg p-2 mb-2 space-y-1 text-[11px]">
        <div className="flex justify-between text-slate-400">
          <span className="flex items-center gap-1">
            <Clock size={11} className="text-amber-400" /> Lead Horizon:
          </span>
          <span className="font-mono font-bold text-amber-300">
            {horizon_hours !== null && horizon_hours !== undefined ? `${horizon_hours}h` : '—'}
          </span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>Publish Time:</span>
          <span className="font-mono text-slate-300">
            {publishTime ? formatDateTime(publishTime) : '—'}
          </span>
        </div>
      </div>

      {/* Generation Metric Rows */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
            <span>Actual Wind (FUELHH):</span>
          </span>
          <span className="font-mono font-bold text-sky-400">{formatMW(actual_mw)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span>DA Forecast (WINDFOR):</span>
          </span>
          <span className="font-mono font-bold text-amber-400">{formatMW(forecast_mw)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2.5 h-0.5 bg-emerald-400" />
            <span>P90 Firm Wind Floor:</span>
          </span>
          <span className="font-mono font-bold text-emerald-400">{formatMW(firm_wind_p90_mw)}</span>
        </div>
      </div>

      {/* Error & Shortfall Impact */}
      <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
        <span className="text-slate-400">Forecast Error (FC - Act):</span>
        <span
          className={`font-mono font-bold ${
            isShortfall ? 'text-rose-400' : 'text-emerald-400'
          }`}
        >
          {error_mw > 0 ? `+${Math.round(error_mw).toLocaleString()}` : Math.round(error_mw).toLocaleString()} MW
        </span>
      </div>

      {shortfall_mw > 0 && (
        <div className="mt-1 flex items-center justify-between text-[11px] bg-rose-950/40 border border-rose-900/60 rounded px-2 py-1 text-rose-300">
          <span className="flex items-center gap-1">
            <AlertTriangle size={12} className="text-rose-400" /> Thermal Shortfall:
          </span>
          <span className="font-mono font-bold">+{Math.round(shortfall_mw).toLocaleString()} MW</span>
        </div>
      )}
    </div>
  );
}

export default function MainWindChart({ timeseries = [] }) {
  const [showActual, setShowActual] = useState(true);
  const [showForecast, setShowForecast] = useState(true);
  const [showFirmFloor, setShowFirmFloor] = useState(true);

  if (!timeseries || timeseries.length === 0) {
    return (
      <div className="h-[420px] flex items-center justify-center bg-[#1e293b] border border-slate-700/80 rounded-xl text-slate-500">
        No timeseries data available for selected window.
      </div>
    );
  }

  return (
    <div className="bg-[#1e293b] border border-slate-700/80 rounded-xl p-5 shadow-xl flex flex-col">
      {/* Chart Title and Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
              <Wind size={18} className="text-cyan-400" />
              Day-Ahead Wind Forecast vs Actual Generation & P90 Firm Floor
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-400 border border-slate-700">
              GB Settlement Grid (30-min UTC)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Compares metered outturn (FUELHH) with matched day-ahead gate forecasts (WINDFOR) and conservative P90 floor
          </p>
        </div>

        {/* Visibility Series Toggles */}
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setShowActual(!showActual)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-all ${
              showActual
                ? 'bg-sky-950/60 border-sky-600/80 text-sky-300'
                : 'bg-slate-900 border-slate-800 text-slate-500 line-through'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-sky-400" />
            <span>Actual (FUELHH)</span>
          </button>

          <button
            type="button"
            onClick={() => setShowForecast(!showForecast)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-all ${
              showForecast
                ? 'bg-amber-950/60 border-amber-600/80 text-amber-300'
                : 'bg-slate-900 border-slate-800 text-slate-500 line-through'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span>Forecast (WINDFOR)</span>
          </button>

          <button
            type="button"
            onClick={() => setShowFirmFloor(!showFirmFloor)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-all ${
              showFirmFloor
                ? 'bg-emerald-950/60 border-emerald-600/80 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-500 line-through'
            }`}
          >
            <span className="w-3 h-0.5 bg-emerald-400 border-dashed" />
            <span>P90 Firm Floor</span>
          </button>
        </div>
      </div>

      {/* Main ComposedChart */}
      <div className="w-full h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={timeseries}
            margin={{ top: 10, right: 20, left: 10, bottom: 20 }}
          >
            <defs>
              <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} />

            <XAxis
              dataKey="startTime"
              stroke="#64748b"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickFormatter={(v) => formatUTC(v)}
              minTickGap={45}
            />

            <YAxis
              stroke="#64748b"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k MW`}
              domain={[0, 'auto']}
              label={{
                value: 'Generation (MW)',
                angle: -90,
                position: 'insideLeft',
                fill: '#94a3b8',
                fontSize: 11,
                offset: 0,
              }}
            />

            <Tooltip content={<CustomMainTooltip />} />

            <Legend
              verticalAlign="top"
              align="right"
              wrapperStyle={{ paddingBottom: '10px', fontSize: '12px' }}
            />

            {/* P90 Firm Wind Floor (Dashed Green) */}
            {showFirmFloor && (
              <Line
                type="monotone"
                dataKey="firm_wind_p90_mw"
                name="P90 Firm Wind Floor (MW)"
                stroke="#10b981"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                activeDot={{ r: 5, fill: '#10b981' }}
              />
            )}

            {/* Day-Ahead Forecast (WINDFOR) (Solid Orange/Amber) */}
            {showForecast && (
              <Line
                type="monotone"
                dataKey="forecast_mw"
                name="Day-Ahead Forecast (WINDFOR)"
                stroke="#f59e0b"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: '#f59e0b' }}
              />
            )}

            {/* Actual Wind (FUELHH) (Solid Sky Blue) */}
            {showActual && (
              <Line
                type="monotone"
                dataKey="actual_mw"
                name="Actual Wind (FUELHH)"
                stroke="#38bdf8"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 6, fill: '#38bdf8' }}
              />
            )}

            {/* Range Brush for smooth panning */}
            {timeseries.length > 24 && (
              <Brush
                dataKey="startTime"
                height={24}
                stroke="#3b82f6"
                fill="#0f172a"
                tickFormatter={(v) => formatUTC(v)}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
