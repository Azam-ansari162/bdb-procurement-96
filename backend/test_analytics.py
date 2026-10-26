"""
Unit tests for UK Wind Procurement Quantitative Analytics Engine.

Verifies:
  1. Strict Look-Ahead Bias Prevention (Mode A gate closure deadline).
  2. Fixed-Horizon Constraint (Mode B min_horizon_hours).
  3. P90/P95 Shortfall Buffer and Firm Wind Calculation.
  4. 30-minute Linear Interpolation vs Hourly-only alignment.
  5. Horizon Degradation Profile calculation.
"""

from datetime import datetime, timezone
import numpy as np
import pandas as pd
import pytest

from analytics import (
    compute_horizon_profile,
    compute_kpis,
    format_timeseries,
    match_point_in_time_forecasts,
)


def _dt(iso_str: str) -> pd.Timestamp:
    return pd.to_datetime(iso_str, utc=True)


@pytest.fixture
def sample_forecasts():
    """
    Synthetic forecast dataset for delivery day 2026-01-05.
    Cutoff for Coupled DA (11:00) is 2026-01-04T11:00:00Z.
    """
    records = [
        # Delivery 14:00 on Jan 5
        # 1. Very early forecast (Jan 3 12:00)
        {"startTime": "2026-01-05T14:00:00Z", "publishTime": "2026-01-03T12:00:00Z", "forecast_mw": 8000.0},
        # 2. Valid D-1 forecast before 11:00 (Jan 4 10:30) - THIS SHOULD BE SELECTED
        {"startTime": "2026-01-05T14:00:00Z", "publishTime": "2026-01-04T10:30:00Z", "forecast_mw": 8500.0},
        # 3. Look-ahead forecast after 11:00 (Jan 4 11:05) - MUST BE REJECTED
        {"startTime": "2026-01-05T14:00:00Z", "publishTime": "2026-01-04T11:05:00Z", "forecast_mw": 9999.0},
        # 4. Intraday forecast on delivery day (Jan 5 08:00) - MUST BE REJECTED
        {"startTime": "2026-01-05T14:00:00Z", "publishTime": "2026-01-05T08:00:00Z", "forecast_mw": 11000.0},

        # Delivery 15:00 on Jan 5
        {"startTime": "2026-01-05T15:00:00Z", "publishTime": "2026-01-04T10:30:00Z", "forecast_mw": 9500.0},
        {"startTime": "2026-01-05T15:00:00Z", "publishTime": "2026-01-04T13:00:00Z", "forecast_mw": 12000.0},
    ]
    df = pd.DataFrame(records)
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    df["publishTime"] = pd.to_datetime(df["publishTime"], utc=True)
    return df


@pytest.fixture
def sample_actuals():
    """Actual generation for 2026-01-05."""
    records = [
        {"startTime": "2026-01-05T14:00:00Z", "actual_mw": 8200.0},
        {"startTime": "2026-01-05T14:30:00Z", "actual_mw": 8700.0},
        {"startTime": "2026-01-05T15:00:00Z", "actual_mw": 9100.0},
    ]
    df = pd.DataFrame(records)
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    return df


def test_no_look_ahead_bias_mode_a(sample_actuals, sample_forecasts):
    """
    CRITICAL TEST: Verify that publishTime is strictly <= D-1 decision deadline.
    For delivery on 2026-01-05 and cutoff 11:00:
    Decision deadline is 2026-01-04T11:00:00Z.
    The forecast published at 11:05 must NEVER be chosen.
    """
    matched_df, _, timeseries, _ = match_point_in_time_forecasts(
        actuals_df=sample_actuals,
        forecasts_df=sample_forecasts,
        start_date="2026-01-05",
        end_date="2026-01-05",
        mode="gate_closure",
        decision_cutoff_time="11:00",
        interpolate_half_hourly=True,
    )

    # Check 14:00 row
    row_14 = matched_df[matched_df["startTime"] == _dt("2026-01-05T14:00:00Z")].iloc[0]
    deadline_14 = _dt("2026-01-04T11:00:00Z")

    assert row_14["publishTime"] <= deadline_14, (
        f"Look-ahead bias detected! publishTime {row_14['publishTime']} > deadline {deadline_14}"
    )
    # Must pick the freshest valid forecast (10:30, 8500 MW), not the 11:05 (9999 MW)
    assert row_14["forecast_mw"] == 8500.0
    assert row_14["publishTime"] == _dt("2026-01-04T10:30:00Z")


def test_various_cutoffs_no_look_ahead():
    """Test EPEX DA (09:20), Coupled DA (11:00), and GB HH DA (15:30)."""
    forecasts = pd.DataFrame([
        {"startTime": "2026-01-06T10:00:00Z", "publishTime": "2026-01-05T09:00:00Z", "forecast_mw": 5000.0},
        {"startTime": "2026-01-06T10:00:00Z", "publishTime": "2026-01-05T10:00:00Z", "forecast_mw": 6000.0},
        {"startTime": "2026-01-06T10:00:00Z", "publishTime": "2026-01-05T14:00:00Z", "forecast_mw": 7000.0},
        {"startTime": "2026-01-06T10:00:00Z", "publishTime": "2026-01-05T16:00:00Z", "forecast_mw": 8000.0},
    ])
    actuals = pd.DataFrame([
        {"startTime": "2026-01-06T10:00:00Z", "actual_mw": 5500.0},
    ])

    target_time = _dt("2026-01-06T10:00:00Z")

    # 1. Cutoff 09:20 -> only 09:00 is valid (5000 MW)
    m_df, _, _, _ = match_point_in_time_forecasts(
        actuals, forecasts, start_date="2026-01-06", end_date="2026-01-06",
        mode="gate_closure", decision_cutoff_time="09:20", interpolate_half_hourly=False
    )
    row = m_df[m_df["startTime"] == target_time].iloc[0]
    assert row["forecast_mw"] == 5000.0
    assert row["publishTime"] == _dt("2026-01-05T09:00:00Z")

    # 2. Cutoff 11:00 -> 10:00 is valid (6000 MW)
    m_df, _, _, _ = match_point_in_time_forecasts(
        actuals, forecasts, start_date="2026-01-06", end_date="2026-01-06",
        mode="gate_closure", decision_cutoff_time="11:00", interpolate_half_hourly=False
    )
    row = m_df[m_df["startTime"] == target_time].iloc[0]
    assert row["forecast_mw"] == 6000.0
    assert row["publishTime"] == _dt("2026-01-05T10:00:00Z")

    # 3. Cutoff 15:30 -> 14:00 is valid (7000 MW), 16:00 is rejected
    m_df, _, _, _ = match_point_in_time_forecasts(
        actuals, forecasts, start_date="2026-01-06", end_date="2026-01-06",
        mode="gate_closure", decision_cutoff_time="15:30", interpolate_half_hourly=False
    )
    row = m_df[m_df["startTime"] == target_time].iloc[0]
    assert row["forecast_mw"] == 7000.0
    assert row["publishTime"] == _dt("2026-01-05T14:00:00Z")


def test_linear_interpolation(sample_actuals, sample_forecasts):
    """
    Test 30-min linear interpolation:
    14:00 matched forecast is 8500 MW.
    15:00 matched forecast is 9500 MW.
    Interpolated 14:30 forecast must be (8500 + 9500) / 2 = 9000 MW.
    """
    matched_df, _, _, _ = match_point_in_time_forecasts(
        actuals_df=sample_actuals,
        forecasts_df=sample_forecasts,
        start_date="2026-01-05",
        end_date="2026-01-05",
        mode="gate_closure",
        decision_cutoff_time="11:00",
        interpolate_half_hourly=True,
    )

    row_1430 = matched_df[matched_df["startTime"] == _dt("2026-01-05T14:30:00Z")].iloc[0]
    assert row_1430["forecast_mw"] == 9000.0
    assert row_1430["actual_mw"] == 8700.0
    # error = forecast - actual = 9000 - 8700 = 300
    assert row_1430["error_mw"] == 300.0
    assert row_1430["shortfall_mw"] == 300.0


def test_interpolate_half_hourly_false(sample_actuals, sample_forecasts):
    """When interpolate_half_hourly is False, drop all :30 rows."""
    matched_df, _, _, _ = match_point_in_time_forecasts(
        actuals_df=sample_actuals,
        forecasts_df=sample_forecasts,
        start_date="2026-01-05",
        end_date="2026-01-05",
        mode="gate_closure",
        decision_cutoff_time="11:00",
        interpolate_half_hourly=False,
    )
    minutes = matched_df["startTime"].dt.minute.unique()
    assert list(minutes) == [0]


def test_mode_b_fixed_horizon():
    """Verify Mode B respects min_horizon_hours."""
    target_time = _dt("2026-01-05T20:00:00Z")
    forecasts = pd.DataFrame([
        # Lead time = 10h (too short for 14h horizon)
        {"startTime": "2026-01-05T20:00:00Z", "publishTime": "2026-01-05T10:00:00Z", "forecast_mw": 5000.0},
        # Lead time = 15h (valid for 14h horizon)
        {"startTime": "2026-01-05T20:00:00Z", "publishTime": "2026-01-05T05:00:00Z", "forecast_mw": 4800.0},
        # Lead time = 24h (valid but older)
        {"startTime": "2026-01-05T20:00:00Z", "publishTime": "2026-01-04T20:00:00Z", "forecast_mw": 4000.0},
    ])
    actuals = pd.DataFrame([
        {"startTime": "2026-01-05T20:00:00Z", "actual_mw": 4500.0},
    ])

    matched_df, _, _, _ = match_point_in_time_forecasts(
        actuals, forecasts, start_date="2026-01-05", end_date="2026-01-05",
        mode="horizon", min_horizon_hours=14.0, interpolate_half_hourly=False
    )
    row = matched_df[matched_df["startTime"] == target_time].iloc[0]
    # Freshest forecast with lead >= 14h is 2026-01-05T05:00:00Z (lead 15h, 4800 MW)
    assert row["forecast_mw"] == 4800.0
    assert row["horizon_hours"] == 15.0


def test_p90_shortfall_buffer_and_kpis():
    """
    Verify P90 and P95 shortfall calculation on synthetic data.
    """
    # 10 data points with shortfalls 0, 10, 20, 30, 40, 50, 60, 70, 80, 90
    shortfalls = [0.0, 10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0]
    errors = shortfalls  # all positive for this test
    actuals = [100.0] * 10

    df = pd.DataFrame({
        "error_mw": errors,
        "shortfall_mw": shortfalls,
        "actual_mw": actuals,
    })

    kpis = compute_kpis(df)

    expected_p90 = round(float(np.percentile(shortfalls, 90)), 1)
    expected_p95 = round(float(np.percentile(shortfalls, 95)), 1)

    assert kpis["p90_shortfall_buffer_mw"] == expected_p90
    assert kpis["p95_shortfall_buffer_mw"] == expected_p95
    assert kpis["sample_count"] == 10
    assert kpis["mae_mw"] == round(float(np.mean(errors)), 1)
    assert kpis["rmse_mw"] == round(float(np.sqrt(np.mean(np.array(errors) ** 2))), 1)


def test_firm_wind_p90():
    """Verify firm_wind_p90_mw = max(0, forecast_mw - p90_buffer)."""
    t12 = _dt("2026-01-05T12:00:00Z")
    t13 = _dt("2026-01-05T13:00:00Z")

    forecasts = pd.DataFrame([
        {"startTime": "2026-01-05T12:00:00Z", "publishTime": "2026-01-04T10:00:00Z", "forecast_mw": 1000.0},
        {"startTime": "2026-01-05T13:00:00Z", "publishTime": "2026-01-04T10:00:00Z", "forecast_mw": 100.0},
    ])
    actuals = pd.DataFrame([
        {"startTime": "2026-01-05T12:00:00Z", "actual_mw": 800.0},  # shortfall = 200
        {"startTime": "2026-01-05T13:00:00Z", "actual_mw": 150.0},  # shortfall = 0
    ])

    matched_df, kpis, timeseries, _ = match_point_in_time_forecasts(
        actuals, forecasts, start_date="2026-01-05", end_date="2026-01-05",
        mode="gate_closure", decision_cutoff_time="11:00", interpolate_half_hourly=False
    )
    p90 = kpis["p90_shortfall_buffer_mw"]

    row0 = matched_df[matched_df["startTime"] == t12].iloc[0]
    assert row0["firm_wind_p90_mw"] == max(0.0, row0["forecast_mw"] - p90)

    row1 = matched_df[matched_df["startTime"] == t13].iloc[0]
    assert row1["firm_wind_p90_mw"] == max(0.0, row1["forecast_mw"] - p90)


def test_horizon_profile_buckets():
    """Verify horizon degradation buckets calculation."""
    df = pd.DataFrame({
        "horizon_hours": [3.0, 8.0, 15.0, 20.0, 30.0, 40.0],
        "error_mw": [10.0, 20.0, 30.0, 40.0, 50.0, 60.0],
    })
    profile = compute_horizon_profile(df)
    bucket_names = [p["bucket"] for p in profile]

    expected = ["0-6h", "6-12h", "12-18h (15:30 DA)", "18-24h (11:00 DA)", "24-36h", "36-48h"]
    assert bucket_names == expected
    for item in profile:
        assert item["mae_mw"] > 0
        assert item["rmse_mw"] >= item["mae_mw"]

