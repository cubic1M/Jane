import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { loadProfile, sayFact } from "@/lib/profile";
import { requireUser } from "@/lib/session";
import type { Fact } from "@/profile/build";
import { factSpec } from "@/profile/facts";
import { forgetProfileCorrection } from "./actions";
import { CorrectForm } from "./correct-form";
import { SubmitButton } from "@/components/submit-button";

// What Jane knows about you (spec step 253): every fact in the picture of you with where it
// came from, how sure Jane is and why, and a way to correct it. A correction is used by
// every part of Jane at once.

const MUTED = "text-zinc-600 dark:text-zinc-400";
const SOURCE_WORDS = { seen: "I saw this", told: "You told me", guessed: "My guess" } as const;

// One fact: what Jane holds, where it came from and how sure it is, and a way to correct it. One
// Jane doesn't know has no value or source to give: "My guess · not known yet" guessed nothing.
function factItem(f: Fact, known: boolean) {
  const spec = factSpec(f.key)!;
  return (
    <li
      key={f.key}
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{f.label}</span>
        {known && <span className="text-lg font-semibold">{sayFact(f.key, f.value)}</span>}
      </div>
      {known && (
        <p className={`text-sm ${MUTED}`}>
          {SOURCE_WORDS[f.source]} · {f.confidence}% sure, based on {f.evidence}
        </p>
      )}
      {spec.correctable && (
        <div className="flex flex-wrap items-center gap-3">
          <CorrectForm
            factKey={f.key}
            choices={
              spec.kind === "choice"
                ? spec.choices
                : spec.kind === "boolean"
                  ? ["yes", "no"]
                  : undefined
            }
            current={
              !known || f.value === null
                ? undefined
                : typeof f.value === "boolean"
                  ? f.value
                    ? "yes"
                    : "no"
                  : String(f.value)
            }
            placeholder={
              spec.kind === "cents"
                ? "Dollars"
                : spec.kind === "number"
                  ? "A number"
                  : "Your answer"
            }
          />
          {f.source === "told" && (
            <form action={forgetProfileCorrection}>
              <input type="hidden" name="key" value={f.key} />
              <SubmitButton className={`text-sm underline ${MUTED}`}>
                Go back to what I worked out
              </SubmitButton>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

async function ProfileContent() {
  const user = await requireUser();
  const profile = await loadProfile(user.id);
  const facts = Object.values(profile.facts);
  // With no months of data Jane has watched nothing: only what the person told it is known
  // (debugger 11-13, a new student: "Your household: just you · My guess · 15% sure" and "You have
  // a 401(k): no · I saw this · 81% sure", both "in 0 months of data").
  const isKnown = (f: Fact) => f.value !== null && (profile.months > 0 || f.source === "told");
  const known = facts.filter(isKnown);
  const unknown = facts.filter((f) => !isKnown(f));
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">What Jane knows about you</h1>
        <p className={MUTED}>
          I work this out from your accounts and what you tell me. The percentage is how sure I am,
          worked out from how much I&apos;ve seen. If something&apos;s wrong, correct it and
          everything I do will use your answer.
        </p>
      </div>
      {known.length > 0 ? (
        <ul className="flex flex-col gap-3">{known.map((f) => factItem(f, true))}</ul>
      ) : (
        <p className={MUTED}>
          I don&apos;t know anything about you yet. Once an account is in, I&apos;ll work it out.
        </p>
      )}
      {/* What Jane can't tell yet folds away: most of it is for a few people (an inherited IRA, a
          Marketplace plan), and a long run of "not known yet" boxes buried what it does know
          (debugger 11-13). Still there to tell it, one tap away. */}
      {unknown.length > 0 && (
        <details
          data-not-known
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <summary className="cursor-pointer font-medium">Not known yet ({unknown.length})</summary>
          <p className={`mt-2 text-sm ${MUTED}`}>Tell me any that apply to you.</p>
          <ul className="mt-3 flex flex-col gap-3">{unknown.map((f) => factItem(f, false))}</ul>
        </details>
      )}
    </>
  );
}

export default function ProfilePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <ProfileContent />
      </Suspense>
    </main>
  );
}
