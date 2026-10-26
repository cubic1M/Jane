import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { IRS_DIRECT_PAY_URL } from "@/config/tax";
import { NOTICE_KINDS } from "@/config/tax-notices";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { checkNoticeFor, listTaxNotices, noticeAmountCents } from "@/lib/tax-notices";
import { ReadingForm, ResponseButtons, SendButtons } from "./forms";
import { LoadingBar } from "@/components/loading-bar";

// Letters from the IRS and the state (spec step 217): the notice explained, its date on the
// deadlines, a check against what Jane knows, and a drafted response. Nothing is paid or
// sent without the person's tap.

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function Content() {
  const user = await requireUser();
  await connection();
  const notices = (await listTaxNotices(user.id)).filter((n) => n.status !== "dismissed");
  const checks = await Promise.all(
    notices
      .filter((n) => n.status === "confirmed")
      .map(async (n) => [n.id, await checkNoticeFor(user.id, n)] as const),
  );
  const checkOf = new Map(checks);
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Letters from the IRS or your state
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Got a notice? Photograph or upload it on{" "}
          <Link href="/documents" className={LINK}>
            Documents
          </Link>{" "}
          (choose &quot;Tax notice&quot;). Jane reads it, you check it, and Jane puts its date on
          your deadlines, checks it against your records and drafts a reply. A notice isn&apos;t
          always right, and it isn&apos;t always wrong. Nothing is paid or sent until you tap.
        </p>
      </div>
      {notices.length === 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No notices yet.</p>
      )}
      {notices.map((n) => {
        const rule = NOTICE_KINDS[n.kind];
        const check = checkOf.get(n.id);
        return n.status === "waiting" ? (
          <section key={n.id} aria-label={`Check ${n.fileName}`} className={CARD}>
            <h2 className="text-xl font-semibold">Check what Jane read from {n.fileName}</h2>
            <ReadingForm id={n.id} fields={n.fields} sources={n.sources} notes={n.notes} />
          </section>
        ) : (
          <section key={n.id} aria-label={rule.title} className={CARD}>
            <h2 className="text-xl font-semibold">{rule.title}</h2>
            <p className="text-sm">{rule.what}</p>
            <p className="text-sm">
              {n.fields.taxYear ? `Tax year ${n.fields.taxYear}. ` : ""}
              {noticeAmountCents(n) > 0
                ? `${formatCents(noticeAmountCents(n))} ${rule.amount === "owed" ? "owed" : "proposed"}. `
                : ""}
              {n.dueOn ? `Due by ${dayLabel(n.dueOn, { year: true })}.` : ""}
            </p>
            {check && check.lines.length > 0 && (
              <ul className="list-disc pl-5 text-sm">
                {check.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            {check?.advice && check.points && (
              <p className="text-sm">
                <strong>
                  Looks like:{" "}
                  {check.points === "agree" ? "agree" : check.points === "pay" ? "pay" : "disagree"}
                  .
                </strong>{" "}
                {check.why}
              </p>
            )}
            {!n.draft && (
              <ResponseButtons
                id={n.id}
                responses={rule.responses}
                pointed={check?.points ?? null}
              />
            )}
            {n.draft && (
              <div className="flex flex-col gap-2">
                <pre className="whitespace-pre-wrap rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
                  {n.draft}
                </pre>
                {n.response === "pay" && n.fields.issuer === "irs" && (
                  <a href={IRS_DIRECT_PAY_URL} className={LINK} rel="noreferrer">
                    Pay on IRS Direct Pay (you pay it, not Jane)
                  </a>
                )}
                {n.handledBy ? (
                  <p className="text-sm">
                    {n.handledBy === "team"
                      ? "Jane's team has it and will send it."
                      : "You said you'll send it yourself."}
                  </p>
                ) : (
                  <SendButtons id={n.id} />
                )}
              </div>
            )}
            {check?.advice && <DemoAdviceLabel />}
            <a href={rule.source} className={`text-xs ${LINK}`} rel="noreferrer">
              About this notice
            </a>
          </section>
        );
      })}
    </>
  );
}

export default function LettersPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Content />
      </Suspense>
    </main>
  );
}
