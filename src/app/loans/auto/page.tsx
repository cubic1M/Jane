import { dayLabel } from "@/lib/day-label";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { ADDON_KINDS, ADDON_RULES, ADDON_SOURCES } from "@/config/car-loan";
import { formatRate } from "@/insights/loans";
import { loadCarLoan } from "@/lib/car-loan";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import {
  addAddonAction,
  cancelAddonAction,
  confirmAddonAction,
  dismissAddonAction,
} from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// The car loan you already have (spec step 245): the best refinance by total cost, dealer
// add-ons found in the loan with the refund each would give, and the cancellation drafted for
// the person to send or the team to send for them. Estimates; Jane sends nothing.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700";
const BUTTON = "h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const OUTLINE =
  "h-11 rounded-full border border-zinc-300 px-5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function AutoContent({ searchParams }: Pick<PageProps<"/loans/auto">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const p = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : (raw[k] as string | undefined));
  const data = await loadCarLoan(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your car loan</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Whether a cheaper loan exists, and whether the dealer added things you could cancel for a
          refund.
        </p>
      </div>
      {!data.available || !data.loan ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          I don&apos;t see a car loan with a balance.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          {["confirmed", "dismissed", "added", "requested"].map(
            (k) =>
              p(k) && (
                <p key={k} role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
                  Done.
                </p>
              ),
          )}
          {p("error") && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {p("error")}
            </p>
          )}
          <section aria-label="The loan" className={CARD}>
            <h2 className="text-xl font-semibold">{data.loan.name}</h2>
            <p>
              {formatCents(data.loan.balanceCents)} left
              {data.loan.aprBps !== null ? ` at ${formatRate(data.loan.aprBps)}` : ""}
              {data.loan.monthlyCents !== null
                ? `, ${formatCents(data.loan.monthlyCents)} a month`
                : ""}
              .
            </p>
            {data.advice && data.refi ? (
              <>
                <DemoAdviceLabel />
                <p>
                  {data.refi.savingCents > 0
                    ? `Refinancing with ${data.refi.lender} at ${formatRate(data.refi.aprBps)} would cost ${formatCents(data.refi.newTotalCents)} in all against ${formatCents(data.refi.currentTotalCents)} for keeping it: ${formatCents(data.refi.savingCents)} less, fees of ${formatCents(data.refi.feeCents)} included.`
                    : `No refinance offer beats this loan on total cost right now.`}
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Compared on total cost, not the payment: a lower payment over a longer term can
                  cost more. Sample offers from a stand-in lender catalog
                  {data.refi.checkedOn
                    ? `, checked ${dayLabel(data.refi.checkedOn, { year: true })}`
                    : ""}
                  .
                </p>
                {data.change && (
                  <p role="status">
                    {data.change.kind === "rates_fell"
                      ? "Rates fell since the last check."
                      : "Your score moved into a better band since the last check."}
                  </p>
                )}
              </>
            ) : null}
          </section>

          <section aria-label="Dealer add-ons" className={CARD}>
            <h2 className="text-xl font-semibold">Dealer add-ons</h2>
            {data.candidates.map((c) => (
              <div
                key={c.key}
                className="flex flex-col gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900"
              >
                <p>
                  {formatCents(c.paidCents)} to {c.name} on {dayLabel(c.startedOn, { year: true })}:
                  looks like {c.label.toLowerCase()}. Was it?
                </p>
                <form action={confirmAddonAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="key" value={c.key} />
                  <label className="flex flex-col gap-1 text-sm">
                    Term in months
                    <input
                      name="termMonths"
                      defaultValue={c.termMonths}
                      inputMode="numeric"
                      className={`${INPUT} w-28`}
                    />
                  </label>
                  <SubmitButton className={BUTTON}>Yes, it was</SubmitButton>
                </form>
                <form action={dismissAddonAction}>
                  <input type="hidden" name="key" value={c.key} />
                  <SubmitButton className={OUTLINE}>No, it wasn&apos;t</SubmitButton>
                </form>
              </div>
            ))}
            {data.addons.length === 0 && data.candidates.length === 0 && (
              <p className="text-zinc-600 dark:text-zinc-400">
                I haven&apos;t found one in your payments. If you have one, add it below.
              </p>
            )}
            <ul aria-label="Your add-ons" className="flex flex-col gap-3">
              {data.addons.map((a) => (
                <li
                  key={a.key}
                  className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <p className="font-medium">
                    {a.label}: {a.name}, {formatCents(a.paidCents)}
                  </p>
                  <p>
                    Cancelling now could refund about {formatCents(a.refund.refundCents)} (
                    {a.refund.monthsLeft} of {a.termMonths} months unused
                    {a.refund.feeCents > 0
                      ? `, less about ${formatCents(a.refund.feeCents)} in fees`
                      : ""}
                    ). An estimate: your contract has the final say.
                  </p>
                  {a.letter && (
                    <pre
                      aria-label={`Cancellation letter for ${a.name}`}
                      className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900"
                    >
                      {a.letter}
                    </pre>
                  )}
                  {a.status === "confirmed" && a.id ? (
                    <div className="flex flex-wrap gap-2">
                      <form action={cancelAddonAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="by" value="mine" />
                        <SubmitButton className={BUTTON}>I&apos;ll send it myself</SubmitButton>
                      </form>
                      {data.team && (
                        <form action={cancelAddonAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="by" value="team" />
                          <SubmitButton className={OUTLINE}>Have the team send it</SubmitButton>
                        </form>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm">
                      {a.status === "team"
                        ? "The team has this request."
                        : "You said you'd send this yourself."}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <form
              action={addAddonAction}
              aria-label="Add one"
              className="grid gap-3 sm:grid-cols-5"
            >
              <label className="flex flex-col gap-1 text-sm">
                Kind
                <select name="kind" className={INPUT}>
                  {ADDON_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ADDON_RULES[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Sold by
                <input name="name" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Price
                <input name="paid" inputMode="decimal" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Term in months
                <input name="termMonths" inputMode="numeric" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Bought on
                <input name="startedOn" type="date" className={INPUT} />
              </label>
              <SubmitButton className={`${BUTTON} sm:col-span-5 sm:justify-self-start`}>
                Add it
              </SubmitButton>
            </form>
            <ul className="flex flex-col gap-1 text-sm">
              {ADDON_SOURCES.map((s) => (
                <li key={s.url}>
                  <a href={s.url} className={LINK}>
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

export default function AutoPage({ searchParams }: PageProps<"/loans/auto">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <AutoContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
