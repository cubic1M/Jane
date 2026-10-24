import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { RISK_LEVELS } from "@/config/investing";
import {
  THEME_ALTERNATIVE_EVIDENCE,
  THEME_EVIDENCE,
  THEME_EVIDENCE_SOURCE,
  themeConfidence,
  type ThemeRecord,
} from "@/config/theme-evidence";
import {
  THEME_HOLD_DAYS,
  THEME_IDS,
  THEME_SLICE_BY_LEVEL,
  THEME_STOP_LOSS,
  THEMES,
} from "@/config/themes";

// "News themes" on the investments page (Phase AW, Stage A): the kinds of news Jane watches for
// the practice portfolio, the fund each points to, and how that did on its past events. Only the
// themes that held up bring an idea; the rest are shown with their numbers. Demo advice, always
// labelled, and a replay of the past, never a forecast.

const pct = (n: number) => `${n >= 0 ? "+" : "−"}${(Math.abs(n) * 100).toFixed(1)}%`;
const points = (n: number) => `${n >= 0 ? "+" : "−"}${(Math.abs(n) * 100).toFixed(1)} points`;

export function themeRecordLine(r: ThemeRecord): string {
  return `Beat the whole US market in ${r.hits} of ${r.events} past events, ${points(r.averageExcess)} on average over a month; worst ${pct(r.worst)}, best ${pct(r.best)}.`;
}

export function NewsThemesSection() {
  const slices = ([3, 4, 5] as const)
    .map((l) => `${RISK_LEVELS[l].label} ${Math.round((THEME_SLICE_BY_LEVEL[l] ?? 0) * 100)}%`)
    .join(", ");
  return (
    <section className="flex flex-col gap-3" aria-labelledby="news-themes-heading">
      <div className="flex flex-col gap-1">
        <h2 id="news-themes-heading" className="text-xl font-semibold">
          News themes
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Jane reads the news for events that have moved one kind of fund before. When one breaks,
          she brings a practice idea: a small slice ({slices} of the portfolio at most), out after
          about a month ({THEME_HOLD_DAYS} trading days) or if it falls{" "}
          {Math.round(THEME_STOP_LOSS * 100)}%. Each was tested on its past events; only the ones
          that held up are offered.
        </p>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {THEME_IDS.map((id) => {
          const t = THEMES[id];
          const r = THEME_EVIDENCE[id];
          const alternatives = THEME_ALTERNATIVE_EVIDENCE.filter((a) => a.theme === id);
          return (
            <li
              key={id}
              data-theme={id}
              data-held-up={r.heldUp}
              className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <p className="font-medium">
                {t.label}: {t.ticker}{" "}
                <span className="text-xs font-normal text-zinc-500">
                  {r.heldUp ? `offered, ${themeConfidence(r)}% sure` : "tested, not offered"}
                </span>
              </p>
              <p className="text-zinc-600 dark:text-zinc-400">{t.what}</p>
              <p className="text-xs text-zinc-500">{themeRecordLine(r)}</p>
              {alternatives.map((a) => (
                <p key={a.ticker} className="text-xs text-zinc-500">
                  {a.ticker} instead: beat the market in {a.hits} of {a.events}.
                </p>
              ))}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-zinc-500">
        {THEME_EVIDENCE_SOURCE}. A replay of the past, not a forecast: future results will be
        different. Practice money only.
      </p>
      <DemoAdviceLabel />
    </section>
  );
}
