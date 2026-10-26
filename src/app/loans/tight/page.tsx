import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { HARDSHIP_SOURCE, TIGHT_ANSWER_DAYS } from "@/config/tight-money";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { loadTightMoney } from "@/lib/tight-money";
import { sendRequestAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// When money is tight (spec step 177): the bills in the order to pay them (housing,
// utilities and insurance first), and the requests Jane prepared, each written out and sent
// only on a tap. Demo advice, labelled.

const LINK = "font-medium text-emerald-700 hover:underline";
const STATUS: Record<string, string> = {
  sent: `Sent, answer in about ${TIGHT_ANSWER_DAYS} days`,
  granted: "Granted",
  declined: "Declined",
};

async function TightContent({ searchParams }: Pick<PageProps<"/loans/tight">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const param = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : raw[k]) ?? "";
  const data = await loadTightMoney(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">When money is tight</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane watches your checking forecast. If it dips under its cushion, Jane prepares what to
          pay first and what to ask for. Nothing is sent until you tap.
        </p>
      </div>
      {!data.available ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Requests need a lender partner, and there isn&apos;t one for your accounts yet.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          <DemoAdviceLabel />
          {param("sent") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Sent just now.
            </p>
          )}
          {param("error") && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {param("error")}
            </p>
          )}
          {!data.shortfall ? (
            <p>
              Your checking forecast stays above its cushion for the next month, so nothing is
              tight. If that changes, the plan appears here.
            </p>
          ) : (
            <>
              <p role="status">
                Checking is forecast to be{" "}
                {data.shortfall.balanceCents < 0
                  ? `${formatCents(-data.shortfall.balanceCents)} overdrawn`
                  : `down to ${formatCents(data.shortfall.balanceCents)}`}{" "}
                on {dayLabel(data.shortfall.date)}.
              </p>
              <section aria-labelledby="first" className="flex flex-col gap-2">
                <h2 id="first" className="text-xl font-semibold">
                  Pay these first
                </h2>
                <ol aria-label="Bills in order" className="list-decimal pl-5 text-sm">
                  {data.billsFirst.map((b) => (
                    <li key={`${b.payee}${b.date}`}>
                      {b.payee}, {formatCents(b.amountCents)} on {dayLabel(b.date)}
                      {b.essential ? ` (${b.essential}: never delayed)` : ""}
                    </li>
                  ))}
                </ol>
              </section>
              <section aria-labelledby="ask" className="flex flex-col gap-3">
                <h2 id="ask" className="text-xl font-semibold">
                  Requests to ease it
                </h2>
                <ul aria-label="Requests" className="flex flex-col gap-3">
                  {data.items.map((i) => (
                    <li
                      key={i.id}
                      className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
                    >
                      <p className="font-medium">{i.label}</p>
                      <p className="whitespace-pre-line text-zinc-600 dark:text-zinc-400">
                        {i.body}
                      </p>
                      {i.sent ? (
                        <p className="mt-2">
                          {STATUS[i.sent.status] ?? i.sent.status}
                          {i.sent.outcome ? `: ${i.sent.outcome}` : ""}
                        </p>
                      ) : (
                        <form action={sendRequestAction} className="mt-2">
                          <input type="hidden" name="itemId" value={i.id} />
                          <SubmitButton className="h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800">
                            Send this request
                          </SubmitButton>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Lenders often have hardship options.{" "}
                <a href={HARDSHIP_SOURCE} className={LINK}>
                  What you can do if you can&apos;t pay (CFPB)
                </a>
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}

export default function TightPage({ searchParams }: PageProps<"/loans/tight">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <TightContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
