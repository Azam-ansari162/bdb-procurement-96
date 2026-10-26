# UK Wholesale Energy Day-Ahead Wind Procurement Trading Desk

An institutional decision-support system and quantitative analytics platform designed for UK electricity trading desks navigating Day-Ahead (DA) market gate closures, intermittent wind penetration, and physical imbalance risk under the Balancing and Settlement Code (BSC).

---

## 1. Executive Summary: The UK Day-Ahead Wind Procurement Challenge

In the Great Britain (GB) wholesale power market, energy suppliers, utilities, and trading desks must balance physical generation against contractual commitments across 48 half-hour **Settlement Periods (SPs)** per delivery day. 

Wind generation constitutes both the UK's fastest-growing renewable power source and its largest single driver of volumetric forecast risk:
- **The Shortfall Risk:** When actual wind generation outturn drops below the Day-Ahead forecast submitted at auction gate closure, the trading desk incurs a physical supply deficit. The system operator (National Grid ESO) resolves this deficit via the Balancing Mechanism (BM), charging the imbalance party punitive **System Buy Prices (SBP)** or forcing urgent intraday dispatch of expensive gas-fired thermal plants (CCGT/OCGT).
- **The Over-Forecasting Penalty:** Systematic positive forecast bias causes trading desks to sell or commit wind capacity they cannot deliver. In high-wind periods, unexpected drops expose utilities to steep cashout penalties and cashflow volatility.
- **The Decision-Time Dilemma:** Traders must commit physical and financial positions at specific auction deadlines—such as EPEX DA (`09:20 UTC`), Coupled N2EX (`11:00 UTC`), or GB Half-Hourly DA (`15:30 UTC`)—well before physical delivery begins. They cannot know which forecast was "right"; they only know what forecasts were **strictly published prior to gate closure**.

This platform provides quantitative trading desks with point-in-time backtesting, risk-adjusted **P90/P95 Shortfall Buffers**, half-hourly granularity alignment, and automated thermal replacement scheduling based on live Elexon BMRS market data.

---

## 2. Architectural Overview

```
                                      +---------------------------------------------+
                                      |             Elexon BMRS API                 |
                                      +---------------------------------------------+
                                             |                               |
                   Actual Outturn            |                               | Forecast Updates
              (FUELHH/stream, 30-min)        |                               | (WINDFOR/stream, 60-min)
                                             v                               v
                                    +-----------------------------------------------+
                                    |        Two-Tier Caching & Ingestion           |
                                    |     (In-Memory Microcache + Disk JSON)        |
                                    +-----------------------------------------------+
                                                            |
                                                            v
                                    +-----------------------------------------------+
                                    |         Point-in-Time Matcher Engine          |
                                    |  * Mode A: D-1 Auction Gate Closure Cutoff    |
                                    |  * Mode B: Minimum Horizon Lead-Time Matching |
                                    |  * Anti-Lookahead Bias Filter: max(publish)   |
                                    +-----------------------------------------------+
                                                            |
                                                            v
                                    +-----------------------------------------------+
                                    |        Granularity Harmonizer & Interpolator  |
                                    |   Harmonizes 60-min WINDFOR to 30-min FUELHH  |
                                    +-----------------------------------------------+
                                                            |
                                                            v
                                    +-----------------------------------------------+
                                    |          Quantitative Risk Metrics            |
                                    |   MAE · RMSE · WAPE · Bias · P90/P95 Buffers  |
                                    |         Firm Wind Floor Calculation           |
                                    +-----------------------------------------------+
                                                            |
                                        +-------------------+-------------------+
                                        |                                       |
                                        v                                       v
                             +---------------------+                 +---------------------+
                             |   FastAPI REST API  | <=== (CORS) === |  Vite React Desk UI |
                             |     Port: 8000      |                 |     Port: 5173      |
                             +---------------------+                 +---------------------+
```

### 2.1 Elexon BMRS Data Sources
The engine consumes two foundational BMRS streams from Elexon:
1. **Metered Actual Outturn (`FUELHH/stream`):**
   - Half-hourly settlement period outturn for fuel type `WIND`.
   - Query filters: `settlementDateFrom` and `settlementDateTo`. Note: Per Elexon specification, `settlementDate*` parameters are never combined with `publishDateTime*` parameters to avoid HTTP 400 errors.
2. **Day-Ahead Forecasts (`WINDFOR/stream`):**
   - Hourly national wind generation forecasts published incrementally throughout the day.
   - Query filters: `publishDateTimeFrom` and `publishDateTimeTo`. Fetched in concurrent $\le$7-day chunks starting at $D-2$ (`2025-12-30`) to capture early forecasts for initial delivery days.

### 2.2 Point-in-Time Matching Logic & Anti-Lookahead Guarantee
To prevent look-ahead bias—which would invalidate backtested trading decisions—forecast selection is strictly constrained:
- **Mode A (Gate Closure Cutoff):** For target delivery time $t_{\text{delivery}}$ on day $D$:
  $$\text{Deadline} = \text{floor\_day}(t_{\text{delivery}}) - 1\text{ day} + \text{CutoffTime}$$
  Eligible forecast rows must satisfy $\text{publishTime} \le \text{Deadline}$. The matcher selects the latest row: $\max(\text{publishTime})$.
  Standard supported presets:
  - `09:20 UTC`: EPEX Day-Ahead Auction
  - `11:00 UTC`: Coupled European Day-Ahead Auction (N2EX)
  - `15:30 UTC`: GB Half-Hourly Day-Ahead Auction
- **Mode B (Fixed Horizon):** Enforces that the forecast lead horizon satisfies:
  $$(t_{\text{delivery}} - \text{publishTime}) \ge \text{min\_horizon\_hours}$$
  Selects the most recently published forecast meeting this threshold.

### 2.3 Granularity Alignment (30-min vs 60-min)
- `FUELHH` metered generation operates on 30-minute intervals (`:00` and `:30`).
- `WINDFOR` forecasts arrive at 60-minute resolution (`:00` only).
- When `interpolate_half_hourly = true` (default), the `:30` slot is computed as the linear interpolation between the matched `:00` forecast of the current hour and the `:00` forecast of the subsequent hour:
  $$\hat{W}_{h:30} = \frac{\hat{W}_{h:00} + \hat{W}_{h+1:00}}{2}$$
  If either adjacent hour is missing, the `:30` interval remains `null` and is excluded from error metrics.

---

## 3. Quantitative Risk & Firm Wind Formulations

For every evaluated settlement period $i$ with actual wind $W_i$ and forecast $\hat{W}_i$:

| Metric | Mathematical Formula | Desk Interpretation |
|---|---|---|
| **Forecast Error ($e_i$)** | $e_i = \hat{W}_i - W_i$ | Positive error = over-forecast (wind deficit / shortfall). |
| **Shortfall ($S_i$)** | $S_i = \max(0, e_i)$ | Physical deficit requiring thermal replacement power. |
| **Mean Absolute Error (MAE)** | $\text{MAE} = \frac{1}{N} \sum_{i=1}^N \|e_i\|$ | Expected volume deviation per half-hour period. |
| **Root Mean Square Error (RMSE)**| $\text{RMSE} = \sqrt{\frac{1}{N} \sum_{i=1}^N e_i^2}$ | Error metric heavily penalizing tail forecast swings. |
| **Weighted Absolute % Error (WAPE)**| $\text{WAPE} = \frac{\sum \|e_i\|}{\sum W_i} \times 100\%$ | Scale-independent accuracy relative to total national outturn. |
| **Mean Signed Bias** | $\text{Bias} = \frac{1}{N} \sum_{i=1}^N e_i$ | Directional skew. Positive bias indicates persistent over-forecasting. |
| **P90 Shortfall Buffer** | $\text{Quantile}_{0.90}(\{S_i\})$ | Volume of thermal backup required to cover 90% of wind drop events. |
| **P95 Stress Buffer** | $\text{Quantile}_{0.95}(\{S_i\})$ | Extreme downside reserve cushion for severe winter anticyclones. |
| **P90 Firm Wind Floor** | $W^{\text{firm}}_{i} = \max(0, \hat{W}_i - \text{P90 Buffer})$ | De-risked baseload wind volume available for forward power commitments. |

---

## 4. Empirical Delivery Performance (January 2026 Window)

Cross-validation of the trading desk across 192 evaluated half-hour settlement periods (Jan 5–8, 2026):

```
Gate Closure Cutoff    MAE (MW)    RMSE (MW)    WAPE (%)    Mean Bias (MW)    P90 Buffer (MW)
---------------------------------------------------------------------------------------------
09:20 UTC (EPEX)       1,686.8      1,997.6      19.0%         +1,027 MW          +3,042 MW
11:00 UTC (Coupled)    1,649.1      2,006.1      18.6%         +1,020 MW          +3,124 MW
15:30 UTC (GB HH)      1,364.3      1,624.3      15.3%           +909 MW          +2,609 MW
```

> **Trading Insight:** Waiting for the `15:30 UTC` gate closure provides fresher atmospheric model ingest, decreasing MAE by **19.1%** and reducing the required thermal backup reserve commitment by **433 MW**.

---

## 5. Local Docker & Cloud Deployment

### 5.1 Quick Start with Docker Compose (Recommended)

Run both the FastAPI backend (`:8000`) and the Vite React frontend (`:5173`) in isolated containers:

```bash
# Clone the repository
git clone <repo-url>
cd wind-procurement

# Build and start services
docker compose up --build
```

The system automatically verifies backend health before spinning up the frontend:
- **Frontend Dashboard:** [http://localhost:5173](http://localhost:5173)
- **FastAPI OpenAPI Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Backend Health Check:** [http://localhost:8000/api/health](http://localhost:8000/api/health)

To stop the containers:
```bash
docker compose down
```

---

### 5.2 Local Manual Development Setup

#### Backend Setup (Python 3.11+)
```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run test suite
pytest test_analytics.py -v

# Start FastAPI server
uvicorn main:app --reload --port 8000
```

#### Frontend Setup (Node.js 18+)
```bash
cd frontend

# Install dependencies
npm install

# Build production distribution
npm run build

# Start Vite development server
npm run dev -- --port 5173
```

---

### 5.3 Cloud Deployments (Heroku & Vercel)

#### Backend Deployment
- **Heroku:** A pre-configured `backend/Procfile` is provided:
  ```
  web: uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
  ```
  Deploy using the Heroku Git or GitHub integration. Set config vars `FRONTEND_ORIGIN` to your frontend production URL.
- **Vercel (Python Serverless):** The `backend/vercel.json` maps incoming requests to `@vercel/python` routing through `main.py`.

#### Frontend Deployment
- **Vercel (React Vite SPA):** `frontend/vercel.json` provides standard rewrite rules redirecting all paths to `index.html` for client-side routing.
  ```json
  {
    "buildCommand": "npm run build",
    "outputDirectory": "dist",
    "framework": "vite",
    "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
  }
  ```
  Set the build environment variable `VITE_API_URL` to your production FastAPI endpoint.

---

## 6. Explicit AI Tools & Workflow Disclosure

In accordance with institutional transparency and AI accountability guidelines:

This software system was researched, designed, scaffolded, tested, and documented using **Google Antigravity** (an advanced multi-agent software engineering environment) powered by **Google Gemini** language models.

### Scope of AI Assistance:
1. **Domain Research & Specification Modeling:** Formulation of the UK energy market settlement rules, Elexon BMRS endpoint contracts (`FUELHH` vs `WINDFOR`), and anti-lookahead bias mathematical boundaries documented in `SPEC.md`.
2. **Multi-Agent Code Scaffolding:** Concurrent synthesis of the asynchronous FastAPI backend data pipeline, pandas analytical routines, and responsive React/Tailwind/Recharts trading UI.
3. **Automated Verification & Test Engineering:** Creation and execution of pytest analytical unit test suites and headless Chromium browser tests (using native Chrome DevTools Protocol over WebSockets) to validate DOM element rendering, chart generation, and gate-closure switching.
4. **DevOps & Production Packaging:** Containerization via multi-stage Docker builds, Nginx reverse-proxy configuration, Heroku/Vercel platform configurations, and documentation authoring.

All mathematical formulas, risk logic, and architectural designs have been verified against Elexon BMRS market standards.

---

## 7. License & Credits

- **Data Provider:** [Elexon BMRS (Balancing Mechanism Reporting Service)](https://data.elexon.co.uk/bmrs/api/v1)
- **Specification:** Strictly conforms to `SPEC.md`
- **License:** MIT License
