import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DEPOSIT_STATES, RENTING_SOURCES } from "@/config/renting";
import { dayLabel } from "@/lib/day-label";
import { depositLines } from "@/lib/jane-agent/renting-replies";
import { formatCents } from "@/lib/money";
import { loadRenting } from "@/lib/renting";
import { requireUser } from "@/lib/session";
import { depositAction, depositReturnedAction, reportingAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// Renting, counted (spec step 248): rent reported to the credit bureaus only if you say so, a
// rent increase beside what is usual, and a security deposit followed to its return date.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700";
const BUTTON = "h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function RentingContent({ searchParams }: Pick<PageProps<"/loans/renting">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const p = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : (raw[k] as string | undefined));
  const d = await loadRenting(user.id);
  const lines = depositLines(d);
  const flash = p("reporting_on")
    ? "Your rent will be reported."
    : p("reporting_off")
      ? "Rent reporting is off."
      : p("deposit")
        ? "Deposit saved."
        : p("returned")
          ? "Noted that it came back."
          : null;
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your rent</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Rent that builds credit, a rent increase checked against what is usual, and a deposit that
          comes back.
        </p>
      </div>
      {flash && (
        <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
          {flash}
        </p>
      )}
      {p("error") && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {p("error")}
        </p>
      )}
      {d.renter ? (
        <>
          <section aria-label="Rent reporting" className={CARD}>
            <h2 className="text-xl font-semibold">
              {formatCents(d.monthlyCents!)} a month, {d.payments.length} payments found
            </h2>
            {d.reporting.on ? (
              <p>Reported to the credit bureaus since {dayLabel(d.reporting.since!)}.</p>
            ) : (
              <p>
                Not on your credit file. {d.reporting.note} About{" "}
                {formatCents(d.reporting.monthlyFeeCents)} a month through {d.reporting.partner}.
                Nothing is reported unless you turn it on.
              </p>
            )}
            <form action={reportingAction}>
              <input type="hidden" name="on" value={d.reporting.on ? "no" : "yes"} />
              <SubmitButton className={BUTTON}>
                {d.reporting.on ? "Turn off rent reporting" : "Report my rent"}
              </SubmitButton>
            </form>
          </section>
          {d.rise && (
            <section aria-label="Rent increase" className={CARD}>
              <h2 className="text-xl font-semibold">Your rent went up</h2>
              <p>
                From {formatCents(d.rise.beforeCents)} to {formatCents(d.rise.nowCents)} a month:{" "}
                {(d.rise.risePercentBps / 100).toFixed(1)}%, or{" "}
                {formatCents(d.rise.yearlyExtraCents)} more a year. A usual rise is about{" "}
                {(d.rise.usualBps / 100).toFixed(0)}% ({d.localRent.label.toLowerCase()}, not your
                landlord&apos;s market).
                {d.rise.askAbout ? " That's enough to ask your landlord about." : ""}
              </p>
            </section>
          )}
        </>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          I don&apos;t see rent payments in your bank data yet.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      )}
      <section aria-label="Security deposits" className={CARD}>
        <h2 className="text-xl font-semibold">Security deposits</h2>
        {lines.length > 0 && (
          <ul className="flex flex-col gap-2">
            {lines.map((l) => (
              <li key={l}>{l.replace(/^- /, "")}</li>
            ))}
          </ul>
        )}
        {d.deposits
          .filter((x) => x.view.status !== "returned")
          .map((x) => (
            <form key={x.id} action={depositReturnedAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={x.id} />
              <label className="flex flex-col gap-1 text-sm">
                Amount returned (${(x.amountCents / 100).toFixed(0)} deposit)
                <input name="returned" inputMode="decimal" className={INPUT} />
              </label>
              <SubmitButton className={`${BUTTON} self-end`}>It came back</SubmitButton>
            </form>
          ))}
        <form action={depositAction} className="grid gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            Deposit
            <input name="amount" inputMode="decimal" className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            State
            <select name="state" className={INPUT} defaultValue="CA">
              {[...DEPOSIT_STATES, "Other"].map((s) => (
                <option key={s} value={s === "Other" ? "ZZ" : s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Day you moved out
            <input name="movedOutOn" type="date" className={INPUT} />
          </label>
          <SubmitButton className={`${BUTTON} self-end`}>Follow this deposit</SubmitButton>
        </form>
      </section>
      <ul className="flex flex-col gap-1 text-sm">
        {RENTING_SOURCES.map((s) => (
          <li key={s.url}>
            <a href={s.url} className={LINK}>
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function RentingPage(props: PageProps<"/loans/renting">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <RentingContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
