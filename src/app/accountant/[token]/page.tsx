import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { dayLabel } from "@/lib/day-label";
import { viewByToken, type AccountantView } from "@/lib/accountant";
import { formatCents } from "@/lib/money";
import { AnswerForm } from "./answer-form";
import { LoadingBar } from "@/components/loading-bar";

// A read-only link for a person's accountant (spec step 222): tax information only, shown
// from a token, until the date on the link or until it is revoked. Not indexed.

export const metadata: Metadata = {
  title: "Tax information for your client",
  robots: { index: false, follow: false },
};

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

const GROUP_LABELS: Record<string, string> = {
  medical: "Medical",
  childcare: "Child and dependent care",
  education: "Education",
  business: "Business expenses",
  rental: "Rental expenses",
};

function Rows({ rows }: { rows: AccountantView["pack"]["charity"]["rows"] }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-600">Nothing in this group.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap justify-between gap-x-3">
          <span className="[overflow-wrap:anywhere]">
            {dayLabel(r.date, { year: true })} {r.payee}
          </span>
          <span>{formatCents(r.amountCents)}</span>
        </li>
      ))}
    </ul>
  );
}

async function Shared({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const result = await viewByToken(token);
  if (result.state !== "ok") {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">This link isn&apos;t available</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          It may have ended or been revoked. Ask your client for a new one.
        </p>
      </section>
    );
  }
  const v = result.view;
  const s = v.summary;
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-emerald-700">Prepared by Jane, read-only</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Tax information for {v.year}: {v.label}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Your client shared this with you. It shows only their tax information, as Jane worked it
          out from their accounts. The figures are estimates for you to check; Jane gives no tax
          advice. This link works until {dayLabel(v.expiresOn, { year: true })}.
        </p>
      </div>
      {v.complexity && (
        <p className="rounded-xl bg-zinc-100 p-4 text-sm dark:bg-zinc-900">{v.complexity}</p>
      )}
      <section aria-labelledby="summary" className={CARD}>
        <h2 id="summary" className="text-xl font-semibold">
          The federal estimate
        </h2>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {(
            [
              ["Total income", s.totalIncomeCents],
              ["Adjusted gross income", s.agiCents],
              ["Taxable income", s.taxableCents],
              ["Tax", s.totalTaxCents],
              ["Already paid", s.paidCents],
              [s.refundCents >= 0 ? "Refund" : "Owed", Math.abs(s.refundCents)],
            ] as const
          ).map(([label, cents]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-zinc-600">{label}</dt>
              <dd className="whitespace-nowrap">{formatCents(cents)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="pack" className={CARD}>
        <h2 id="pack" className="text-xl font-semibold">
          The tax pack
        </h2>
        <h3 className="font-semibold">Charity: {formatCents(v.pack.charity.totalCents)}</h3>
        <Rows rows={v.pack.charity.rows} />
        {Object.entries(v.pack.preparer).map(([key, group]) => (
          <div key={key} className="flex flex-col gap-1">
            <h3 className="font-semibold">
              {GROUP_LABELS[key] ?? key}: {formatCents(group.totalCents)}
            </h3>
            <Rows rows={group.rows} />
          </div>
        ))}
        <h3 className="font-semibold">Income: {formatCents(v.pack.income.totalCents)}</h3>
        <Rows rows={v.pack.income.rows} />
        {v.pack.rental && (
          <p className="text-sm">
            Rental: rent {formatCents(v.pack.rental.rentCents)}, expenses{" "}
            {formatCents(v.pack.rental.expensesCents)}, depreciation{" "}
            {formatCents(v.pack.rental.depreciationCents)}, net{" "}
            {formatCents(v.pack.rental.netCents)}.
          </p>
        )}
        {v.pack.states.length > 0 && (
          <p className="text-sm">States: {v.pack.states.map((st) => st.code).join(", ")}.</p>
        )}
      </section>
      <section aria-labelledby="forms" className={CARD}>
        <h2 id="forms" className="text-xl font-semibold">
          Forms
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          {v.pack.forms.map((f) => (
            <li key={f.key} className="flex flex-wrap justify-between gap-x-3">
              <span>
                {f.form} from {f.from}
              </span>
              <span>{f.received ? "Received" : f.mayNotSend ? "May not be sent" : "Waiting"}</span>
            </li>
          ))}
        </ul>
        {v.collected.length > 0 && (
          <>
            <h3 className="font-semibold">Collected by Jane</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {v.collected.map((c) => (
                <li key={`${c.form}${c.from}`}>
                  {c.form} from {c.from}:{" "}
                  {Object.entries(c.boxes)
                    .map(([box, cents]) => `${box} ${formatCents(cents)}`)
                    .join(", ")}
                  {c.matches === "differs" ? " (doesn't match the accounts)" : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section aria-labelledby="deductions" className={CARD}>
        <h2 id="deductions" className="text-xl font-semibold">
          Deductions and credits, with their proof
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          {v.deductions.map((d) => (
            <li key={d.label} className="flex flex-col">
              <span>
                {d.label}: {formatCents(d.claimedCents)} ({d.sources}{" "}
                {d.sources === 1 ? "source" : "sources"})
              </span>
              {d.needs.map((n) => (
                <span key={n} className="text-amber-800">
                  Still needed: {n}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="questions" className={CARD}>
        <h2 id="questions" className="text-xl font-semibold">
          Questions for you
        </h2>
        {v.questions.length === 0 && <p className="text-sm">None right now.</p>}
        <ul className="flex flex-col gap-5">
          {v.questions.map((q) => (
            <li key={q.key} className="flex flex-col gap-2 text-sm">
              <strong>{q.text}</strong>
              {q.answers.map((a) => (
                <span key={a.on + a.body} className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-900">
                  {a.fromName}, {dayLabel(a.on, { year: true })}: {a.body}
                </span>
              ))}
              <AnswerForm token={token} questionKey={q.key} label="Your answer" />
            </li>
          ))}
        </ul>
        <h3 className="font-semibold">Anything else for your client</h3>
        {v.notes.map((n) => (
          <span key={n.on + n.body} className="rounded-lg bg-zinc-100 p-2 text-sm dark:bg-zinc-900">
            {n.fromName}, {dayLabel(n.on, { year: true })}: {n.body}
          </span>
        ))}
        <AnswerForm token={token} questionKey={null} label="A note" />
      </section>
    </>
  );
}

export default function AccountantSharedPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Shared params={params} />
      </Suspense>
    </main>
  );
}
