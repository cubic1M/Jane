import { Suspense } from "react";
import { loadBetaMetrics, type BetaMetrics } from "@/lib/beta-metrics";
import { loadMetrics, type Metrics } from "@/lib/metrics";
import { formatCents } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { inviteFunnel, type InviteFunnel } from "@/lib/share-invites";
import { AdminNav } from "../admin-nav";
import { LoadingBar } from "@/components/loading-bar";

const WINDOWS = [7, 30];

const percent = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)}%`);

function Row({ name, values }: { name: string; values: string[] }) {
  return (
    <tr className="border-t border-zinc-200 dark:border-zinc-800">
      <th scope="row" className="py-2 pr-4 text-left font-medium">
        {name}
      </th>
      {values.map((v, i) => (
        <td key={i} className="py-2 pr-4">
          {v}
        </td>
      ))}
    </tr>
  );
}

function rows(windows: { days: number; metrics: Metrics }[]) {
  const each = (f: (m: Metrics) => string) => windows.map((w) => f(w.metrics));
  const types = [...new Set(windows.flatMap((w) => w.metrics.approval.map((a) => a.type)))].sort();
  const actionTypes = [
    ...new Set(windows.flatMap((w) => w.metrics.minutes.map((a) => a.type))),
  ].sort();
  return [
    [
      "Link rate",
      each((m) => `${percent(m.linkRate.rate)} (${m.linkRate.linked}/${m.linkRate.signedUp})`),
    ],
    [
      "Money found (median per linked user)",
      each((m) =>
        m.moneyFound.medianCents === null
          ? "–"
          : `${formatCents(m.moneyFound.medianCents)} (${m.moneyFound.users} users)`,
      ),
    ],
    ...types.map((type) => [
      `Approval rate: ${type.replaceAll("_", " ")}`,
      each((m) => {
        const a = m.approval.find((x) => x.type === type);
        return a ? `${percent(a.rate)} (${a.approved}/${a.shown})` : "–";
      }),
    ]),
    [
      "Completion rate",
      each((m) => `${percent(m.completion.rate)} (${m.completion.done}/${m.completion.closed})`),
    ],
    [
      "Willingness to pay",
      each(
        (m) =>
          `${percent(m.willingnessToPay.rate)} (${m.willingnessToPay.willing}/${m.willingnessToPay.completed})`,
      ),
    ],
    [
      "30-day retention",
      each((m) => `${percent(m.retention.rate)} (${m.retention.retained}/${m.retention.cohort})`),
    ],
    [
      "Referral revenue",
      each((m) =>
        m.referrals.conversions === 0
          ? "–"
          : `${formatCents(m.referrals.cents)} (${m.referrals.conversions} conversions)`,
      ),
    ],
    ...actionTypes.map((type) => [
      `Minutes per action: ${type.replaceAll("_", " ")}`,
      each((m) => {
        const a = m.minutes.find((x) => x.type === type);
        return a?.averageMinutes != null ? `${a.averageMinutes} min (${a.actions})` : "–";
      }),
    ]),
  ] as [string, string[]][];
}

// The closed beta's traction, all time: what goes in the application and the update emails.
function betaRows(b: BetaMetrics, invites: InviteFunnel): [string, string][] {
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  return [
    ["Invited (redeemed a code)", String(b.invited)],
    [
      "Share links: sent, opened, joined",
      `${invites.sent} sent, ${invites.opened} opened, ${invites.joined} joined`,
    ],
    ["Signed up", String(b.signedUp)],
    ["Added accounts by upload", `${b.uploaded.accounts} accounts (${people(b.uploaded.users)})`],
    ["Linked accounts with Plaid", `${b.linked.accounts} accounts (${people(b.linked.users)})`],
    ["People with at least one finding", String(b.withFinding)],
    ["Found, total per year", `${formatCents(b.found.totalCents)} (${people(b.found.users)})`],
    [
      "Found, median per person per year",
      b.found.medianCents === null ? "–" : formatCents(b.found.medianCents),
    ],
    ["People who acted on at least one card", String(b.acted)],
    ["Verified savings so far", `${formatCents(b.verified.cents)} (${people(b.verified.users)})`],
  ];
}

async function MetricsContent() {
  const admin = await requireAdmin();
  const [{ windows, automateNext }, beta, invites] = await Promise.all([
    loadMetrics(admin, WINDOWS),
    loadBetaMetrics(),
    inviteFunnel(),
  ]);
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Metrics</h1>
      <section data-beta-metrics="" className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Closed beta</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          All time, real people only: no trial, demo-bank-only or team accounts. Found counts what
          the report counts plus findings already done, per person who added an account. Verified
          savings are what later transactions showed.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {betaRows(beta, invites).map(([name, value]) => (
                <Row key={name} name={name} values={[value]} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th scope="col" className="py-2 pr-4 text-left">
                Metric
              </th>
              {WINDOWS.map((d) => (
                <th key={d} scope="col" className="py-2 pr-4 text-left">
                  Last {d} days
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows(windows).map(([name, values]) => (
              <Row key={name} name={name} values={values} />
            ))}
          </tbody>
        </table>
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Automate next</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Action types by the team time they&apos;ve taken so far: approvals times average minutes
          per finished action, all time.
        </p>
        {automateNext.length === 0 ? (
          <p className="text-sm text-zinc-500">No actions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["Action", "Approvals", "Minutes each", "Team minutes"].map((h) => (
                    <th key={h} scope="col" className="py-2 pr-4 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {automateNext.map((row) => (
                  <Row
                    key={row.type}
                    name={row.type.replaceAll("_", " ")}
                    values={[
                      String(row.approvals),
                      row.averageMinutes === null ? "–" : String(row.averageMinutes),
                      row.teamMinutes === null ? "not enough data" : String(row.teamMinutes),
                    ]}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-zinc-500">
        Approval rate is yes answers (including do-it-yourself) over cards opened. Completion rate
        is done over all actions closed in the period. Willingness to pay counts reservations and
        payments after a person&apos;s first finished action. Retention counts people whose 30th day
        after linking fell in the period and who came back in days 23 to 30.
      </p>
    </>
  );
}

export default function MetricsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <MetricsContent />
      </Suspense>
    </main>
  );
}
