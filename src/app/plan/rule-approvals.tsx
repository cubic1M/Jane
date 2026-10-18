"use client";

import { useActionState } from "react";
import { undoRule, type ItemState } from "./actions";

export type RuleApprovalView = {
  decisionId: string;
  title: string;
  ruleLabel: string;
  canUndo: boolean;
};

function Row({ approval }: { approval: RuleApprovalView }) {
  const [state, action, pending] = useActionState<ItemState, FormData>(undoRule, null);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="flex flex-col">
        <span className="font-medium [overflow-wrap:anywhere]">{approval.title}</span>
        <span className="text-xs text-zinc-600 dark:text-zinc-400">Rule: {approval.ruleLabel}</span>
      </span>
      {state?.kind === "undone" ? (
        <span role="status" className="text-sm">
          Taken back. It&apos;s on your plan again.
        </span>
      ) : approval.canUndo ? (
        <form action={action} className="flex flex-col items-end gap-1">
          <input type="hidden" name="decisionId" value={approval.decisionId} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-full border border-zinc-300 px-3 py-1 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Take back<span className="sr-only">: {approval.title}</span>
          </button>
          {state?.kind === "error" && (
            <span role="alert" className="text-xs text-red-700 dark:text-red-400">
              {state.message}
            </span>
          )}
        </form>
      ) : (
        <span className="text-sm text-zinc-600 dark:text-zinc-400">Underway</span>
      )}
    </li>
  );
}

export function RuleApprovals({ approvals }: { approvals: RuleApprovalView[] }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-emerald-200 p-4 dark:border-emerald-900">
      <h2 className="font-semibold">Approved by your rules</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        In the last day. You can take one back until the work starts.
      </p>
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {approvals.map((a) => (
          <Row key={a.decisionId} approval={a} />
        ))}
      </ul>
    </section>
  );
}
