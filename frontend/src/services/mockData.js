/**
 * High-fidelity fallback / demo data generator matching SPEC.md Section 7.2 schema.
 * Simulates UK national wind generation across January 2026 with realistic diurnal patterns,
 * cold-snap wind drops, and day-ahead forecast uncertainty.
 */

export function generateMockAnalysis(params = {}) {
  const startDateStr = params.start_date || params.delivery_start || '2026-01-05';
  const endDateStr = params.end_date || params.delivery_end || '2026-01-08';
  const interpolate30m = params.interpolate_half_hourly !== false && params.interpolate_30m !== 'false';
  const decisionMode = params.mode || params.decision_rule || 'gate_closure';
  const cutoffTime = params.decision_cutoff_time || params.gate_closure || '11:00';
  const minHorizon = Number(params.min_horizon_hours || params.horizon_hours || 14.0);

  const start = new Date(`${startDateStr}T00:00:00Z`);
  const end = new Date(`${endDateStr}T23:59:59Z`);

  const timeseries = [];
  let totalErrorAbs = 0;
  let totalSquaredError = 0;
  let totalSignedError = 0;
  let totalActual = 0;
  let count = 0;
  const shortfalls = [];

  const stepMinutes = interpolate30m ? 30 : 60;
  const curr = new Date(start.getTime());

  // Deterministic seed-like variation based on day
  while (curr <= end) {
    const isoStr = curr.toISOString();
    const day = curr.getUTCDate();
    const hour = curr.getUTCHours();
    const min = curr.getUTCMinutes();
    const timeFrac = hour + min / 60;

    // Simulate wind generation in UK (typical winter ~6,000 MW - 16,000 MW)
    const baseWind = 10500 + 4000 * Math.sin((day * 24 + timeFrac) / 14);
    const diurnal = 1200 * Math.cos(((timeFrac - 15) * Math.PI) / 12);
    const noise = 400 * Math.sin(day * 7 + timeFrac * 3);
    const actual_mw = Math.max(1200, Math.round(baseWind + diurnal + noise));

    // Forecast variation based on decision mode
    let leadHours = 14;
    let publishHour = 11;
    if (decisionMode === 'gate_closure') {
      const [cH, cM] = cutoffTime.split(':').map(Number);
      publishHour = cH + (cM || 0) / 60;
      leadHours = (24 - publishHour) + timeFrac;
    } else {
      leadHours = minHorizon + (timeFrac % 6);
    }

    // Lead time increases uncertainty
    const errorScale = 400 + leadHours * 28;
    // Bias toward slight over-forecast in winter blocking highs
    const biasTendency = 180 + 100 * Math.sin(day / 3);
    const simulatedError = biasTendency + errorScale * Math.sin((day * 31 + timeFrac * 5) % 11 - 5.5);

    const forecast_mw = Math.max(800, Math.round(actual_mw + simulatedError));
    const error_mw = forecast_mw - actual_mw;
    const shortfall_mw = Math.max(0, error_mw);

    // Compute publishTime
    const pubDate = new Date(curr.getTime() - leadHours * 3600 * 1000);
    const publishTime = pubDate.toISOString();

    timeseries.push({
      startTime: isoStr,
      publishTime: publishTime,
      actual_mw,
      forecast_mw,
      firm_wind_p90_mw: 0, // populated after p90 buffer computed
      error_mw,
      shortfall_mw,
      horizon_hours: Number(leadHours.toFixed(1)),
    });

    totalErrorAbs += Math.abs(error_mw);
    totalSquaredError += error_mw * error_mw;
    totalSignedError += error_mw;
    totalActual += actual_mw;
    shortfalls.push(shortfall_mw);
    count++;

    curr.setUTCMinutes(curr.getUTCMinutes() + stepMinutes);
  }

  // Calculate percentiles
  shortfalls.sort((a, b) => a - b);
  const p90Index = Math.floor(shortfalls.length * 0.9);
  const p95Index = Math.floor(shortfalls.length * 0.95);
  const p90_shortfall_buffer_mw = shortfalls[p90Index] || 1350.0;
  const p95_shortfall_buffer_mw = shortfalls[p95Index] || 1680.0;

  // Apply firm_wind_p90_mw = max(0, forecast_mw - p90_shortfall_buffer_mw)
  timeseries.forEach((pt) => {
    pt.firm_wind_p90_mw = Math.max(0, pt.forecast_mw - p90_shortfall_buffer_mw);
  });

  const mae_mw = Number((totalErrorAbs / Math.max(1, count)).toFixed(1));
  const rmse_mw = Number(Math.sqrt(totalSquaredError / Math.max(1, count)).toFixed(1));
  const mean_bias_mw = Number((totalSignedError / Math.max(1, count)).toFixed(1));
  const wape_pct = Number(((totalErrorAbs / Math.max(1, totalActual)) * 100).toFixed(1));
  const mape_pct = Number(((totalErrorAbs / Math.max(1, totalActual)) * 108).toFixed(1));

  // Horizon Degradation Profile Buckets (SPEC.md Section 6.4)
  const horizon_profile = [
    { bucket: '0–6 h (Intraday)', mae_mw: Math.round(mae_mw * 0.52), rmse_mw: Math.round(rmse_mw * 0.55) },
    { bucket: '6–12 h (Short DA)', mae_mw: Math.round(mae_mw * 0.74), rmse_mw: Math.round(rmse_mw * 0.76) },
    { bucket: '12–18 h (Mid DA)', mae_mw: Math.round(mae_mw * 0.92), rmse_mw: Math.round(rmse_mw * 0.93) },
    { bucket: '18–24 h (Long DA)', mae_mw: Math.round(mae_mw * 1.10), rmse_mw: Math.round(rmse_mw * 1.12) },
    { bucket: '24–36 h (DA+1)', mae_mw: Math.round(mae_mw * 1.35), rmse_mw: Math.round(rmse_mw * 1.38) },
    { bucket: '36–48 h (2-Day)', mae_mw: Math.round(mae_mw * 1.62), rmse_mw: Math.round(rmse_mw * 1.65) },
  ];

  return {
    kpis: {
      mae_mw,
      rmse_mw,
      mape_pct,
      wape_pct,
      mean_bias_mw,
      p90_shortfall_buffer_mw,
      p95_shortfall_buffer_mw,
      sample_count: count,
    },
    timeseries,
    horizon_profile,
    _isMock: true,
  };
}
