import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { kindWords } from "@/lib/insurance/gaps";
import { compareCover } from "@/lib/insurance/like-for-like";
import { isQuotable, partnerFor } from "@/lib/insurance/partner";
import { POLICY_SELECT, toPolicy, yearlyPremium } from "@/lib/insurance/policies";
import { quotesFor, type StoredQuote } from "@/lib/insurance/quotes";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { getQuotes } from "./actions";

// Quotes for one policy (spec step 103), like for like: same cover and deductible, or each
// difference spelled out. From the stand-in carrier catalog until a licensed partner is
// connected, and labelled as such.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800";

const dateLabel = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function QuoteCard({
  quote,
  currentAnnualCents,
}: {
  quote: StoredQuote;
  currentAnnualCents: number | null;
}) {
  const saving = currentAnnualCents === null ? null : currentAnnualCents - quote.annualPremiumCents;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h3 className="font-semibold">{quote.carrier.name}</h3>
          <span className="text-sm text-zinc-500">Rated {quote.carrier.rating}</span>
        </div>
        <span className="text-xl font-semibold">
          {formatCents(quote.premiumCents)}{" "}
          <span className="text-sm font-normal">
            {PREMIUM_FREQUENCIES[quote.premiumFrequency].label}
          </span>
        </span>
      </div>
      <p className="text-sm">
        {formatCents(quote.annualPremiumCents)} a year
        {saving !== null &&
          (saving > 0
            ? `, ${formatCents(saving)} less than you pay now`
            : saving < 0
              ? `, ${formatCents(-saving)} more than you pay now`
              : ", the same as you pay now")}
        .
      </p>
      {quote.sameCover ? (
        <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
          Same cover and deductible as your policy.
        </p>
      ) : (
        <div className="text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">Not the same cover:</p>
          <ul className="list-disc pl-5">
            {quote.differences.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-zinc-500">Good until {dateLabel(quote.expiresAt)}.</p>
    </li>
  );
}

async function QuotesContent({
  searchParams,
}: {
  searchParams: PageProps<"/insurance/quotes">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  const policyId = typeof params.policy === "string" ? params.policy : "";
  const now = new Date();
  const row = policyId
    ? await scopedFor(user.id).insurancePolicies.findFirst({
        where: { id: policyId, status: "active" },
        select: POLICY_SELECT,
      })
    : null;
  const policy = row ? toPolicy(row) : null;
  const [partner, quotes] = policy
    ? await Promise.all([partnerFor(user.id), quotesFor(user.id, policy.id, { now })])
    : [null, []];
  const current = policy ? yearlyPremium(policy) : null;
  const unknown = policy && quotes[0] ? compareCover(policy.kind, policy, quotes[0]).unknown : [];

  return (
    <>
      <AppHeader user={user} />
      <Link href="/insurance" className={`text-sm ${LINK}`}>
        ← Insurance
      </Link>
      {!policy ? (
        <p>That policy isn&apos;t on your insurance anymore.</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Quotes for your {policy.carrier} {kindWords(policy.kind)}
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              Asked for with the same cover and deductible as your policy
              {current !== null && `, which costs ${formatCents(current)} a year`}. Getting quotes
              costs nothing and changes nothing: nothing is bought without your tap.
            </p>
          </div>
          {partner?.demo && (
            <p
              role="note"
              className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50"
            >
              Sample quotes from Jane&apos;s demo carrier catalog: made-up insurers and prices, not
              real offers.
            </p>
          )}
          {!isQuotable(policy.kind) ? (
            <p>Jane can&apos;t get quotes for {kindWords(policy.kind)} yet.</p>
          ) : !partner ? (
            <p>
              Quotes need a licensed insurance partner, which isn&apos;t connected yet. Jane keeps
              an eye on your renewal date meanwhile.
            </p>
          ) : (
            <>
              {unknown.length > 0 && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Your policy&apos;s {unknown.join(", ").toLowerCase()}{" "}
                  {unknown.length === 1 ? "isn't" : "aren't"} on file, so Jane can&apos;t check{" "}
                  {unknown.length === 1 ? "it matches" : "they match"}.{" "}
                  <Link href={`/insurance?edit=${policy.id}#policy-${policy.id}`} className={LINK}>
                    Add the details
                  </Link>
                </p>
              )}
              {quotes.length > 0 && (
                <ul className="flex flex-col gap-3">
                  {quotes.map((q) => (
                    <QuoteCard key={q.id} quote={q} currentAnnualCents={current} />
                  ))}
                </ul>
              )}
              <form action={getQuotes}>
                <input type="hidden" name="policyId" value={policy.id} />
                <button type="submit" className={BUTTON}>
                  {quotes.length > 0 ? "Get fresh quotes" : "Get quotes"}
                </button>
              </form>
            </>
          )}
        </>
      )}
    </>
  );
}

export default function QuotesPage({ searchParams }: PageProps<"/insurance/quotes">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <QuotesContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
