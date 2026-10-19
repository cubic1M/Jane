"use client";

import { useActionState, useState } from "react";
import { CLAIM_GUIDES } from "@/config/claims";
import { POLICY_KINDS, isPolicyKind } from "@/config/insurance";
import { newClaim, type StartClaimState } from "./actions";

const INPUT =
  "h-11 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const LABEL = "flex flex-col gap-1 text-sm font-medium";

// Starting a claim tracker (spec step 107): which policy (or kind of insurance) and what
// happened; the events change with the kind.
export function StartClaimForm({
  policies,
  today,
}: {
  policies: { id: string; label: string; kind: string }[];
  today: string;
}) {
  const [state, action, pending] = useActionState<StartClaimState, FormData>(newClaim, null);
  const first = policies[0] ? policies[0].id : "kind:auto";
  const [policy, setPolicy] = useState(first);
  const kind = policy.startsWith("kind:")
    ? policy.slice(5)
    : (policies.find((p) => p.id === policy)?.kind ?? "other");
  const events = CLAIM_GUIDES[isPolicyKind(kind) ? kind : "other"].events;
  return (
    <form action={action} className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
      <label htmlFor="claim-policy" className={LABEL}>
        It&apos;s on
        <select
          id="claim-policy"
          name="policy"
          value={policy}
          onChange={(e) => setPolicy(e.target.value)}
          className={INPUT}
        >
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {Object.entries(POLICY_KINDS).map(([k, label]) => (
            <option key={k} value={`kind:${k}`}>
              {label} insurance not on Jane
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="claim-event" className={LABEL}>
        What happened
        <select id="claim-event" name="event" key={kind} className={INPUT}>
          {Object.entries(events).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="claim-day" className={LABEL}>
        When
        <input
          id="claim-day"
          name="happenedOn"
          type="date"
          max={today}
          defaultValue={today}
          className={INPUT}
        />
      </label>
      {state && (
        <p role="alert" className="text-red-700 sm:col-span-2 dark:text-red-400">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center self-end rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Starting…" : "Start the tracker"}
      </button>
    </form>
  );
}
