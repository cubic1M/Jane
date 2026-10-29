import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { getApplication, statusLine } from "@/lib/loan-applications";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { acceptAction, submitAction, withdrawAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { formatRate } from "@/lib/percent";

// One loan application (spec step 112): the terms to review, what's sent with it, and
// where it stands. Submit needs the terms reviewed (the box ticked); Accept signs for the
// approved loan; then Jane follows the funding and the old loan's payoff.

const BUTTON = "h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const SECONDARY =
  "h-11 rounded-full border border-zinc-300 px-5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

const DONE: Record<string, string> = {
  submitted: "Submitted. The lender answered right away.",
  accepted: "Accepted. Jane will tell you when the old loan shows zero.",
  withdrawn: "Withdrawn. Nothing changes on your loan.",
};

const when = (date: Date | null) =>
  date
    ? date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

async function ApplicationContent({
  params,
  searchParams,
}: {
  params: PageProps<"/loans/apply/[id]">["params"];
  searchParams: PageProps<"/loans/apply/[id]">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { id } = await params;
  const query = await searchParams;
  const app = await getApplication(user.id, id);
  if (!app) notFound();
  const done = typeof query.done === "string" ? DONE[query.done] : undefined;
  const error = typeof query.error === "string" ? query.error : "";
  const steps: [string, Date | null][] = [
    ["Prepared", app.createdAt],
    ["Submitted", app.submittedAt],
    ["Accepted", app.acceptedAt],
    ["Funded", app.fundedAt],
    ["Old loan paid off", app.paidOffAt],
  ];

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Loan application</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {app.lender}, paying off your {app.oldName}. {statusLine(app)}
        </p>
      </div>
      {done && (
        <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
          {error}
        </p>
      )}
      {app.partner === "demo" && (
        <p
          role="note"
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          A sample offer from a stand-in lender catalog: nothing real is applied for.
        </p>
      )}

      <section aria-labelledby="terms" className="flex flex-col gap-3">
        <h2 id="terms" className="text-xl font-semibold">
          The terms
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-zinc-500">Pays off</dt>
            <dd>
              {app.oldName}, {formatCents(app.amountCents)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Rate</dt>
            <dd>
              {formatRate(app.aprBps)} {app.rateType}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Months</dt>
            <dd>{app.termMonths}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Payment</dt>
            <dd>{formatCents(app.monthlyCents)} a month</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Fee</dt>
            <dd>{app.feeCents === 0 ? "None" : formatCents(app.feeCents)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">In all, with the fee</dt>
            <dd>
              {formatCents(app.totalCents)} ({formatCents(app.savingCents)} less than keeping it)
            </dd>
          </div>
        </dl>
        <DemoAdviceLabel />
      </section>

      <section aria-labelledby="sent" className="flex flex-col gap-2 text-sm">
        <h2 id="sent" className="text-xl font-semibold">
          Sent with it
        </h2>
        <p>
          {app.applicant.name || "Your name"} ({app.applicant.email}), and the loan it pays off:
          your {app.applicant.payingOff}, {formatCents(app.applicant.amountCents)}. No account
          numbers. Submitting is a soft check, which doesn&apos;t affect a credit score.
        </p>
      </section>

      {app.status === "draft" && (
        <div className="flex flex-col gap-3">
          <form action={submitAction} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={app.id} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="reviewed" required className="h-5 w-5" />
              I&apos;ve reviewed the terms above
            </label>
            <SubmitButton className={`${BUTTON} self-start`}>Submit the application</SubmitButton>
          </form>
          <form action={withdrawAction}>
            <input type="hidden" name="id" value={app.id} />
            <SubmitButton className="text-sm text-zinc-500 hover:underline">
              Don&apos;t apply
            </SubmitButton>
          </form>
        </div>
      )}
      {app.status === "approved" && (
        <div className="flex flex-wrap gap-3">
          <form action={acceptAction}>
            <input type="hidden" name="id" value={app.id} />
            <SubmitButton className={BUTTON}>Accept the loan</SubmitButton>
          </form>
          <form action={withdrawAction}>
            <input type="hidden" name="id" value={app.id} />
            <SubmitButton className={SECONDARY}>Don&apos;t take it</SubmitButton>
          </form>
        </div>
      )}

      <section aria-labelledby="progress" className="flex flex-col gap-2">
        <h2 id="progress" className="text-xl font-semibold">
          Where it stands
        </h2>
        <ol aria-label="Steps" className="flex flex-col gap-1 text-sm">
          {steps.map(([label, at]) => (
            <li key={label} className={at ? "" : "text-zinc-500"}>
              {label}: {when(at) ?? "not yet"}
            </li>
          ))}
        </ol>
      </section>
      <p className="text-sm">
        <Link href="/loans/refinance" className="font-medium text-emerald-700 hover:underline">
          Back to the offers
        </Link>
      </p>
    </>
  );
}

export default function ApplicationPage({ params, searchParams }: PageProps<"/loans/apply/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <ApplicationContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
