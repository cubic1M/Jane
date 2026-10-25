import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { FILING_STATUSES, TAX_TAGS, isFilingStatus, isTaxTagKind } from "@/config/tax";
import { filingPartnerFor } from "@/lib/filing";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { filingYear, inFilingSeason, loadReturn } from "@/lib/tax-filing";
import { balancePhrase } from "@/planning/tax-estimate-copy";
import { stateName } from "@/planning/tax-profile";
import { SignForm, StartForm } from "./file-forms";
import { LoadingBar } from "@/components/loading-bar";

// Filing (spec step 126): start the return with the filing partner, review what Jane handed
// over, and sign it. Nothing is filed until the person signs.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const LABELS: Record<string, string> = {
  wagesCents: "Wages",
  selfEmploymentCents: "Freelance income, less costs",
  interestCents: "Interest",
  dividendsCents: "Dividends",
  rentalCents: "Rent",
  retirementCents: "Pensions",
  unemploymentCents: "Unemployment",
  shortTermGainsCents: "Short-term gains",
  longTermGainsCents: "Long-term gains",
};

async function Content() {
  const user = await requireUser();
  await connection();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const year = filingYear(today);
  const [partner, ret] = await Promise.all([
    filingPartnerFor(user.id),
    loadReturn(user.id, year, { now }),
  ]);
  const season = inFilingSeason(year, today);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">File your {year} taxes</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane hands your tax profile, income, tags and forms to the filing partner. You review the
          return and sign it; nothing is filed until you do.
        </p>
      </div>
      {!partner ? (
        <p className="rounded-xl bg-zinc-100 p-4 text-sm dark:bg-zinc-900">
          Filing through Jane isn&apos;t available for your accounts yet. Your{" "}
          <Link href="/tax-pack" className="font-medium text-emerald-700 hover:underline">
            tax-time pack
          </Link>{" "}
          is ready for whoever does your taxes.
        </p>
      ) : !ret ? (
        <section aria-labelledby="start" className={CARD}>
          <h2 id="start" className="text-xl font-semibold">
            Start
          </h2>
          {season ? (
            <StartForm />
          ) : (
            <p className="text-sm">
              Filing for {year} opens in late January {year + 1}.
            </p>
          )}
          <p className="text-xs text-zinc-500">
            The filing partner here is a stand-in for the demo: nothing is sent to the IRS.
          </p>
        </section>
      ) : (
        <>
          <section aria-labelledby="status" className={CARD}>
            <h2 id="status" className="text-xl font-semibold">
              Status
            </h2>
            <p>
              {ret.status === "ready_for_review"
                ? "Ready for you to review and sign."
                : ret.status === "submitted"
                  ? `Signed by ${ret.signerName} and sent. Waiting for it to be accepted.`
                  : ret.status === "accepted"
                    ? "Accepted."
                    : "Rejected: Jane will tell you why."}
            </p>
            <p className="text-sm">
              Federal: {balancePhrase(ret.preview.federalRefundCents)}.
              {ret.preview.stateRefundCents !== null && ret.package.profile.state
                ? ` ${stateName(ret.package.profile.state)}: ${balancePhrase(ret.preview.stateRefundCents)}.`
                : ""}
            </p>
          </section>
          <section aria-labelledby="review" className={CARD}>
            <h2 id="review" className="text-xl font-semibold">
              What Jane handed over
            </h2>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-600 dark:text-zinc-400">Filing status</dt>
                <dd>
                  {isFilingStatus(ret.package.profile.filingStatus)
                    ? FILING_STATUSES[ret.package.profile.filingStatus]
                    : ret.package.profile.filingStatus}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-600 dark:text-zinc-400">Children under 17</dt>
                <dd>{ret.package.profile.childrenUnder17}</dd>
              </div>
              {Object.entries(ret.package.income)
                .filter(([k, v]) => v !== 0 && LABELS[k])
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-zinc-600 dark:text-zinc-400">{LABELS[k]}</dt>
                    <dd>{formatCents(v)}</dd>
                  </div>
                ))}
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-600 dark:text-zinc-400">Federal tax withheld</dt>
                <dd>{formatCents(ret.package.withholding.federalCents)}</dd>
              </div>
              {Object.entries(ret.package.tags)
                .filter(([t, v]) => v > 0 && isTaxTagKind(t))
                .map(([t, v]) => (
                  <div key={t} className="flex justify-between gap-2">
                    <dt className="text-zinc-600 dark:text-zinc-400">
                      {isTaxTagKind(t) ? TAX_TAGS[t].label : t}
                    </dt>
                    <dd>{formatCents(v)}</dd>
                  </div>
                ))}
            </dl>
            <ul className="text-sm">
              {ret.package.forms.map((f) => (
                <li key={`${f.form}${f.from}`}>
                  {f.form} from {f.from}: {f.received ? "received" : "not received yet"}
                </li>
              ))}
            </ul>
          </section>
          {ret.status === "ready_for_review" && (
            <section aria-labelledby="sign" className={CARD}>
              <h2 id="sign" className="text-xl font-semibold">
                Review and sign
              </h2>
              <SignForm year={ret.year} />
            </section>
          )}
        </>
      )}
      <Link href="/taxes" className="font-medium text-emerald-700 hover:underline">
        Back to taxes
      </Link>
    </>
  );
}

export default function FilePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Content />
      </Suspense>
    </main>
  );
}
