import React, { useState } from 'react';
import { Table, Download, Search, Filter, AlertTriangle } from 'lucide-react';
import { formatMW, formatUTC, formatDateTime, getSettlementPeriod } from '../utils/format';

export default function SettlementDataTable({ timeseries = [] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterShortfallOnly, setFilterShortfallOnly] = useState(false);

  // Filter rows
  const filteredRows = timeseries.filter((row) => {
    if (filterShortfallOnly && !(row.shortfall_mw > 0)) {
      return false;
    }
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const timeMatch = (row.startTime || '').toLowerCase().includes(term);
    const spMatch = `sp ${getSettlementPeriod(row.startTime)}`.includes(term);
    return timeMatch || spMatch;
  });

  // Export CSV
  const handleDownloadCSV = () => {
    if (!timeseries || timeseries.length === 0) return;
    const headers = [
      'Settlement_Period',
      'Start_Time_UTC',
      'Actual_MW',
      'Forecast_MW',
      'Firm_P90_MW',
      'Error_MW',
      'Shortfall_MW',
      'Horizon_Hours',
      'Publish_Time_UTC',
    ];

    const csvContent = [
      headers.join(','),
      ...timeseries.map((r) =>
        [
          getSettlementPeriod(r.startTime) || '',
          r.startTime || '',
          r.actual_mw ?? '',
          r.forecast_mw ?? '',
          r.firm_wind_p90_mw ?? '',
          r.error_mw ?? '',
          r.shortfall_mw ?? '',
          r.horizon_hours ?? '',
          r.publishTime || '',
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `uk_wind_settlement_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-[#1e293b] border border-slate-700/80 rounded-xl shadow-xl overflow-hidden">
      {/* Table Top Toolbar */}
      <div className="p-4 border-b border-slate-700/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Table size={18} className="text-cyan-400" />
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
            Settlement Period Ledger
          </h3>
          <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-400 border border-slate-700">
            {filteredRows.length} of {timeseries.length} Records
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Search by period or date */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter time / SP..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-36 sm:w-48"
            />
          </div>

          {/* Shortfall Only Filter Button */}
          <button
            type="button"
            onClick={() => setFilterShortfallOnly(!filterShortfallOnly)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-medium transition-all ${
              filterShortfallOnly
                ? 'bg-rose-950/70 border-rose-700 text-rose-300'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            <AlertTriangle size={12} className={filterShortfallOnly ? 'text-rose-400' : 'text-slate-400'} />
            <span>Shortfalls Only</span>
          </button>

          {/* CSV Download Button */}
          <button
            type="button"
            onClick={handleDownloadCSV}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium px-3 py-1 rounded-lg transition-colors"
          >
            <Download size={13} className="text-cyan-400" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto max-h-[380px] scrollbar-thin">
        <table className="w-full text-left text-xs font-sans border-collapse">
          <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] tracking-wider sticky top-0 z-10 border-b border-slate-700">
            <tr>
              <th className="py-2.5 px-3">SP</th>
              <th className="py-2.5 px-3">Delivery Time (UTC)</th>
              <th className="py-2.5 px-3 text-right">Actual MW</th>
              <th className="py-2.5 px-3 text-right">Forecast MW</th>
              <th className="py-2.5 px-3 text-right">Firm P90 MW</th>
              <th className="py-2.5 px-3 text-right">Error MW</th>
              <th className="py-2.5 px-3 text-right">Shortfall MW</th>
              <th className="py-2.5 px-3 text-right">Horizon</th>
              <th className="py-2.5 px-3">Forecast Issued (UTC)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-slate-500">
                  No settlement records match your filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, idx) => {
                const sp = getSettlementPeriod(row.startTime);
                const isShortfall = row.error_mw > 0;
                return (
                  <tr
                    key={row.startTime || idx}
                    className="hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="py-2 px-3 font-mono font-bold text-slate-400">
                      SP {sp || '—'}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-200 font-medium whitespace-nowrap">
                      {formatUTC(row.startTime)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-sky-400 font-medium">
                      {formatMW(row.actual_mw, false)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-amber-400 font-medium">
                      {formatMW(row.forecast_mw, false)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-emerald-400 font-medium">
                      {formatMW(row.firm_wind_p90_mw, false)}
                    </td>
                    <td
                      className={`py-2 px-3 text-right font-mono font-bold ${
                        isShortfall ? 'text-rose-400' : 'text-teal-400'
                      }`}
                    >
                      {row.error_mw !== null && row.error_mw !== undefined
                        ? (row.error_mw > 0 ? `+${Math.round(row.error_mw).toLocaleString()}` : Math.round(row.error_mw).toLocaleString())
                        : '—'}
                    </td>
                    <td
                      className={`py-2 px-3 text-right font-mono ${
                        row.shortfall_mw > 0 ? 'text-rose-400 font-extrabold' : 'text-slate-500'
                      }`}
                    >
                      {row.shortfall_mw !== null && row.shortfall_mw !== undefined
                        ? (row.shortfall_mw > 0 ? `+${Math.round(row.shortfall_mw).toLocaleString()}` : '0')
                        : '—'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-400">
                      {row.horizon_hours !== null && row.horizon_hours !== undefined
                        ? `${row.horizon_hours}h`
                        : '—'}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-400 whitespace-nowrap">
                      {row.publishTime ? formatDateTime(row.publishTime) : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
