import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import {
  COUNSELOR_REFERRALS,
  COUNSEL_POINTER,
  DEBT_FACTS,
  HARDSHIP_FINDER,
  HARDSHIP_PROGRAMS,
} from "@/config/debt-trouble";
import { loadDebtTrouble } from "@/lib/debt-trouble";
import { dmpLines, headline } from "@/lib/jane-agent/debt-trouble-replies";
import { requireUser } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { LoadingBar } from "@/components/loading-bar";

// When debt is too much (spec step 229): the options laid out as facts, from the person's own
// debts. Jane doesn't advise settling or filing, gives no legal advice and contacts no one.

const LINK = "font-medium text-emerald-700 hover:underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

function Facts({ label, facts }: { label: string; facts: (typeof DEBT_FACTS)["settlement"] }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {facts.map((f) => (
        <li key={f.text}>
          {f.text}{" "}
          <a href={f.source.url} className={`${LINK} text-sm`}>
            {f.source.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

async function HelpContent() {
  const user = await requireUser();
  await connection();
  const data = await loadDebtTrouble(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">When debt is too much</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          The options, laid out plainly from your own debts. These are facts, not advice on which to
          pick, and I don&apos;t contact anyone for you.
        </p>
      </div>
      {!data.available ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          I don&apos;t see a debt with a balance.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          <p role="status" className="text-lg">
            {headline(data)}
          </p>
          <section aria-label="Hardship programs" className={CARD}>
            <h2 className="text-xl font-semibold">Ask each lender first</h2>
            <ul className="flex flex-col gap-2">
              {data.debts.map((d) => (
                <li key={d.key}>
                  <span className="font-medium">
                    {d.name} ({formatCents(d.balanceCents ?? 0)}):
                  </span>{" "}
                  {HARDSHIP_PROGRAMS[d.kind].ask}
                </li>
              ))}
            </ul>
            <a href={HARDSHIP_FINDER.url} className={`${LINK} text-sm`}>
              {HARDSHIP_FINDER.label}
            </a>
          </section>
          <section aria-label="Debt management plan" className={CARD}>
            <h2 className="text-xl font-semibold">A debt management plan</h2>
            {dmpLines(data)
              .slice(0, -1)
              .map((l) => (
                <p key={l}>{l}</p>
              ))}
            <ul className="flex flex-col gap-1 text-sm">
              {COUNSELOR_REFERRALS.map((c) => (
                <li key={c.url}>
                  <a href={c.url} className={LINK}>
                    {c.name}
                  </a>{" "}
                  <span className="text-zinc-600 dark:text-zinc-400">({c.note})</span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Settlement and bankruptcy" className={CARD}>
            <h2 className="text-xl font-semibold">Settlement and bankruptcy</h2>
            <Facts label="Debt settlement" facts={DEBT_FACTS.settlement} />
            <Facts label="Bankruptcy" facts={DEBT_FACTS.bankruptcy} />
            <Facts label="Taxes on forgiven debt" facts={DEBT_FACTS.taxes} />
            <p
              role="note"
              className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
            >
              {COUNSEL_POINTER}
            </p>
          </section>
        </>
      )}
    </>
  );
}

export default function HelpPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <HelpContent />
      </Suspense>
    </main>
  );
}
