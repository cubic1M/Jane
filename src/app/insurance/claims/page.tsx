import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { CLAIM_CONTACT_FALLBACK } from "@/config/claims";
import { eventLabel, guideFor, listClaims, nextStep, type Claim } from "@/lib/insurance/claims";
import { kindWords } from "@/lib/insurance/gaps";
import { listPolicies } from "@/lib/insurance/policies";
import { requireUser } from "@/lib/session";
import { claimNumber, finishClaim, stepDone } from "./actions";
import { StartClaimForm } from "./start-form";

// Claims (spec step 107): when something happens, what to do now, what to collect, who to
// call, and a tracker of the claim's steps. Every step stays on the claim until it's closed.

const LINK = "font-medium text-emerald-700 hover:underline";
const SMALL_BUTTON =
  "inline-flex h-9 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700";
const INPUT =
  "h-9 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-sm dark:border-zinc-700";

const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function ClaimCard({ claim }: { claim: Claim }) {
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
          {eventLabel(claim.kind, claim.event)}, {dateLabel(claim.happenedOn)}
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
              {!step.doneAt && <span className="text-zinc-500"> (by {dateLabel(step.dueOn)})</span>}
            </span>
            {!step.doneAt && claim.status === "open" && (
              <form action={stepDone}>
                <input type="hidden" name="claimId" value={claim.id} />
                <input type="hidden" name="step" value={step.key} />
                <button type="submit" className={SMALL_BUTTON}>
                  {next?.key === step.key ? "Done" : "Mark done"}
                </button>
              </form>
            )}
          </li>
        ))}
      </ol>
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
            <button type="submit" className={SMALL_BUTTON}>
              Save
            </button>
          </form>
          <form action={finishClaim}>
            <input type="hidden" name="claimId" value={claim.id} />
            <button type="submit" className={SMALL_BUTTON}>
              Close the claim
            </button>
          </form>
        </div>
      )}
    </li>
  );
}

async function ClaimsContent() {
  const user = await requireUser();
  await connection();
  const [claims, policies] = await Promise.all([listClaims(user.id), listPolicies(user.id)]);
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
          each step until it&apos;s done. You file the claim with your insurer yourself.
        </p>
      </div>
      {claims.length > 0 && (
        <ul className="flex flex-col gap-3">
          {claims.map((c) => (
            <ClaimCard key={c.id} claim={c} />
          ))}
        </ul>
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

export default function ClaimsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ClaimsContent />
      </Suspense>
    </main>
  );
}
