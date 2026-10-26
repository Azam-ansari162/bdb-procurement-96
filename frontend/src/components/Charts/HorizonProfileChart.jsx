import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { Clock, TrendingUp, Info } from 'lucide-react';
import { formatMWPrecise } from '../../utils/format';

/**
 * Custom Tooltip for Horizon Profile
 */
function CustomHorizonTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload || {};

  return (
    <div className="bg-slate-900/95 border border-slate-700 rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs min-w-[220px]">
      <div className="border-b border-slate-800 pb-1.5 mb-1.5 flex items-center justify-between">
        <span className="font-bold text-slate-100 flex items-center gap-1">
          <Clock size={12} className="text-cyan-400" />
          {data.bucket}
        </span>
        <span className="text-[10px] text-slate-500 font-mono">Lead Bucket</span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-cyan-300">
            <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500" />
            <span>MAE:</span>
          </span>
          <span className="font-mono font-bold text-cyan-400">{formatMWPrecise(data.mae_mw)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-amber-300">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
            <span>RMSE:</span>
          </span>
          <span className="font-mono font-bold text-amber-400">{formatMWPrecise(data.rmse_mw)}</span>
        </div>
      </div>

      <div className="mt-2 pt-1.5 border-t border-slate-800 text-[10px] text-slate-400 flex items-center gap-1">
        <Info size={11} className="text-slate-500" />
        <span>Spread: {data.mae_mw ? (data.rmse_mw / data.mae_mw).toFixed(2) : 1}x RMSE volatility ratio</span>
      </div>
    </div>
  );
}

export default function HorizonProfileChart({ horizonProfile = [] }) {
  if (!horizonProfile || horizonProfile.length === 0) {
    return (
      <div className="h-[350px] flex items-center justify-center bg-[#1e293b] border border-slate-700/80 rounded-xl text-slate-500">
        No horizon degradation data available.
      </div>
    );
  }

  return (
    <div className="bg-[#1e293b] border border-slate-700/80 rounded-xl p-5 shadow-xl flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
            <TrendingUp size={16} className="text-cyan-400" />
            Horizon Degradation Profile
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            MAE & RMSE error escalation across forecast lead horizon buckets (0h to 48h)
          </p>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
          Lead Window
        </span>
      </div>

      {/* BarChart */}
      <div className="w-full h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={horizonProfile}
            margin={{ top: 10, right: 15, left: 5, bottom: 25 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} />

            <XAxis
              dataKey="bucket"
              stroke="#64748b"
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              interval={0}
              angle={-15}
              textAnchor="end"
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

            <Tooltip content={<CustomHorizonTooltip />} />

            <Legend
              verticalAlign="top"
              align="right"
              wrapperStyle={{ paddingBottom: '10px', fontSize: '11px' }}
            />

            {/* MAE (Cyan) */}
            <Bar
              dataKey="mae_mw"
              name="Mean Absolute Error (MAE MW)"
              fill="#06b6d4"
              radius={[4, 4, 0, 0]}
            />

            {/* RMSE (Amber) */}
            <Bar
              dataKey="rmse_mw"
              name="Root Mean Square Error (RMSE MW)"
              fill="#f59e0b"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
