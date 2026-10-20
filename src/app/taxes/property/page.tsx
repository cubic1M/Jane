import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { formatCents } from "@/lib/money";
import { loadPropertyTax } from "@/lib/property-tax";
import { requireUser } from "@/lib/session";
import { AnswersForm, IntentButton } from "./forms";

// Property tax that's too high (spec step 221): the assessment against the market value,
// the appeal window, the drafted appeal, and exemptions (demo advice). Nothing is filed
// without a tap.

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

const dollars = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));

async function Content() {
  const user = await requireUser();
  await connection();
  const v = await loadPropertyTax(user.id);
  const g = v.gap;
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Property tax</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Is your home assessed for more than it&apos;s worth, and are you getting the exemptions
          you qualify for? Appeal windows and exemptions are in Jane&apos;s config with their
          sources, and the county&apos;s own notice always has the real date.
        </p>
      </div>
      <section aria-labelledby="gap" className={CARD}>
        <h2 id="gap" className="text-xl font-semibold">
          The assessment
        </h2>
        {g ? (
          <>
            <p className="text-sm">
              Assessed at {formatCents(g.assessedCents)}, market value {formatCents(g.marketCents)}
              {v.figuresFrom === "partner" ? " (sample data)" : ""}.{" "}
              {g.gapCents > 0
                ? `That's ${Math.round(g.gapRate * 100)}% over, about ${formatCents(g.savingCents)} a year in tax.`
                : "It isn't over."}
            </p>
            {v.advice && (
              <p className="text-sm">
                {v.suggested
                  ? "This is worth appealing."
                  : g.worthAppealing
                    ? "The gap is big enough, but the window has closed or there are no comparable sales."
                    : "The gap is too small to be worth an appeal."}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm">
            Tell me what your home would sell for and what the county assessed it at, below.
          </p>
        )}
        <p className="text-sm">{v.window.text}</p>
        {v.window.closesOn && v.window.status !== "closed" && (
          <IntentButton intent="remind" label="Put the deadline on my plan" secondary />
        )}
      </section>
      {v.advice && v.comps.length > 0 && (
        <section aria-labelledby="comps" className={CARD}>
          <h2 id="comps" className="text-xl font-semibold">
            Comparable sales
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {v.comps.map((c) => (
              <li key={c.address}>
                {c.address}: sold {c.soldOn} for {formatCents(c.priceCents)} ({c.squareFeet} sq ft),{" "}
                {formatCents(c.adjustedCents)} at your home&apos;s size.
              </li>
            ))}
          </ul>
          {!v.appeal && v.suggested && <IntentButton intent="draft" label="Draft the appeal" />}
          <DemoAdviceLabel />
        </section>
      )}
      {v.appeal && v.appeal.status !== "dropped" && (
        <section aria-labelledby="appeal" className={CARD}>
          <h2 id="appeal" className="text-xl font-semibold">
            Your appeal
          </h2>
          <pre className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
            {v.appeal.draft}
          </pre>
          {v.appeal.status === "drafted" ? (
            <div className="flex flex-wrap gap-3">
              <IntentButton intent="team" label="My team files it" />
              <IntentButton intent="you" label="I'll file it" secondary />
              <IntentButton intent="drop" label="Never mind" secondary />
            </div>
          ) : (
            <p className="text-sm">
              {v.appeal.status === "team"
                ? "My team has it to file. I'll tell you when it's in."
                : "It's yours to file. The deadline is on your plan."}
            </p>
          )}
        </section>
      )}
      {v.advice && v.homeowner && (
        <section aria-labelledby="exemptions" className={CARD}>
          <h2 id="exemptions" className="text-xl font-semibold">
            Exemptions you may not have claimed
          </h2>
          {v.exemptions.eligible.length === 0 && (
            <p className="text-sm">
              {v.state
                ? "None that I can tell from what you've told me."
                : "Tell me your state in your tax profile and I'll look."}
            </p>
          )}
          <ul className="flex flex-col gap-4">
            {v.exemptions.eligible.map((e) => (
              <li key={e.key} className="flex flex-col gap-2 text-sm">
                <strong>{e.name}</strong>
                <span>{e.who}</span>
                <span>{e.benefit}</span>
                <div className="flex flex-wrap gap-3">
                  <IntentButton
                    intent="exemption_remind"
                    keyValue={e.key}
                    label="Remind me to apply"
                    aria={`Remind me to apply for the ${e.name}`}
                  />
                  <IntentButton
                    intent="exemption_claimed"
                    keyValue={e.key}
                    label="I already have it"
                    secondary
                    aria={`I already have the ${e.name}`}
                  />
                </div>
              </li>
            ))}
          </ul>
          {v.exemptions.ask.length > 0 && (
            <p className="text-sm">
              Tell me {v.exemptions.ask.join(" and ")} below to check for more.
            </p>
          )}
          <DemoAdviceLabel />
        </section>
      )}
      <section aria-labelledby="facts" className={CARD}>
        <h2 id="facts" className="text-xl font-semibold">
          About your home
        </h2>
        <AnswersForm
          facts={{
            market: v.figuresFrom === "you" ? dollars(v.marketCents) : "",
            assessed: v.figuresFrom === "you" ? dollars(v.assessedCents) : "",
            assessedYear: v.figuresFrom === "you" && v.assessedYear ? String(v.assessedYear) : "",
            noticeOn: "",
            age: v.facts.age == null ? "" : String(v.facts.age),
            veteran: v.facts.veteran == null ? "" : v.facts.veteran ? "yes" : "no",
            disabled: v.facts.disabled == null ? "" : v.facts.disabled ? "yes" : "no",
          }}
        />
      </section>
    </>
  );
}

export default function PropertyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
