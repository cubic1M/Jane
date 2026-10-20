import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { PROMO_SOURCE } from "@/config/card-interest";
import { dayLabel } from "@/lib/day-label";
import { loadCardInterest } from "@/lib/card-interest";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { promoLine } from "@/planning/card-interest";
import { addPromoAction, removePromoAction, sendRateAction } from "./actions";

// Less interest on every card (spec step 224): each card's interest, what paying earlier
// saves, 0% promotions with their pace, and a request for a lower rate sent only on a tap.
// Demo advice, labelled.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700";
const BUTTON = "h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";

async function InterestContent({
  searchParams,
}: Pick<PageProps<"/loans/interest">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const p = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : (raw[k] as string | undefined));
  const data = await loadCardInterest(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Less card interest</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Interest cut without a new card: pay earlier, clear 0% promotions in time, and ask for a
          lower rate. Nothing is sent until you tap.
        </p>
      </div>
      {!data.available ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          This needs a lending partner, and there isn&apos;t one for your accounts yet.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          <DemoAdviceLabel />
          {p("sent") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Sent just now.
            </p>
          )}
          {p("added") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Promotion added.
            </p>
          )}
          {p("removed") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Removed.
            </p>
          )}
          {p("error") && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {p("error")}
            </p>
          )}
          <section aria-labelledby="cards" className="flex flex-col gap-3">
            <h2 id="cards" className="text-xl font-semibold">
              Your cards
            </h2>
            {data.cards.length === 0 ? (
              <p className="text-sm">No card is charging you interest right now.</p>
            ) : (
              <>
                <p>
                  About <strong>{formatCents(data.interestYearCents)}</strong> a year in interest at
                  today&apos;s balances.
                </p>
                <ul aria-label="Cards" className="flex flex-col gap-3">
                  {data.cards.map((c) => (
                    <li
                      key={c.debtKey}
                      className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
                    >
                      <p className="font-medium">
                        {c.name}: {formatCents(c.balanceCents)} at {(c.aprBps / 100).toFixed(2)}%
                      </p>
                      <p>About {formatCents(c.interestYearCents)} a year in interest.</p>
                      {c.payEarly && (
                        <p>
                          Paying the {formatCents(c.payEarly.amountCents)} now, not on the due date,
                          saves {formatCents(c.payEarly.savedCents)}.
                        </p>
                      )}
                      {c.statementClosesOn && (
                        <p>Statement closes {dayLabel(c.statementClosesOn)}.</p>
                      )}
                      {c.rate &&
                        (c.rate.sent ? (
                          <p className="mt-2">
                            Asked {dayLabel(c.rate.sent.sentOn)}:{" "}
                            {c.rate.sent.outcome ?? "waiting for their answer (about 2 days)"}
                          </p>
                        ) : (
                          <div className="mt-2 flex flex-col gap-2">
                            <p>
                              A lower rate of {(c.rate.newAprBps / 100).toFixed(2)}% would save
                              about {formatCents(c.rate.savingYearlyCents)} a year.
                            </p>
                            <p className="whitespace-pre-line text-zinc-600 dark:text-zinc-400">
                              {c.rate.script}
                            </p>
                            <p className="whitespace-pre-line text-zinc-600 dark:text-zinc-400">
                              {c.rate.body}
                            </p>
                            <form action={sendRateAction}>
                              <input type="hidden" name="requestId" value={c.rate.id} />
                              <button type="submit" className={BUTTON}>
                                Send this request
                              </button>
                            </form>
                          </div>
                        ))}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <section aria-labelledby="promos" className="flex flex-col gap-3">
            <h2 id="promos" className="text-xl font-semibold">
              0% promotions
            </h2>
            {data.promos.length > 0 && (
              <ul aria-label="Promotions" className="flex flex-col gap-2 text-sm">
                {data.promos.map((pr) => (
                  <li
                    key={pr.id}
                    className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <p>{promoLine(pr.cardName, pr.plan, pr.endsOn)}</p>
                    <p
                      className={
                        pr.plan.onPace
                          ? "text-emerald-800 dark:text-emerald-200"
                          : "text-amber-800 dark:text-amber-300"
                      }
                    >
                      {pr.plan.onPace
                        ? "You're on pace to clear it."
                        : `You pay ${formatCents(pr.plan.monthlyPaidCents)} a month: ${formatCents(pr.plan.shortCents)} short.${pr.deferred ? ` Missing it would charge about ${formatCents(pr.plan.costIfMissedCents)} in deferred interest.` : ""}${pr.deadlineRaised ? " It's on your deadlines." : ""}`}
                    </p>
                    <form action={removePromoAction} className="mt-1">
                      <input type="hidden" name="promoId" value={pr.id} />
                      <button type="submit" className={LINK}>
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form
              action={addPromoAction}
              aria-label="Add a promotion"
              className="grid gap-3 sm:grid-cols-3"
            >
              <label className="flex flex-col gap-1 text-sm">
                Card
                <input name="cardName" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Left to clear
                <input name="balance" inputMode="decimal" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Rate after the promotion %
                <input name="goToApr" inputMode="decimal" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Started
                <input name="startedOn" type="date" className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Ends
                <input name="endsOn" type="date" className={INPUT} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input name="deferred" type="checkbox" /> Deferred interest
              </label>
              <button type="submit" className={`${BUTTON} sm:col-span-3 sm:w-fit`}>
                Add this promotion
              </button>
            </form>
            <a href={PROMO_SOURCE} className={`${LINK} text-sm`}>
              What deferred interest means (CFPB)
            </a>
          </section>
        </>
      )}
    </>
  );
}

export default function InterestPage({ searchParams }: PageProps<"/loans/interest">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <InterestContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
