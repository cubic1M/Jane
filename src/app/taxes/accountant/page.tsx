import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { dayLabel } from "@/lib/day-label";
import { loadAccountantPage } from "@/lib/accountant";
import { requireUser } from "@/lib/session";
import { CreateForm, RevokeButton, SeenButton } from "./forms";
import { LoadingBar } from "@/components/loading-bar";

// Working with an accountant (spec step 222): a read-only link, and what comes back.

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

const STATE_WORDS = {
  active: "Works until",
  expired: "Stopped working on",
  revoked: "Revoked",
} as const;

async function Content() {
  const user = await requireUser();
  await connection();
  const v = await loadAccountantPage(user.id);
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Working with an accountant</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Give your accountant one link instead of a pile of files. It shows only your tax
          information for {v.year}: your tax pack, the forms Jane collected, the proof behind each
          deduction and the questions Jane has. They can write answers back, and you see them here.
          The link ends on the day you pick and you can revoke it any time; every time it&apos;s
          opened is logged.
        </p>
      </div>
      {v.complexity.text && (
        <p className="rounded-xl bg-zinc-100 p-4 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {v.complexity.text}
        </p>
      )}
      <section aria-labelledby="make" className={CARD}>
        <h2 id="make" className="text-xl font-semibold">
          Make a link
        </h2>
        <CreateForm />
      </section>
      {v.links.length > 0 && (
        <section aria-labelledby="links" className={CARD}>
          <h2 id="links" className="text-xl font-semibold">
            Your links
          </h2>
          <ul className="flex flex-col gap-3 text-sm">
            {v.links.map((l) => (
              <li key={l.id} className="flex flex-col gap-1">
                <strong>{l.label}</strong>
                <span>
                  {STATE_WORDS[l.state]}
                  {l.state === "revoked" ? "" : ` ${dayLabel(l.expiresOn, { year: true })}`}. Opened{" "}
                  {l.viewCount} {l.viewCount === 1 ? "time" : "times"}
                  {l.lastViewedAt ? `, last on ${dayLabel(l.lastViewedAt, { year: true })}` : ""}.
                </span>
                {l.state === "active" && <RevokeButton id={l.id} label={l.label} />}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="questions" className={CARD}>
        <h2 id="questions" className="text-xl font-semibold">
          Questions Jane has for them
        </h2>
        {v.questions.length === 0 ? (
          <p className="text-sm">None right now.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {v.questions.map((q) => (
              <li key={q.key}>{q.text}</li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="answers" className={CARD}>
        <h2 id="answers" className="text-xl font-semibold">
          What they wrote back
        </h2>
        {v.notes.length === 0 ? (
          <p className="text-sm">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {v.notes.map((n) => (
              <li key={n.id} className="flex flex-col gap-1">
                {n.questionText && (
                  <span className="text-zinc-600 dark:text-zinc-400">{n.questionText}</span>
                )}
                <span className="[overflow-wrap:anywhere]">{n.body}</span>
                <span className="text-xs text-zinc-500">
                  {n.fromName}, {dayLabel(n.createdAt, { year: true })}
                  {n.seen ? "" : " (new)"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {v.unseen > 0 && <SeenButton />}
      </section>
    </>
  );
}

export default function AccountantPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Content />
      </Suspense>
    </main>
  );
}
