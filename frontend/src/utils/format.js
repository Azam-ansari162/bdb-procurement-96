/**
 * Formatting utilities for UK Wholesale Energy Trading Desk
 */

/**
 * Format Megawatts (MW) with comma thousand separators
 */
export function formatMW(val, includeUnit = true) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const formatted = Math.round(val).toLocaleString('en-GB');
  return includeUnit ? `${formatted} MW` : formatted;
}

/**
 * Format Megawatts with 1 decimal place (for precise KPI metrics)
 */
export function formatMWPrecise(val, includeUnit = true) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const formatted = Number(val).toLocaleString('en-GB', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return includeUnit ? `${formatted} MW` : formatted;
}

/**
 * Format signed MW error (e.g. +1,240 MW or -850 MW)
 */
export function formatSignedMW(val, includeUnit = true) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const rounded = Math.round(val);
  const sign = rounded > 0 ? '+' : '';
  const formatted = `${sign}${rounded.toLocaleString('en-GB')}`;
  return includeUnit ? `${formatted} MW` : formatted;
}

/**
 * Format percentage (e.g. 8.1%)
 */
export function formatPct(val) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  return `${Number(val).toFixed(1)}%`;
}

/**
 * Format hours (e.g. 14.5h)
 */
export function formatHours(val) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  return `${Number(val).toFixed(1)}h`;
}

/**
 * Format ISO timestamp into short UTC string: "DD MMM HH:mm"
 */
export function formatUTC(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    const day = String(d.getUTCDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getUTCMonth()];
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const mins = String(d.getUTCMinutes()).padStart(2, '0');
    return `${day} ${month} ${hours}:${mins}`;
  } catch {
    return isoStr;
  }
}

/**
 * Format ISO timestamp into time only: "HH:mm"
 */
export function formatTimeOnly(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const mins = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${mins}`;
  } catch {
    return isoStr;
  }
}

/**
 * Format ISO timestamp to full "YYYY-MM-DD HH:mm UTC"
 */
export function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const mins = String(d.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${mins} UTC`;
  } catch {
    return isoStr;
  }
}

/**
 * Calculate UK Settlement Period (1 to 48) from UTC timestamp
 * Period 1: 00:00 - 00:30 UTC, Period 48: 23:30 - 24:00 UTC
 */
export function getSettlementPeriod(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    const hours = d.getUTCHours();
    const mins = d.getUTCMinutes();
    return hours * 2 + (mins >= 30 ? 2 : 1);
  } catch {
    return null;
  }
}
