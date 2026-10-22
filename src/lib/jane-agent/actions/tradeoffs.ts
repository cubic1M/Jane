import { TradeoffError, chooseGoalOrder } from "@/lib/goal-tradeoffs";
import { answeredElsewhere, type ActionHandler } from "./handler";

// Buttons on goals that trade off (spec step 241): use Jane's suggested order (the person's
// tap re-plans every sector: the paycheck plan and the year plan fund goals in it), or keep
// things as they are. Nothing re-plans without the tap.

export const tradeoffsPick: ActionHandler = {
  id: "tradeoffs.pick",
  on: "open",
  async run(context) {
    const order = (context.message.refs.goalOrder ?? "").split(",").filter(Boolean);
    try {
      const { names } = await chooseGoalOrder(context.userId, order, {
        client: context.client,
        now: context.now,
      });
      return {
        answeredWith: context.action.label,
        note: `Done. From now on your goals are funded in this order: ${names.join(", then ")}. Your paycheck plan and the year plan use it.`,
      };
    } catch (error) {
      if (error instanceof TradeoffError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

export const tradeoffsKeep: ActionHandler = {
  id: "tradeoffs.keep",
  on: "open",
  async run(context) {
    return {
      answeredWith: context.action.label,
      note: "OK, nothing changes. Your goals stay in date order.",
    };
  },
};
