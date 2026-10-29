import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { loadPlanMenu } from "@/lib/investments/plan-menu";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import type { MenuFund } from "@/planning/plan-menu";
import { confirm, sendChange, useSample } from "./actions";
import { ReadForm } from "./read-form";
import { SubmitButton } from "@/components/submit-button";
import { formatPercent as pct, formatRate } from "@/lib/percent";

// The workplace plan's menu, used well (spec step 232, demo advice): the funds the plan
// offers, read from a disclosure and confirmed, and the cheapest mix of them for the
// person's target. Only funds on the menu are ever suggested.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const SECONDARY =
  "h-11 rounded-lg border border-zinc-300 px-5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const KINDS: Record<string, string> = {
  us_stocks: "US stocks",
  intl_stocks: "International stocks",
  bonds: "Bonds",
  cash: "Cash",
  target_date: "Target date",
  other: "Other",
};

function Table({ funds }: { funds: MenuFund[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-zinc-500">
          <th className="font-normal">Fund</th>
          <th className="font-normal">Kind</th>
          <th className="text-right font-normal">Costs a year</th>
        </tr>
      </thead>
      <tbody>
        {funds.map((f) => (
          <tr key={f.ticker}>
            <td>
              {f.ticker} {f.name}
            </td>
            <td>{KINDS[f.kind]}</td>
            <td className="text-right">{formatRate(f.expenseBps)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/plan-menu">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const v = await loadPlanMenu(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Your workplace plan&apos;s funds</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Your 401(k) only offers certain funds. Paste its fee disclosure and I&apos;ll find the
          cheapest mix of those funds for your target. I only ever suggest funds on your plan&apos;s
          list.
        </p>
      </div>
      {done && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {done === "confirmed"
            ? "Saved."
            : done === "requested"
              ? "Requested through the payroll stand-in. Your plan changes when it does."
              : "That changed since you last looked."}
        </p>
      )}
      {v.proposed && (
        <section className="flex flex-col gap-2 rounded-xl border border-amber-300 p-4 dark:border-amber-800">
          <h2 className="text-xl font-semibold">Is this your plan&apos;s list?</h2>
          <Table funds={v.proposed.funds} />
          <form action={confirm} className="flex gap-3">
            <input type="hidden" name="id" value={v.proposed.id} />
            <SubmitButton className={BUTTON}>Yes, that&apos;s right</SubmitButton>
          </form>
        </section>
      )}
      {v.menu && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">
            {v.menu.planName}: {v.menu.funds.length} funds
          </h2>
          <Table funds={v.menu.funds} />
        </section>
      )}
      {v.advice && v.plan && (
        <section className="flex flex-col gap-3 rounded-xl border border-emerald-300 p-4 dark:border-emerald-800">
          <h2 className="text-xl font-semibold">The cheapest mix for your target</h2>
          <p className="text-sm">
            Your {v.plan.accountName} holds {formatCents(v.plan.balanceCents)} and costs about{" "}
            {formatCents(Math.round((v.plan.balanceCents * v.plan.currentBps) / 10_000))} a year (
            {formatRate(v.plan.currentBps)}). The cheapest mix of your plan&apos;s funds for your
            risk level costs about{" "}
            {formatCents(Math.round((v.plan.balanceCents * v.plan.suggestedBps) / 10_000))} (
            {formatRate(v.plan.suggestedBps)}): {formatCents(v.plan.savingCents)} a year less.
          </p>
          <ul className="list-disc pl-5 text-sm">
            {v.plan.suggested.map((a) => (
              <li key={a.ticker}>
                {pct(a.share)} {a.ticker} {a.name} ({formatRate(a.expenseBps)})
              </li>
            ))}
          </ul>
          {v.plan.missing.length > 0 && (
            <p className="text-xs text-zinc-500">
              Your plan has no {v.plan.missing.join(" or ")} fund, so I used the closest one it has.
            </p>
          )}
          {v.plan.targetDates.filter(Boolean).map((t) => (
            <p key={t!.ticker} className="text-sm">
              {t!.ticker}, the plan&apos;s target-date fund, costs {formatRate(t!.fundBps)} (
              {formatCents(t!.fundCents)} a year on your balance). Building the same mix by hand
              from the cheapest funds costs {formatRate(t!.handBps)}: {formatCents(t!.savingCents)}{" "}
              a year less.
            </p>
          ))}
          {v.pending ? (
            <p className="text-sm">A change is already requested.</p>
          ) : (
            v.plan.savingCents > 0 && (
              <form action={sendChange}>
                <SubmitButton className={BUTTON}>Send this mix to my plan</SubmitButton>
              </form>
            )
          )}
          <DemoAdviceLabel />
        </section>
      )}
      {!v.proposed && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">
            {v.menu ? "Read a new list" : "Read your plan's list"}
          </h2>
          <ReadForm />
          {v.demo && (
            <form action={useSample}>
              <SubmitButton className={SECONDARY}>Use the demo plan&apos;s disclosure</SubmitButton>
            </form>
          )}
        </section>
      )}
    </>
  );
}

export default function PlanMenuPage(props: PageProps<"/investments/plan-menu">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
