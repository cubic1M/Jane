import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { CREDIT_FIX_SOURCE, MEDICAL_COLLECTION_NOTE } from "@/config/credit-report-fixes";
import { loadReportFixes } from "@/lib/credit-report-fixes";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { sendLetterAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// Collections and credit report errors (spec step 181): what's on the report that may need
// fixing, the letters Jane wrote (each citing its rule, with its deadline), and what came
// back. Sent only on a tap. A stand-in report for the demo bank, labelled.

const LINK = "font-medium text-emerald-700 hover:underline";

async function ReportContent({ searchParams }: Pick<PageProps<"/loans/report">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const p = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : (raw[k] as string | undefined));
  const data = await loadReportFixes(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Fix your credit report</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane checks your report each month for collections and errors, writes the letters that fix
          them, and tracks the deadlines. Nothing is sent until you tap.
        </p>
      </div>
      {!data.available ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Checking your report needs a credit partner, and there isn&apos;t one for your accounts
          yet.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          <DemoAdviceLabel />
          <p
            role="note"
            className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          >
            This is a stand-in report for the demo bank, not your real credit report.
          </p>
          {p("sent") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Sent just now. The answer date is on your deadlines.
            </p>
          )}
          {p("error") && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {p("error")}
            </p>
          )}
          {data.fixes.length === 0 ? (
            <p>Nothing on your report needs fixing right now.</p>
          ) : (
            <ul aria-label="Items" className="flex flex-col gap-4">
              {data.fixes.map((f) => (
                <li
                  key={f.item.id}
                  className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <p className="font-medium">
                    {f.item.creditor}
                    {f.item.amountCents ? `: ${formatCents(f.item.amountCents)}` : ""}
                    {f.fixed ? " (fixed)" : ""}
                  </p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{f.item.detail}</p>
                  {f.item.medical && <p className="text-sm">{MEDICAL_COLLECTION_NOTE}</p>}
                  <ul
                    aria-label={`Letters for ${f.item.creditor}`}
                    className="mt-3 flex flex-col gap-3 text-sm"
                  >
                    {f.letters.map((l) => (
                      <li key={l.id}>
                        <p className="font-medium">{l.label}</p>
                        {l.windowEndsOn && (
                          <p>The last day to ask is {dayLabel(l.windowEndsOn, { year: true })}.</p>
                        )}
                        <p className="whitespace-pre-line text-zinc-600 dark:text-zinc-400">
                          {l.body}
                        </p>
                        {l.sent ? (
                          <p className="mt-1">
                            Sent {dayLabel(l.sent.sentOn)}; answer due by{" "}
                            {dayLabel(l.sent.deadlineOn, { year: true })}
                            {l.sent.outcome ? `. ${l.sent.outcome}` : ""}
                          </p>
                        ) : (
                          <form action={sendLetterAction} className="mt-2">
                            <input type="hidden" name="letterId" value={l.id} />
                            <SubmitButton className="h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800">
                              Send this letter
                            </SubmitButton>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            <a href={CREDIT_FIX_SOURCE} className={LINK}>
              How to dispute an error on your credit report (CFPB)
            </a>
          </p>
        </>
      )}
    </>
  );
}

export default function ReportPage({ searchParams }: PageProps<"/loans/report">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ReportContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
