import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { FAMILY_LABELS } from "@/config/family-credit";
import { loadFamilyCredit } from "@/lib/family-credit";
import { adviceLines, cosignLines } from "@/lib/jane-agent/family-credit-replies";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { addAction, missedAction, removeAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// Helping family with credit (spec step 249): an authorized user, a first card for a student
// and co-signing, with the risks shown and a co-signed loan counted in full in your own debt
// load. Nothing is applied for or sent from here.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700";
const BUTTON = "h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function HelpingContent({ searchParams }: Pick<PageProps<"/loans/helping">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const p = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : (raw[k] as string | undefined));
  const d = await loadFamilyCredit(user.id);
  const flash = p("added")
    ? "Saved."
    : p("updated")
      ? "Updated."
      : p("removed")
        ? "Removed."
        : null;
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Helping family with credit</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Adding someone to a card, a first card for a student, and co-signing: what each does to
          their credit and yours.
        </p>
      </div>
      {flash && (
        <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
          {flash}
        </p>
      )}
      {p("error") && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {p("error")}
        </p>
      )}
      <section aria-label="Co-signing" className={CARD}>
        <h2 className="text-xl font-semibold">Co-signing</h2>
        <ul className="flex flex-col gap-2">
          {cosignLines(d).map((l) => (
            <li key={l}>{l.replace(/^- /, "")}</li>
          ))}
        </ul>
        <a href={d.cosigning.source.url} className={`${LINK} text-sm`}>
          {d.cosigning.source.label}
        </a>
      </section>
      {d.advice ? (
        <section aria-label="Safer ways to help" className={CARD}>
          <DemoAdviceLabel />
          <h2 className="text-xl font-semibold">Safer ways to help</h2>
          <ul className="flex flex-col gap-2">
            {adviceLines(d).map((l) => (
              <li key={l}>{l.replace(/^- /, "")}</li>
            ))}
          </ul>
          <ul className="list-disc pl-5 text-sm">
            {d.firstCard.habits.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <a href={d.authorizedUser.source.url} className={`${LINK} text-sm`}>
            {d.authorizedUser.source.label}
          </a>
        </section>
      ) : null}
      <section aria-label="What you told me" className={CARD}>
        <h2 className="text-xl font-semibold">What you told me</h2>
        {d.entries.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {d.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3">
                <span>
                  {FAMILY_LABELS[e.kind]} for {e.person}
                  {e.kind === "cosigned"
                    ? `: ${e.balanceCents === null ? "balance not given" : `${formatCents(e.balanceCents)} owed`}${e.monthlyPaymentCents === null ? "" : `, ${formatCents(e.monthlyPaymentCents)} a month`}${e.missed ? ", a payment was missed" : ""}`
                    : ""}
                </span>
                {e.kind === "cosigned" && (
                  <form action={missedAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="missed" value={e.missed ? "no" : "yes"} />
                    <SubmitButton className="text-sm font-medium text-emerald-700 underline">
                      {e.missed ? "They caught up" : "They missed a payment"}
                    </SubmitButton>
                  </form>
                )}
                <form action={removeAction}>
                  <input type="hidden" name="id" value={e.id} />
                  <SubmitButton className="text-sm text-zinc-600 underline dark:text-zinc-400">
                    Remove
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addAction} className="grid gap-3 sm:grid-cols-5">
          <label className="flex flex-col gap-1 text-sm">
            What
            <select name="kind" className={INPUT} defaultValue="cosigned">
              <option value="cosigned">Co-signed a loan</option>
              <option value="authorized_user">Added an authorized user</option>
              <option value="first_card">Helped with a first card</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            For
            <input name="person" className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Owed (co-signed)
            <input name="balance" inputMode="decimal" className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Payment a month
            <input name="payment" inputMode="decimal" className={INPUT} />
          </label>
          <SubmitButton className={`${BUTTON} self-end`}>Save</SubmitButton>
        </form>
      </section>
    </>
  );
}

export default function HelpingPage(props: PageProps<"/loans/helping">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <HelpingContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
