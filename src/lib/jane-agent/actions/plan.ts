import { yesToAll } from "@/lib/plan";
import { noRiskItems } from "@/lib/plan-links";
import type { ActionHandler } from "./handler";

// "Approve all safe ones" on the week's plan (spec step 81): the ticked, no-risk items a
// one-tap link would cover (never calls, cancellations, moving money or insurance), each
// checked against its card and approved through yesToAll, from source "chat".

const things = (n: number) => `${n} ${n === 1 ? "thing" : "things"}`;

export const planApproveSafe: ActionHandler = {
  id: "plan.approve_safe",
  on: "open",
  async run({ userId, action, client }) {
    const items = await noRiskItems(userId, { client });
    if (items.length === 0) {
      return {
        answeredWith: action.label,
        note: "There's nothing safe left to approve. Review the plan to pick the rest.",
      };
    }
    const results = await yesToAll(
      userId,
      items.map(({ findingId, cardHash }) => ({ findingId, cardHash })),
      { client, source: "chat" },
    );
    const approved = results.filter((r) => r.ok).length;
    const skipped = results.length - approved;
    return {
      answeredWith: action.label,
      note:
        `Approved ${things(approved)}. I'm on it.` +
        (skipped > 0 ? ` ${things(skipped)} had changed, so I left them for you.` : ""),
      agentJobIds: results.map((r) => (r.ok ? r.agentJobId : undefined)),
    };
  },
};
