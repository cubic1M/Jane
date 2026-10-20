import { adoptPlan, isScenario, whatIf } from "@/lib/what-if";
import { ChatActionError, type ActionHandler } from "./handler";

// "Use this plan" on a what-if (spec step 203): the scenario is run again from the person's
// current numbers, so a stale message can't adopt old figures, then saved. Nothing else
// changes: the plan's changes show up among the next best things.
export const whatIfAdopt: ActionHandler = {
  id: "whatif.adopt",
  on: "open",
  async run(context) {
    const { userId, client, now, message } = context;
    const ref = message.refs.whatIf;
    if (!ref || !isScenario(ref.scenario)) {
      throw new ChatActionError("failed", "Something went wrong. Open What if instead.");
    }
    const run = await whatIf(
      userId,
      ref.scenario,
      { months: ref.months, extraMonthlyCents: ref.extraMonthlyCents },
      { client, now },
    );
    if (!run) throw new ChatActionError("failed", "I can't see your accounts right now.");
    await adoptPlan(userId, run, { client, now });
    return {
      answeredWith: context.action.label,
      note: `Done. ${run.plan.length} steps are on your list of next best things; I'll ask before each one.`,
    };
  },
};
