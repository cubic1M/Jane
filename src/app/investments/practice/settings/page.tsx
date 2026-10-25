import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { GOALS, RISK_LEVELS } from "@/config/investing";
import {
  ADD_DAY_RANGE,
  APPETITE_ORDER,
  APPETITES,
  AUTOPILOT_MODES,
  BROAD_FUND_NOTE,
  EXCLUSIONS,
  LEVEL_WORST_DROP_PERCENT,
  MAX_DROP_RANGE,
  MAX_FUND_RANGE,
  REBALANCE_PACES,
  STRATEGY_CHOICES,
  UNIVERSES,
  type RebalancePace,
  type StrategyChoice,
  type Universe,
} from "@/config/practice-preferences";
import { adviceMode } from "@/lib/advice-mode";
import { loadPreferences, practiceProfileOf, questionnaireLevel } from "@/lib/practice/preferences";
import { requireUser } from "@/lib/session";
import { PREFERENCE_LABELS, type PreferenceField } from "@/planning/practice-preferences";
import { savePracticeSettings } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// What the person wants from the practice portfolio (Phase AW, Stage A), in plain words: how much
// risk, a goal and its date, the monthly practice money, extra moves, what never to buy, loss
// harvesting, cash to keep, whether Jane acts or only suggests, and how she invests: the
// strategy, how often she rebalances, what she may buy and the most in one fund. The same settings change from
// the chat. Practice money and demo advice only; the hard limits always win.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const FIELD =
  "h-10 w-full max-w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const SECTION = "flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const HINT = "text-sm text-zinc-600 dark:text-zinc-400";

const dollars = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, "");

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/practice/settings">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done: rawDone, error: rawError } = await searchParams;
  const done = Array.isArray(rawDone) ? rawDone[0] : rawDone;
  const error = Array.isArray(rawError) ? rawError[0] : rawError;
  const advice = await adviceMode(user.id);
  const header = (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments/practice" className={`text-sm ${LINK}`}>
          ← Practice portfolio
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Practice settings</h1>
        <p className={HINT}>
          Tell Jane how to run your practice portfolio. You can also just say it in the chat, like
          &ldquo;make it less risky&rdquo; or &ldquo;avoid oil companies&rdquo;. Practice money
          only: no real money moves.
        </p>
      </div>
    </>
  );
  if (!advice) {
    return (
      <>
        {header}
        <p className={HINT}>
          The practice portfolio is only available in demo advice mode for now.
        </p>
      </>
    );
  }
  const [prefs, profile, suggested] = await Promise.all([
    loadPreferences(user.id),
    practiceProfileOf(user.id),
    questionnaireLevel(user.id),
  ]);
  const errorField =
    error && Object.hasOwn(PREFERENCE_LABELS, error) ? (error as PreferenceField) : null;
  const avoidTickers = prefs.avoid.filter((k) => !Object.hasOwn(EXCLUSIONS, k));
  return (
    <>
      {header}
      {done && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {done === "saved" ? "Saved. Jane uses it from the next run." : "Nothing changed."}
        </p>
      )}
      {errorField && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          Check &ldquo;{PREFERENCE_LABELS[errorField]}&rdquo; and save again. Nothing was changed.
        </p>
      )}
      <section className={SECTION} aria-labelledby="what-jane-does">
        <h2 id="what-jane-does" className="text-xl font-semibold">
          What Jane does now
        </h2>
        <ul className="list-disc pl-5 text-sm">
          {profile.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className={HINT}>
          Whatever you choose, the hard limits stay: no borrowing, options or shorting, no trade
          over {Math.round(profile.limits.perTradeShare * 100)}% of the portfolio, no company over{" "}
          {Math.round(profile.limits.perStockShare * 100)}%, and at most{" "}
          {profile.limits.tradesPerDay} trades a day.
        </p>
        <DemoAdviceLabel />
      </section>
      <form action={savePracticeSettings} className="flex flex-col gap-4">
        <fieldset className={SECTION}>
          <legend className="px-1 font-semibold">How much risk</legend>
          <label className="flex flex-col gap-1 text-sm">
            {PREFERENCE_LABELS.riskLevel}
            <select name="riskLevel" defaultValue={prefs.riskLevel ?? ""} className={FIELD}>
              <option value="">
                From your answers{suggested ? ` (${RISK_LEVELS[suggested].label})` : ""}
              </option>
              {([1, 2, 3, 4, 5] as const).map((l) => (
                <option key={l} value={l}>
                  {RISK_LEVELS[l].label}
                </option>
              ))}
            </select>
          </label>
          <ul className={`${HINT} list-disc pl-5`}>
            {([1, 2, 3, 4, 5] as const).map((l) => (
              <li key={l}>
                <strong>{RISK_LEVELS[l].label}</strong>: {RISK_LEVELS[l].description}
              </li>
            ))}
          </ul>
          <label className="flex flex-col gap-1 text-sm">
            {PREFERENCE_LABELS.maxDropPercent} (%)
            <input
              type="number"
              name="maxDropPercent"
              min={MAX_DROP_RANGE.min}
              max={MAX_DROP_RANGE.max}
              step={1}
              defaultValue={prefs.maxDropPercent ?? ""}
              placeholder="No limit"
              className={FIELD}
            />
          </label>
          <p className={HINT}>
            In the sample replay the worst drops were about{" "}
            {([1, 2, 3, 4, 5] as const)
              .map((l) => `${LEVEL_WORST_DROP_PERCENT[l]}% (${RISK_LEVELS[l].label})`)
              .join(", ")}
            . Jane keeps to a level whose drop fits.
          </p>
        </fieldset>

        <fieldset className={SECTION}>
          <legend className="px-1 font-semibold">Your goal</legend>
          <label className="flex flex-col gap-1 text-sm">
            {PREFERENCE_LABELS.goal}
            <select name="goal" defaultValue={prefs.goal ?? ""} className={FIELD}>
              <option value="">None</option>
              {Object.entries(GOALS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {PREFERENCE_LABELS.goalDate}
            <input
              type="date"
              name="goalDate"
              defaultValue={prefs.goalDate ?? ""}
              className={FIELD}
            />
          </label>
          <p className={HINT}>
            As the date gets closer Jane moves the mix toward bonds and cash, the way target-date
            funds do.
          </p>
        </fieldset>

        <fieldset className={SECTION}>
          <legend className="px-1 font-semibold">Monthly practice money</legend>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {PREFERENCE_LABELS.monthlyAddCents} ($)
              <input
                type="number"
                name="monthlyAdd"
                min={0}
                step="0.01"
                defaultValue={dollars(prefs.monthlyAddCents)}
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {PREFERENCE_LABELS.addDay}
              <input
                type="number"
                name="addDay"
                min={ADD_DAY_RANGE.min}
                max={ADD_DAY_RANGE.max}
                defaultValue={prefs.addDay}
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {PREFERENCE_LABELS.cashBufferCents} ($)
              <input
                type="number"
                name="cashBuffer"
                min={0}
                step="0.01"
                defaultValue={dollars(prefs.cashBufferCents)}
                className={FIELD}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className={SECTION}>
          <legend className="px-1 font-semibold">How Jane invests</legend>
          <p className={HINT}>
            {PREFERENCE_LABELS.strategy}
            {profile.strategy ? `: today, ${profile.strategy.note}` : "."}
          </p>
          {(Object.keys(STRATEGY_CHOICES) as StrategyChoice[]).map((c) => (
            <label key={c} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="strategy"
                value={c}
                defaultChecked={prefs.strategy === c}
                className="mt-1 shrink-0"
              />
              <span>
                <strong>{STRATEGY_CHOICES[c].label}</strong>: {STRATEGY_CHOICES[c].description}
              </span>
            </label>
          ))}
          <label className="flex flex-col gap-1 text-sm">
            {PREFERENCE_LABELS.rebalancePace}
            <select name="rebalancePace" defaultValue={prefs.rebalancePace} className={FIELD}>
              {(Object.keys(REBALANCE_PACES) as RebalancePace[]).map((r) => (
                <option key={r} value={r}>
                  {REBALANCE_PACES[r].label}: {REBALANCE_PACES[r].description}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {PREFERENCE_LABELS.universe}
            <select name="universe" defaultValue={prefs.universe} className={FIELD}>
              {(Object.keys(UNIVERSES) as Universe[]).map((u) => (
                <option key={u} value={u}>
                  {UNIVERSES[u].label}
                </option>
              ))}
            </select>
          </label>
          <p className={HINT}>{UNIVERSES[prefs.universe].description}</p>
          <label className="flex flex-col gap-1 text-sm">
            {PREFERENCE_LABELS.maxFundPercent} (%)
            <input
              type="number"
              name="maxFundPercent"
              min={MAX_FUND_RANGE.min}
              max={MAX_FUND_RANGE.max}
              step={1}
              defaultValue={prefs.maxFundPercent ?? ""}
              placeholder={`${MAX_FUND_RANGE.max} (the limit)`}
              className={FIELD}
            />
          </label>
          <p className={HINT}>
            What a lower cap keeps out of a fund stays as cash. It can only be lower than the hard
            limit of {MAX_FUND_RANGE.max}%.
          </p>
        </fieldset>

        <fieldset className={SECTION}>
          <legend className="px-1 font-semibold">{PREFERENCE_LABELS.appetite}</legend>
          <p className={HINT}>
            Small moves beyond the model, like buying a dip with cash waiting, or a news idea at
            High and Very high.
          </p>
          {APPETITE_ORDER.map((a) => (
            <label key={a} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="appetite"
                value={a}
                defaultChecked={prefs.appetite === a}
                className="mt-1 shrink-0"
              />
              <span>
                <strong>{APPETITES[a].label}</strong>: {APPETITES[a].description}
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className={SECTION}>
          <legend className="px-1 font-semibold">{PREFERENCE_LABELS.avoid}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {Object.entries(EXCLUSIONS).map(([key, { label }]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="avoid"
                  value={key}
                  defaultChecked={prefs.avoid.includes(key)}
                  className="shrink-0"
                />
                {label}
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Funds or companies by ticker
            <input
              type="text"
              name="avoidTickers"
              defaultValue={avoidTickers.join(", ")}
              placeholder="e.g. TSLA, VXUS"
              className={FIELD}
            />
          </label>
          <p className={HINT}>{BROAD_FUND_NOTE}</p>
        </fieldset>

        <fieldset className={SECTION}>
          <legend className="px-1 font-semibold">Taxes and the autopilot</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="harvestLosses"
              defaultChecked={prefs.harvestLosses}
              className="shrink-0"
            />
            {PREFERENCE_LABELS.harvestLosses}: swap a fund that&rsquo;s down into a similar one
          </label>
          {(Object.keys(AUTOPILOT_MODES) as (keyof typeof AUTOPILOT_MODES)[]).map((m) => (
            <label key={m} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                value={m}
                defaultChecked={prefs.mode === m}
                className="mt-1 shrink-0"
              />
              <span>
                <strong>{AUTOPILOT_MODES[m].label}</strong>: {AUTOPILOT_MODES[m].description}
              </span>
            </label>
          ))}
        </fieldset>

        <SubmitButton className={`${BUTTON} self-start`}>Save settings</SubmitButton>
      </form>
    </>
  );
}

export default function PracticeSettingsPage(props: PageProps<"/investments/practice/settings">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
