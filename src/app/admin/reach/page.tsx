import { Suspense } from "react";
import { CALIBRATION_MIN_SAMPLE } from "@/config/reach";
import { formatCents } from "@/lib/money";
import { reachReport, type Totals } from "@/lib/reach";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { AdminTable } from "../admin-table";
import { LoadingBar } from "@/components/loading-bar";

// Spec step 258: proof that the features reach people. The eight sample people one by one;
// everyone else in totals only. And whether "85% sure" proves right about 85% of the time.

const MUTED = "text-zinc-600 dark:text-zinc-400";
const rate = (yes: number, no: number) =>
  yes + no === 0 ? "none yet" : `${Math.round((100 * yes) / (yes + no))}%`;

function TotalsTable({ title, totals }: { title: string; totals: Totals }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      {totals.offered === 0 ? (
        <p className={MUTED}>Nothing offered yet.</p>
      ) : (
        <>
          <p className={MUTED}>
            {totals.offered} offered, {formatCents(totals.dollarsCents)} a year shown, yes rate{" "}
            {rate(totals.yes, totals.no)}, {totals.no} said no.
          </p>
          <AdminTable
            head={["Capability", "Offered", "Shown", "Yes rate", "No"]}
            rows={totals.byCapability.map((c) => ({
              key: c.capability,
              cells: [
                c.capability === "strategist" ? "strategist ideas" : c.capability,
                c.offered,
                formatCents(c.dollarsCents),
                rate(c.yes, c.no),
                c.no,
              ],
            }))}
          />
        </>
      )}
    </section>
  );
}

async function Reach() {
  const admin = await requireAdmin();
  const report = await reachReport();
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Reach</h1>
      <p className={MUTED}>
        Which of Jane&apos;s features reach which people, and whether its confidence is honest.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Bar 3: top three suggestions</h2>
        <p className={MUTED}>
          {report.topThree.filter((t) => t.pass).length} of {report.topThree.length} people pass:
          their top three are all on their written list and none is on their must-not list.
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {report.topThree.map((t) => (
            <li key={t.id}>
              <span
                className={`mr-2 inline-block rounded px-2 py-0.5 font-semibold ${t.pass ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"}`}
              >
                {t.pass ? "Pass" : "Fail"}
              </span>
              {t.label}: {t.topics.join(", ") || "nothing"}
              {t.wrong.length > 0 && (
                <span className="text-red-700"> · must not: {t.wrong.join(", ")}</span>
              )}
              {t.offList.length > 0 && (
                <span className={MUTED}> · not on their list: {t.offList.join(", ")}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">The eight sample people</h2>
        {report.people.map((p) => (
          <details
            key={p.id}
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <summary className="cursor-pointer font-medium">
              {p.label}: {p.fired.length} suggestions, {formatCents(p.dollarsCents)} a year
              {p.wrong.length > 0 && (
                <span className="text-red-700"> · {p.wrong.length} wrong</span>
              )}
            </summary>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {p.fired.map((f) => (
                <li key={`${f.capability}:${f.topic}`}>
                  {f.topic} ({f.capability}): {formatCents(f.worthCents)}, {f.percent}% sure, based
                  on {f.reason}
                </li>
              ))}
            </ul>
            {p.missed.length > 0 && (
              <p className={`mt-2 text-sm ${MUTED}`}>
                Should have, not yet:{" "}
                {p.missed.map((m) => `${m.topic}${m.covered ? " (missed)" : ""}`).join(", ")}
              </p>
            )}
          </details>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Coverage per feature</h2>
        <p className={MUTED}>
          {report.coverage.covered.length} of {report.coverage.total} tools have a detector,{" "}
          {report.coverage.exempt.length} never suggest by themselves,{" "}
          {report.coverage.missing.length} still have none.
        </p>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Covered</summary>
          <ul className="list-disc pl-5 text-sm">
            {report.coverage.covered.map((c) => (
              <li key={c.tool}>
                {c.tool}: {c.detectors.join(", ")}
              </li>
            ))}
          </ul>
        </details>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Still missing a detector</summary>
          <ul className="list-disc pl-5 text-sm">
            {report.coverage.missing.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Taxes, tool by tool</h2>
        <p className={MUTED}>
          {report.taxes.filter((t) => t.reached.length > 0).length} of {report.taxes.length} tax
          tools reach a sample person during the year; the rest say why.
        </p>
        <ul className="list-disc pl-5 text-sm">
          {report.taxes.map((t) => (
            <li key={t.tool}>
              {t.tool}
              {t.reached.length > 0
                ? `: ${t.reached.map((r) => `${r.person} (${r.months.length === 12 ? "all year" : r.months.join(", ")})`).join("; ")}, by ${t.detectors.join(", ")}`
                : `: ${t.exempt ?? t.needsPerson ?? "reaches no one"}`}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Capabilities</h2>
        <ul className="list-disc pl-5 text-sm">
          {report.capabilities.map((c) => (
            <li key={c.capability}>
              {c.capability}: reaches {c.people.length} of 8 ({c.people.join(", ")})
            </li>
          ))}
          {report.unreachable.map((u) => (
            <li key={u.capability}>
              {u.capability}: unreachable. {u.reason}
            </li>
          ))}
        </ul>
      </section>

      <TotalsTable title="Sample people using Try Jane (totals)" totals={report.sample} />
      <TotalsTable title="Real people (totals only)" totals={report.real} />

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Is the confidence honest?</h2>
        {report.bands.length === 0 ? (
          <p className={MUTED}>No suggestion has been answered yet.</p>
        ) : (
          <AdminTable
            head={["Jane said", "Answered", "Said yes"]}
            rows={report.bands.map((b) => ({
              key: String(b.from),
              cells: [`${b.from}–${b.to}% (average ${b.stated}%)`, b.count, `${b.actual}%`],
            }))}
          />
        )}
        <h3 className="font-semibold">Detectors to correct</h3>
        {report.off.length === 0 ? (
          <p className={MUTED}>None with at least {CALIBRATION_MIN_SAMPLE} answers is off.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {report.off.map((o) => (
              <li key={o.detector}>
                {o.detector}: runs {o.direction} (said {o.stated}%, right {o.actual}% of {o.count})
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function AdminReachPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Reach />
      </Suspense>
    </main>
  );
}
