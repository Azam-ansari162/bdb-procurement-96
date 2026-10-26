# UK Wholesale Energy Day-Ahead Wind Procurement — System Specification

> **This file is the single source of truth.**
> Both the Backend Agent and Frontend Agent **must** read it fully and follow every rule before writing any code.
> If a task conflicts with this specification, **stop and ask**; do not deviate silently.

---

## 1  Purpose & Business Context

A UK energy utility's trading desk must purchase power in the **Day-Ahead (DA) market** every morning.
Wind generation is the largest source of forecast uncertainty: when actual wind is lower than the forecast used at decision time, the desk faces a **shortfall** and must procure expensive thermal replacement power.

This application lets a trader:

1. Select a date range of **delivery days** within January 2026.
2. Choose how the "decision-time forecast" is determined (gate-closure cutoff or minimum horizon).
3. View time-series of actual vs. forecast wind generation, forecast errors, and a "firm wind" estimate that accounts for downside risk.
4. Review summary KPIs (MAE, RMSE, MAPE, WAPE, bias, P90/P95 shortfall buffers) and a horizon-profile breakdown.

---

## 2  Scope — January 2026

| Concept | Value |
|---|---|
| **Decision dates** | 2025-12-31 → 2026-01-31 (the day the trader commits) |
| **Delivery dates** | 2026-01-01 → 2026-02-01 (the day power flows) |
| **Granularity** | Half-hourly (48 settlement periods per day, aligned `:00` and `:30`) |
| **Timezone** | All internal timestamps are **UTC**. The UI should label axes "UTC". |

---

## 3  External Data Sources (Elexon BMRS)

### 3.1  Actuals — `FUELHH/stream`

| Item | Detail |
|---|---|
| **Endpoint** | `GET https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH/stream` |
| **Query params** | `settlementDateFrom=2026-01-01`, `settlementDateTo=2026-02-01`, `fuelType=WIND` |
| **Resolution** | 30-minute intervals (`:00` and `:30` each hour) |
| **Fields used** | `startTime` (ISO-8601 UTC), `generation` (MW), `fuelType` (`"WIND"`) |

> [!CAUTION]
> **Never** combine `settlementDate*` params with `publishDateTime*` params on `FUELHH/stream`.
> Elexon returns **HTTP 400** if both families are present on the same request.

### 3.2  Forecasts — `WINDFOR/stream`

| Item | Detail |
|---|---|
| **Endpoint** | `GET https://data.elexon.co.uk/bmrs/api/v1/datasets/WINDFOR/stream` |
| **Query params** | `publishDateTimeFrom`, `publishDateTimeTo` (ISO-8601 UTC) |
| **Chunking** | Fetch in **7-day chunks** from `2025-12-30T00:00:00Z` to `2026-02-01T23:59:59Z` |
| **Resolution** | 1-hour intervals (`:00` each hour) |
| **Fields used** | `startTime` (ISO-8601 UTC), `publishTime` (ISO-8601 UTC — when the forecast was created), `generation` (MW) |

> [!IMPORTANT]
> `WINDFOR/stream` only accepts `publishDateTime*` params — **not** `settlementDate*`.
> The publish window must start on **2025-12-30** so that forecasts created the day before the first delivery day (2026-01-01) are captured.

---

## 4  Point-in-Time Matching Logic

The core analytical challenge is choosing **which forecast row** was the "latest available" at the moment the trader had to commit.
Two modes are supported; the frontend lets the user switch between them.

### 4.1  Mode A — `gate_closure`

For every target `startTime` on Delivery Day **D**:

1. Compute `decision_deadline = floor_day(startTime) - 1 day + decision_cutoff_time` (in UTC).
   - `floor_day(startTime)` = midnight UTC of the delivery day.
   - Example: if `startTime = 2026-01-06T14:00:00Z` and `decision_cutoff_time = "11:00"`, then `decision_deadline = 2026-01-05T11:00:00Z`.
2. Filter `WINDFOR` rows where **both**:
   - The row's `startTime` matches the target `startTime` (after granularity alignment; see §5).
   - `publishTime <= decision_deadline`.
3. From the filtered set, pick the row with **`max(publishTime)`** — this is the freshest forecast the trader could have seen.

**Standard cutoff presets** (for the frontend dropdown):

| Label | `decision_cutoff_time` |
|---|---|
| EPEX Day-Ahead | `09:20` |
| Coupled DA | `11:00` |
| GB Half-Hourly DA | `15:30` |

### 4.2  Mode B — `horizon`

For every target `startTime` on Delivery Day **D**:

1. Filter `WINDFOR` rows where **both**:
   - The row's `startTime` matches the target `startTime`.
   - `(startTime - publishTime) >= min_horizon_hours` (i.e., the forecast was published at least `min_horizon_hours` before delivery).
2. From the filtered set, pick the row with **`max(publishTime)`**.

### 4.3  Look-Ahead Bias Prevention

> [!WARNING]
> Under **no** circumstances should a forecast published **after** the decision deadline (Mode A) or with a horizon shorter than `min_horizon_hours` (Mode B) be used.
> This would constitute look-ahead bias and render the analysis useless for real trading decisions.

---

## 5  Granularity Alignment & Interpolation

`FUELHH` provides actuals at **30-minute** resolution (`:00` and `:30`).
`WINDFOR` provides forecasts at **1-hour** resolution (`:00` only).

### 5.1  Joining

Build the master index from `FUELHH` `startTime` values (the 30-min grid).
Left-join matched `WINDFOR` forecast values onto this index using the aligned `startTime`.

- For `:00` slots, the forecast value comes directly from the matched `WINDFOR` row.
- For `:30` slots, the forecast value is `NULL` (no native `WINDFOR` row exists for `:30`).

### 5.2  Interpolation (`interpolate_half_hourly`)

When the query parameter `interpolate_half_hourly = true` (the default):

- For each `:30` slot, compute `forecast_mw` as the **linear average** of the matched `:00` forecast for that hour and the matched `:00` forecast for the next hour.
- If either neighbour is missing, leave the `:30` slot as `NULL` and exclude it from KPI calculations.

When `interpolate_half_hourly = false`:

- Drop all `:30` rows from the result entirely; return only hourly data.

---

## 6  Error Metrics & Firm Wind Calculation

### 6.1  Per-Row Calculations

For each row where both `forecast_mw` and `actual_mw` are non-null:

| Field | Formula | Interpretation |
|---|---|---|
| `error_mw` | `forecast_mw − actual_mw` | **Positive** = wind over-forecast = actual shortfall |
| `shortfall_mw` | `max(0, error_mw)` | Only over-forecast events (the trader's risk) |
| `horizon_hours` | `(startTime − publishTime)` in decimal hours | Forecast lead time |

### 6.2  Aggregate KPIs

Computed over all non-null rows in the requested date range:

| KPI | Formula |
|---|---|
| `mae_mw` | `mean(abs(error_mw))` |
| `rmse_mw` | `sqrt(mean(error_mw²))` |
| `mape_pct` | `100 × mean(abs(error_mw) / actual_mw)` — skip rows where `actual_mw = 0` |
| `wape_pct` | `100 × sum(abs(error_mw)) / sum(actual_mw)` |
| `mean_bias_mw` | `mean(error_mw)` |
| `p90_shortfall_buffer_mw` | 90th percentile of the `shortfall_mw` distribution |
| `p95_shortfall_buffer_mw` | 95th percentile of the `shortfall_mw` distribution |
| `sample_count` | Number of non-null rows |

### 6.3  Firm Wind Estimate

For each row:

```
firm_wind_p90_mw = max(0, forecast_mw − p90_shortfall_buffer_mw)
```

This represents a conservative wind figure the trader can rely on with ~90% confidence.

### 6.4  Horizon Profile Buckets

Group all non-null rows by `horizon_hours` into fixed buckets and compute `mae_mw` and `rmse_mw` per bucket:

| Bucket label | Range |
|---|---|
| `0–6 h (Intraday)` | `0 ≤ horizon_hours < 6` |
| `6–12 h (Short DA)` | `6 ≤ horizon_hours < 12` |
| `12–18 h (Mid DA)` | `12 ≤ horizon_hours < 18` |
| `18–24 h (Long DA)` | `18 ≤ horizon_hours < 24` |
| `24–36 h (DA+1)` | `24 ≤ horizon_hours < 36` |
| `36–48 h (2-Day)` | `36 ≤ horizon_hours < 48` |
| `48+ h` | `48 ≤ horizon_hours` |

---

## 7  REST API Contract

### `GET /api/day-ahead-analysis`

#### 7.1  Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `start_date` | string (`YYYY-MM-DD`) | `"2026-01-05"` | First delivery date (inclusive) |
| `end_date` | string (`YYYY-MM-DD`) | `"2026-01-08"` | Last delivery date (inclusive) |
| `mode` | string | `"gate_closure"` | `"gate_closure"` or `"horizon"` |
| `decision_cutoff_time` | string (`HH:MM`) | `"11:00"` | Only used when `mode = "gate_closure"` |
| `min_horizon_hours` | float | `14.0` | Only used when `mode = "horizon"` |
| `interpolate_half_hourly` | boolean | `true` | If `false`, return hourly rows only |

#### 7.2  Success Response — `200 OK`

```json
{
  "kpis": {
    "mae_mw": 842.3,
    "rmse_mw": 1054.1,
    "mape_pct": 9.45,
    "wape_pct": 8.12,
    "mean_bias_mw": 215.4,
    "p90_shortfall_buffer_mw": 1390.0,
    "p95_shortfall_buffer_mw": 1720.5,
    "sample_count": 192
  },
  "timeseries": [
    {
      "startTime": "2026-01-05T00:00:00Z",
      "publishTime": "2026-01-04T08:30:00Z",
      "actual_mw": 11240.0,
      "forecast_mw": 12100.0,
      "firm_wind_p90_mw": 10710.0,
      "error_mw": 860.0,
      "shortfall_mw": 860.0,
      "horizon_hours": 15.5
    }
  ],
  "horizon_profile": [
    {
      "bucket": "0-6h (Intraday)",
      "mae_mw": 410.2,
      "rmse_mw": 530.8
    }
  ]
}
```

#### 7.3  Field Descriptions

**`kpis`** (object — always present, all values are numbers):

| Field | Unit | Description |
|---|---|---|
| `mae_mw` | MW | Mean Absolute Error |
| `rmse_mw` | MW | Root Mean Squared Error |
| `mape_pct` | % | Mean Absolute Percentage Error |
| `wape_pct` | % | Weighted Absolute Percentage Error |
| `mean_bias_mw` | MW | Mean signed error (positive = over-forecast tendency) |
| `p90_shortfall_buffer_mw` | MW | 90th percentile of shortfall distribution |
| `p95_shortfall_buffer_mw` | MW | 95th percentile of shortfall distribution |
| `sample_count` | integer | Number of non-null data points used |

**`timeseries`** (array of objects — sorted ascending by `startTime`):

| Field | Type | Description |
|---|---|---|
| `startTime` | ISO-8601 UTC string | Delivery half-hour start |
| `publishTime` | ISO-8601 UTC string or `null` | When the matched forecast was issued |
| `actual_mw` | number or `null` | Metered wind generation |
| `forecast_mw` | number or `null` | Matched (and possibly interpolated) forecast |
| `firm_wind_p90_mw` | number or `null` | `max(0, forecast_mw − p90_shortfall_buffer_mw)` |
| `error_mw` | number or `null` | `forecast_mw − actual_mw` |
| `shortfall_mw` | number or `null` | `max(0, error_mw)` |
| `horizon_hours` | number or `null` | `(startTime − publishTime)` in decimal hours |

**`horizon_profile`** (array of objects — one per non-empty bucket, ordered by ascending hour range):

| Field | Type | Description |
|---|---|---|
| `bucket` | string | Human-readable bucket label (see §6.4) |
| `mae_mw` | number | MAE within this bucket |
| `rmse_mw` | number | RMSE within this bucket |

#### 7.4  Error Responses

| Status | When | Body |
|---|---|---|
| `400` | Invalid params (bad date format, unknown mode, etc.) | `{ "error": "<descriptive message>" }` |
| `502` | Elexon API unreachable or returns a non-2xx status | `{ "error": "Upstream Elexon API error: <details>" }` |
| `500` | Unexpected server error | `{ "error": "Internal server error" }` |

---

## 8  Backend Architecture

### 8.1  Tech Stack

| Layer | Choice |
|---|---|
| Language | Python 3.11+ |
| Framework | FastAPI |
| HTTP client | `httpx` (async) |
| Data processing | `pandas` |
| Server | `uvicorn` |
| Config | Environment variables (`.env` + `python-dotenv`) |

### 8.2  Directory Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app, CORS, lifespan
│   ├── config.py             # Settings via env vars / pydantic-settings
│   ├── routers/
│   │   ├── __init__.py
│   │   └── analysis.py       # GET /api/day-ahead-analysis
│   ├── services/
│   │   ├── __init__.py
│   │   ├── elexon_client.py  # Async fetch, chunking, retry logic
│   │   ├── matcher.py        # Point-in-time matching (Mode A & B)
│   │   └── metrics.py        # KPI calculation, horizon profile
│   ├── schemas/
│   │   ├── __init__.py
│   │   └── analysis.py       # Pydantic response models
│   └── utils/
│       ├── __init__.py
│       └── time_utils.py     # floor_day, interpolation helpers
├── tests/
│   ├── __init__.py
│   ├── test_matcher.py
│   └── test_metrics.py
├── requirements.txt
├── .env.example
└── README.md
```

### 8.3  Key Implementation Rules

1. **Elexon Client (`elexon_client.py`)**
   - `fetch_actuals(start_date, end_date)` → `pd.DataFrame`
     - Calls `FUELHH/stream` with `settlementDateFrom` / `settlementDateTo` / `fuelType=WIND`.
     - **Must never** include `publishDateTime*` params.
   - `fetch_forecasts(publish_from, publish_to)` → `pd.DataFrame`
     - Calls `WINDFOR/stream` with `publishDateTimeFrom` / `publishDateTimeTo`.
     - Splits the window into **≤ 7-day chunks** and concatenates results.
     - `publish_from` must be at least **1 day before** `start_date` to capture pre-delivery forecasts.
   - All requests set `Accept: application/json` header.
   - Retry up to **3 times** with exponential back-off on 429 / 5xx.
   - On persistent failure, raise an `ElexonAPIError` that the router maps to HTTP 502.

2. **Matcher (`matcher.py`)**
   - `match_forecasts(actuals_df, forecasts_df, mode, decision_cutoff_time, min_horizon_hours, interpolate_half_hourly)` → `pd.DataFrame`
   - Must implement §4 and §5 exactly.
   - The output DataFrame has one row per `startTime` in the actuals index with columns: `startTime`, `publishTime`, `actual_mw`, `forecast_mw`.
   - `publishTime` and `forecast_mw` may be `NaN` if no matching forecast was found.

3. **Metrics (`metrics.py`)**
   - `compute_kpis(df)` → `dict` matching §6.2.
   - `compute_timeseries(df, p90_shortfall_buffer_mw)` → `list[dict]` matching §7.2 `timeseries`.
   - `compute_horizon_profile(df)` → `list[dict]` matching §7.2 `horizon_profile`.

4. **Router (`analysis.py`)**
   - Single route: `GET /api/day-ahead-analysis`.
   - Parse & validate query params per §7.1.
   - Orchestrate: fetch → match → compute → serialise → respond.
   - All numeric values in the response must be **rounded to 1 decimal place**.
   - `null` (not `NaN`) for missing values in JSON.

5. **CORS**
   - Allow origin `http://localhost:5173` (Vite dev server).
   - Allow origin from env var `FRONTEND_ORIGIN` if set.

### 8.4  Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |
| `ELEXON_BASE_URL` | `https://data.elexon.co.uk/bmrs/api/v1` | Base URL for Elexon API |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

---

## 9  Frontend Architecture

### 9.1  Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + Vite |
| Language | JavaScript (JSX) |
| HTTP client | `axios` |
| Charts | Recharts |
| Styling | Plain CSS (one global stylesheet + component styles) |
| Routing | Single page (no router needed) |

### 9.2  Directory Structure

```
frontend/
├── public/
│   └── index.html
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── App.css
│   ├── index.css              # Global styles, CSS variables
│   ├── api/
│   │   └── index.js           # Axios instance + fetchAnalysis()
│   ├── components/
│   │   ├── ControlPanel.jsx   # Date pickers, mode selector, cutoff dropdown, submit button
│   │   ├── ControlPanel.css
│   │   ├── KpiCards.jsx       # Summary KPI tiles
│   │   ├── KpiCards.css
│   │   ├── TimeseriesChart.jsx # Multi-line time-series chart
│   │   ├── TimeseriesChart.css
│   │   ├── ErrorHistogram.jsx  # Histogram of error_mw distribution
│   │   ├── ErrorHistogram.css
│   │   ├── HorizonProfile.jsx  # Bar chart of MAE/RMSE by horizon bucket
│   │   ├── HorizonProfile.css
│   │   ├── DataTable.jsx       # Scrollable table of timeseries rows
│   │   └── DataTable.css
│   └── utils/
│       └── format.js          # Number formatting helpers
├── package.json
├── vite.config.js
└── README.md
```

### 9.3  UI Layout & Behaviour

The page is a **single-page dashboard** with these sections, top to bottom:

#### 9.3.1  Header
- Title: **"UK Wind Day-Ahead Procurement Dashboard"**
- Subtitle: *"January 2026 · Elexon BMRS Data"*

#### 9.3.2  Control Panel (`ControlPanel.jsx`)

| Control | Type | Details |
|---|---|---|
| Start Date | date input | Default `2026-01-05`, min `2026-01-01`, max `2026-02-01` |
| End Date | date input | Default `2026-01-08`, min `2026-01-05`, max `2026-02-01` |
| Mode | radio group | `Gate Closure` (default) / `Horizon` |
| Cutoff | dropdown | Shown only when mode = `Gate Closure`. Options: EPEX DA `09:20`, Coupled DA `11:00` (default), GB HH DA `15:30` |
| Min Horizon | number input | Shown only when mode = `Horizon`. Default `14.0`, step `0.5` |
| Interpolate | checkbox | Default checked. Label: "Interpolate to half-hourly" |
| **Analyse** | button | Fires the API call. Disabled while loading. Shows spinner. |

- On load, **automatically** fire the API call with default parameters.
- Show a loading skeleton / spinner while waiting.
- On error, display a red banner with the error message above the results.

#### 9.3.3  KPI Cards (`KpiCards.jsx`)

Display **8 cards** in a responsive grid (4 × 2 on desktop, 2 × 4 on tablet, 1 × 8 on mobile):

| Card title | Value field | Unit | Colour hint |
|---|---|---|---|
| MAE | `mae_mw` | MW | — |
| RMSE | `rmse_mw` | MW | — |
| MAPE | `mape_pct` | % | — |
| WAPE | `wape_pct` | % | — |
| Mean Bias | `mean_bias_mw` | MW | Green if negative (under-forecast), Red if positive (over-forecast) |
| P90 Shortfall | `p90_shortfall_buffer_mw` | MW | Orange |
| P95 Shortfall | `p95_shortfall_buffer_mw` | MW | Red |
| Sample Count | `sample_count` | periods | — |

#### 9.3.4  Time-Series Chart (`TimeseriesChart.jsx`)

A Recharts `ComposedChart` with:

| Series | Type | Colour | Dash |
|---|---|---|---|
| `actual_mw` | Line | `#2563eb` (blue) | Solid |
| `forecast_mw` | Line | `#f97316` (orange) | Solid |
| `firm_wind_p90_mw` | Line | `#10b981` (green) | Dashed |

- X-axis: `startTime` formatted as `"Jan 05 00:00"` or equivalent concise UTC label.
- Y-axis: MW, auto-scaled.
- Tooltip showing all three values + `error_mw` + `shortfall_mw` + `horizon_hours`.
- A `ReferenceArea` shading (light red, 10% opacity) between `forecast_mw` and `actual_mw` where `error_mw > 0` (shortfall zone), if practical; otherwise omit.

#### 9.3.5  Error Histogram (`ErrorHistogram.jsx`)

A Recharts `BarChart` showing the distribution of `error_mw` values:

- Bin width: 200 MW.
- Bars coloured: red for positive error bins (over-forecast / shortfall), blue for negative (under-forecast / surplus).
- Vertical reference line at 0.
- X-axis label: "Forecast Error (MW)". Y-axis label: "Count".

#### 9.3.6  Horizon Profile (`HorizonProfile.jsx`)

A Recharts grouped `BarChart`:

- One group per `bucket`.
- Two bars per group: `mae_mw` (blue) and `rmse_mw` (orange).
- X-axis: bucket labels. Y-axis: MW.

#### 9.3.7  Data Table (`DataTable.jsx`)

A scrollable HTML `<table>` showing every `timeseries` row:

| Column header | Field | Format |
|---|---|---|
| Time (UTC) | `startTime` | `YYYY-MM-DD HH:mm` |
| Actual MW | `actual_mw` | Comma-separated integer |
| Forecast MW | `forecast_mw` | Comma-separated integer |
| Firm P90 MW | `firm_wind_p90_mw` | Comma-separated integer |
| Error MW | `error_mw` | Signed integer, **red** text if > 0 |
| Shortfall MW | `shortfall_mw` | Integer, **bold** if > 0 |
| Horizon (h) | `horizon_hours` | 1 decimal |
| Forecast Issued | `publishTime` | `YYYY-MM-DD HH:mm` |

- Alternate row shading for readability.
- Sticky header row.
- Null values displayed as `"—"`.

### 9.4  Styling Guidelines

- **Colour palette**: Dark navy `#0f172a` header/sidebar, white `#ffffff` card surfaces, light grey `#f1f5f9` page background.
- **Font**: System sans-serif stack.
- **CSS variables** for all colours, shadows, radii — defined in `index.css`.
- **Responsive**: Flex/grid layouts, min-width 375px.
- **No UI library** (no Material UI, Tailwind, etc.) — plain CSS only.

### 9.5  API Integration (`api/index.js`)

```js
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

const api = axios.create({ baseURL: API_BASE });

export async function fetchAnalysis(params) {
  const res = await api.get('/api/day-ahead-analysis', { params });
  return res.data;
}
```

### 9.6  Number Formatting (`utils/format.js`)

- `formatMW(value)` → comma-separated integer string (e.g., `"12,340"`) or `"—"` if null.
- `formatPct(value)` → one-decimal string with `%` suffix (e.g., `"9.5%"`) or `"—"`.
- `formatHours(value)` → one-decimal string (e.g., `"15.5"`) or `"—"`.

---

## 10  Development & Build

### 10.1  Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

### 10.2  Frontend

```bash
cd frontend
npm install
npm run dev        # → http://localhost:5173
npm run build      # Production build into dist/
```

### 10.3  Proxy / CORS

During development the frontend Vite dev server runs on `:5173` and the backend on `:8000`.
The backend's CORS middleware must allow `http://localhost:5173`.
The frontend uses the full URL via `VITE_API_BASE`.

---

## 11  Rules for Agents

1. **Work only inside the folder your task names** (`backend/` or `frontend/`). Do not edit the other agent's area.
2. **Follow the tech stack, data models, API contract, and UI layout above exactly.** Do not add libraries without asking.
3. **Make only the changes the task asks for.** No extra features.
4. **Run the app (or tests) and fix errors before reporting done.**
5. Keep secrets in `.env` and commit a `.env.example`. Never commit `.env`.
6. All numeric API responses: **round to 1 decimal place**; use `null` not `NaN`.
7. **No look-ahead bias** — §4.3 is inviolable.
8. All timestamps in the API response must be **ISO-8601 UTC** strings ending in `Z`.

---

## 12  Out of Scope (v1)

- Intraday market analysis or continuous trading.
- Multi-fuel (solar, gas) forecasts.
- Database / caching layer (all data fetched live from Elexon per request).
- User authentication or multi-tenancy.
- Deployment, Docker, CI/CD configuration.
- Historical back-testing beyond January 2026.

