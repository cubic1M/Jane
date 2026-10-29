import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { CREDIT_FREEZE_URLS, IP_PIN, SIGNS } from "@/config/tax-identity";
import { dayLabel } from "@/lib/day-label";
import { requireUser } from "@/lib/session";
import { loadIdentity } from "@/lib/tax-identity";
import { PinButtons, SignButtons, StepButton } from "./forms";

// A protected tax identity (spec step 218): the IP PIN, and, on a sign of theft, the steps
// in order, each tracked to done. The steps are the person's own.

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function Content() {
  const user = await requireUser();
  await connection();
  const v = await loadIdentity(user.id);
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your tax identity</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Tax identity theft is someone filing a return with your Social Security number. An IRS
          Identity Protection PIN stops it. If it has happened, the steps below are in order.
        </p>
      </div>
      <section aria-labelledby="ip-pin" className={CARD}>
        <h2 id="ip-pin" className="text-xl font-semibold">
          IRS Identity Protection PIN
        </h2>
        <p className="text-sm">
          A six-digit number only you have; no one else can file with your Social Security number
          without it. {IP_PIN.who} You get a new one every January.
        </p>
        <a href={IP_PIN.url} className={LINK} rel="noreferrer">
          Get my IP PIN on irs.gov
        </a>
        <p className="text-sm">
          {v.havePin ? `You have it for ${v.year}.` : v.reminded ? "It's on your deadlines." : ""}
        </p>
        {!v.havePin && <PinButtons canRemind={v.season && !v.reminded} />}
      </section>
      {v.case ? (
        <section aria-labelledby="case" className={CARD}>
          <h2 id="case" className="text-xl font-semibold">
            {SIGNS[v.case.sign].title}
          </h2>
          <p className="text-sm">Opened {dayLabel(v.case.openedOn, { year: true })}.</p>
          <ol className="flex flex-col gap-4">
            {v.case.steps.map((s) => (
              <li key={s.key} className="flex flex-col gap-1 text-sm">
                <strong>
                  {s.title}
                  {s.doneOn ? ` (done ${dayLabel(s.doneOn, { year: true })})` : ""}
                </strong>
                <span className="text-zinc-600 dark:text-zinc-400">{s.how}</span>
                {s.phone && <span>Phone: {s.phone}</span>}
                {s.url && (
                  <a href={s.url} className={LINK} rel="noreferrer">
                    Open the guide
                  </a>
                )}
                {s.key === "credit_freeze" && (
                  <span className="flex flex-wrap gap-3">
                    {Object.entries(CREDIT_FREEZE_URLS).map(([name, url]) => (
                      <a key={name} href={url} className={LINK} rel="noreferrer">
                        {name}
                      </a>
                    ))}
                  </span>
                )}
                {!s.doneOn && <StepButton step={s.key} title={s.title} />}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section aria-labelledby="report" className={CARD}>
          <h2 id="report" className="text-xl font-semibold">
            Think someone used your number?
          </h2>
          <p className="text-sm">
            Pick what happened and Jane gives you the steps in order and keeps track of them.
          </p>
          <SignButtons signs={Object.entries(SIGNS).map(([key, s]) => ({ key, title: s.title }))} />
        </section>
      )}
    </>
  );
}

export default function IdentityPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Content />
      </Suspense>
    </main>
  );
}
