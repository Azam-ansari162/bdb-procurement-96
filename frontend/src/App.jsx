import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import TopControlBar from './components/TopControlBar';
import ThermalCalculatorBar from './components/ThermalCalculatorBar';
import KpiSummaryRow from './components/KpiSummaryRow';
import MainWindChart from './components/Charts/MainWindChart';
import ErrorDistributionChart from './components/Charts/ErrorDistributionChart';
import HorizonProfileChart from './components/Charts/HorizonProfileChart';
import SettlementDataTable from './components/SettlementDataTable';
import { fetchDayAheadAnalysis } from './services/api';
import { AlertCircle, RefreshCw, BarChart3, Database } from 'lucide-react';

export default function App() {
  // Query parameters state
  const [startDate, setStartDate] = useState('2026-01-05');
  const [endDate, setEndDate] = useState('2026-01-08');
  const [mode, setMode] = useState('gate_closure'); // 'gate_closure' | 'horizon'
  const [decisionCutoffTime, setDecisionCutoffTime] = useState('11:00');
  const [minHorizonHours, setMinHorizonHours] = useState(14.0);
  const [interpolateHalfHourly, setInterpolateHalfHourly] = useState(true);

  // Trader interactive calculator state
  const [nationalDemand, setNationalDemand] = useState(32000);

  // API result and status states
  const [analysisData, setAnalysisData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isLiveApi, setIsLiveApi] = useState(false);

  // Trigger analysis fetch
  const handleFetchAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDayAheadAnalysis({
        start_date: startDate,
        end_date: endDate,
        mode,
        decision_cutoff_time: decisionCutoffTime,
        min_horizon_hours: minHorizonHours,
        interpolate_half_hourly: interpolateHalfHourly,
      });

      setAnalysisData(data);
      setIsLiveApi(data.isLiveApi ?? false);
    } catch (err) {
      console.error('Failed to load analysis:', err);
      setError(err.message || 'Unable to retrieve day-ahead analysis');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, mode, decisionCutoffTime, minHorizonHours, interpolateHalfHourly]);

  // Initial load
  useEffect(() => {
    handleFetchAnalysis();
  }, [handleFetchAnalysis]);

  const kpis = analysisData?.kpis || {};
  const timeseries = analysisData?.timeseries || [];
  const horizonProfile = analysisData?.horizon_profile || [];

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 flex flex-col font-sans selection:bg-cyan-500 selection:text-white">
      {/* Header Bar */}
      <Header
        isLiveApi={isLiveApi}
        loading={loading}
        error={error}
        sampleCount={kpis.sample_count || timeseries.length}
      />

      {/* Main Trading Desk Workspace */}
      <main className="flex-1 max-w-[1700px] w-full mx-auto px-4 md:px-6 py-6 space-y-6">
        {/* Error notification if backend unreachable */}
        {error && (
          <div className="bg-rose-950/60 border border-rose-700/80 text-rose-300 px-4 py-3 rounded-xl flex items-center justify-between text-xs shadow-lg">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="text-rose-400" />
              <span>
                Backend API Notice: {error}. Falling back to high-fidelity BMRS simulation.
              </span>
            </div>
            <button
              onClick={handleFetchAnalysis}
              className="text-xs font-semibold text-rose-200 hover:text-white underline ml-4"
            >
              Retry
            </button>
          </div>
        )}

        {/* 1. Top Control Bar */}
        <section>
          <TopControlBar
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            mode={mode}
            setMode={setMode}
            decisionCutoffTime={decisionCutoffTime}
            setDecisionCutoffTime={setDecisionCutoffTime}
            minHorizonHours={minHorizonHours}
            setMinHorizonHours={setMinHorizonHours}
            interpolateHalfHourly={interpolateHalfHourly}
            setInterpolateHalfHourly={setInterpolateHalfHourly}
            loading={loading}
            onRunAnalysis={handleFetchAnalysis}
          />
        </section>

        {/* 2. Interactive Thermal Procurement Calculator Bar */}
        <section>
          <ThermalCalculatorBar
            timeseries={timeseries}
            nationalDemand={nationalDemand}
            setNationalDemand={setNationalDemand}
            p90ShortfallBuffer={kpis.p90_shortfall_buffer_mw}
          />
        </section>

        {/* 3. KPI Summary Row (4 Cards) */}
        <section>
          <KpiSummaryRow kpis={kpis} />
        </section>

        {/* 4. Chart 1 (Main): ComposedChart Actual vs Forecast vs P90 Firm Floor */}
        <section>
          <MainWindChart timeseries={timeseries} />
        </section>

        {/* 5. Charts 2 & 3: Bottom Left Error Distribution & Bottom Right Horizon Profile */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 2: Forecast Error (FC - Actual MW) with Deficit Highlighting */}
          <div>
            <ErrorDistributionChart timeseries={timeseries} />
          </div>

          {/* Chart 3: Horizon Degradation Profile (MAE & RMSE across lead buckets) */}
          <div>
            <HorizonProfileChart horizonProfile={horizonProfile} />
          </div>
        </section>

        {/* 6. Settlement Period Ledger Table */}
        <section>
          <SettlementDataTable timeseries={timeseries} />
        </section>
      </main>

      {/* Footer / Desk Status */}
      <footer className="border-t border-slate-800 bg-slate-900/90 py-3 text-center text-xs text-slate-500">
        <div className="max-w-[1700px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            UK Wholesale Day-Ahead Wind Trading Desk &middot; BMRS Elexon FUELHH &amp; WINDFOR Data
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span>Decision Rules: D-1 Cutoff / Horizon Matching</span>
            <span>&bull;</span>
            <span>All Timestamps UTC</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
