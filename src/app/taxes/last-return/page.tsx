import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { listPriorReturns } from "@/lib/prior-return";
import { loadReturnReviews } from "@/lib/prior-return/review";
import { requireUser } from "@/lib/session";
import { PrepareForm, ReadingForm, SignAmendmentForm } from "./forms";

// Last year's return, reviewed (spec step 172): what Jane read from an uploaded return, for
// the person to confirm; then what she found against their accounts (demo advice); and an
// amended return the person reviews and signs. Nothing is amended without that signature.

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function Content() {
  const user = await requireUser();
  await connection();
  const [waiting, { advice, reviews }] = await Promise.all([
    listPriorReturns(user.id, { status: "waiting" }),
    loadReturnReviews(user.id),
  ]);
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Last year&apos;s return</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Upload a copy of a return you filed on{" "}
          <Link href="/documents" className={LINK}>
            Documents
          </Link>{" "}
          (choose &quot;Tax return&quot;). Jane reads it, you check it and confirm, and she looks
          for money left behind. Nothing is used until you confirm, and nothing is amended without
          your review and signature.
        </p>
      </div>
      {waiting.map((r) => (
        <section key={r.id} aria-label={`Check ${r.fileName}`} className={CARD}>
          <h2 className="text-xl font-semibold">Check what Jane read from {r.fileName}</h2>
          <ReadingForm id={r.id} fields={r.fields} sources={r.sources} notes={r.notes} />
        </section>
      ))}
      {reviews.map((r) => (
        <section key={r.returnId} aria-label={`Your ${r.year} return`} className={CARD}>
          <h2 className="text-xl font-semibold">Your {r.year} return</h2>
          {r.findings.length === 0 ? (
            <p className="text-sm">
              I didn&apos;t find anything left behind against your accounts.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-3 text-sm">
                {r.findings.map((f) => (
                  <li key={f.key} className="flex flex-col gap-1">
                    <span className="flex flex-wrap justify-between gap-x-3">
                      <strong>{f.title}</strong>
                      <span className="whitespace-nowrap">about {formatCents(f.savesCents)}</span>
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400">{f.why}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm">
                About {formatCents(r.totalCents)} more refund in all (federal, estimated). You can
                amend until {dayLabel(r.amendBy, { year: true })}.
              </p>
            </>
          )}
          {r.amendment ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium">
                Amended return:{" "}
                {r.amendment.status === "ready_for_review" ? "ready to review" : r.amendment.status}
              </p>
              <ul className="list-disc pl-5">
                {r.amendment.changes.map((c) => (
                  <li key={c.key}>
                    {c.title}: about {formatCents(c.savesCents)}
                  </li>
                ))}
              </ul>
              <p>Refund claimed: about {formatCents(r.amendment.refundCents)}.</p>
              {r.amendment.status === "ready_for_review" ? (
                <SignAmendmentForm year={r.year} />
              ) : (
                <p>Signed by {r.amendment.signerName}.</p>
              )}
            </div>
          ) : (
            r.worthAmending && <PrepareForm year={r.year} />
          )}
          <DemoAdviceLabel />
        </section>
      ))}
      {waiting.length === 0 && reviews.length === 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {advice
            ? "No returns uploaded yet."
            : "Reviewing a return for money left behind will come once Jane works with a tax professional."}
        </p>
      )}
    </>
  );
}

export default function LastReturnPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
