import { FOUNDER_NUMBERS } from "@/config/founder-numbers";
import { loadFounderNumbers } from "@/lib/founder-numbers";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { change, LINES } from "./lines";

// The founders' beta numbers, for the a16z speedrun and YC applications: live, real people only,
// with what was left out. Rendered on the server in one pass, no loading state.

function Sparkline({ values }: { values: (number | null)[] }) {
  const known = values.flatMap((v, i) => (v === null ? [] : [{ v, i }]));
  if (known.length < 2) return null;
  const max = Math.max(...known.map((k) => k.v));
  const min = Math.min(...known.map((k) => k.v));
  const w = 80;
  const h = 20;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => (max === min ? h / 2 : h - 2 - ((v - min) / (max - min)) * (h - 4));
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      className="text-zinc-500"
    >
      <polyline
        points={known.map((k) => `${x(k.i).toFixed(1)},${y(k.v).toFixed(1)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default async function FounderNumbersPage() {
  const admin = await requireAdmin();
  const numbers = await loadFounderNumbers();
  const weekAgo = numbers.trend[0];
  const { trial, team, demoOnly } = numbers.excluded;
  const days = FOUNDER_NUMBERS.trendDays;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Beta numbers</h1>
      <section aria-label="Copy-ready line" className="flex flex-col gap-1">
        <p
          data-copy-line=""
          className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-lg font-medium select-all dark:border-zinc-800 dark:bg-zinc-900"
        >
          {numbers.copyLine}
        </p>
        <p className="text-xs text-zinc-500">
          Click once to select it all. Live as of {numbers.asOf.toISOString().slice(0, 16)} UTC.
        </p>
      </section>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {["Number", "Now", `${days} days ago`, "Change", `Last ${days} days`].map((h) => (
                <th key={h} scope="col" className="py-2 pr-4 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LINES.map((line) => (
              <tr key={line.name} className="border-t border-zinc-200 dark:border-zinc-800">
                <th scope="row" className="py-2 pr-4 text-left font-medium">
                  {line.name}
                </th>
                <td className="py-2 pr-4 tabular-nums">{line.show(line.value(numbers.now))}</td>
                <td className="py-2 pr-4 text-zinc-500 tabular-nums">
                  {line.show(line.value(weekAgo))}
                </td>
                <td className="py-2 pr-4 tabular-nums">
                  {change(line, line.value(weekAgo), line.value(numbers.now))}
                </td>
                <td className="py-2 pr-4">
                  <Sparkline values={numbers.trend.map(line.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section data-excluded="" className="flex flex-col gap-1 text-sm">
        <h2 className="text-xl font-semibold">Left out</h2>
        <p>
          {trial} trial {trial === 1 ? "person" : "people"} (sample data), {team} team and founder{" "}
          {team === 1 ? "account" : "accounts"}, {demoOnly} demo-bank-only{" "}
          {demoOnly === 1 ? "account" : "accounts"}.
        </p>
      </section>
      <p className="text-xs text-zinc-500">
        Real people only: not trial people, not admins or the emails in ADMIN_EMAILS or
        FOUNDER_EMAILS, and not people whose only accounts are the demo bank. Found is the
        report&apos;s yearly total plus findings already done, per person who added an account.
        Fixes are cards and suggestions marked done, plus findings finished for them. Verified
        savings are what later transactions showed. Weekly active is anyone on the activity log in
        the last {FOUNDER_NUMBERS.activeDays} days. Earlier days count what existed by then, with
        today&apos;s statuses for findings.
      </p>
    </main>
  );
}
