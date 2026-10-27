import Link from "next/link";
import { ShownLink } from "@/components/shown-link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { ACTION_FOR_FINDING, CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { partnerForUser } from "@/lib/referrals";
import { scopedDb } from "@/lib/db-scoped";
import { UNDO_WINDOW_SECONDS } from "@/lib/decisions";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { buildKit, hasKit, selfServe } from "@/lib/diy";
import { companyFacts } from "@/lib/merchants";
import { comparisonFor } from "@/lib/compare";
import { BestOption } from "./best-option";
import { DecisionButtons } from "./decision-buttons";
import { DiyKit } from "./diy-kit";
import { conciergeMode } from "@/lib/concierge-mode";
import { savingsLine } from "@/lib/savings-text";
import { policyForMerchant, policyLines } from "@/lib/documents/dates";
import { CHOICE_WORDS, messageAboutFinding } from "@/lib/jane-agent/messages";
import { LoadingBar } from "@/components/loading-bar";

async function Card({ params }: { params: PageProps<"/report/[findingId]">["params"] }) {
  const user = await requireUser();
  const { findingId } = await params;
  const db = await scopedDb();
  const finding = await db.findings.findFirst({
    where: { id: findingId },
    select: { ...CARD_SELECT, status: true },
  });
  if (!finding) notFound();
  if (finding.status === "new") {
    await db.findings.updateMany({
      where: { id: finding.id, status: "new" },
      data: { status: "shown" },
    });
  }
  const card = buildCard(finding, await partnerForUser(user.id, ACTION_FOR_FINDING[finding.type]));
  const open = finding.status === "new" || finding.status === "shown";
  // A do-it-yourself answer shows the kit instead of the buttons.
  const diyDecision = open
    ? null
    : await db.decisions.findFirst({
        where: { findingId: finding.id, choice: "diy", undoneAt: null },
        select: { id: true, diyDoneAt: true, options: true },
      });
  // Read-only mode (src/lib/concierge-mode.ts): for a real account the yes is "Show me how".
  const readOnly = !(await conciergeMode(user.id));
  // What it shows: for a real account, what they'd do, never "We ...". The hash is the card's.
  const shown = readOnly ? selfServe(card) : card;
  // A switch picked on a do-it-yourself answer: its sign-up link goes with the steps.
  const picked = (diyDecision?.options ?? null) as {
    switchName?: unknown;
    switchSignUpUrl?: unknown;
  } | null;
  const switchLink =
    picked && typeof picked.switchSignUpUrl === "string" && typeof picked.switchName === "string"
      ? { label: `Sign up for ${picked.switchName}`, url: picked.switchSignUpUrl }
      : null;
  // Options compared for this person, with Jane's pick (spec step 76).
  const comparison = open ? await comparisonFor(finding, { userId: user.id }) : null;
  const merchantName = (finding.evidence as { merchant?: unknown } | null)?.merchant;
  // The company's directory row and how its cases usually go, in one lookup.
  const company =
    hasKit(card.actionType) && (open || diyDecision)
      ? await companyFacts(typeof merchantName === "string" ? merchantName : null, {
          actionType: card.actionType,
        })
      : null;
  const outcome = company?.outcome ?? null;
  // The person's own policy from this insurer, if they uploaded one (spec step 68). Shown
  // beside the card, not in it, so the card and its hash stay the same.
  const policy =
    finding.type === "insurance_reshop" && typeof merchantName === "string"
      ? await policyForMerchant(user.id, merchantName)
      : null;
  const fromPolicy = policy ? policyLines(policy) : [];
  // Spec step 86: the chat message about this finding, to link back to, and the answer
  // given (here or in the chat), shown the same in both.
  const [chatMessageId, answer] = await Promise.all([
    messageAboutFinding(user.id, finding.id),
    open
      ? null
      : db.decisions.findFirst({
          where: { findingId: finding.id, undoneAt: null },
          orderBy: { createdAt: "desc" },
          select: { choice: true, source: true },
        }),
  ]);
  const kit =
    hasKit(card.actionType) && (open || diyDecision)
      ? buildKit(card.actionType, finding, company?.merchant ?? null)
      : null;

  return (
    <>
      <AppHeader user={user} chatMessageId={chatMessageId} />
      <ViewTracker event="card_opened" findingId={finding.id} />
      <Link href="/report" className="text-sm text-zinc-500 hover:underline">
        ‹ Back to your report
      </Link>

      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{card.title}</h1>
          <p className="text-zinc-700 dark:text-zinc-300">{card.explanation}</p>
        </header>

        {comparison && (
          <BestOption
            comparison={comparison}
            keepLabel={shown.whatChanges}
            findingId={finding.id}
            cardHash={cardHash(card)}
            undoSeconds={UNDO_WINDOW_SECONDS}
            diy={kit !== null}
            readOnly={readOnly}
          />
        )}

        <section className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950">
          <h2 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            {comparison
              ? "If you don't switch"
              : readOnly
                ? "What you'd do"
                : "What changes if you say yes"}
          </h2>
          <p className="mt-1">{shown.whatChanges}</p>
          <p className="mt-3 text-lg font-semibold">
            {savingsLine(card.findingType, card.annualSavingsCents, finding.evidence)}
          </p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            An estimate from your transactions so far, not a promise.
          </p>
        </section>

        {fromPolicy.length > 0 && (
          <section className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">From your policy</h2>
            {fromPolicy.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <Link
              href="/documents"
              className="text-sm font-medium text-emerald-700 hover:underline"
            >
              See your policy
            </Link>
          </section>
        )}

        {card.findingType === "card_interest" && (
          <Link href="/debt" className="font-medium text-emerald-700 hover:underline">
            See what paying off your cards could look like
          </Link>
        )}

        <section className="flex flex-col gap-1">
          <h2 className="font-semibold">What you give up</h2>
          <p className="text-zinc-700 dark:text-zinc-300">{card.giveUp}</p>
        </section>

        {card.alternatives.length > 0 && (
          <section className="flex flex-col gap-1">
            <h2 className="font-semibold">Other options</h2>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-zinc-700 dark:text-zinc-300">
              {card.alternatives.map((alternative) => (
                <li key={alternative}>{alternative}</li>
              ))}
            </ul>
          </section>
        )}

        {card.evidence.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">Why we think so</h2>
            <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
              {card.evidence.map((row, i) => (
                <li key={i} className="flex justify-between gap-4 px-4 py-2">
                  <span className="min-w-0 break-words">
                    {row.date && <span className="text-zinc-500">{row.date} · </span>}
                    {row.label}
                  </span>
                  {row.amountCents !== null && (
                    <span className="shrink-0 font-medium">{formatCents(row.amountCents)}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {card.referralDisclosure && (
          <p className="text-xs text-zinc-500">{card.referralDisclosure}</p>
        )}

        {open && comparison ? null : open ? (
          <DecisionButtons
            findingId={finding.id}
            cardHash={cardHash(card)}
            undoSeconds={UNDO_WINDOW_SECONDS}
            diy={kit !== null}
            readOnly={readOnly}
          />
        ) : diyDecision && kit ? (
          <DiyKit
            kit={kit}
            switchLink={switchLink}
            usually={outcome?.medianMinutes ?? null}
            decisionId={diyDecision.id}
            doneOn={diyDecision.diyDoneAt?.toISOString().slice(0, 10) ?? null}
          />
        ) : (
          <p className="rounded-xl bg-zinc-100 p-4 dark:bg-zinc-900">
            {answer
              ? `You chose: ${CHOICE_WORDS[answer.choice]}${answer.source === "chat" ? ", in the chat" : ""}.`
              : "You've already answered this one."}{" "}
            <ShownLink href="/actions" className="font-medium text-emerald-700 hover:underline">
              See your actions
            </ShownLink>
          </p>
        )}
      </article>
    </>
  );
}

export default function CardPage({ params }: PageProps<"/report/[findingId]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Card params={params} />
      </Suspense>
    </main>
  );
}
