import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { FORECAST_DAYS, LOW_BALANCE_CUSHION_CENTS } from "@/config/detection";
import { loadDetectionInput } from "@/detection/engine";
import { forecastAccounts, upcomingBills } from "@/detection/forecast";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

async function Bills() {
  const user = await requireUser();
  const input = await loadDetectionInput(user.id);
  if (input.accounts.length === 0) redirect("/connect");
  const bills = upcomingBills(input, FORECAST_DAYS);
  const forecasts = forecastAccounts(input, FORECAST_DAYS);
  const byDate = Map.groupBy(bills, (b) => b.date);

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
        const low = f.lowest.balanceCents < LOW_BALANCE_CUSHION_CENTS;
        return (
          <section
            key={f.accountId}
            className={`flex flex-col gap-1 rounded-xl p-4 ${low ? "bg-amber-50 dark:bg-amber-950" : "border border-zinc-200 dark:border-zinc-800"}`}
          >
            <h2 className="font-semibold">{f.accountName}</h2>
            <p className="text-sm">
              {formatCents(f.startCents)} today. Lowest point about{" "}
              <strong>{formatCents(f.lowest.balanceCents)}</strong> on {dayLabel(f.lowest.date)}.
            </p>
            {low && (
              <p className="text-sm">
                That&apos;s below {formatCents(LOW_BALANCE_CUSHION_CENTS)}, so check your report for
                ways to avoid it.
              </p>
            )}
          </section>
        );
      })}

      {bills.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">No regular charges expected.</p>
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
    </>
  );
}

export default function BillsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Looking ahead…</p>}>
        <Bills />
      </Suspense>
    </main>
  );
}
