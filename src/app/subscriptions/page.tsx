import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { EmptyState } from "@/components/empty-state";
import { loadDetectionInput } from "@/detection/input";
import { cheaperPlansOf } from "@/detectors/cover-facts";
import { loadProfileInput } from "@/lib/profile";
import { recurringCharges, type RecurringCharge } from "@/detection/subscriptions";
import { Rows } from "./rows";
import { scopedDb } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { PageShell } from "@/components/page-shell";
import { dayLabel } from "@/lib/day-label";
import { DETECTOR_RATES as R } from "@/config/detectors";
import { subscriptionTrimSentence } from "@/lib/subscription-trim";

async function Subscriptions() {
  const user = await requireUser();
  const db = await scopedDb();
  const [input, checks, profileInput] = await Promise.all([
    loadDetectionInput(user.id),
    db.subscriptionChecks.findMany({ select: { merchantKey: true, isSubscription: true } }),
    // The rows the cheaper-plan card was made from (src/lib/suggestions.ts detectFor).
    loadProfileInput(user.id),
  ]);
  if (input.accounts.length === 0) redirect("/connect");
  // What the cheaper-plan card counts, each service with its plan and a year of the difference:
  // they add up to the card's figure (cheaperPlansOf; debug 2, 11-22: none was on this page).
  const plans = cheaperPlansOf(profileInput);
  input.subscriptionMerchantKeys = checks.filter((c) => c.isSubscription).map((c) => c.merchantKey);
  // What they said is not a subscription, as on Money and in the chat, so the marks agree.
  input.declinedSubscriptionMerchantKeys = checks
    .filter((c) => !c.isSubscription)
    .map((c) => c.merchantKey);
  const rows = recurringCharges(input);
  const findings = await db.findings.findMany({
    where: {
      type: "subscription_review",
      status: { in: ["new", "shown"] },
      key: { in: rows.map((r) => r.key) },
    },
    select: { id: true, key: true },
  });
  const cards = new Map(findings.map((f) => [f.key, f.id]));
  const subscriptions = rows.filter((r) => r.subscription);
  const other = rows.filter((r) => !r.subscription);
  const total = (list: RecurringCharge[]) => list.reduce((sum, r) => sum + r.annualCostCents, 0);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Subscriptions and regular bills</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Everything that charges you on a schedule, from your transactions. Next dates are
          estimates. Yearly and quarterly renewals get an alert a week ahead.
        </p>
      </div>

      {plans.length > 0 && (
        <section data-cheaper-plans="" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">Cheaper plans of what you pay</h2>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              about {formatCents(plans.reduce((n, p) => n + p.yearly, 0))} a year less
            </span>
          </div>
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {plans.map((p) => (
              <li
                key={p.service}
                data-plan-yearly={p.yearly}
                className="flex flex-wrap justify-between gap-2 px-4 py-3 [overflow-wrap:anywhere]"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{p.service}</span>
                  <span className="text-xs text-zinc-500">
                    You paid {formatCents(p.latest.amountCents)} on {dayLabel(p.latest.date)};{" "}
                    {p.service}&apos;s own page lists {p.plan} at {formatCents(p.cents)} a month.{" "}
                    <a href={p.url} className="underline">
                      Its plans and prices
                    </a>
                  </span>
                </span>
                <span>{formatCents(p.yearly)} a year less</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Subscriptions</h2>
          {subscriptions.length > 0 && (
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {formatCents(total(subscriptions))} a year
            </span>
          )}
        </div>
        {subscriptions.length >= R.subscriptionsMin && (
          <p data-subscription-trim="" className="text-sm text-zinc-600 dark:text-zinc-400">
            {subscriptionTrimSentence(total(subscriptions))}
          </p>
        )}
        {subscriptions.length === 0 ? (
          <EmptyState
            words="None found yet. Jane spots a subscription once it has charged you twice, so a few months of statements find the most."
            next={{ href: "/import", label: "Add older statements" }}
          />
        ) : (
          <Rows rows={subscriptions} cards={cards} />
        )}
      </section>

      {other.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">Other regular bills</h2>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {formatCents(total(other))} a year
            </span>
          </div>
          <Rows rows={other} cards={cards} />
        </section>
      )}
    </>
  );
}

export default function SubscriptionsPage() {
  return (
    <PageShell>
      <Subscriptions />
    </PageShell>
  );
}
