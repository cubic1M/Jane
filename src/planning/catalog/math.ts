// The strategy catalog's arithmetic (Phase AW, Stage A): moving averages, momentum measures,
// RSI, covariance, the long-only optimizers (minimum variance, maximum diversification,
// hierarchical risk parity) and the deflated Sharpe ratio (Bailey & López de Prado, 2014).
// Pure; every series is oldest first and every look-back reads only closes before the day.

export const mean = (x: readonly number[]) => x.reduce((s, v) => s + v, 0) / Math.max(1, x.length);
export function sd(x: readonly number[]): number {
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, x.length - 1));
}

// Simple moving average of the n closes ending at index t (inclusive).
export function sma(c: readonly number[], t: number, n: number): number | null {
  if (t - n + 1 < 0) return null;
  let s = 0;
  for (let i = t - n + 1; i <= t; i += 1) s += c[i];
  return s / n;
}

// The return over `days` trading days ending at index t.
export const ret = (c: readonly number[], t: number, days: number): number | null =>
  t - days < 0 ? null : c[t] / c[t - days] - 1;

// Trading days in a month, for month look-backs on daily closes.
export const MONTH = 21;

// Keller's 13612W: (12·r1 + 4·r3 + 2·r6 + r12) / 4, from monthly returns.
export function m13612w(c: readonly number[], t: number): number | null {
  const r = [1, 3, 6, 12].map((m) => ret(c, t, m * MONTH));
  if (r.some((x) => x === null)) return null;
  const [r1, r3, r6, r12] = r as number[];
  return (12 * r1 + 4 * r3 + 2 * r6 + r12) / 4;
}

// The plain average of the 1, 3, 6 and 12-month returns (13612U).
export function m13612u(c: readonly number[], t: number): number | null {
  const r = [1, 3, 6, 12].map((m) => ret(c, t, m * MONTH));
  if (r.some((x) => x === null)) return null;
  return (r as number[]).reduce((s, x) => s + x, 0) / 4;
}

// Wilder's RSI over n days, ending at index t.
export function rsi(c: readonly number[], t: number, n: number): number | null {
  if (t - n * 5 < 1) return null;
  let up = 0;
  let down = 0;
  // Seeded over the first n changes of a 5n window, then smoothed.
  const start = t - n * 5 + 1;
  for (let i = start; i < start + n; i += 1) {
    const d = c[i] - c[i - 1];
    up += Math.max(0, d);
    down += Math.max(0, -d);
  }
  up /= n;
  down /= n;
  for (let i = start + n; i <= t; i += 1) {
    const d = c[i] - c[i - 1];
    up = (up * (n - 1) + Math.max(0, d)) / n;
    down = (down * (n - 1) + Math.max(0, -d)) / n;
  }
  if (down === 0) return 100;
  return 100 - 100 / (1 + up / down);
}

// Daily returns of each series over the `days` before index t (t excluded).
export function returnsBefore(series: readonly (readonly number[])[], t: number, days: number) {
  return series.map((c) => {
    const out: number[] = [];
    for (let i = t - days; i < t; i += 1) out.push(c[i] / c[i - 1] - 1);
    return out;
  });
}

export function covariance(r: readonly (readonly number[])[]): number[][] {
  const m = r.map(mean);
  const n = r[0]?.length ?? 0;
  return r.map((a, i) =>
    r.map((b, j) => {
      let s = 0;
      for (let k = 0; k < n; k += 1) s += (a[k] - m[i]) * (b[k] - m[j]);
      return s / Math.max(1, n - 1);
    }),
  );
}

const portVar = (w: readonly number[], cov: readonly (readonly number[])[]) =>
  w.reduce((s, wi, i) => s + wi * cov[i].reduce((t, cij, j) => t + cij * w[j], 0), 0);

// Projection onto { w ≥ 0, Σw = 1, w ≤ cap } (bisection on the shift).
export function projectCapped(v: readonly number[], cap: number): number[] {
  const c = Math.max(cap, 1 / v.length);
  let lo = Math.min(...v) - 1;
  let hi = Math.max(...v);
  for (let k = 0; k < 100; k += 1) {
    const mid = (lo + hi) / 2;
    const s = v.reduce((a, x) => a + Math.min(c, Math.max(0, x - mid)), 0);
    if (s > 1) lo = mid;
    else hi = mid;
  }
  return v.map((x) => Math.min(c, Math.max(0, x - (lo + hi) / 2)));
}

// Long-only minimum variance, at most `cap` in one, by projected gradient descent.
export function minVariance(cov: readonly (readonly number[])[], cap = 1): number[] {
  const n = cov.length;
  let w = new Array(n).fill(1 / n);
  const scale = Math.max(...cov.map((r, i) => r[i]), 1e-12);
  const step = 0.5 / scale;
  for (let it = 0; it < 500; it += 1) {
    const g = cov.map((r) => 2 * r.reduce((s, c, j) => s + c * w[j], 0));
    w = projectCapped(
      w.map((x, i) => x - step * g[i]),
      cap,
    );
  }
  return w;
}

// Long-only maximum diversification ratio (Σ wσ / √(w'Σw)): minimum variance on the
// correlation matrix, rescaled by the volatilities (Choueifaty & Coignard), then capped.
export function maxDiversification(cov: readonly (readonly number[])[], cap = 1): number[] {
  const vol = cov.map((r, i) => Math.sqrt(Math.max(r[i], 1e-16)));
  const corr = cov.map((r, i) => r.map((c, j) => c / (vol[i] * vol[j])));
  const y = minVariance(corr, 1);
  const raw = y.map((x, i) => x / vol[i]);
  const s = raw.reduce((a, x) => a + x, 0);
  return projectCapped(
    raw.map((x) => x / s),
    cap,
  );
}

// Hierarchical risk parity (López de Prado, 2016): single-linkage clustering on the correlation
// distance √((1 − ρ)/2), quasi-diagonal order, then recursive bisection by inverse variance.
export function hrp(cov: readonly (readonly number[])[]): number[] {
  const n = cov.length;
  const vol = cov.map((r, i) => Math.sqrt(Math.max(r[i], 1e-16)));
  const dist = cov.map((r, i) =>
    r.map((c, j) => Math.sqrt(Math.max(0, (1 - c / (vol[i] * vol[j])) / 2))),
  );
  // Agglomerate: each cluster is the ordered list of its leaves (left then right).
  let clusters = Array.from({ length: n }, (_, i) => [i]);
  const between = (a: number[], b: number[]) =>
    Math.min(...a.flatMap((i) => b.map((j) => dist[i][j])));
  while (clusters.length > 1) {
    let best = [0, 1];
    let bestD = Infinity;
    for (let i = 0; i < clusters.length; i += 1)
      for (let j = i + 1; j < clusters.length; j += 1) {
        const d = between(clusters[i], clusters[j]);
        if (d < bestD) {
          bestD = d;
          best = [i, j];
        }
      }
    const merged = [...clusters[best[0]], ...clusters[best[1]]];
    clusters = clusters.filter((_, k) => k !== best[0] && k !== best[1]);
    clusters.push(merged);
  }
  const order = clusters[0];
  const w = new Array(n).fill(1);
  const clusterVar = (items: number[]) => {
    const iv = items.map((i) => 1 / cov[i][i]);
    const s = iv.reduce((a, x) => a + x, 0);
    const wi = iv.map((x) => x / s);
    return portVar(
      wi,
      items.map((i) => items.map((j) => cov[i][j])),
    );
  };
  const split = (items: number[]) => {
    if (items.length <= 1) return;
    const half = Math.floor(items.length / 2);
    const left = items.slice(0, half);
    const right = items.slice(half);
    const vl = clusterVar(left);
    const vr = clusterVar(right);
    const alpha = 1 - vl / (vl + vr);
    for (const i of left) w[i] *= alpha;
    for (const i of right) w[i] *= 1 - alpha;
    split(left);
    split(right);
  };
  split(order);
  const s = w.reduce((a, x) => a + x, 0);
  return w.map((x) => x / s);
}

// The standard normal: its distribution function and its inverse (Acklam's approximation).
export function normCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 on erf.
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export function normInv(p: number): number {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

const EULER = 0.5772156649015329;

// The Sharpe ratio a best-of-N search would find by luck alone, given how much the trials'
// Sharpe ratios vary (per period, not annualized).
export function expectedMaxSharpe(trials: number, sharpeVariance: number): number {
  if (trials <= 1) return 0;
  const n = trials;
  return (
    Math.sqrt(Math.max(0, sharpeVariance)) *
    ((1 - EULER) * normInv(1 - 1 / n) + EULER * normInv(1 - 1 / (n * Math.E)))
  );
}

// The probability that the true Sharpe ratio of these returns is above `benchmark` (both per
// period), allowing for their skew and fat tails (the probabilistic Sharpe ratio). With the
// benchmark from expectedMaxSharpe, it is the deflated Sharpe ratio.
export function probabilisticSharpe(r: readonly number[], benchmark: number): number {
  const n = r.length;
  if (n < 30) return 0;
  const m = mean(r);
  const s = sd(r);
  if (s === 0) return m > benchmark ? 1 : 0;
  const sr = m / s;
  const skew = r.reduce((a, x) => a + ((x - m) / s) ** 3, 0) / n;
  const kurt = r.reduce((a, x) => a + ((x - m) / s) ** 4, 0) / n;
  const denom = Math.sqrt(Math.max(1e-12, 1 - skew * sr + ((kurt - 1) / 4) * sr * sr));
  return normCdf(((sr - benchmark) * Math.sqrt(n - 1)) / denom);
}
