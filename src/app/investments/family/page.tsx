import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { SimulatedBanner } from "@/components/simulated-banner";
import {
  CHILD_ROTH_SOURCE,
  CUSTODIAL_NOTE,
  KIDDIE_TAX_SOURCE,
  KIDDIE_TAX_THRESHOLD_CENTS,
} from "@/config/family";
import { loadFamily } from "@/lib/investments/family";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { makeLink, openAccount, putIn, saveChild, takeDown } from "./actions";

// Investing for the family (spec step 213, demo advice): a child's custodial account, a Roth
// IRA for a child with earned income, and a gift link for their college fund.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const SECONDARY =
  "h-11 rounded-lg border border-zinc-300 px-5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const INPUT =
  "h-11 w-32 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const DONE: Record<string, string> = {
  saved: "Saved.",
  opened: "Demo account opened.",
  contributed: "Done in the simulated brokerage (no real money moves).",
  linked: "Gift link made.",
  revoked: "Gift links taken down.",
  check: "Please check that and try again.",
};

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/family">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const v = await loadFamily(user.id);
  const origin = process.env.APP_URL ?? "http://localhost:3000";

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Investing for the family</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          A custodial account, a Roth IRA for a child who earns, and a link for relatives to give to
          their college fund.
        </p>
      </div>
      {typeof done === "string" && Object.hasOwn(DONE, done) && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {DONE[done]}
        </p>
      )}

      {v.children.map((c, i) => (
        <section
          key={c.id}
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 className="text-xl font-semibold">
            {c.name}, {c.age}
          </h2>
          {v.advice && (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">Custodial account</h3>
              <p className="text-xs text-zinc-500">
                {CUSTODIAL_NOTE} Income over {formatCents(KIDDIE_TAX_THRESHOLD_CENTS)} a year is
                taxed at your rate ({KIDDIE_TAX_SOURCE}).
              </p>
              {c.custodial ? (
                <>
                  <p className="text-sm">
                    {c.custodial.name}: {formatCents(c.custodial.balanceCents)}
                  </p>
                  <form action={putIn} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="child" value={c.id} />
                    <input type="hidden" name="kind" value="custodial" />
                    <label
                      htmlFor={`cust-${c.id}`}
                      className="flex flex-col gap-1 text-sm font-medium"
                    >
                      Put in ($)
                      <input
                        id={`cust-${c.id}`}
                        name="amount"
                        inputMode="decimal"
                        className={INPUT}
                      />
                    </label>
                    <button type="submit" className={BUTTON}>
                      Put in
                    </button>
                  </form>
                </>
              ) : (
                i === 0 &&
                v.demo && (
                  <form action={openAccount}>
                    <input type="hidden" name="kind" value="custodial" />
                    <button type="submit" className={SECONDARY}>
                      Open a demo custodial account
                    </button>
                  </form>
                )
              )}

              <h3 className="font-medium">Roth IRA for {c.name}</h3>
              {c.earnedCents > 0 ? (
                <p className="text-sm">
                  {c.name} earned {formatCents(c.earnedCents)}, so up to{" "}
                  {formatCents(Math.min(c.earnedCents, 750_000))} can go in a Roth IRA this year (
                  {CHILD_ROTH_SOURCE}).
                </p>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  A Roth IRA needs earned income (a job, not an allowance). Add what {c.name} earned
                  below.
                </p>
              )}
              {c.roth ? (
                <form action={putIn} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="child" value={c.id} />
                  <input type="hidden" name="kind" value="child_roth" />
                  <label
                    htmlFor={`roth-${c.id}`}
                    className="flex flex-col gap-1 text-sm font-medium"
                  >
                    Put in ($, up to {formatCents(c.roth.roomCents)})
                    <input
                      id={`roth-${c.id}`}
                      name="amount"
                      inputMode="decimal"
                      className={INPUT}
                    />
                  </label>
                  <button type="submit" className={BUTTON}>
                    Put in
                  </button>
                </form>
              ) : (
                i === 0 &&
                c.earnedCents > 0 &&
                v.demo && (
                  <form action={openAccount}>
                    <input type="hidden" name="kind" value="child_roth" />
                    <button type="submit" className={SECONDARY}>
                      Open a demo Roth IRA for {c.name}
                    </button>
                  </form>
                )
              )}
              <SimulatedBanner />
              <DemoAdviceLabel />
            </div>
          )}

          {c.college && (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">{c.college.goalName}</h3>
              <p className="text-sm">
                {c.college.percent}% of {formatCents(c.college.targetCents)}.
              </p>
              {c.gift ? (
                <>
                  <p className="text-sm">
                    Gift link (shows only the goal and how far along it is):{" "}
                    <code className="break-all">{`${origin}/gift/${c.gift.token}`}</code>
                  </p>
                  {c.gift.gifts.length > 0 && (
                    <ul className="text-sm">
                      {c.gift.gifts.map((g, k) => (
                        <li key={k}>
                          {g.giverName}: {formatCents(g.amountCents)}
                        </li>
                      ))}
                    </ul>
                  )}
                  <form action={takeDown}>
                    <button type="submit" className={SECONDARY}>
                      Take the link down
                    </button>
                  </form>
                </>
              ) : (
                <form action={makeLink}>
                  <input type="hidden" name="plan" value={c.college.planId} />
                  <button type="submit" className={BUTTON}>
                    Make a gift link
                  </button>
                </form>
              )}
            </div>
          )}
        </section>
      ))}

      <form action={saveChild} className="flex flex-wrap items-end gap-3">
        <label htmlFor="child-name" className="flex flex-col gap-1 text-sm font-medium">
          Child&apos;s first name
          <input id="child-name" name="name" className={INPUT} />
        </label>
        <label htmlFor="child-age" className="flex flex-col gap-1 text-sm font-medium">
          Age
          <input id="child-age" name="age" inputMode="numeric" className={INPUT} />
        </label>
        <label htmlFor="child-earned" className="flex flex-col gap-1 text-sm font-medium">
          Earned this year ($)
          <input
            id="child-earned"
            name="earned"
            inputMode="decimal"
            defaultValue="0"
            className={INPUT}
          />
        </label>
        <button type="submit" className={SECONDARY}>
          Save
        </button>
      </form>
    </>
  );
}

export default function FamilyPage(props: PageProps<"/investments/family">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
