import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import {
  CARD_BETTER_MIN_CENTS,
  DEMO_CARD_ARRIVES,
  REWARD_CATEGORIES,
  REWARD_CATEGORY_LABELS,
} from "@/config/credit-cards";
import { loadCreditCards, type CreditCards } from "@/lib/credit-cards";
import { formatCents } from "@/lib/money";
import { pct } from "@/lib/jane-agent/credit-card-replies";
import { requireUser } from "@/lib/session";
import type { BetterCard } from "@/planning/credit-cards";
import { applyCardAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// The right card for each purchase (spec step 174): what each of the person's cards earns
// on their own year of spending with its fee taken off, which card to use for each kind of
// spending, whether each annual fee pays for itself, and a card that would earn more, with
// one tap to apply. Demo advice, labelled; only the demo bank has a card catalog.

const LINK = "font-medium text-emerald-700 hover:underline";
const STATUS: Record<string, string> = {
  approved: `Approved: arrives in ${DEMO_CARD_ARRIVES}`,
  declined: "Declined",
  pending: "Waiting on the issuer",
};

function Better({ b, first }: { b: BetterCard; first: boolean }) {
  return (
    <li className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="font-medium">
        {b.card.name} <span className="text-zinc-600 dark:text-zinc-400">from {b.card.issuer}</span>
      </p>
      <p className="text-sm">
        Adds about {formatCents(b.gainCents)} a year after its{" "}
        {b.card.annualFeeCents > 0
          ? `${formatCents(b.card.annualFeeCents)} annual fee`
          : "fee (it has none)"}
        , used for {b.usedFor.map((c) => REWARD_CATEGORY_LABELS[c].toLowerCase()).join(", ")}.
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{b.card.rewardsLabel}.</p>
      {b.card.intro && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sign-up bonus: {formatCents(b.card.intro.bonusCents)} after{" "}
          {formatCents(b.card.intro.spendCents)} in {b.card.intro.months} months
          {b.introReachable
            ? ", within your usual spending."
            : ", more than you usually spend in that time."}{" "}
          It isn&apos;t counted in the yearly figure.
        </p>
      )}
      <a href={b.card.sourceUrl} className={`${LINK} text-sm`}>
        The issuer&apos;s terms (sample)
      </a>
      {first && (
        <form action={applyCardAction} className="mt-3">
          <input type="hidden" name="productId" value={b.card.id} />
          <SubmitButton className="h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800">
            Apply for the {b.card.name}
          </SubmitButton>
          <span className="ml-3 text-xs text-zinc-600 dark:text-zinc-400">
            A real application with a hard credit check.
          </span>
        </form>
      )}
    </li>
  );
}

function Content({ cards, params }: { cards: CreditCards; params: Record<string, string> }) {
  const named = (id: string) => cards.cards.find((c) => c.product?.id === id)?.name ?? id;
  return (
    <>
      <DemoAdviceLabel />
      {params.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {params.error}
        </p>
      )}
      <section aria-labelledby="spend" className="flex flex-col gap-2">
        <h2 id="spend" className="text-xl font-semibold">
          Your spending
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {formatCents(cards.spend.totalCents)} a year on purchases a card can earn on, from{" "}
          {cards.spend.days} days of your own spending
          {cards.firstLook ? ": a first look until there's more history" : ""}. Rent, loan payments,
          fees and taxes aren&apos;t counted.
        </p>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-zinc-600 dark:text-zinc-400">
              <th className="py-1 font-medium">Kind</th>
              <th className="py-1 font-medium">A year</th>
              <th className="py-1 font-medium">Use</th>
            </tr>
          </thead>
          <tbody>
            {REWARD_CATEGORIES.filter((c) => cards.spend.byCategory[c] > 0).map((c) => {
              const pick = cards.wallet.picks.find((p) => p.category === c);
              return (
                <tr key={c} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-1">{REWARD_CATEGORY_LABELS[c]}</td>
                  <td className="py-1">{formatCents(cards.spend.byCategory[c])}</td>
                  <td className="py-1">
                    {pick ? `${named(pick.cardId)}, ${pct(pick.rateBps)}` : "Not known yet"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section aria-labelledby="own" className="flex flex-col gap-2">
        <h2 id="own" className="text-xl font-semibold">
          Your cards
        </h2>
        <ul className="flex flex-col gap-3">
          {cards.cards.map((c) => (
            <li
              key={c.accountId ?? c.name}
              className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
            >
              <p className="font-medium">
                {c.name}
                {c.fromApplication ? " (new, not linked yet)" : ""}
              </p>
              {c.product ? (
                <>
                  <p className="text-zinc-600 dark:text-zinc-400">{c.product.rewardsLabel}.</p>
                  <p>
                    On all your spending it would earn about{" "}
                    {formatCents((c.earnsCents ?? 0) + c.product.annualFeeCents)} a year
                    {c.product.annualFeeCents > 0
                      ? `, ${formatCents(c.earnsCents ?? 0)} after its ${formatCents(c.product.annualFeeCents)} annual fee`
                      : ", with no annual fee"}
                    .
                  </p>
                  {c.fee && (
                    <p
                      className={
                        c.fee.paysForItself
                          ? "text-emerald-800 dark:text-emerald-200"
                          : "text-amber-800 dark:text-amber-300"
                      }
                    >
                      {c.fee.paysForItself
                        ? "The fee pays for itself on your spending."
                        : `The fee doesn't pay for itself: the ${c.fee.noFee!.card.name}, with no fee, would earn ${formatCents(c.fee.noFee!.earnsCents)}.`}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-zinc-600 dark:text-zinc-400">
                  Jane doesn&apos;t know this card&apos;s rewards yet.
                </p>
              )}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          Using the best card for each kind: about {formatCents(cards.wallet.earnsCents)} a year,{" "}
          {formatCents(cards.wallet.netCents)} after {formatCents(cards.wallet.feesCents)} in annual
          fees.
        </p>
      </section>
      <section aria-labelledby="better" className="flex flex-col gap-2">
        <h2 id="better" className="text-xl font-semibold">
          A card that would earn more
        </h2>
        {cards.better.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {cards.better.map((b, i) => (
              <Better key={b.card.id} b={b} first={i === 0} />
            ))}
          </ul>
        ) : (
          <p className="text-sm">
            No card would add {formatCents(CARD_BETTER_MIN_CENTS)} a year or more after its fee, so
            Jane wouldn&apos;t switch.
          </p>
        )}
      </section>
      {cards.applications.length > 0 && (
        <section aria-labelledby="applications" className="flex flex-col gap-2">
          <h2 id="applications" className="text-xl font-semibold">
            Your applications
          </h2>
          {params.applied && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Sent just now.
            </p>
          )}
          <ul className="flex flex-col gap-1 text-sm">
            {cards.applications.map((a) => (
              <li key={a.id}>
                {a.cardName} from {a.issuer}, {a.createdOn}: {STATUS[a.status] ?? a.status}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function CardsContent({ searchParams }: Pick<PageProps<"/loans/cards">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? (v[0] ?? "") : (v ?? "")]),
  );
  const cards = await loadCreditCards(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Card rewards</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Which card to use for each purchase, worked out from your own spending, with every annual
          fee counted.
        </p>
      </div>
      {cards.available ? (
        <Content cards={cards} params={params} />
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          Card rewards come from a card partner, and there isn&apos;t one for your accounts yet.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      )}
    </>
  );
}

export default function CardsPage({ searchParams }: PageProps<"/loans/cards">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <CardsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
