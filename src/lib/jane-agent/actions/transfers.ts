import { TransferError, endTransfer, startTransfer } from "@/lib/balance-transfers";
import { formatCents } from "@/lib/money";
import { shortMonth } from "@/planning/balance-transfer";
import { ChatActionError, type ActionHandler } from "./handler";

// Balance transfers from the chat (spec step 113), through src/lib/balance-transfers.ts.
// Jane can't open a card or move money: "I've moved it" tells her the person did, so she
// can keep the 0% end in view; "It's paid off" ends the reminders.

const failed = (error: unknown) =>
  error instanceof TransferError ? new ChatActionError("failed", error.message) : error;

export const transferStart: ActionHandler = {
  id: "transfer.start",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.transfer;
    if (!target)
      throw new ChatActionError("failed", "Something went wrong. Open the offers instead.");
    try {
      const t = await startTransfer(userId, target, { client, now });
      return {
        answeredWith: action.label,
        note: `Got it. To clear it before the 0% ends on ${shortMonth(t.promoEndsOn)}, pay ${formatCents(t.monthlyNeededCents)} a month. It's on your deadlines, and I'll remind you 60, 30 and 7 days before.`,
        refs: { ...message.refs, transferId: t.id },
      };
    } catch (error) {
      throw failed(error);
    }
  },
};

export const transferDone: ActionHandler = {
  id: "transfer.done",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.transferId;
    if (!id) throw new ChatActionError("failed", "Something went wrong. Open the offers instead.");
    try {
      const t = await endTransfer(userId, id, "done", { client, now });
      return {
        answeredWith: action.label,
        note: `Nice work: ${t.cardName} is paid off before the 0% ended. I've ticked it off your deadlines.`,
      };
    } catch (error) {
      throw failed(error);
    }
  },
};
