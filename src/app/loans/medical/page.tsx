import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { MEDICAL_SOURCE } from "@/config/medical-bills";
import { dayLabel } from "@/lib/day-label";
import { loadMedicalBills } from "@/lib/medical-bills";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { addBillAction, sendRequestAction } from "./actions";

// Medical bills (spec step 180): bills found in the person's payments plus ones they type,
// each with the requests Jane wrote (itemized bill, insurance check, financial assistance,
// a plan with no interest), sent only on a tap. Demo advice, labelled.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700";
const STATUS: Record<string, string> = {
  sent: "Sent, answer in about 2 days",
  granted: "Answered",
  declined: "Declined",
};

async function MedicalContent({ searchParams }: Pick<PageProps<"/loans/medical">, "searchParams">) {
  const user = await requireUser();
  await connection();
  const raw = await searchParams;
  const p = (k: string) => (Array.isArray(raw[k]) ? raw[k]?.[0] : (raw[k] as string | undefined));
  const data = await loadMedicalBills(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Medical bills</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Medical bills are often wrong or can be lowered. Jane finds them, writes the letters, and
          sends nothing until you tap.
        </p>
      </div>
      {!data.available ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Help with medical bills needs a provider partner, and there isn&apos;t one for your
          accounts yet.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          <DemoAdviceLabel />
          {p("sent") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Sent just now.
            </p>
          )}
          {p("added") && (
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
              Added.
            </p>
          )}
          {p("error") && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {p("error")}
            </p>
          )}
          <p className="text-sm">
            {data.hasInsurance
              ? "You have a health plan on file, so Jane checks each bill against it."
              : "No active health plan on file, so there's no insurance check. Add your plan on the insurance page to get one."}
          </p>
          {data.bills.length === 0 ? (
            <p>No medical bills of $100 or more in your recent payments. Add one below.</p>
          ) : (
            <ul aria-label="Bills" className="flex flex-col gap-4">
              {data.bills.map((b) => (
                <li
                  key={b.key}
                  className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <p className="font-medium">
                    {b.provider}: {formatCents(b.amountCents)}
                  </p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {dayLabel(b.billedOn, { year: true })},{" "}
                    {b.source === "typed" ? "added by you" : "found in your payments"}
                  </p>
                  <ul
                    aria-label={`Requests for ${b.provider}`}
                    className="mt-3 flex flex-col gap-3 text-sm"
                  >
                    {b.items.map((i) => (
                      <li key={i.id}>
                        <p className="font-medium">{i.label}</p>
                        <p className="whitespace-pre-line text-zinc-600 dark:text-zinc-400">
                          {i.body}
                        </p>
                        {i.sent ? (
                          <p className="mt-1">
                            {STATUS[i.sent.status] ?? i.sent.status}
                            {i.sent.outcome ? `: ${i.sent.outcome}` : ""}
                          </p>
                        ) : (
                          <form action={sendRequestAction} className="mt-2">
                            <input type="hidden" name="itemId" value={i.id} />
                            <button
                              type="submit"
                              className="h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800"
                            >
                              Send this request
                            </button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <form
            action={addBillAction}
            aria-label="Add a bill"
            className="grid gap-3 sm:grid-cols-3"
          >
            <label className="flex flex-col gap-1 text-sm">
              From
              <input name="provider" className={INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Amount
              <input name="amount" inputMode="decimal" className={INPUT} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Date on the bill
              <input name="billedOn" type="date" className={INPUT} />
            </label>
            <button
              type="submit"
              className="h-11 rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 sm:col-span-3 sm:w-fit"
            >
              Add this bill
            </button>
          </form>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            <a href={MEDICAL_SOURCE} className={LINK}>
              Dealing with medical debt (CFPB)
            </a>
          </p>
        </>
      )}
    </>
  );
}

export default function MedicalPage({ searchParams }: PageProps<"/loans/medical">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <MedicalContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
