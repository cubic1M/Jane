import { SAMPLE_PROFILES, normal, sampleBars } from "./sample";
import type { IntradayBar } from "./types";

// The sample market's 5-minute bars (Phase AW, Stage A: the Very high day-trading sleeve):
// one New York session a trading day, 9:30 to 4:00, made from the sample's own closes so the
// day ends where its daily bar does. A bridge from the last close to the day's close with the
// fund's own day-to-day jumpiness spread over the 78 bars, the volume heaviest at the open and
// the close. Deterministic: the same day gives the same bars. Nothing here is a real price.

const BARS = 78;
// New York's open in UTC: 14:30 in winter, 13:30 in summer (DST, second Sunday of March to the
// first Sunday of November).
function openUtc(day: string): number {
  const y = Number(day.slice(0, 4));
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  const dst = `${y}-03-${String(nthSunday(2, 2)).padStart(2, "0")}`;
  const std = `${y}-11-${String(nthSunday(10, 1)).padStart(2, "0")}`;
  const summer = day >= dst && day < std;
  return Date.parse(`${day}T${summer ? "13" : "14"}:30:00Z`);
}

export function sampleSession(ticker: string, day: string): IntradayBar[] {
  const t = ticker.toUpperCase();
  const p = SAMPLE_PROFILES[t];
  if (!p) return [];
  const closes = sampleBars(t, `${Number(day.slice(0, 4)) - 1}${day.slice(4)}`, day);
  const today = closes.at(-1);
  const before = closes.at(-2);
  if (!today || today.date !== day || !before) return [];
  const from = Math.log(before.closeCents);
  const to = Math.log(today.closeCents);
  // Each bar's share of the day's jumpiness, in log terms.
  const step = (p.beta * 0.009 + p.vol * 0.6) / Math.sqrt(BARS);
  const walk: number[] = [0];
  for (let k = 1; k <= BARS; k += 1) walk.push(walk[k - 1] + step * normal(`${t}:${day}:${k}`));
  const path = walk.map((w, k) => from + ((to - from) * k) / BARS + w - (walk[BARS] * k) / BARS);
  const open = openUtc(day);
  return Array.from({ length: BARS }, (_, k) => {
    const o = Math.exp(path[k]);
    const c = Math.exp(path[k + 1]);
    const wick = (key: string) => Math.abs(normal(`${t}:${day}:${k}:${key}`)) * step * 0.5;
    const u = (k - (BARS - 1) / 2) / ((BARS - 1) / 2);
    return {
      t: new Date(open + k * 300_000).toISOString(),
      o: Math.round(o),
      h: Math.round(Math.max(o, c) * (1 + wick("h"))),
      l: Math.round(Math.min(o, c) * (1 - wick("l"))),
      c: Math.round(c),
      v: Math.round(
        10_000 * (1 + 2 * u * u) * (0.75 + 0.5 * Math.abs(normal(`${t}:${day}:${k}:v`))),
      ),
    };
  });
}
