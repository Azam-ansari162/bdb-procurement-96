import { generateMockAnalysis } from './mockData';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * Fetch Day-Ahead Wind Analysis from backend REST API
 * Endpoint: GET /api/day-ahead-analysis
 * Query params conform strictly to SPEC.md Section 7.1:
 *  - start_date (YYYY-MM-DD)
 *  - end_date (YYYY-MM-DD)
 *  - mode ("gate_closure" | "horizon")
 *  - decision_cutoff_time ("09:20" | "11:00" | "15:30")
 *  - min_horizon_hours (float)
 *  - interpolate_half_hourly (boolean)
 */
export async function fetchDayAheadAnalysis(params = {}) {
  const url = new URL('/api/day-ahead-analysis', BASE_URL);

  // Map and append params per SPEC.md contract
  const queryParams = {
    start_date: params.start_date || '2026-01-05',
    end_date: params.end_date || '2026-01-08',
    mode: params.mode || 'gate_closure',
    interpolate_half_hourly: params.interpolate_half_hourly !== false,
  };

  if (params.mode === 'gate_closure') {
    queryParams.decision_cutoff_time = params.decision_cutoff_time || '11:00';
  } else if (params.mode === 'horizon') {
    queryParams.min_horizon_hours = params.min_horizon_hours ?? 14.0;
  }

  // Also append user-facing aliases to ensure seamless cross-compatibility
  Object.entries(queryParams).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Backend responded with ${response.status}: ${errorText}`);
      throw new Error(`API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return {
      ...data,
      isLiveApi: true,
      apiUrl: url.toString(),
    };
  } catch (err) {
    console.info(`Connecting to live API at ${url.toString()} failed. Using client-side simulation. Reason:`, err.message);
    const mock = generateMockAnalysis(queryParams);
    return {
      ...mock,
      isLiveApi: false,
      apiError: err.message,
      apiUrl: url.toString(),
    };
  }
}
