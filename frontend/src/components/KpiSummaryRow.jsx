import React from 'react';
import { TrendingUp, TrendingDown, Shield, AlertTriangle, Activity, BarChart2, CheckCircle2 } from 'lucide-react';
import { formatMW, formatMWPrecise, formatSignedMW, formatPct } from '../utils/format';

export default function KpiSummaryRow({ kpis = {} }) {
  const {
    mae_mw = 0,
    rmse_mw = 0,
    wape_pct = 0,
    mape_pct = 0,
    mean_bias_mw = 0,
    p90_shortfall_buffer_mw = 0,
    p95_shortfall_buffer_mw = 0,
    sample_count = 0,
  } = kpis;

  // Bias badge calculation
  const isOverForecast = mean_bias_mw > 0.05;
  const isUnderForecast = mean_bias_mw < -0.05;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Card 1: MAE (MW) + WAPE (%) */}
      <div className="bg-[#1e293b] border border-slate-700/80 rounded-xl p-4 shadow-lg hover:border-slate-600 transition-all flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5 text-slate-300">
            <Activity size={14} className="text-cyan-400" /> Mean Absolute Error
          </span>
          <span className="text-[10px] bg-slate-900 px-2 py-0.5 rounded font-mono text-slate-400">
            MAE & WAPE
          </span>
        </div>

        <div className="my-1.5 flex items-baseline justify-between">
          <div>
            <div className="text-2xl font-mono font-bold text-white tracking-tight">
              {formatMWPrecise(mae_mw)}
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
              <span>Average half-hour absolute error</span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">WAPE</span>
            <span className="text-sm font-mono font-bold text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 px-2 py-0.5 rounded">
              {formatPct(wape_pct)}
            </span>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between text-[11px] text-slate-400">
          <span>MAPE Normalized:</span>
          <span className="font-mono font-medium text-slate-300">{formatPct(mape_pct)}</span>
        </div>
      </div>

      {/* Card 2: RMSE (MW) */}
      <div className="bg-[#1e293b] border border-slate-700/80 rounded-xl p-4 shadow-lg hover:border-slate-600 transition-all flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5 text-slate-300">
            <BarChart2 size={14} className="text-blue-400" /> Root Mean Square Error
          </span>
          <span className="text-[10px] bg-slate-900 px-2 py-0.5 rounded font-mono text-slate-400">
            RMSE
          </span>
        </div>

        <div className="my-1.5">
          <div className="text-2xl font-mono font-bold text-white tracking-tight">
            {formatMWPrecise(rmse_mw)}
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
            <span>Penalizes extreme forecast swings</span>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between text-[11px] text-slate-400">
          <span>Spread (RMSE / MAE):</span>
          <span className="font-mono font-medium text-slate-300">
            {mae_mw > 0 ? (rmse_mw / mae_mw).toFixed(2) : '1.00'}x
          </span>
        </div>
      </div>

      {/* Card 3: Mean Forecast Bias (MW) with Risk Badge */}
      <div className="bg-[#1e293b] border border-slate-700/80 rounded-xl p-4 shadow-lg hover:border-slate-600 transition-all flex flex-col justify-between">
        <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
          <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5 text-slate-300">
            {isOverForecast ? (
              <TrendingUp size={14} className="text-rose-400" />
            ) : isUnderForecast ? (
              <TrendingDown size={14} className="text-emerald-400" />
            ) : (
              <CheckCircle2 size={14} className="text-cyan-400" />
            )}
            Mean Forecast Bias
          </span>
          <span className="text-[10px] bg-slate-900 px-2 py-0.5 rounded font-mono text-slate-400">
            Bias
          </span>
        </div>

        <div className="my-1.5">
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-mono font-bold tracking-tight ${
                isOverForecast
                  ? 'text-rose-400'
                  : isUnderForecast
                  ? 'text-emerald-400'
                  : 'text-slate-200'
              }`}
            >
              {formatSignedMW(mean_bias_mw)}
            </span>
          </div>

          {/* Prominent Risk Badge */}
          <div className="mt-1.5">
            {isOverForecast ? (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-950/70 border border-rose-800 text-rose-300">
                <AlertTriangle size={11} className="text-rose-400" />
                <span>Over-forecast / Shortfall Risk</span>
              </div>
            ) : isUnderForecast ? (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-950/70 border border-emerald-800 text-emerald-300">
                <CheckCircle2 size={11} className="text-emerald-400" />
                <span>Under-forecast / Surplus Wind</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 border border-slate-700 text-slate-300">
                <span>Zero Net Bias</span>
              </div>
            )}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between text-[11px] text-slate-400">
          <span>Desk Risk Implication:</span>
          <span className="text-[10px] text-slate-300 font-medium">
            {isOverForecast ? 'Procure extra thermal reserve' : 'System spill / curtailment'}
          </span>
        </div>
      </div>

      {/* Card 4: Highlighted P90 Thermal Reserve Buffer with P95 subtext */}
      <div className="bg-gradient-to-br from-[#1e293b] to-amber-950/30 border-2 border-amber-500/80 rounded-xl p-4 shadow-xl shadow-amber-950/20 flex flex-col justify-between relative overflow-hidden">
        {/* Accent glow corner */}
        <div className="absolute top-0 right-0 w-16 h-16 bg-amber-400/10 rounded-bl-full pointer-events-none" />

        <div className="flex items-center justify-between text-xs mb-1">
          <span className="font-bold uppercase tracking-wider flex items-center gap-1.5 text-amber-400">
            <Shield size={15} className="text-amber-400" /> P90 Thermal Buffer
          </span>
          <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-mono font-bold">
            90% Hedging Floor
          </span>
        </div>

        <div className="my-1.5">
          <div className="text-2xl font-mono font-extrabold text-white tracking-tight flex items-baseline gap-1">
            <span className="text-amber-400">+{formatMW(p90_shortfall_buffer_mw, false)}</span>
            <span className="text-xs text-slate-400 font-semibold">MW</span>
          </div>
          <div className="text-[11px] text-amber-200/90 font-medium mt-0.5 flex items-center gap-1">
            <span>Thermal reserve needed to mitigate 90% wind drops</span>
          </div>
        </div>

        {/* P95 Subtext */}
        <div className="pt-2 border-t border-amber-500/30 flex items-center justify-between text-[11px]">
          <span className="text-slate-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span>P95 Stress Buffer:</span>
          </span>
          <span className="font-mono font-bold text-rose-300">
            +{formatMW(p95_shortfall_buffer_mw)}
          </span>
        </div>
      </div>
    </div>
  );
}
