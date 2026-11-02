import { Suspense } from "react";
import { LoadingBar } from "@/components/loading-bar";
import { SubmitButton } from "@/components/submit-button";
import { mistakeStats, type MistakeStats } from "@/lib/act-mistakes";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { closeReported } from "./actions";

// What Jane got wrong, for a person to look at (docs/mistakes.md), and the rate the gate to Stage 3
// tracks.

const SHOWN = 50;
const when = (date: Date) => date.toISOString().slice(0, 16).replace("T", " ");

const rate = (s: MistakeStats) =>
  s.rate === null
    ? `No acts yet`
    : `${s.mistakes} of ${s.acts} acts (${(s.rate * 100).toFixed(1)}%), ${s.open} open`;

async function Mistakes() {
  const admin = await requireAdmin();
  const [real, rehearsal, open] = await Promise.all([
    mistakeStats(),
    mistakeStats({ simulated: true }),
    db.actMistake.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "asc" },
      take: SHOWN,
      select: {
        id: true,
        userId: true,
        note: true,
        simulated: true,
        createdAt: true,
        act: { select: { what: true, why: true, specialist: true, sector: true, actionId: true } },
      },
    }),
  ]);
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-2xl font-semibold">Mistakes</h1>
      <dl className="flex flex-col gap-1 text-sm">
        <div>
          <dt className="inline font-medium">Real: </dt>
          <dd className="inline" data-mistakes-real="">
            {rate(real)}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Rehearsal, on sample data: </dt>
          <dd className="inline">{rate(rehearsal)}</dd>
        </div>
      </dl>
      {open.length === 0 ? (
        <p>Nothing open.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {open.map((m) => (
            <li
              key={m.id}
              data-mistake=""
              className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <span className="font-semibold [overflow-wrap:anywhere]">{m.act.what}</span>
              <span className="text-sm">
                {when(m.createdAt)} · {m.act.specialist} · {m.act.sector}
                {m.simulated ? " · simulated" : ""} · person {m.userId}
              </span>
              <span className="text-sm [overflow-wrap:anywhere]">
                They said: {m.note || "(nothing written)"}
              </span>
              <form action={closeReported} className="mt-2 flex flex-col items-start gap-2">
                <input type="hidden" name="id" value={m.id} />
                <textarea
                  name="resolution"
                  rows={2}
                  required
                  aria-label="What was done"
                  placeholder="What was done about it?"
                  className="w-full rounded-lg border border-zinc-300 p-2 text-sm dark:border-zinc-700"
                />
                <SubmitButton className="rounded-lg border border-zinc-900 px-3 py-1 text-sm font-medium dark:border-zinc-100">
                  Close it
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function MistakesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Mistakes />
      </Suspense>
    </main>
  );
}
