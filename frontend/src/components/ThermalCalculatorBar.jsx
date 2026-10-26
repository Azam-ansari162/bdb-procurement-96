import React from 'react';
import { Flame, Wind, ShieldAlert, ArrowRight, Gauge, AlertCircle, Info } from 'lucide-react';
import { formatMW, formatUTC, getSettlementPeriod } from '../utils/format';

export default function ThermalCalculatorBar({
  timeseries = [],
  nationalDemand,
  setNationalDemand,
  p90ShortfallBuffer = 0,
}) {
  // Find the period with the peak shortfall (max shortfall_mw or max error_mw)
  let peakShortfallRow = null;
  let maxShortfall = -Infinity;

  if (timeseries && timeseries.length > 0) {
    timeseries.forEach((row) => {
      const shortfall = row.shortfall_mw !== undefined && row.shortfall_mw !== null
        ? row.shortfall_mw
        : Math.max(0, (row.error_mw || 0));
      if (shortfall > maxShortfall) {
        maxShortfall = shortfall;
        peakShortfallRow = row;
      }
    });
  }

  // Fallback if no specific peak found
  const targetRow = peakShortfallRow || timeseries[0] || {};
  const expectedWindForecast = targetRow.forecast_mw || 0;
  const p90FirmWind = targetRow.firm_wind_p90_mw !== undefined && targetRow.firm_wind_p90_mw !== null
    ? targetRow.firm_wind_p90_mw
    : Math.max(0, expectedWindForecast - (p90ShortfallBuffer || 0));

  const demand = Number(nationalDemand) || 32000;
  // Recommended Thermal Procurement = Demand - Firm Wind P90 (MW)
  const recommendedThermal = Math.max(0, demand - p90FirmWind);
  const naiveThermal = Math.max(0, demand - expectedWindForecast);
  const safetyBufferApplied = Math.max(0, recommendedThermal - naiveThermal);

  const sp = targetRow.startTime ? getSettlementPeriod(targetRow.startTime) : null;

  return (
    <div className="bg-gradient-to-r from-slate-900 via-[#1e293b] to-slate-900 border border-amber-500/40 rounded-xl p-4 shadow-2xl relative overflow-hidden">
      {/* Decorative background glow */}
      <div className="absolute -right-16 -top-16 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col gap-3">
        {/* Top Header Row of the Calculator */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/60 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-amber-500/20 text-amber-400 rounded-lg border border-amber-500/30">
              <Flame size={18} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
                  Interactive Thermal Procurement Calculator
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/70 text-amber-400 border border-amber-800">
                  Peak Shortfall Sizing
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Determines required firm dispatchable CCGT/Thermal capacity to cover wind drop at 90% confidence floor
              </p>
            </div>
          </div>

          {/* Settlement period indicator */}
          {targetRow.startTime && (
            <div className="flex items-center gap-2 text-xs bg-slate-800/90 border border-slate-700 px-3 py-1 rounded-lg">
              <span className="text-slate-400">Peak Risk Period:</span>
              <span className="text-cyan-400 font-mono font-bold">
                SP {sp || '—'} ({formatUTC(targetRow.startTime)})
              </span>
              <span className="text-rose-400 font-mono font-semibold">
                (Deficit: +{Math.round(maxShortfall > 0 ? maxShortfall : targetRow.shortfall_mw || 0).toLocaleString()} MW)
              </span>
            </div>
          )}
        </div>

        {/* Calculation Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-center">
          {/* 1. Demand Input */}
          <div className="bg-slate-900/90 border border-slate-700/80 rounded-lg p-3">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span className="font-semibold flex items-center gap-1 text-slate-300">
                <Gauge size={13} className="text-blue-400" /> Expected National Demand
              </span>
              <span className="text-[10px] text-slate-500 font-mono">GB System</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="500"
                min="10000"
                max="60000"
                value={nationalDemand}
                onChange={(e) => setNationalDemand(Math.max(0, Number(e.target.value)))}
                className="w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-1 text-lg font-mono font-bold text-white focus:outline-none focus:border-cyan-400"
              />
              <span className="text-xs font-bold text-slate-400">MW</span>
            </div>
            {/* Quick Presets */}
            <div className="flex gap-1.5 mt-2">
              {[28000, 32000, 36000, 42000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setNationalDemand(preset)}
                  className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors ${
                    nationalDemand === preset
                      ? 'bg-blue-600 text-white font-bold'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {preset / 1000}k
                </button>
              ))}
            </div>
          </div>

          {/* 2. Expected Wind Forecast */}
          <div className="bg-slate-900/90 border border-slate-700/80 rounded-lg p-3">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span className="font-semibold flex items-center gap-1 text-amber-300">
                <Wind size={13} className="text-amber-400" /> Expected Wind Forecast
              </span>
              <span className="text-[10px] text-slate-500 font-mono">WINDFOR DA</span>
            </div>
            <div className="text-lg font-mono font-bold text-amber-400">
              {formatMW(expectedWindForecast)}
            </div>
            <div className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
              <span>Unhedged wind assumption</span>
            </div>
          </div>

          {/* 3. P90 Safe Firm Wind */}
          <div className="bg-slate-900/90 border border-emerald-700/50 rounded-lg p-3">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span className="font-semibold flex items-center gap-1 text-emerald-300">
                <ShieldAlert size={13} className="text-emerald-400" /> P90 Safe Firm Wind
              </span>
              <span className="text-[10px] text-emerald-500 font-mono">90% Confidence Floor</span>
            </div>
            <div className="text-lg font-mono font-bold text-emerald-400">
              {formatMW(p90FirmWind)}
            </div>
            <div className="text-[11px] text-emerald-500/90 mt-2 flex items-center gap-1">
              <span>Forecast minus P90 buffer</span>
            </div>
          </div>

          {/* 4. Recommended Thermal Procurement */}
          <div className="bg-gradient-to-br from-amber-950/70 to-slate-900 border-2 border-amber-500/80 rounded-lg p-3 relative shadow-lg shadow-amber-950/30">
            <div className="flex items-center justify-between text-xs text-amber-300 mb-1">
              <span className="font-bold flex items-center gap-1 uppercase tracking-wide">
                <Flame size={14} className="text-amber-400" /> Recommended Thermal
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono">
                Order Size
              </span>
            </div>
            <div className="text-xl font-mono font-extrabold text-white flex items-baseline gap-1">
              <span className="text-amber-400">{formatMW(recommendedThermal, false)}</span>
              <span className="text-xs text-slate-300 font-normal">MW Thermal</span>
            </div>
            <div className="text-[11px] text-amber-200/80 mt-1 flex items-center justify-between">
              <span>Reserve Cushion:</span>
              <span className="font-mono font-bold text-amber-300">
                +{formatMW(safetyBufferApplied)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
