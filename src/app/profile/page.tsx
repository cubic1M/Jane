import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { loadProfile, sayFact } from "@/lib/profile";
import { requireUser } from "@/lib/session";
import { factSpec } from "@/profile/facts";
import { forgetProfileCorrection } from "./actions";
import { CorrectForm } from "./correct-form";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// What Jane knows about you (spec step 253): every fact in the picture of you with where it
// came from, how sure Jane is and why, and a way to correct it. A correction is used by
// every part of Jane at once.

const MUTED = "text-zinc-600 dark:text-zinc-400";
const SOURCE_WORDS = { seen: "I saw this", told: "You told me", guessed: "My guess" } as const;

async function ProfileContent() {
  const user = await requireUser();
  const profile = await loadProfile(user.id);
  const facts = Object.values(profile.facts);
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
      <ul className="flex flex-col gap-3">
        {facts.map((f) => {
          const spec = factSpec(f.key)!;
          return (
            <li
              key={f.key}
              className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{f.label}</span>
                <span className="text-lg font-semibold">{sayFact(f.key, f.value)}</span>
              </div>
              <p className={`text-sm ${MUTED}`}>
                {SOURCE_WORDS[f.source]}
                {f.value !== null && ` · ${f.confidence}% sure, based on ${f.evidence}`}
                {f.value === null && " · not known yet"}
              </p>
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
                        Go back to what you see
                      </SubmitButton>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default function ProfilePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <ProfileContent />
      </Suspense>
    </main>
  );
}
