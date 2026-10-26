import React, { useState, useEffect } from 'react';
import { Activity, ShieldCheck, AlertTriangle, Zap, Clock } from 'lucide-react';

export default function Header({ isLiveApi, loading, error, sampleCount }) {
  const [utcTime, setUtcTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setUtcTime(
        now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="border-b border-slate-800 bg-[#0f172a]/95 backdrop-blur sticky top-0 z-40 px-6 py-3.5 shadow-md">
      <div className="max-w-[1700px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Desk Title & Subtitle */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-tr from-cyan-600 to-blue-600 rounded-lg shadow-lg shadow-cyan-500/20 text-white">
            <Zap size={22} className="stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-100 tracking-tight">
                UK Wholesale Energy Trading Desk
              </h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-900/40 text-blue-400 border border-blue-700/50 uppercase tracking-wider">
                Day-Ahead Wind
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2">
              <span>National Grid ESO / Elexon BMRS (FUELHH · WINDFOR)</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-400">January 2026 Delivery Window</span>
            </p>
          </div>
        </div>

        {/* Status Indicators & Live UTC Clock */}
        <div className="flex items-center gap-4 text-xs">
          {/* Market / Clock */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300">
            <Clock size={14} className="text-cyan-400" />
            <span className="font-mono">{utcTime || 'UTC Loading...'}</span>
          </div>

          {/* Data Connection Badge */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition-all ${
              isLiveApi
                ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300'
                : 'bg-amber-950/40 border-amber-700/50 text-amber-300'
            }`}
            title={
              isLiveApi
                ? 'Connected to FastAPI Backend (Elexon BMRS live stream)'
                : 'Client Simulation Active (FastAPI server offline or unreached)'
            }
          >
            {isLiveApi ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>BMRS API Live</span>
              </>
            ) : (
              <>
                <Activity size={13} className="text-amber-400 animate-pulse" />
                <span>Simulation Model</span>
              </>
            )}
          </div>

          {/* Sample count badge */}
          {sampleCount > 0 && (
            <div className="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700/70 text-slate-400">
              <span className="text-slate-200 font-semibold">{sampleCount}</span>
              <span>Settlement Periods</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
