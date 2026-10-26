import React from 'react';
import { Calendar, Clock, Sliders, Layers, RefreshCw, ChevronDown } from 'lucide-react';

const GATE_CLOSURE_OPTIONS = [
  { value: '09:20', label: '09:20 UTC (EPEX Day-Ahead)' },
  { value: '11:00', label: '11:00 UTC (N2EX Coupled)' },
  { value: '15:30', label: '15:30 UTC (GB Half-Hour DA)' },
];

export default function TopControlBar({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  mode,
  setMode,
  decisionCutoffTime,
  setDecisionCutoffTime,
  minHorizonHours,
  setMinHorizonHours,
  interpolateHalfHourly,
  setInterpolateHalfHourly,
  loading,
  onRunAnalysis,
}) {
  return (
    <div className="bg-[#1e293b] border border-slate-700/80 rounded-xl p-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Controls Container */}
        <div className="flex flex-wrap items-center gap-4 lg:gap-6 flex-1">
          {/* Delivery Date Range Picker */}
          <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-1.5 shadow-inner">
            <Calendar size={16} className="text-cyan-400" />
            <div className="flex items-center gap-1.5 text-xs">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Start Delivery</span>
                <input
                  type="date"
                  min="2026-01-01"
                  max="2026-02-01"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-transparent text-slate-100 font-medium focus:outline-none focus:ring-0 text-xs cursor-pointer"
                />
              </div>
              <span className="text-slate-600 font-bold px-1">→</span>
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">End Delivery</span>
                <input
                  type="date"
                  min="2026-01-01"
                  max="2026-02-01"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-transparent text-slate-100 font-medium focus:outline-none focus:ring-0 text-xs cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Decision Rule Selector */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1">
              <Sliders size={12} className="text-cyan-400" /> Decision Rule
            </span>
            <div className="inline-flex rounded-lg bg-slate-900/90 p-0.5 border border-slate-700">
              <button
                type="button"
                onClick={() => setMode('gate_closure')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  mode === 'gate_closure'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                D-1 Auction Gate Closure
              </button>
              <button
                type="button"
                onClick={() => setMode('horizon')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  mode === 'horizon'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Fixed Lead Horizon (Hours)
              </button>
            </div>
          </div>

          {/* Conditional Control: Gate Closure dropdown OR Horizon Slider */}
          {mode === 'gate_closure' ? (
            <div className="flex flex-col gap-1 min-w-[240px]">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1">
                <Clock size={12} className="text-amber-400" /> Cutoff Gate
              </span>
              <div className="relative">
                <select
                  value={decisionCutoffTime}
                  onChange={(e) => setDecisionCutoffTime(e.target.value)}
                  className="w-full appearance-none bg-slate-900 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-1.5 pr-8 font-medium focus:outline-none focus:border-cyan-500 cursor-pointer shadow-inner"
                >
                  {GATE_CLOSURE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-slate-900 text-slate-200">
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-2.5 text-slate-400 pointer-events-none" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1 min-w-[230px]">
              <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                <span className="flex items-center gap-1">
                  <Clock size={12} className="text-amber-400" /> Horizon Lead Time
                </span>
                <span className="text-cyan-400 font-mono text-xs font-bold">{minHorizonHours}h</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="48"
                  step="0.5"
                  value={minHorizonHours}
                  onChange={(e) => setMinHorizonHours(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500 h-1.5 bg-slate-900 rounded-lg cursor-pointer"
                />
                <span className="text-[10px] text-slate-400 font-mono">48h</span>
              </div>
            </div>
          )}

          {/* Half-hourly Interpolation Toggle */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1">
              <Layers size={12} className="text-emerald-400" /> Granularity
            </span>
            <button
              type="button"
              onClick={() => setInterpolateHalfHourly(!interpolateHalfHourly)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                interpolateHalfHourly
                  ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title={
                interpolateHalfHourly
                  ? 'Interpolate :30 settlement slots linearly from hourly WINDFOR'
                  : 'Display raw hourly :00 slots only'
              }
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  interpolateHalfHourly ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-slate-500'
                }`}
              />
              <span>{interpolateHalfHourly ? '30-min Settlement Periods' : 'Raw Hourly'}</span>
            </button>
          </div>
        </div>

        {/* Action Button: Run DA Analysis */}
        <div className="flex items-center">
          <button
            type="button"
            disabled={loading}
            onClick={onRunAnalysis}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider px-5 py-2.5 rounded-lg shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>{loading ? 'Crunching BMRS...' : 'Run Analysis'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
