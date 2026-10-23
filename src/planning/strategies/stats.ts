// Small statistics on a price series for the strategies. Pure; every window ends before index
// `t` (what was known that morning).

// Daily simple returns over the last `window` days before t (fewer when the series is shorter).
export function returns(series: readonly number[], t: number, window: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(1, t - window); i < t; i += 1) out.push(series[i] / series[i - 1] - 1);
  return out;
}

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

// Yearly volatility of daily returns over the window, or null with too little history.
export function vol(
  series: readonly number[],
  t: number,
  window: number,
  daysPerYear: number,
): number | null {
  if (t - 1 < window) return null;
  return stdev(returns(series, t, window)) * Math.sqrt(daysPerYear);
}

// The return over the look-back (close before t against `lookback` days earlier), or null.
export function trailingReturn(series: readonly number[], t: number, lookback: number) {
  if (t - 1 - lookback < 0) return null;
  return series[t - 1] / series[t - 1 - lookback] - 1;
}

// The simple moving average of the closes over the window before t, or null.
export function sma(series: readonly number[], t: number, window: number): number | null {
  if (t < window) return null;
  let s = 0;
  for (let i = t - window; i < t; i += 1) s += series[i];
  return s / window;
}

// The covariance matrix of daily returns over the window, for the series in order, or null.
export function covariance(series: readonly (readonly number[])[], t: number, window: number) {
  if (t - 1 < window) return null;
  const rs = series.map((s) => returns(s, t, window));
  const ms = rs.map(mean);
  const n = rs[0].length;
  return rs.map((a, i) =>
    rs.map((b, j) => {
      let s = 0;
      for (let k = 0; k < n; k += 1) s += (a[k] - ms[i]) * (b[k] - ms[j]);
      return s / (n - 1);
    }),
  );
}

// The closest point to `w` whose entries sum to `total`, each between 0 and `cap` (a capped
// simplex projection, by bisection on the shift).
export function projectCapped(w: readonly number[], total: number, cap: number): number[] {
  const at = (shift: number) => w.map((x) => Math.min(cap, Math.max(0, x - shift)));
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  if (cap * w.length < total) return w.map(() => cap);
  let lo = Math.min(...w) - cap;
  let hi = Math.max(...w);
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (sum(at(mid)) > total) lo = mid;
    else hi = mid;
  }
  return at((lo + hi) / 2);
}
