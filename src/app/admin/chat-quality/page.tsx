import { Suspense } from "react";
import history from "../../../../docs/chat-quality-history.json";
import type { NightEntry } from "@/lib/jane-agent/checks/history";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { LoadingBar } from "@/components/loading-bar";

// Spec step 195: how well Jane's chat answers, night by night. The nightly run
// (.github/workflows/chat-quality.yml) scores the question bank and records each night in
// docs/chat-quality-history.json; this page shows the scores over time and the questions that
// failed the last time. Scores and question wording only, never anyone's own words.

const nights = history as NightEntry[];
const cell = "py-2 pr-4";

function Chart({ rows }: { rows: NightEntry[] }) {
  const scores = rows.filter((r) => r.score !== null);
  if (scores.length === 0) return null;
  return (
    <figure className="flex flex-col gap-1">
      <div aria-hidden="true" className="flex h-24 items-end gap-1">
        {scores.map((r) => (
          <div
            key={`${r.date}${r.mode}`}
            title={`${r.date}: ${r.score}`}
            className="min-w-1 flex-1 bg-emerald-600"
            style={{ height: `${r.score}%` }}
          />
        ))}
      </div>
      <figcaption className="text-sm text-zinc-600 dark:text-zinc-400">
        Score by night, 0 to 100 ({scores[0].date} to {scores.at(-1)!.date}).
      </figcaption>
    </figure>
  );
}

async function ChatQuality() {
  const admin = await requireAdmin();
  const recent = [...nights].reverse();
  const last = recent[0];
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">Chat quality</h1>
      {nights.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No nightly run has been recorded yet. It runs every night and adds its scores here.
        </p>
      ) : (
        <>
          <Chart rows={nights.slice(-60)} />
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">Nights</h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className={`${cell} font-semibold`}>Night</th>
                  <th className={`${cell} font-semibold`}>Run</th>
                  <th className={`${cell} font-semibold`}>Score</th>
                  <th className={`${cell} font-semibold`}>Graded</th>
                  <th className={`${cell} font-semibold`}>Failing</th>
                  <th className={`${cell} font-semibold`}>First words</th>
                  <th className="py-2 font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {recent.slice(0, 30).map((r) => (
                  <tr
                    key={`${r.date}${r.mode}`}
                    className="border-b border-zinc-100 dark:border-zinc-900"
                  >
                    <td className={cell}>{r.date}</td>
                    <td className={cell}>{r.mode === "full" ? "With Claude" : "Rules only"}</td>
                    <td className={cell}>{r.score ?? "–"}</td>
                    <td className={cell}>{r.graded}</td>
                    <td className={cell}>{r.failed.length}</td>
                    <td className={cell}>
                      {r.firstWordsMs === null ? "–" : `${r.firstWordsMs} ms`}
                    </td>
                    <td className="py-2">${(r.costCents / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">Failed on {last.date}</h2>
            {last.failed.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-400">Every question scored 80 or more.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {last.failed.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <span className="font-semibold">{f.score}</span> · {f.id} · “{f.text}”
                    <br />
                    <span className="text-zinc-600 dark:text-zinc-400">{f.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default function ChatQualityPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <ChatQuality />
      </Suspense>
    </main>
  );
}
