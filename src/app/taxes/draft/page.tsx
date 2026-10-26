import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { adviceMode } from "@/lib/advice-mode";
import { listDraftReturns } from "@/lib/draft-return";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { DraftForm, SampleDraftButton } from "./forms";
import { LoadingBar } from "@/components/loading-bar";

// Your draft return (spec step 272): a draft uploaded to Documents, read for you to confirm, then
// checked line by line against what Jane knows for the year. Each thing to fix has its dollars.
// Jane never files: fixing the draft and filing are yours (or your preparer's).

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function Content() {
  const user = await requireUser();
  await connection();
  const [all, sample] = await Promise.all([listDraftReturns(user.id), adviceMode(user.id)]);
  const drafts = all.filter((d) => d.status !== "dismissed");
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your draft return</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Before you file, upload the draft from your tax software or accountant to{" "}
          <Link href="/documents" className={LINK}>
            Documents
          </Link>{" "}
          as &ldquo;Draft tax return&rdquo;. Jane reads it, you confirm what Jane read, and Jane
          checks every line against your forms and accounts. Jane never files it.
        </p>
      </div>
      {drafts.length === 0 && <p className="text-sm">No draft yet.</p>}
      {sample && !drafts.some((d) => d.status === "waiting") && (
        <section aria-labelledby="sample" className={CARD}>
          <h2 id="sample" className="text-xl font-semibold">
            Try it on a sample
          </h2>
          <p className="text-sm">
            No draft to hand? Jane makes a sample one from your sample figures, with a few mistakes
            in it, so you can see the check.
          </p>
          <SampleDraftButton />
        </section>
      )}
      {drafts.map((d) =>
        d.status === "waiting" ? (
          <section key={d.id} aria-labelledby={`draft-${d.id}`} className={CARD}>
            <h2 id={`draft-${d.id}`} className="text-xl font-semibold">
              {d.fileName}: check what Jane read
            </h2>
            <DraftForm id={d.id} fields={d.fields} sources={d.sources} notes={d.notes} />
          </section>
        ) : (
          <section key={d.id} aria-labelledby={`draft-${d.id}`} className={CARD}>
            <h2 id={`draft-${d.id}`} className="text-xl font-semibold">
              {d.year} draft:{" "}
              {d.findings.length === 0
                ? "nothing to fix"
                : `${d.findings.length} to fix before you file`}
            </h2>
            <ul className="flex flex-col gap-3">
              {d.findings.map((f) => (
                <li key={f.key} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">
                    {f.title}:{" "}
                    {f.effect === "saves"
                      ? `about ${formatCents(f.dollarsCents)} back`
                      : `about ${formatCents(f.dollarsCents)} more tax`}
                  </span>
                  <span>{f.why}</span>
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">{f.line}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm">
              Fix these in your software or send them to your preparer:{" "}
              <Link href="/taxes/accountant" className={LINK}>
                share with my accountant
              </Link>
              . Filing is yours.
            </p>
          </section>
        ),
      )}
    </>
  );
}

export default function DraftReturnPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Content />
      </Suspense>
    </main>
  );
}
