import { DisasterError, applyRelief, recordDisasterLoss } from "@/lib/disasters";
import { formatCents } from "@/lib/money";
import { ChatActionError, type ActionHandler } from "./handler";

// Disaster relief from the chat (spec step 270): moving the tax deadlines a postponement covers,
// and keeping the loss with the insurance claim (once). Nothing is filed.

const failed = (error: unknown): never => {
  if (error instanceof DisasterError) throw new ChatActionError("failed", error.message);
  throw error;
};

const reliefOf = (refs: { disasterRelief?: string }) => {
  if (!refs.disasterRelief)
    throw new ChatActionError("failed", "Something went wrong. Open your deadlines instead.");
  return refs.disasterRelief;
};

export const taxDisasterMove: ActionHandler = {
  id: "tax.disaster_move",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const moved = await applyRelief(userId, reliefOf(message.refs), {
      client,
      now,
      via: "chat",
    }).catch(failed);
    return {
      answeredWith: action.label,
      note:
        moved.length === 0
          ? "None of your deadlines needed moving; I'll keep the new date in mind for the ones I work out."
          : `Done: ${moved.length === 1 ? "1 tax deadline" : `${moved.length} tax deadlines`} moved to ${moved[0].to}.`,
    };
  },
};

export const taxDisasterLoss: ActionHandler = {
  id: "tax.disaster_loss",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const row = await recordDisasterLoss(userId, reliefOf(message.refs), { client, now }).catch(
      failed,
    );
    return {
      answeredWith: action.label,
      note: `Kept${row.claimId ? " with your insurance claim" : ""}: ${row.deductibleCents > 0 ? `${formatCents(row.deductibleCents)} deductible` : "nothing deductible after the floors for now"}. It's counted once, whatever else you add.`,
    };
  },
};
