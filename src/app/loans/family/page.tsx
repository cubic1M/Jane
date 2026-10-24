import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { dayLabel } from "@/lib/day-label";
import { loadFamilyLoans } from "@/lib/family-loans";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { candidateQuestion } from "@/lib/jane-agent/family-loans-replies";
import {
  addCosignedAction,
  confirmLoanAction,
  dismissLoanAction,
  settleLoanAction,
} from "./actions";
import { SubmitButton } from "@/components/submit-button";

// Money between family and friends (spec step 226): who owes whom, kept kindly. A transfer is
// a loan only after the person says so, Jane never messages the other person, and a reminder
// is text to send yourself.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700";
const BUTTON = "h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";

async function FamilyContent({ searchParams }: Pick<PageProps<"/loans/family">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const p = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : (raw[k] as string | undefined));
  const data = await loadFamilyLoans(user.id);
  const flash = ["confirmed", "dismissed", "settled", "cosigned"].find((k) => p(k));
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Family and friends</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Who owes whom, kept kindly. A payment-app transfer is a loan only after you say so, and
          Jane never messages the other person: a reminder is a note for you to send.
        </p>
      </div>
      {flash && (
        <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
          {flash === "confirmed"
            ? "Noted."
            : flash === "dismissed"
              ? "Got it: not a loan."
              : flash === "settled"
                ? "Marked settled."
                : "Added."}
        </p>
      )}
      {p("error") && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {p("error")}
        </p>
      )}

      {data.candidates.length > 0 && (
        <section aria-labelledby="ask" className="flex flex-col gap-3">
          <h2 id="ask" className="text-xl font-semibold">
            Was this a loan?
          </h2>
          <ul aria-label="Transfers" className="flex flex-col gap-3">
            {data.candidates.map((c) => (
              <li
                key={c.id}
                className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
              >
                <p>{candidateQuestion(c)}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <form action={confirmLoanAction}>
                    <input type="hidden" name="candidateId" value={c.id} />
                    <SubmitButton className={BUTTON}>
                      {c.kind === "lent" ? "Yes, I lent it" : "Yes, I borrowed it"}
                    </SubmitButton>
                  </form>
                  <form action={dismissLoanAction}>
                    <input type="hidden" name="candidateId" value={c.id} />
                    <SubmitButton className={LINK}>No, it wasn&apos;t a loan</SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="loans" className="flex flex-col gap-3">
        <h2 id="loans" className="text-xl font-semibold">
          Loans
        </h2>
        {data.loans.length === 0 ? (
          <p className="text-sm">No money lent or borrowed that you&apos;ve confirmed.</p>
        ) : (
          <ul aria-label="Loans" className="flex flex-col gap-3">
            {data.loans.map((l) => (
              <li
                key={l.id}
                className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
              >
                <p className="font-medium">
                  {l.kind === "lent" ? `${l.counterparty} owes you` : `You owe ${l.counterparty}`}{" "}
                  {formatCents(l.balanceCents)}
                </p>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {formatCents(l.principalCents)} {l.kind === "lent" ? "lent" : "borrowed"} on{" "}
                  {dayLabel(l.openedOn, { year: true })}
                  {l.repaid.length
                    ? `; paid back so far: ${l.repaid.map((r) => `${formatCents(r.cents)} on ${dayLabel(r.date)}`).join(", ")}`
                    : ""}
                  .
                </p>
                {l.reminder && (
                  <div role="note" className="mt-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                    <p className="font-medium">A kind reminder, for you to send</p>
                    <p>{l.reminder.text}</p>
                  </div>
                )}
                <form action={settleLoanAction} className="mt-2">
                  <input type="hidden" name="loanId" value={l.id} />
                  <SubmitButton className={LINK}>Mark settled</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cosigned" className="flex flex-col gap-3">
        <h2 id="cosigned" className="text-xl font-semibold">
          Loans you co-signed
        </h2>
        {data.cosigned.length > 0 && (
          <ul aria-label="Co-signed loans" className="flex flex-col gap-2 text-sm">
            {data.cosigned.map((c) => (
              <li key={c.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <p>
                  {c.debtName} for {c.counterparty}:{" "}
                  {c.missed ? "a payment looks late." : "payments are on time."}
                </p>
                {c.text && (
                  <p className="text-zinc-600 dark:text-zinc-400">
                    A note to send yourself: {c.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {data.cosignable.length > 0 && (
          <form
            action={addCosignedAction}
            aria-label="Add a co-signed loan"
            className="grid gap-3 sm:grid-cols-3"
          >
            <label className="flex flex-col gap-1 text-sm">
              Your loan
              <select name="debtKey" className={INPUT}>
                {data.cosignable.map((d) => (
                  <option key={d.debtKey} value={d.debtKey}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Co-signed for
              <input name="counterparty" className={INPUT} />
            </label>
            <SubmitButton className={`${BUTTON} self-end`}>Watch it</SubmitButton>
          </form>
        )}
      </section>

      {(data.shared.length > 0 || data.inHousehold) && (
        <section aria-labelledby="shared" className="flex flex-col gap-2 text-sm">
          <h2 id="shared" className="text-xl font-semibold">
            Shared debts
          </h2>
          {data.shared.length === 0 ? (
            <p>
              No debt is on an account you share with your household yet.{" "}
              <Link href="/household" className={LINK}>
                Household
              </Link>
            </p>
          ) : (
            <ul aria-label="Shared debts" className="flex flex-col gap-1">
              {data.shared.map((s) => (
                <li key={s.debtKey}>
                  {s.name}:{" "}
                  {s.yourShareCents === null
                    ? "no payment known"
                    : `your half of the ${formatCents(s.paymentCents ?? 0)} payment is ${formatCents(s.yourShareCents)} a month`}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

export default function FamilyPage({ searchParams }: PageProps<"/loans/family">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <FamilyContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
