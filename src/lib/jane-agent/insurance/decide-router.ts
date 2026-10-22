import type { Decider } from "../decision";
import type { MessageAction } from "../types";
import { withNeeds } from "@/lib/insurance/need/load";
import { decide, decisionConfidence, decisionKindOf } from "./decisions";
import { loadInsuranceSnapshot } from "./snapshot";

// Insurance's part of the "should I ...?" router (docs/decisions.md): "should I get umbrella
// insurance?", "should I switch car insurance?". The router hands over what they asked in
// `label`; the answer is the same short, direct one as the rest of the insurance chat
// (./decisions.ts), with how sure Jane is. A question insurance doesn't recognise is declined
// and gets the general answer. Buttons that act (switch, pay) stay out: the router offers
// links only.

const linkOnly = (actions: readonly MessageAction[]): MessageAction[] =>
  actions.map((a) =>
    a.kind === "link"
      ? a
      : ({
          id: "open",
          label: "See the details",
          kind: "link",
          href: "/insurance",
        } as MessageAction),
  );

export const insuranceDecider: Required<Pick<Decider, "decides" | "decide">> = {
  decides: ["insurance"],
  decide: async ({ userId, client, now, label }) => {
    const kind = decisionKindOf(`should i ${label.toLowerCase()}`);
    if (!kind) return null;
    const insurance = await withNeeds(
      userId,
      await loadInsuranceSnapshot(userId, { client, now }),
      { client, now },
    );
    const reply = decide(kind, insurance, now.toISOString().slice(0, 10));
    const seen = new Set<string>();
    const actions = linkOnly(reply.actions).filter((a) => {
      const key = `${a.label}|${"href" in a ? a.href : ""}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });
    return { body: reply.body, actions, confidence: decisionConfidence(kind, insurance) };
  },
};
