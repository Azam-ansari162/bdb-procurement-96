"""
Quantitative Analytics Engine for UK Day-Ahead Wind Procurement.

Implements:
  1. Point-in-Time D-1 Gate Closure Matching (Mode A) — strict look-ahead bias prevention.
  2. Fixed-Horizon Matching (Mode B) — minimum lead-time filter.
  3. Granularity Alignment & 30-Minute Linear Interpolation.
  4. Trading Desk KPIs: MAE, RMSE, MAPE, WAPE, Mean Bias, P90/P95 Shortfall Buffers.
  5. Horizon Degradation Profile across standard lead-time buckets:
     - 0-6h
     - 6-12h
     - 12-18h (15:30 DA)
     - 18-24h (11:00 DA)
     - 24-36h
     - 36-48h
     - 48h+ (if present)
"""

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

# Standard horizon degradation buckets per SPEC.md Section 6.4 & user specification
HORIZON_BUCKETS = [
    ("0-6h", 0.0, 6.0),
    ("6-12h", 6.0, 12.0),
    ("12-18h (15:30 DA)", 12.0, 18.0),
    ("18-24h (11:00 DA)", 18.0, 24.0),
    ("24-36h", 24.0, 36.0),
    ("36-48h", 36.0, 48.0),
    ("48h+", 48.0, float("inf")),
]


def match_point_in_time_forecasts(
    actuals_df: pd.DataFrame,
    forecasts_df: pd.DataFrame,
    start_date: str = "2026-01-05",
    end_date: str = "2026-01-08",
    mode: str = "gate_closure",
    decision_cutoff_time: str = "11:00",
    min_horizon_hours: float = 14.0,
    interpolate_half_hourly: bool = True,
) -> Tuple[pd.DataFrame, Dict[str, Any], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Execute end-to-end point-in-time matching, interpolation, KPI calculations,
    and horizon degradation analysis.
    
    Guarantees zero look-ahead bias:
      - In Mode A: For any delivery period on delivery day D, only forecasts published
        on or before (floor_day(D) - 1 day + decision_cutoff_time) are considered.
      - In Mode B: For any delivery period, (startTime - publishTime) >= min_horizon_hours.
    """
    # 1. Parse date bounds
    start_dt = pd.to_datetime(f"{start_date}T00:00:00Z", utc=True)
    end_dt = pd.to_datetime(f"{end_date}T23:30:00Z", utc=True)

    # 2. Build delivery days list
    delivery_days = pd.date_range(
        start=start_dt.floor("D"),
        end=end_dt.floor("D"),
        freq="1D",
        tz=timezone.utc,
    )

    fc = forecasts_df.copy()
    if not fc.empty:
        fc["startTime"] = pd.to_datetime(fc["startTime"], utc=True)
        fc["publishTime"] = pd.to_datetime(fc["publishTime"], utc=True)
        fc["forecast_mw"] = pd.to_numeric(fc["forecast_mw"], errors="coerce")
        fc = fc.dropna(subset=["startTime", "publishTime", "forecast_mw"])
    else:
        fc = pd.DataFrame(columns=["startTime", "publishTime", "forecast_mw"])

    cutoff_h, cutoff_m = map(int, decision_cutoff_time.split(":"))

    # Matched results by half-hour slot
    matched_slots: List[Dict[str, Any]] = []

    for day in delivery_days:
        day_start = day
        day_end = day + pd.Timedelta(hours=23, minutes=30)
        day_30m_grid = pd.date_range(day_start, day_end, freq="30min", tz=timezone.utc)

        # Bounding hourly targets for day D include D 00:00 to (D+1) 00:00 (25 targets)
        hourly_targets = pd.date_range(day, day + pd.Timedelta(days=1), freq="1h", tz=timezone.utc)

        day_fc_map: Dict[pd.Timestamp, Tuple[float, pd.Timestamp]] = {}

        if not fc.empty:
            if mode == "gate_closure":
                # Decision deadline for delivery day D is strictly D - 1 day + cutoff
                decision_deadline = (
                    day - pd.Timedelta(days=1) + pd.Timedelta(hours=cutoff_h, minutes=cutoff_m)
                )

                # Filter: target must be one of the hourly targets for day D,
                # AND publishTime must be <= decision_deadline
                valid = fc[
                    fc["startTime"].isin(hourly_targets)
                    & (fc["publishTime"] <= decision_deadline)
                ]

                if not valid.empty:
                    # Pick max(publishTime) for each target delivery hour
                    best = (
                        valid.sort_values(["startTime", "publishTime"])
                        .groupby("startTime")
                        .last()
                        .reset_index()
                    )
                    for _, r in best.iterrows():
                        day_fc_map[r["startTime"]] = (float(r["forecast_mw"]), r["publishTime"])

            elif mode == "horizon":
                # Mode B: Fixed horizon matching
                # For each hourly target t, (t - publishTime) >= min_horizon_hours
                valid = fc[fc["startTime"].isin(hourly_targets)].copy()
                lead_h = (valid["startTime"] - valid["publishTime"]).dt.total_seconds() / 3600.0
                valid = valid[lead_h >= min_horizon_hours]

                if not valid.empty:
                    best = (
                        valid.sort_values(["startTime", "publishTime"])
                        .groupby("startTime")
                        .last()
                        .reset_index()
                    )
                    for _, r in best.iterrows():
                        day_fc_map[r["startTime"]] = (float(r["forecast_mw"]), r["publishTime"])
            else:
                raise ValueError(f"Unknown mode: {mode}. Must be 'gate_closure' or 'horizon'.")

        # Now evaluate each 30-min slot on delivery day D
        for slot in day_30m_grid:
            is_half_hour = slot.minute == 30

            if not is_half_hour:
                # :00 slot — direct match
                if slot in day_fc_map:
                    f_mw, p_time = day_fc_map[slot]
                    matched_slots.append(
                        {"startTime": slot, "publishTime": p_time, "forecast_mw": f_mw}
                    )
                else:
                    matched_slots.append(
                        {"startTime": slot, "publishTime": None, "forecast_mw": np.nan}
                    )
            else:
                # :30 slot
                if not interpolate_half_hourly:
                    continue  # Drop all :30 slots if interpolate_half_hourly is False

                prev_h = slot - pd.Timedelta(minutes=30)
                next_h = slot + pd.Timedelta(minutes=30)

                if prev_h in day_fc_map and next_h in day_fc_map:
                    f_prev, p_prev = day_fc_map[prev_h]
                    f_next, p_next = day_fc_map[next_h]

                    interpolated_fc = (f_prev + f_next) / 2.0
                    interpolated_pub = max(p_prev, p_next)

                    # In Mode B, verify interpolated horizon lead
                    if mode == "horizon":
                        slot_lead = (slot - interpolated_pub).total_seconds() / 3600.0
                        if slot_lead < min_horizon_hours:
                            matched_slots.append(
                                {"startTime": slot, "publishTime": None, "forecast_mw": np.nan}
                            )
                            continue

                    matched_slots.append(
                        {
                            "startTime": slot,
                            "publishTime": interpolated_pub,
                            "forecast_mw": interpolated_fc,
                        }
                    )
                else:
                    matched_slots.append(
                        {"startTime": slot, "publishTime": None, "forecast_mw": np.nan}
                    )

    master_df = pd.DataFrame(matched_slots)
    if master_df.empty:
        master_df = pd.DataFrame(columns=["startTime", "publishTime", "forecast_mw"])

    # 3. Join Actuals onto Master Grid
    if not actuals_df.empty:
        act = actuals_df.copy()
        act["startTime"] = pd.to_datetime(act["startTime"], utc=True)
        act["actual_mw"] = pd.to_numeric(act["actual_mw"], errors="coerce")
        master_df = pd.merge(
            master_df, act[["startTime", "actual_mw"]], on="startTime", how="left"
        )
    else:
        master_df["actual_mw"] = np.nan

    # 4. Restrict to Requested Date Window [start_dt, end_dt]
    master_df = master_df[
        (master_df["startTime"] >= start_dt) & (master_df["startTime"] <= end_dt)
    ].sort_values("startTime").reset_index(drop=True)

    # 5. Compute Per-Row Residuals & Horizon Lead
    valid_mask = master_df["forecast_mw"].notna() & master_df["actual_mw"].notna()

    master_df["error_mw"] = np.nan
    master_df["shortfall_mw"] = np.nan
    master_df["horizon_hours"] = np.nan

    if valid_mask.any():
        errors = master_df.loc[valid_mask, "forecast_mw"] - master_df.loc[valid_mask, "actual_mw"]
        master_df.loc[valid_mask, "error_mw"] = errors
        master_df.loc[valid_mask, "shortfall_mw"] = np.maximum(0.0, errors)

        lead_delta = (
            master_df.loc[valid_mask, "startTime"]
            - pd.to_datetime(master_df.loc[valid_mask, "publishTime"], utc=True)
        )
        master_df.loc[valid_mask, "horizon_hours"] = lead_delta.dt.total_seconds() / 3600.0

    # 6. Compute Aggregate KPIs
    kpis = compute_kpis(master_df.loc[valid_mask])

    # 7. Compute Firm Wind Estimate
    p90_buffer = kpis["p90_shortfall_buffer_mw"]
    master_df["firm_wind_p90_mw"] = np.nan
    fc_notna = master_df["forecast_mw"].notna()
    if fc_notna.any():
        master_df.loc[fc_notna, "firm_wind_p90_mw"] = np.maximum(
            0.0, master_df.loc[fc_notna, "forecast_mw"] - p90_buffer
        )

    # 8. Compute Horizon Degradation Profile
    horizon_profile = compute_horizon_profile(master_df.loc[valid_mask])

    # 9. Format Timeseries Records conforming strictly to JSON contract
    timeseries = format_timeseries(master_df)

    return master_df, kpis, timeseries, horizon_profile


def compute_kpis(valid_df: pd.DataFrame) -> Dict[str, Any]:
    """
    Compute trading desk KPIs conforming to SPEC.md Section 6.2:
      - mae_mw: mean(abs(error_mw))
      - rmse_mw: sqrt(mean(error_mw^2))
      - mape_pct: 100 * mean(abs(error_mw) / actual_mw) skipping actual_mw == 0
      - wape_pct: 100 * sum(abs(error_mw)) / sum(actual_mw)
      - mean_bias_mw: mean(error_mw)
      - p90_shortfall_buffer_mw: 90th percentile of shortfall_mw
      - p95_shortfall_buffer_mw: 95th percentile of shortfall_mw
      - sample_count: number of valid evaluated intervals
    """
    sample_count = len(valid_df)
    if sample_count == 0:
        return {
            "mae_mw": 0.0,
            "rmse_mw": 0.0,
            "mape_pct": 0.0,
            "wape_pct": 0.0,
            "mean_bias_mw": 0.0,
            "p90_shortfall_buffer_mw": 0.0,
            "p95_shortfall_buffer_mw": 0.0,
            "sample_count": 0,
        }

    errors = valid_df["error_mw"].values
    shortfalls = valid_df["shortfall_mw"].values
    actuals = valid_df["actual_mw"].values

    mae = float(np.mean(np.abs(errors)))
    rmse = float(np.sqrt(np.mean(errors ** 2)))

    # MAPE: skip actual_mw == 0 to avoid division by zero
    non_zero_act = actuals != 0
    if np.any(non_zero_act):
        mape = float(100.0 * np.mean(np.abs(errors[non_zero_act]) / actuals[non_zero_act]))
    else:
        mape = 0.0

    # WAPE: 100 * sum(abs(error)) / sum(actual)
    sum_act = float(np.sum(actuals))
    if sum_act > 0:
        wape = float(100.0 * np.sum(np.abs(errors)) / sum_act)
    else:
        wape = 0.0

    mean_bias = float(np.mean(errors))
    p90 = float(np.percentile(shortfalls, 90))
    p95 = float(np.percentile(shortfalls, 95))

    return {
        "mae_mw": round(mae, 1),
        "rmse_mw": round(rmse, 1),
        "mape_pct": round(mape, 1),
        "wape_pct": round(wape, 1),
        "mean_bias_mw": round(mean_bias, 1),
        "p90_shortfall_buffer_mw": round(p90, 1),
        "p95_shortfall_buffer_mw": round(p95, 1),
        "sample_count": sample_count,
    }


def compute_horizon_profile(valid_df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Compute Horizon Degradation Profile across standard lead-time buckets.
    Only non-empty buckets are returned, sorted in ascending lead-time order.
    """
    if valid_df.empty or "horizon_hours" not in valid_df:
        return []

    profile = []
    for label, min_h, max_h in HORIZON_BUCKETS:
        if max_h == float("inf"):
            bucket_rows = valid_df[valid_df["horizon_hours"] >= min_h]
        else:
            bucket_rows = valid_df[
                (valid_df["horizon_hours"] >= min_h) & (valid_df["horizon_hours"] < max_h)
            ]

        if not bucket_rows.empty:
            errors = bucket_rows["error_mw"].values
            mae = float(np.mean(np.abs(errors)))
            rmse = float(np.sqrt(np.mean(errors ** 2)))
            profile.append(
                {
                    "bucket": label,
                    "mae_mw": round(mae, 1),
                    "rmse_mw": round(rmse, 1),
                }
            )

    return profile


def format_timeseries(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Format rows into the exact JSON contract of SPEC.md Section 7.2:
      - All numbers rounded to 1 decimal place.
      - Missing values encoded as None (JSON null), never NaN.
      - ISO-8601 UTC strings ending with 'Z'.
    """
    records = []
    for _, row in df.iterrows():
        st = row["startTime"]
        st_str = st.strftime("%Y-%m-%dT%H:%M:%SZ") if pd.notna(st) else None

        pub = row.get("publishTime")
        if pub is not None and pd.notna(pub):
            pub_dt = pd.to_datetime(pub, utc=True)
            pub_str = pub_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        else:
            pub_str = None

        def _val(col: str) -> Optional[float]:
            v = row.get(col)
            if v is None or pd.isna(v) or math.isnan(float(v)):
                return None
            return round(float(v), 1)

        records.append(
            {
                "startTime": st_str,
                "publishTime": pub_str,
                "actual_mw": _val("actual_mw"),
                "forecast_mw": _val("forecast_mw"),
                "firm_wind_p90_mw": _val("firm_wind_p90_mw"),
                "error_mw": _val("error_mw"),
                "shortfall_mw": _val("shortfall_mw"),
                "horizon_hours": _val("horizon_hours"),
            }
        )

    return records

