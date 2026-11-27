// The month chart's dollar axis (./explorer.tsx).

// Dollars in a few characters, for the chart's axis: $0, $800, $2.5k, $1.2M.
export function axisDollars(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${+(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${+(d / 1_000).toFixed(1)}k`;
  // Whole dollars from $10 up; cents below that so $0.50 and $1 don't both read "$1".
  return d >= 10 || Number.isInteger(d) ? `$${Math.round(d)}` : `$${+d.toFixed(2)}`;
}

// A round top for the axis and its step: three steps of 1, 2, 2.5 or 5 times a power of ten.
export function axisTicks(maxCents: number): number[] {
  if (maxCents <= 0) return [0];
  const rough = maxCents / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((s) => s >= rough)!;
  const top = Math.ceil(maxCents / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}
