import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { LoadingBar } from "@/components/loading-bar";
import { SubmitButton } from "@/components/submit-button";
import type { FactSource } from "@/config/memory";
import { dayLabel } from "@/lib/day-label";
import { listFacts, type KnownFact } from "@/lib/memory/facts";
import { requireUser } from "@/lib/session";
import { factSpec } from "@/profile/facts";
import { forgetAllMemory, forgetMemoryFact } from "./actions";
import { CorrectMemoryForm } from "./correct-form";

// What Jane knows about you (src/lib/memory/): every fact Jane learned from the person's
// statements, answers, chat and what they did with its suggestions, with where it came from and
// how sure Jane is. Each can be corrected or forgotten, and all of it (with the stored chat)
// deleted at once.

const MUTED = "text-sm text-zinc-600 dark:text-zinc-400";
const LINK = "font-medium underline underline-offset-2 hover:no-underline";

const FROM: Record<FactSource, string> = {
  answer: "You told me",
  chat: "You said it in the chat",
  action: "From what you did with my suggestions",
  upload: "From your uploaded statements",
  detector: "From your bank data",
};

// What a correction can be: yes or no, one of the profile's choices, or free words.
function choicesFor(fact: KnownFact): readonly string[] | undefined {
  const spec = factSpec(fact.key);
  if (spec?.kind === "choice") return spec.choices;
  if (spec?.kind === "boolean" || typeof fact.value === "boolean") return ["yes", "no"];
  return undefined;
}

function FactItem({ fact }: { fact: KnownFact }) {
  const correctable = factSpec(fact.key)?.correctable ?? true;
  return (
    <li
      data-fact={fact.key}
      className="flex flex-col gap-2 border-b border-zinc-200 py-3 last:border-b-0 dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium [overflow-wrap:anywhere]">{fact.label}</span>
        <span className="text-sm font-semibold tabular-nums">{fact.confidence}% sure</span>
      </div>
      <p className={MUTED}>
        {FROM[fact.source]} · since {dayLabel(fact.firstSeen, { year: true })}
        {fact.evidenceCount > 1 && ` · seen ${fact.evidenceCount} times`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {correctable && (
          <details className="group">
            <summary className={`cursor-pointer text-sm ${LINK}`}>
              Correct<span className="sr-only">: {fact.label}</span>
            </summary>
            <div className="pt-2">
              <CorrectMemoryForm
                factId={fact.id}
                label={fact.label}
                choices={choicesFor(fact)}
                current={
                  typeof fact.value === "boolean" ? (fact.value ? "yes" : "no") : String(fact.value)
                }
              />
            </div>
          </details>
        )}
        <form action={forgetMemoryFact}>
          <input type="hidden" name="factId" value={fact.id} />
          <SubmitButton className={`relative inline-flex min-h-11 items-center text-sm ${LINK}`}>
            Forget<span className="sr-only">: {fact.label}</span>
          </SubmitButton>
        </form>
      </div>
    </li>
  );
}

async function MemoryContent() {
  await connection();
  const user = await requireUser();
  const facts = await listFacts(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">What Jane knows about you</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane learns from your statements, your answers, the chat and what you do with its
          suggestions, so its answers fit you. Correct or forget anything here.
        </p>
        <p className={MUTED}>
          It never keeps anything about your health, religion, politics, sexuality, ethnicity or
          immigration status.
        </p>
      </div>

      {facts.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nothing yet. Jane learns as you upload statements and talk to it.
        </p>
      ) : (
        <ul aria-label="What Jane knows" className="flex flex-col">
          {facts.map((fact) => (
            <FactItem key={fact.id} fact={fact} />
          ))}
        </ul>
      )}

      <section
        aria-labelledby="forget-all"
        className="flex flex-col gap-3 rounded-xl border-2 border-zinc-900 p-4 dark:border-zinc-100"
      >
        <h2 id="forget-all" className="text-lg font-semibold">
          Delete all memory
        </h2>
        <p className={MUTED}>
          Forgets everything above and every chat message, with Jane&apos;s answers. Your accounts,
          suggestions and decisions stay. Jane starts learning again from what you do next.
        </p>
        <form action={forgetAllMemory} className="flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="confirm" value="yes" required className="h-4 w-4" />I
            understand this can&apos;t be undone
          </label>
          <SubmitButton className="relative h-10 rounded-full bg-zinc-900 px-4 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
            Delete all memory
          </SubmitButton>
        </form>
      </section>

      <p className={MUTED}>
        Jane also works out a picture of you from your accounts each time it looks:{" "}
        <Link href="/profile" className={LINK}>
          see that picture
        </Link>
        .
      </p>
      <Link href="/settings" className={`self-start ${LINK}`}>
        Back to settings
      </Link>
    </>
  );
}

export default function MemoryPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar label="Loading what Jane knows" />}>
        <MemoryContent />
      </Suspense>
    </main>
  );
}
