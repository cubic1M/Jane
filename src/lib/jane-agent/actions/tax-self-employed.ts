import { adviceMode } from "@/lib/advice-mode";
import { SelfEmployedError, recordTaxPayment, saveMiles } from "@/lib/self-employed";
import { formatCents } from "@/lib/money";
import { ChatActionError, type ActionHandler } from "./handler";

// Freelancers from the chat (spec step 123): "I've paid it" counts an estimated payment in
// the estimate; "Add them" adds business miles. Through src/lib/self-employed.ts.

const failed = (error: unknown): never => {
  if (error instanceof SelfEmployedError) throw new ChatActionError("failed", error.message);
  throw error;
};

export const taxQuarterPaid: ActionHandler = {
  id: "tax.quarter_paid",
  on: "open",
  async run({ userId, message, action, client, now }) {
    if (!(await adviceMode(userId, { client }))) {
      throw new ChatActionError("failed", "That's only offered in demo advice mode.");
    }
    const q = message.refs.taxQuarter;
    if (!q) throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    const date = now.toISOString().slice(0, 10);
    await recordTaxPayment(
      userId,
      { date, cents: q.cents, to: "federal" },
      { client, now, via: "chat" },
    ).catch(failed);
    if (q.stateCents > 0) {
      await recordTaxPayment(
        userId,
        { date, cents: q.stateCents, to: "state" },
        { client, now, via: "chat" },
      ).catch(failed);
    }
    return {
      answeredWith: action.label,
      note: `Noted: ${formatCents(q.cents)} federal${q.stateCents > 0 ? ` and ${formatCents(q.stateCents)} state` : ""}. Your estimate counts it now.`,
    };
  },
};

export const taxMilesAdd: ActionHandler = {
  id: "tax.miles_add",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const miles = message.refs.taxMiles;
    if (typeof miles !== "number")
      throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    const total = await saveMiles(userId, miles, { client, now, via: "chat", add: true }).catch(
      failed,
    );
    return {
      answeredWith: action.label,
      note: `Added. That's ${total.toLocaleString("en-US")} business miles this year.`,
    };
  },
};
