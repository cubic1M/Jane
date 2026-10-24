import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import {
  ESCROW_EXPLAINER,
  ESCROW_SOURCE,
  HOME_EQUITY_SOURCE,
  PMI_SOURCE,
} from "@/config/home-equity";
import { PROJECT_NOTES, PROJECT_YEARS_DEFAULT } from "@/config/home-equity";
import { HomeEquityError, compareHomeProject, loadHomeEquity } from "@/lib/home-equity";
import { escrowLines, pmiLines } from "@/lib/jane-agent/home-equity-replies";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { requestSentAction, saveFactsAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// A home's equity, used well (spec step 228): PMI against the home's original value, escrow
// against the real bills, and ways to borrow for a project with each one's total cost (demo
// advice). Jane drafts the requests; the person sends them.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700";
const BUTTON = "h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const dollars = (cents: number | null) => (cents === null ? "" : String(cents / 100));

async function EquityContent({ searchParams }: Pick<PageProps<"/loans/equity">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const p = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : (raw[k] as string | undefined));
  const data = await loadHomeEquity(user.id);
  let projectError: string | null = null;
  let project = null;
  const asked = Number(String(p("project") ?? "").replace(/[$,]/g, ""));
  if (data.available && data.advice && asked > 0) {
    try {
      project = await compareHomeProject(user.id, {
        projectCents: Math.round(asked * 100),
        years: Number(p("years") ?? PROJECT_YEARS_DEFAULT),
      });
    } catch (error) {
      if (!(error instanceof HomeEquityError)) throw error;
      projectError = error.message;
    }
  }
  const sent = (which: "pmi" | "escrow") => (
    <form action={requestSentAction}>
      <input type="hidden" name="which" value={which} />
      <SubmitButton className={BUTTON}>
        {which === "pmi" ? "I sent the PMI request" : "I sent the escrow request"}
      </SubmitButton>
    </form>
  );
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your home loan, used well</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          PMI against what the home was worth when you bought it, escrow against your real bills,
          and the ways to borrow for a project.
        </p>
      </div>
      {!data.available ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          I don&apos;t see a mortgage with a balance yet.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          {p("saved") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Saved.
            </p>
          )}
          {p("sent") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Noted that you sent it.
            </p>
          )}
          {(p("error") || projectError) && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {p("error") ?? projectError}
            </p>
          )}
          <section aria-label="What you know" className={CARD}>
            <h2 className="text-xl font-semibold">What you know about the loan</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {data.loanName}: {formatCents(data.balanceCents)} left. I don&apos;t guess these; they
              come from your closing papers and your tax and insurance bills.
            </p>
            <form action={saveFactsAction} className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                Home&apos;s value when the loan began
                <input
                  name="originalValue"
                  inputMode="decimal"
                  defaultValue={dollars(data.facts.originalValueCents)}
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Property tax, a year
                <input
                  name="yearlyTax"
                  inputMode="decimal"
                  defaultValue={dollars(data.facts.yearlyTaxCents)}
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Homeowners insurance, a year
                <input
                  name="yearlyInsurance"
                  inputMode="decimal"
                  defaultValue={dollars(data.facts.yearlyInsuranceCents)}
                  className={INPUT}
                />
              </label>
              <SubmitButton className={`${BUTTON} sm:col-span-3 sm:justify-self-start`}>
                Save
              </SubmitButton>
            </form>
          </section>

          <section aria-label="PMI" className={CARD}>
            <h2 className="text-xl font-semibold">PMI</h2>
            {data.hasPmi === false ? (
              <p>Your bank says your loan has no PMI.</p>
            ) : data.hasPmi === null ? (
              <p>
                Your bank doesn&apos;t say whether your loan has PMI. Your annual statement does.
              </p>
            ) : !data.pmi ? (
              <p>
                Tell me the home&apos;s value when the loan began and I&apos;ll work out where you
                are.
              </p>
            ) : (
              pmiLines(data).map((l) => <p key={l}>{l}</p>)
            )}
            {data.pmiLetter && (
              <>
                <pre
                  aria-label="Drafted PMI request"
                  className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900"
                >
                  {data.pmiLetter}
                </pre>
                {data.facts.pmiLetterSentOn ? (
                  <p className="text-sm">You sent this on {data.facts.pmiLetterSentOn}.</p>
                ) : (
                  sent("pmi")
                )}
              </>
            )}
            <a href={PMI_SOURCE} className={`${LINK} text-sm`}>
              When can I remove PMI? (CFPB)
            </a>
          </section>

          <section aria-label="Escrow" className={CARD}>
            <h2 className="text-xl font-semibold">Escrow</h2>
            {escrowLines(data).length === 0 ? (
              <p>Give me your yearly property tax and insurance and I&apos;ll check your escrow.</p>
            ) : (
              escrowLines(data).map((l) => <p key={l}>{l}</p>)
            )}
            {data.escrowLetter && (
              <>
                <pre
                  aria-label="Drafted escrow request"
                  className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900"
                >
                  {data.escrowLetter}
                </pre>
                {data.facts.escrowRequestSentOn ? (
                  <p className="text-sm">You sent this on {data.facts.escrowRequestSentOn}.</p>
                ) : (
                  sent("escrow")
                )}
              </>
            )}
            <div className="flex flex-col gap-1 text-sm">
              <a href={ESCROW_EXPLAINER} className={LINK}>
                What is an escrow account? (CFPB)
              </a>
              <a href={ESCROW_SOURCE} className={LINK}>
                The escrow rules (Regulation X, section 1024.17)
              </a>
            </div>
          </section>

          <section aria-label="A home project" className={CARD}>
            <h2 className="text-xl font-semibold">Paying for a home project</h2>
            {!data.advice ? (
              <p className="text-zinc-600 dark:text-zinc-400">
                Comparing ways to borrow against your home is advice, and Jane only gives it for the
                demo bank.
              </p>
            ) : (
              <>
                <DemoAdviceLabel />
                <form
                  method="get"
                  action="/loans/equity"
                  aria-label="Compare ways to pay"
                  className="grid gap-3 sm:grid-cols-3"
                >
                  <label className="flex flex-col gap-1 text-sm">
                    What it costs
                    <input
                      name="project"
                      inputMode="decimal"
                      defaultValue={p("project")}
                      className={INPUT}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Years to pay it back
                    <input
                      name="years"
                      inputMode="numeric"
                      defaultValue={p("years") ?? String(PROJECT_YEARS_DEFAULT)}
                      className={INPUT}
                    />
                  </label>
                  <button type="submit" className={`${BUTTON} self-end`}>
                    Compare
                  </button>
                </form>
                {project && (
                  <>
                    <table aria-label="Ways to pay" className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-zinc-600 dark:text-zinc-400">
                          <th className="py-1 font-medium">Way</th>
                          <th className="py-1 font-medium">Rate</th>
                          <th className="py-1 font-medium">A month</th>
                          <th className="py-1 font-medium">Up front</th>
                          <th className="py-1 font-medium">Total cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {project.options.map((o) => (
                          <tr
                            key={o.product}
                            className="border-t border-zinc-200 dark:border-zinc-800"
                          >
                            <td className="py-1">{o.label}</td>
                            {o.available ? (
                              <>
                                <td className="py-1">{o.aprBps / 100}%</td>
                                <td className="py-1">{formatCents(o.monthlyCents)}</td>
                                <td className="py-1">{formatCents(o.upfrontCents)}</td>
                                <td className="py-1">{formatCents(o.totalCostCents)}</td>
                              </>
                            ) : (
                              <td colSpan={4} className="py-1">
                                Not an option: {o.why}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <ul className="list-disc pl-5 text-sm">
                      {project.options
                        .filter((o) => o.available)
                        .map((o) => (
                          <li key={o.product}>
                            {o.label}: {PROJECT_NOTES[o.product]}
                          </li>
                        ))}
                    </ul>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      Total cost is interest and fees. For the cash-out refinance it&apos;s the
                      extra interest against keeping your mortgage, plus closing costs. These are
                      stand-in lender terms, not offers ({HOME_EQUITY_SOURCE}).
                    </p>
                  </>
                )}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default function EquityPage({ searchParams }: PageProps<"/loans/equity">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <EquityContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
