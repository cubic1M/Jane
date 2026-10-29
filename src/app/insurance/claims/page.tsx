import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { CLAIM_CONTACT_FALLBACK } from "@/config/claims";
import { eventLabel, guideFor, listClaims, nextStep, type Claim } from "@/lib/insurance/claims";
import { kindWords } from "@/lib/insurance/gaps";
import { listPolicies } from "@/lib/insurance/policies";
import { requireUser } from "@/lib/session";
import {
  claimNumber,
  draftClaimForm,
  fileClaimForm as fileIt,
  finishClaim,
  stepDone,
} from "./actions";
import { canFile } from "@/lib/insurance/claim-filing";
import { partnerFor } from "@/lib/insurance/partner";
import { STATUS_WORDS } from "@/lib/insurance/claim-rules";
import { draftBody } from "@/lib/jane-agent/insurance/done-by-jane-words";
import { formatCents } from "@/lib/money";
import { adviceLines, payoutLine } from "@/lib/insurance/claim-worth";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { claimWorthFor } from "@/lib/insurance/claim-worth-for";
import { StartClaimForm } from "./start-form";
import { SubmitButton } from "@/components/submit-button";
import { dayLabel } from "@/lib/day-label";

// Claims (spec step 107): when something happens, what to do now, what to collect, who to
// call, and a tracker of the claim's steps. Every step stays on the claim until it's closed.

const LINK = "font-medium text-emerald-700 hover:underline";
const SMALL_BUTTON =
  "inline-flex h-9 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700";
const INPUT =
  "h-9 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-sm dark:border-zinc-700";

// Spec step 155: filed by Jane, a draft to check and file, or the form to write one up.
function Filing({ claim, filable }: { claim: Claim; filable: boolean }) {
  if (claim.filing === "filed") {
    return (
      <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50">
        Filed by Jane: {claim.carrier} {STATUS_WORDS[claim.carrierStatus ?? "received"]}, number{" "}
        {claim.claimNumber}.
        {claim.payoutCents !== null && claim.payoutCents !== undefined
          ? ` Payment: ${formatCents(claim.payoutCents)}.`
          : ""}
      </p>
    );
  }
  if (!filable) return null;
  if (claim.filing === "draft") {
    const [intro, ...lines] = draftBody(claim).split("\n");
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <p className="font-medium">{intro}</p>
        <ul>
          {lines.map((l) => (
            <li key={l}>{l.replace(/^- /, "")}</li>
          ))}
        </ul>
        <form action={fileIt}>
          <input type="hidden" name="claimId" value={claim.id} />
          <SubmitButton className={SMALL_BUTTON}>File it</SubmitButton>
        </form>
      </div>
    );
  }
  return (
    <form action={draftClaimForm} className="flex flex-col gap-2 text-sm">
      <p className="font-medium">
        Jane can file this claim for you. It&apos;ll show you before it goes.
      </p>
      <input type="hidden" name="claimId" value={claim.id} />
      <label htmlFor={`amount-${claim.id}`} className="flex flex-col gap-1 font-medium">
        How much it cost ($)
        <input id={`amount-${claim.id}`} name="amount" inputMode="decimal" className={INPUT} />
      </label>
      <label htmlFor={`what-${claim.id}`} className="flex flex-col gap-1 font-medium">
        What happened
        <textarea
          id={`what-${claim.id}`}
          name="description"
          rows={2}
          className="min-w-0 rounded-lg border border-zinc-300 bg-transparent p-3 text-base dark:border-zinc-700"
        />
      </label>
      <SubmitButton className={`${SMALL_BUTTON} self-start`}>Write it up</SubmitButton>
    </form>
  );
}

function ClaimCard({ claim, filable = false }: { claim: Claim; filable?: boolean }) {
  const guide = guideFor(claim.kind);
  const next = nextStep(claim);
  const done = claim.steps.filter((s) => s.doneAt).length;
  return (
    <li
      id={`claim-${claim.id}`}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800"
    >
      <div className="flex flex-col">
        <h3 className="font-semibold">
          {eventLabel(claim.kind, claim.event)}, {dayLabel(claim.happenedOn, { year: true })}
        </h3>
        <span className="text-sm text-zinc-500">
          {claim.carrier ? `${claim.carrier} ${kindWords(claim.kind)}` : kindWords(claim.kind)} ·{" "}
          {claim.status === "closed" ? "Closed" : `${done} of ${claim.steps.length} steps done`}
        </span>
      </div>
      <p className="text-sm">
        {claim.claimsPhone ? `Claims line: ${claim.claimsPhone}.` : CLAIM_CONTACT_FALLBACK}{" "}
        {claim.claimsUrl && (
          <a href={claim.claimsUrl} className={LINK} rel="noopener noreferrer" target="_blank">
            File online
          </a>
        )}
      </p>
      <details>
        <summary className="cursor-pointer text-sm text-emerald-700">What to collect</summary>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {guide.collect.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      <ol className="flex flex-col gap-2">
        {claim.steps.map((step) => (
          <li key={step.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className={step.doneAt ? "text-zinc-500 line-through" : ""}>
              {step.label}
              {!step.doneAt && (
                <span className="text-zinc-500"> (by {dayLabel(step.dueOn, { year: true })})</span>
              )}
            </span>
            {!step.doneAt && claim.status === "open" && (
              <form action={stepDone}>
                <input type="hidden" name="claimId" value={claim.id} />
                <input type="hidden" name="step" value={step.key} />
                <SubmitButton className={SMALL_BUTTON}>
                  {next?.key === step.key ? "Done" : "Mark done"}
                </SubmitButton>
              </form>
            )}
          </li>
        ))}
      </ol>
      <Filing claim={claim} filable={filable} />
      {claim.status === "open" && (
        <div className="flex flex-wrap items-end gap-3">
          <form action={claimNumber} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="claimId" value={claim.id} />
            <label
              htmlFor={`number-${claim.id}`}
              className="flex flex-col gap-1 text-sm font-medium"
            >
              Claim number
              <input
                id={`number-${claim.id}`}
                name="claimNumber"
                defaultValue={claim.claimNumber ?? ""}
                className={INPUT}
              />
            </label>
            <SubmitButton className={SMALL_BUTTON}>Save</SubmitButton>
          </form>
          <form action={finishClaim}>
            <input type="hidden" name="claimId" value={claim.id} />
            <SubmitButton className={SMALL_BUTTON}>Close the claim</SubmitButton>
          </form>
        </div>
      )}
    </li>
  );
}

// Spec step 199: "is it worth claiming?" for an amount, on one of the person's policies.
async function WorthCalculator({
  userId,
  policies,
  amount,
  policyId,
}: {
  userId: string;
  policies: { id: string; label: string }[];
  amount?: string;
  policyId?: string;
}) {
  const dollars = amount ? Number(amount.replace(/[$,\s]/g, "")) : NaN;
  const result =
    Number.isFinite(dollars) && dollars > 0 && dollars < 10_000_000
      ? await claimWorthFor(userId, { amountCents: Math.round(dollars * 100), policyId })
      : null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="worth">
      <h2 id="worth" className="text-xl font-semibold">
        Is it worth claiming?
      </h2>
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          What it costs ($)
          <input name="amount" inputMode="decimal" defaultValue={amount} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          Policy
          <select name="policy" defaultValue={policyId} className={INPUT}>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={SMALL_BUTTON}>
          Work it out
        </button>
      </form>
      {result?.found && (
        <div className="flex flex-col gap-1 text-sm" data-testid="claim-worth">
          <p>{payoutLine(result.worth)}</p>
          {result.advice && (
            <>
              {adviceLines(result.worth).map((l) => (
                <p key={l}>{l}</p>
              ))}
              <DemoAdviceLabel />
            </>
          )}
        </div>
      )}
    </section>
  );
}

async function ClaimsContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; amount?: string; policy?: string }>;
}) {
  const user = await requireUser();
  await connection();
  const { error, amount, policy } = await searchParams;
  const [claims, policies, partner] = await Promise.all([
    listClaims(user.id),
    listPolicies(user.id),
    partnerFor(user.id),
  ]);
  const filable = new Set<string>();
  for (const c of claims) {
    if (await canFile(user.id, c, { partner })) filable.add(c.id);
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <AppHeader user={user} />
      <Link href="/insurance" className={`text-sm ${LINK}`}>
        ← Insurance
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Claims</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          When something happens, tell Jane in the chat (&ldquo;I had a car accident&rdquo;) or
          start a tracker here. Jane shows what to do now and what to collect, and reminds you of
          each step until it&apos;s done. For a small claim on a policy Jane can reach, it can file
          it with your insurer once you&apos;ve checked its draft.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {claims.length > 0 && (
        <ul className="flex flex-col gap-3">
          {claims.map((c) => (
            <ClaimCard key={c.id} claim={c} filable={filable.has(c.id)} />
          ))}
        </ul>
      )}
      {policies.some((p) => p.status === "active") && (
        <WorthCalculator
          userId={user.id}
          amount={amount}
          policyId={policy}
          policies={policies
            .filter((p) => p.status === "active")
            .map((p) => ({ id: p.id, label: `${p.carrier} ${kindWords(p.kind)}` }))}
        />
      )}
      <section className="flex flex-col gap-3" aria-labelledby="start">
        <h2 id="start" className="text-xl font-semibold">
          Start a claim tracker
        </h2>
        <StartClaimForm
          today={today}
          policies={policies
            .filter((p) => p.status !== "found")
            .map((p) => ({ id: p.id, kind: p.kind, label: `${p.carrier} ${kindWords(p.kind)}` }))}
        />
      </section>
    </>
  );
}

export default function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; amount?: string; policy?: string }>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <ClaimsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
