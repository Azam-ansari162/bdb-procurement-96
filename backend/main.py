"""
FastAPI application for UK Wholesale Energy Day-Ahead Wind Procurement.

Endpoints:
  - GET /api/health: Health check endpoint
  - GET /api/day-ahead-analysis: Main analysis query endpoint implementing SPEC.md contract
"""

import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from analytics import match_point_in_time_forecasts
from elexon_client import ElexonAPIError, fetch_fuelhh_actuals, fetch_windfor_forecasts, preload_cache_if_needed

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("wind_procurement")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")


# --- Lifespan Manager for Pre-warming Data ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting UK Wind Procurement Backend...")
    try:
        # Preload data into cache for instant <20ms responses
        await preload_cache_if_needed()
    except Exception as exc:
        logger.warning(f"Initial cache warm-up notice: {exc}")
    yield
    logger.info("Shutting down UK Wind Procurement Backend.")


app = FastAPI(
    title="UK Wind Day-Ahead Procurement API",
    description="Trading Desk Decision Support System for January 2026",
    version="1.0.0",
    lifespan=lifespan,
)

# --- CORS Middleware ---

# Deduplicate origins
# --- CORS Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Custom Exception Handlers for SPEC.md Compliance ---
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )


@app.exception_handler(ElexonAPIError)
async def elexon_error_handler(request: Request, exc: ElexonAPIError):
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content={"error": f"Upstream Elexon API error: {str(exc)}"},
    )


# --- Pydantic Response Models ---
class KpiModel(BaseModel):
    mae_mw: float = Field(..., description="Mean Absolute Error in MW")
    rmse_mw: float = Field(..., description="Root Mean Squared Error in MW")
    mape_pct: float = Field(..., description="Mean Absolute Percentage Error (%)")
    wape_pct: float = Field(..., description="Weighted Absolute Percentage Error (%)")
    mean_bias_mw: float = Field(..., description="Mean signed error (positive = over-forecast)")
    p90_shortfall_buffer_mw: float = Field(..., description="90th percentile shortfall buffer in MW")
    p95_shortfall_buffer_mw: float = Field(..., description="95th percentile shortfall buffer in MW")
    sample_count: int = Field(..., description="Number of evaluated half-hour settlement periods")


class TimeseriesItem(BaseModel):
    startTime: str = Field(..., description="ISO-8601 UTC delivery half-hour start")
    publishTime: Optional[str] = Field(None, description="ISO-8601 UTC forecast publication time")
    actual_mw: Optional[float] = Field(None, description="Actual metered wind generation")
    forecast_mw: Optional[float] = Field(None, description="Matched wind forecast")
    firm_wind_p90_mw: Optional[float] = Field(None, description="Firm wind estimate (P90 protected)")
    error_mw: Optional[float] = Field(None, description="Forecast error (forecast - actual)")
    shortfall_mw: Optional[float] = Field(None, description="Shortfall (max(0, error))")
    horizon_hours: Optional[float] = Field(None, description="Forecast lead time in decimal hours")


class HorizonProfileItem(BaseModel):
    bucket: str = Field(..., description="Horizon lead-time bucket")
    mae_mw: float = Field(..., description="MAE within lead bucket")
    rmse_mw: float = Field(..., description="RMSE within lead bucket")


class AnalysisResponse(BaseModel):
    kpis: KpiModel
    timeseries: List[TimeseriesItem]
    horizon_profile: List[HorizonProfileItem]


# --- Health Check Endpoint ---
@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "service": "UK Wind Procurement Analytics API",
        "timestamp": datetime.now().isoformat(),
    }


# --- Day-Ahead Analysis Endpoint ---
@app.get("/api/day-ahead-analysis", response_model=AnalysisResponse)
async def get_day_ahead_analysis(
    start_date: str = Query(
        "2026-01-05",
        description="First delivery date (inclusive, YYYY-MM-DD)",
        example="2026-01-05",
    ),
    end_date: str = Query(
        "2026-01-08",
        description="Last delivery date (inclusive, YYYY-MM-DD)",
        example="2026-01-08",
    ),
    mode: str = Query(
        "gate_closure",
        description="Forecast matching mode ('gate_closure' or 'horizon')",
        example="gate_closure",
    ),
    decision_cutoff_time: str = Query(
        "11:00",
        description="D-1 Gate closure cutoff time in UTC ('09:20', '11:00', '15:30')",
        example="11:00",
    ),
    min_horizon_hours: float = Query(
        14.0,
        description="Minimum horizon in decimal hours when mode='horizon'",
        example=14.0,
    ),
    interpolate_half_hourly: bool = Query(
        True,
        description="If True, interpolate forecasts to 30-min settlement periods; if False, return hourly only",
    ),
):
    """
    Day-Ahead Wind Forecast Residual & Shortfall Risk Analysis.
    Conforms strictly to SPEC.md Section 7.
    """
    # 1. Parameter Validation
    date_regex = r"^\d{4}-\d{2}-\d{2}$"
    if not re.match(date_regex, start_date):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid start_date '{start_date}'. Must be in YYYY-MM-DD format.",
        )
    if not re.match(date_regex, end_date):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid end_date '{end_date}'. Must be in YYYY-MM-DD format.",
        )

    try:
        dt_start = datetime.strptime(start_date, "%Y-%m-%d").date()
        dt_end = datetime.strptime(end_date, "%Y-%m-%d").date()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if dt_start > dt_end:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"start_date '{start_date}' cannot be after end_date '{end_date}'.",
        )

    if mode not in ("gate_closure", "horizon"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid mode '{mode}'. Must be 'gate_closure' or 'horizon'.",
        )

    time_regex = r"^\d{2}:\d{2}$"
    if not re.match(time_regex, decision_cutoff_time):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid decision_cutoff_time '{decision_cutoff_time}'. Must be HH:MM.",
        )

    # 2. Fetch or load cached actuals and forecasts
    try:
        actuals_df = await fetch_fuelhh_actuals()
        forecasts_df = await fetch_windfor_forecasts()
    except ElexonAPIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Upstream Elexon API error: {str(exc)}",
        )
    except Exception as exc:
        logger.exception("Unexpected error fetching Elexon datasets")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(exc)}",
        )

    # 3. Execute Point-in-Time Matching and Analytics
    try:
        _, kpis, timeseries, horizon_profile = match_point_in_time_forecasts(
            actuals_df=actuals_df,
            forecasts_df=forecasts_df,
            start_date=start_date,
            end_date=end_date,
            mode=mode,
            decision_cutoff_time=decision_cutoff_time,
            min_horizon_hours=min_horizon_hours,
            interpolate_half_hourly=interpolate_half_hourly,
        )

        return {
            "kpis": kpis,
            "timeseries": timeseries,
            "horizon_profile": horizon_profile,
        }
    except Exception as exc:
        logger.exception("Analytics processing error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error processing analysis: {str(exc)}",
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
