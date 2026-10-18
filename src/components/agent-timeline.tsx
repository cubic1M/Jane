// The action agent's emails for one action, oldest first: what Jane sent and what came
// back. Used on /actions (for the person) and the team's action page.

export type TimelineMessage = {
  id: string;
  direction: "outbound" | "inbound";
  toAddress: string;
  fromAddress: string;
  subject: string;
  body: string;
  summary: string | null;
  createdAt: Date;
};

const when = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function AgentTimeline({ messages }: { messages: TimelineMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m) => (
        <li
          key={m.id}
          className={`flex flex-col gap-1 rounded-lg p-3 text-sm ${
            m.direction === "outbound"
              ? "bg-emerald-50 dark:bg-emerald-950"
              : "bg-zinc-100 dark:bg-zinc-900"
          }`}
        >
          <span className="font-medium">
            {m.direction === "outbound"
              ? `Jane wrote to ${m.toAddress}`
              : `Reply from ${m.fromAddress}`}
          </span>
          <span className="text-xs text-zinc-600 dark:text-zinc-400">{when(m.createdAt)}</span>
          {m.summary && <span>{m.summary}</span>}
          <details>
            <summary className="cursor-pointer text-xs font-medium text-emerald-700">
              {m.direction === "outbound" ? "Read the email" : "Read the reply"}
            </summary>
            <p className="mt-1 font-medium [overflow-wrap:anywhere]">{m.subject}</p>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p>
          </details>
        </li>
      ))}
    </ol>
  );
}
