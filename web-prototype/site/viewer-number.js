/** Presentation only: analysis/export values retain their original numbers. */
export function formatNumber(value, precision = 3, notation = 'adaptive') {
  if (value == null || !Number.isFinite(value)) return 'Not available';
  const places = Number.isInteger(precision) ? Math.max(0, Math.min(12, precision)) : 3;
  const negativeZero = Object.is(value, -0), sign = negativeZero ? '-' : '';
  if (notation === 'scientific') return `${sign}${value.toExponential(places)}`;
  if (notation === 'fixed') return value.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places });
  if (negativeZero) return '-0';
  if (value !== 0 && (Math.abs(value) < 10 ** -places || Math.abs(value) >= 1e9)) return value.toExponential(places);
  return value.toLocaleString(undefined, { maximumFractionDigits: places });
}
