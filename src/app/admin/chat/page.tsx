import { Suspense } from "react";
import { CHAT_UNANSWERED_DAYS } from "@/config/agent-chat";
import { loadUnanswered } from "@/lib/jane-agent/unanswered";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../admin-nav";
import { LoadingBar } from "@/components/loading-bar";

// Spec step 93: what Jane couldn't answer in the chat, by kind of question and how it
// ended, and which guardrail rules blocked answers: where to add rules or narrow a rule.
// Kinds and codes only, never anyone's words.

const HOW: Record<string, string> = {
  fallback: "No rule fit, and no Claude",
  claude_unavailable: "Claude was slow or down",
  claude_blocked: "Blocked by the guardrails",
};

async function Chat() {
  const admin = await requireAdmin();
  const data = await loadUnanswered();
  const share = data.asked === 0 ? 0 : Math.round((100 * data.notAnswered) / data.asked);
  return (
    <>
      <AdminNav email={admin.email} />
      <h1 className="text-3xl font-semibold tracking-tight">What Jane couldn&apos;t answer</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        The last {CHAT_UNANSWERED_DAYS} days: {data.notAnswered} of {data.asked} typed questions (
        {share}%) didn&apos;t get an answer.
      </p>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">By kind</h2>
        {data.byKind.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Everything got an answer.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-semibold">Question kind</th>
                <th className="py-2 pr-4 font-semibold">What happened</th>
                <th className="py-2 font-semibold">Times</th>
              </tr>
            </thead>
            <tbody>
              {data.byKind.map((row) => (
                <tr
                  key={`${row.intent}|${row.how}`}
                  className="border-b border-zinc-100 dark:border-zinc-900"
                >
                  <td className="py-2 pr-4">{row.intent}</td>
                  <td className="py-2 pr-4">{HOW[row.how] ?? row.how}</td>
                  <td className="py-2">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Blocked by guardrail rule</h2>
        {data.blockedBy.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Nothing was blocked.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {data.blockedBy.map((b) => (
              <li key={b.issue}>
                {b.issue}: {b.count}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function AdminChatPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<LoadingBar />}>
        <Chat />
      </Suspense>
    </main>
  );
}
