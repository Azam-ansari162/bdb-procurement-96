"""
Elexon BMRS API Client for UK Wind Procurement.

Fetches:
  1. Actual wind generation from FUELHH/stream (settlement periods, 30-min).
  2. Wind forecasts from WINDFOR/stream (hourly forecasts, chunked in 7-day intervals).

Includes:
  - Concurrent async chunk fetching with httpx.
  - Automatic retry with exponential backoff on 429 / 5xx / timeouts.
  - Two-tier caching (in-memory + disk in backend/cache/) ensuring sub-20ms queries.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pandas as pd

logger = logging.getLogger(__name__)

ELEXON_BASE_URL = os.getenv("ELEXON_BASE_URL", "https://data.elexon.co.uk/bmrs/api/v1")
CACHE_DIR = Path(__file__).parent / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# File cache paths
ACTUALS_CACHE_FILE = CACHE_DIR / "fuelhh_wind_actuals_jan2026.json"
FORECASTS_CACHE_FILE = CACHE_DIR / "windfor_forecasts_jan2026.json"

# In-memory cached DataFrames for microsecond response times
_memory_cache: Dict[str, pd.DataFrame] = {}


class ElexonAPIError(Exception):
    """Raised when Elexon API requests fail after all retries."""
    pass


def _parse_stream_response(text: str) -> List[Dict[str, Any]]:
    """Parse JSON array or newline-delimited JSON (NDJSON)."""
    text = text.strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

    records = []
    for line in text.split("\n"):
        line = line.strip()
        if line:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


async def _fetch_with_retry(
    client: httpx.AsyncClient,
    url: str,
    params: Dict[str, Any],
    retries: int = 3,
    backoff_factor: float = 1.0,
) -> List[Dict[str, Any]]:
    """Fetch endpoint with exponential backoff retry for 429/5xx and network errors."""
    headers = {"Accept": "application/json"}
    last_error: Optional[Exception] = None

    for attempt in range(1, retries + 1):
        try:
            resp = await client.get(url, params=params, headers=headers, timeout=60.0)
            if resp.status_code == 200:
                return _parse_stream_response(resp.text)
            elif resp.status_code in (429, 500, 502, 503, 504):
                last_error = ElexonAPIError(
                    f"Elexon API returned HTTP {resp.status_code}: {resp.text[:200]}"
                )
                logger.warning(
                    f"Attempt {attempt}/{retries} failed for {url} ({resp.status_code}). Retrying..."
                )
            else:
                resp.raise_for_status()
        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            last_error = ElexonAPIError(f"HTTP request failed: {exc}")
            logger.warning(f"Attempt {attempt}/{retries} network error: {exc}. Retrying...")

        if attempt < retries:
            await asyncio.sleep(backoff_factor * (2 ** (attempt - 1)))

    raise last_error or ElexonAPIError(f"Failed to fetch {url} after {retries} retries.")


async def fetch_fuelhh_actuals(
    start_date: str = "2026-01-01",
    end_date: str = "2026-02-01",
    use_cache: bool = True,
) -> pd.DataFrame:
    """
    Fetch FUELHH actual wind generation from Elexon BMRS.
    
    Endpoint: datasets/FUELHH/stream
    Params: settlementDateFrom, settlementDateTo, fuelType=WIND
    Resolution: 30 minutes
    """
    cache_key = f"actuals_{start_date}_{end_date}"

    # 1. In-memory cache hit
    if use_cache and cache_key in _memory_cache:
        return _memory_cache[cache_key].copy()

    # 2. Disk cache hit
    if use_cache and ACTUALS_CACHE_FILE.exists():
        try:
            with open(ACTUALS_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            df = _process_actuals_data(data)
            _memory_cache[cache_key] = df
            return df.copy()
        except Exception as exc:
            logger.warning(f"Failed reading actuals disk cache: {exc}")

    # 3. Live network fetch
    url = f"{ELEXON_BASE_URL}/datasets/FUELHH/stream"
    params = {
        "settlementDateFrom": start_date,
        "settlementDateTo": end_date,
        "fuelType": "WIND",
    }

    async with httpx.AsyncClient() as client:
        records = await _fetch_with_retry(client, url, params)

    if not records:
        raise ElexonAPIError("Elexon returned empty FUELHH data for the requested period.")

    # Write disk cache
    try:
        with open(ACTUALS_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(records, f)
    except Exception as exc:
        logger.warning(f"Failed writing actuals disk cache: {exc}")

    df = _process_actuals_data(records)
    _memory_cache[cache_key] = df
    return df.copy()


def _process_actuals_data(records: List[Dict[str, Any]]) -> pd.DataFrame:
    """Transform raw FUELHH records into a normalized DataFrame."""
    df = pd.DataFrame(records)
    if df.empty:
        return pd.DataFrame(columns=["startTime", "actual_mw", "settlementDate", "settlementPeriod"])

    # Ensure UTC datetime and numeric generation
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    df["actual_mw"] = pd.to_numeric(df["generation"], errors="coerce").astype(float)

    # Sort and remove duplicates
    df = df.sort_values("startTime").drop_duplicates(subset=["startTime"]).reset_index(drop=True)
    return df[["startTime", "actual_mw", "settlementDate", "settlementPeriod"]]


async def fetch_windfor_forecasts(
    publish_from: str = "2025-12-30T00:00:00Z",
    publish_to: str = "2026-02-01T23:59:59Z",
    chunk_days: int = 7,
    use_cache: bool = True,
) -> pd.DataFrame:
    """
    Fetch WINDFOR wind generation forecasts from Elexon BMRS in concurrent <= 7-day chunks.
    
    Endpoint: datasets/WINDFOR/stream
    Params: publishDateTimeFrom, publishDateTimeTo
    Resolution: Hourly (1-hour intervals)
    """
    cache_key = "windfor_forecasts"

    # 1. In-memory cache hit
    if use_cache and cache_key in _memory_cache:
        return _memory_cache[cache_key].copy()

    # 2. Disk cache hit
    if use_cache and FORECASTS_CACHE_FILE.exists():
        try:
            with open(FORECASTS_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            df = _process_forecasts_data(data)
            _memory_cache[cache_key] = df
            return df.copy()
        except Exception as exc:
            logger.warning(f"Failed reading forecasts disk cache: {exc}")

    # 3. Build concurrent 7-day chunk ranges
    start_dt = datetime.fromisoformat(publish_from.replace("Z", "+00:00"))
    end_dt = datetime.fromisoformat(publish_to.replace("Z", "+00:00"))

    chunk_ranges: List[Tuple[str, str]] = []
    curr = start_dt
    while curr < end_dt:
        nxt = min(curr + timedelta(days=chunk_days), end_dt)
        chunk_ranges.append(
            (
                curr.strftime("%Y-%m-%dT%H:%M:%SZ"),
                nxt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            )
        )
        curr = nxt

    url = f"{ELEXON_BASE_URL}/datasets/WINDFOR/stream"

    async with httpx.AsyncClient() as client:
        tasks = [
            _fetch_with_retry(
                client,
                url,
                {"publishDateTimeFrom": c_start, "publishDateTimeTo": c_end},
            )
            for c_start, c_end in chunk_ranges
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    all_records: List[Dict[str, Any]] = []
    for res in results:
        if isinstance(res, Exception):
            raise ElexonAPIError(f"Error fetching WINDFOR chunk: {res}")
        all_records.extend(res)

    if not all_records:
        raise ElexonAPIError("Elexon returned empty WINDFOR data for the requested window.")

    # Write disk cache
    try:
        with open(FORECASTS_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(all_records, f)
    except Exception as exc:
        logger.warning(f"Failed writing forecasts disk cache: {exc}")

    df = _process_forecasts_data(all_records)
    _memory_cache[cache_key] = df
    return df.copy()


def _process_forecasts_data(records: List[Dict[str, Any]]) -> pd.DataFrame:
    """Transform raw WINDFOR records into a normalized DataFrame."""
    df = pd.DataFrame(records)
    if df.empty:
        return pd.DataFrame(columns=["startTime", "publishTime", "forecast_mw"])

    df["startTime"] = pd.to_datetime(df["startTime"], utc=True)
    df["publishTime"] = pd.to_datetime(df["publishTime"], utc=True)
    df["forecast_mw"] = pd.to_numeric(df["generation"], errors="coerce").astype(float)

    # Filter out nulls and sort by target startTime and publishTime
    df = df.dropna(subset=["startTime", "publishTime", "forecast_mw"])
    df = df.sort_values(["startTime", "publishTime"]).drop_duplicates(
        subset=["startTime", "publishTime"]
    ).reset_index(drop=True)

    return df[["startTime", "publishTime", "forecast_mw"]]


async def preload_cache_if_needed() -> None:
    """Warm up both actuals and forecasts in memory/disk cache."""
    try:
        logger.info("Pre-warming Elexon actuals & forecasts cache...")
        await asyncio.gather(
            fetch_fuelhh_actuals(),
            fetch_windfor_forecasts(),
        )
        logger.info("Elexon data cache ready.")
    except Exception as exc:
        logger.warning(f"Cache pre-warming encountered an issue (will fetch on demand): {exc}")

