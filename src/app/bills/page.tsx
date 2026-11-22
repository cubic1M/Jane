import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { FORECAST_DAYS, LOW_BALANCE_CUSHION_CENTS } from "@/config/detection";
import { loadDetectionInput } from "@/detection/input";
import { comingUpBills, forecastAccounts, otherMoneyIn, unevenPay } from "@/detection/forecast";
import { formatCents } from "@/lib/money";
import { scopedDb } from "@/lib/db-scoped";
import { requireUser } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import { balanceLine, otherMoneyLine, unevenPayLine } from "./balance-line";
import { BillsOnward } from "./onward";
import { PageShell } from "@/components/page-shell";

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const BILL_ASK_KEY = "cost:bill_negotiation";

async function Bills() {
  const user = await requireUser();
  const input = await loadDetectionInput(user.id);
  if (input.accounts.length === 0) redirect("/connect");
  const bills = comingUpBills(input, FORECAST_DAYS);
  const forecasts = forecastAccounts(input, FORECAST_DAYS);
  const byDate = Map.groupBy(bills, (b) => b.date);
  // "Ask for a lower bill rate" opens here: its figure and how it's worked out, as the card has
  // them (debug 2, 11-22: the demo's "save $1,080/yr" opened a page with neither).
  const ask = await (
    await scopedDb()
  ).suggestions.findFirst({
    where: { key: BILL_ASK_KEY },
    select: { headline: true, why: true },
  });

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Coming up</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Regular charges we expect in the next month, from your past transactions. Dates and
          amounts are estimates.
        </p>
      </div>

      {forecasts.map((f) => {
        const low = !f.staleFrom && f.lowest.balanceCents < LOW_BALANCE_CUSHION_CENTS;
        const uneven = low
          ? (unevenPayLine(unevenPay(input, f.accountId)) ??
            otherMoneyLine(otherMoneyIn(input, f.accountId)))
          : null;
        return (
          <section
            key={f.accountId}
            className={`flex flex-col gap-1 rounded-xl p-4 ${low ? "bg-amber-50 dark:bg-amber-950" : "border border-zinc-200 dark:border-zinc-800"}`}
          >
            <h2 className="font-semibold">{f.accountName}</h2>
            {f.staleFrom ? (
              <p className="text-sm">
                {balanceLine(f, dayLabel)}. Add a newer statement to see what&apos;s ahead.
              </p>
            ) : (
              <p className="text-sm">
                {balanceLine(f, dayLabel)}. Lowest point about{" "}
                <strong>{formatCents(f.lowest.balanceCents)}</strong> on {dayLabel(f.lowest.date)}.
              </p>
            )}
            {low && (
              <p className="text-sm">
                That&apos;s below {formatCents(LOW_BALANCE_CUSHION_CENTS)}, so check{" "}
                <Link href="/report" className="font-medium underline underline-offset-2">
                  your report
                </Link>{" "}
                for ways to avoid it.
              </p>
            )}
            {uneven && <p className="text-sm">{uneven}</p>}
          </section>
        );
      })}

      {ask && (
        <section
          id="ask"
          aria-labelledby="ask-title"
          className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 id="ask-title" className="font-semibold">
            {ask.headline}
          </h2>
          <p className="text-sm">{ask.why}</p>
        </section>
      )}

      {bills.length === 0 ? (
        <EmptyState
          words="Nothing expected in the next month yet. Jane learns your bills once a charge comes back month after month, so a few months of statements show the most."
          next={{ href: "/import", label: "Add older statements" }}
        />
      ) : (
        <ol className="flex flex-col gap-4">
          {[...byDate].map(([date, rows]) => (
            <li key={date} className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold text-zinc-500">{dayLabel(date)}</h2>
              <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
                {rows.map((b) => (
                  <li
                    key={`${b.merchant}-${b.date}`}
                    className="flex justify-between gap-4 px-4 py-2"
                  >
                    <span>{b.merchant}</span>
                    <span className="font-medium">{formatCents(b.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {bills.length > 0 && <BillsOnward />}
    </>
  );
}

export default function BillsPage() {
  return (
    <PageShell layout="roomy" label="Looking ahead">
      <Bills />
    </PageShell>
  );
}
