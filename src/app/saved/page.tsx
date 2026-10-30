import { connection } from "next/server";
import { isHiddenPage } from "@/config/hidden-pages";
import { HELD_DAYS } from "@/config/outcomes";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { LedgerEntryRow, STATE_GLYPH } from "@/components/ledger-entry";
import { savingsLedger, type LedgerEntry } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { LEDGER_RULES, type LedgerState } from "@/planning/ledger";
import { markDone } from "./actions";
import { ShareForm } from "./share-form";

// What Jane saved you: the savings ledger (src/lib/ledger.ts). The headline counts only what the
// person's own transactions show (Verified and Held), each with its lines; estimates (found, or
// done and not shown yet) sit apart and are called estimates. Few words: three chips on top,
// every entry's proof behind a click, the rules in one closed note.

const MUTED = "text-zinc-600 dark:text-zinc-400";

const CHIP: Record<LedgerState, (n: number) => string> = {
  held: (n) => `${n} held`,
  verified: (n) => `${n} verified`,
  done: (n) => `${n} done, waiting`,
  said_yes: (n) => `${n} you said yes`,
  estimated: (n) => `${n} to do`,
  not_seen: (n) => `${n} not seen`,
};

function Section({
  id,
  title,
  note,
  entries,
  doneButton = false,
}: {
  id: string;
  title: string;
  note: string;
  entries: LedgerEntry[];
  doneButton?: boolean;
}) {
  if (entries.length === 0) return null;
  return (
    <section id={id} aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className={`text-sm ${MUTED}`}>{note}</p>
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <LedgerEntryRow
            key={e.key}
            entry={e}
            action={
              doneButton && (e.state === "estimated" || e.state === "said_yes") ? (
                <form action={markDone}>
                  <input type="hidden" name="key" value={e.key} />
                  <button
                    type="submit"
                    className="rounded-lg border border-zinc-900 px-3 py-1 text-sm font-medium dark:border-zinc-100"
                  >
                    I did it
                  </button>
                </form>
              ) : null
            }
          />
        ))}
      </ul>
    </section>
  );
}

async function SavedContent() {
  const user = await requireUser();
  await connection();
  const ledger = await savingsLedger(user.id);
  const of = (...states: LedgerState[]) => ledger.entries.filter((e) => states.includes(e.state));
  // At most three chips: what's proven first, then what's waiting on the person.
  const chips = (["held", "verified", "done", "said_yes", "estimated"] as const)
    .filter((s) => ledger.counts[s] > 0)
    .slice(0, 3);
  return (
    <>
      <AppHeader user={user} />
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">What Jane saved you</h1>
        <p className="text-4xl font-semibold" data-ledger-saved={ledger.savedCents}>
          {formatCents(ledger.savedCents)}
        </p>
        <p className={MUTED}>
          Verified in your own transactions
          {ledger.heldCents > 0
            ? `; ${formatCents(ledger.heldCents)} of it held ${HELD_DAYS} days`
            : ""}
          .
        </p>
        {chips.length > 0 && (
          <div role="group" aria-label="What matters now" className="flex flex-wrap gap-2">
            {chips.map((s) => (
              <a
                key={s}
                href={`#${s === "held" || s === "verified" ? "saved" : "estimates"}`}
                className="rounded-full border border-zinc-300 px-3 py-1 font-mono text-xs uppercase dark:border-zinc-700"
              >
                {STATE_GLYPH[s]} {CHIP[s](ledger.counts[s])}
              </a>
            ))}
          </div>
        )}
      </section>

      {ledger.counts.held + ledger.counts.verified === 0 ? (
        <p className={MUTED}>
          Nothing verified yet. When a statement shows a charge gone or a bill lower, it shows here.
        </p>
      ) : (
        <Section
          id="saved"
          title="Verified"
          note="Each one opens on the lines that show it."
          entries={of("held", "verified")}
        />
      )}

      <Section
        id="estimates"
        title="Estimates"
        note={`About ${formatCents(ledger.doneCents + ledger.saidYesCents + ledger.estimatedCents)} more. Not counted until your transactions show it.`}
        entries={of("done", "said_yes", "estimated")}
        doneButton
      />

      <Section
        id="not-seen"
        title="Not seen"
        note="The time passed and no saving showed up, so these don't count."
        entries={of("not_seen")}
      />

      <details className="text-sm">
        <summary className="cursor-pointer font-medium">How Jane verifies</summary>
        <ul className={`mt-2 flex list-disc flex-col gap-1 pl-5 ${MUTED}`}>
          {LEDGER_RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>

      {/* Shared links (/s/...) are hidden in the read-only beta (src/config/hidden-pages.ts). */}
      {!isHiddenPage("/s/link") && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Share it</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            A link to a page with your confirmed total and nothing else: no name, no accounts, no
            details.
          </p>
          <ShareForm />
        </section>
      )}
    </>
  );
}

export default function SavedPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <Suspense>
        <SavedContent />
      </Suspense>
    </main>
  );
}
