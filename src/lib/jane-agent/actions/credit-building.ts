import { CreditBuildingError, applyForBuilder, payBeforeStatement } from "@/lib/credit-building";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { ChatActionError, type ActionHandler } from "./handler";

// Building credit from the chat (spec step 175), through src/lib/credit-building.ts: the
// payment before a statement closes, through the money-movement stand-in, and opening a
// credit-builder stand-in. Each only on the person's tap.

const failed = (error: unknown) =>
  error instanceof CreditBuildingError ? new ChatActionError("failed", error.message) : error;

export const creditBuildPay: ActionHandler = {
  id: "credit_build.pay",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.creditStatement;
    if (!target)
      throw new ChatActionError("failed", "Something went wrong. Open your credit score instead.");
    try {
      const paid = await payBeforeStatement(userId, target, { client, now });
      return {
        answeredWith: action.label,
        note: `Scheduled: ${formatCents(paid.amountCents)} to your ${paid.cardName} on ${dayLabel(paid.runOn)}, before the statement closes on ${dayLabel(paid.closesOn)}.`,
      };
    } catch (error) {
      throw failed(error);
    }
  },
};

export const creditBuilderOpen: ActionHandler = {
  id: "credit_builder.open",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.creditBuilder;
    if (!target)
      throw new ChatActionError("failed", "Something went wrong. Open your credit score instead.");
    try {
      const { product } = await applyForBuilder(userId, target.productId, { client, now });
      return {
        answeredWith: action.label,
        note: `Opened: ${product.issuer} approved your ${product.name}. Pay it on time each month and it's reported to the bureaus.`,
      };
    } catch (error) {
      throw failed(error);
    }
  },
};
