import { CarLoanError, confirmAddon, dismissAddon, requestCancellation } from "@/lib/car-loan";
import { conciergeMode } from "@/lib/concierge-mode";
import { formatCents } from "@/lib/money";
import { ChatActionError, type ActionHandler } from "./handler";

// Dealer add-ons on a car loan, from the chat (spec step 245). Confirming only records what
// the payment was; a cancellation is sent by the person or by the team (the demo bank only,
// read-only mode), never by Jane herself.

const failed = (error: unknown) =>
  error instanceof CarLoanError ? new ChatActionError("failed", error.message) : error;
const needTarget = () =>
  new ChatActionError("failed", "Something went wrong. Open your car loan instead.");

export const carAddonYes: ActionHandler = {
  id: "caraddon.yes",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const key = message.refs.carAddon?.key;
    if (!key) throw needTarget();
    try {
      const a = await confirmAddon(userId, key, {}, { client, now });
      const team = await conciergeMode(userId, { client });
      return {
        answeredWith: action.label,
        note: `Noted. Cancelling it now could refund about ${formatCents(a.refund.refundCents)}, an estimate. ${team ? "I drafted the cancellation; I'll ask whether you'd like to send it or have the team do it." : "I drafted the cancellation for you to send; it's on your car loan page to copy."}`,
      };
    } catch (error) {
      throw failed(error);
    }
  },
};

export const carAddonNo: ActionHandler = {
  id: "caraddon.no",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const key = message.refs.carAddon?.key;
    if (!key) throw needTarget();
    try {
      await dismissAddon(userId, key, { client, now });
      return { answeredWith: action.label, note: "Got it: not an add-on, and I won't ask again." };
    } catch (error) {
      throw failed(error);
    }
  },
};

const requestHandler = (
  id: "caraddon.mine" | "caraddon.team",
  by: "mine" | "team",
): ActionHandler => ({
  id,
  on: "open",
  async run({ userId, message, action, client }) {
    const addonId = message.refs.carAddon?.id;
    if (!addonId) throw needTarget();
    try {
      await requestCancellation(userId, addonId, by, { client });
      return {
        answeredWith: action.label,
        note:
          by === "mine"
            ? "Noted. The letter is on your car loan page to copy and send."
            : "Done: the team has the request and will send the cancellation for you, then tell you what comes back.",
      };
    } catch (error) {
      throw failed(error);
    }
  },
});
export const carAddonMine = requestHandler("caraddon.mine", "mine");
export const carAddonTeam = requestHandler("caraddon.team", "team");
