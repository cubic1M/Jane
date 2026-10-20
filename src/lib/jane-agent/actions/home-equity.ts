import { markHomeRequestSent } from "@/lib/home-equity";
import { ChatActionError, type ActionHandler } from "./handler";

// "I sent it" on a drafted PMI or escrow request (spec step 228). Jane sends nothing: this
// only records that the person did, so she can follow up.

export const homeEquitySent: ActionHandler = {
  id: "homeeq.sent",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const which = message.refs.homeRequest;
    if (which !== "pmi" && which !== "escrow") {
      throw new ChatActionError(
        "failed",
        "Something went wrong. Open your home loan page instead.",
      );
    }
    await markHomeRequestSent(userId, which, { client, now });
    return {
      answeredWith: action.label,
      note:
        which === "pmi"
          ? "Noted. I'll check back in 30 days if your bank still shows PMI."
          : "Noted. Servicers usually answer an escrow request after their next analysis.",
    };
  },
};
