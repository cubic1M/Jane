import { RentingError, setRentReporting } from "@/lib/renting";
import { ChatActionError, type ActionHandler } from "./handler";

// Rent reporting from the chat (spec step 248). The tap is the opt-in; nothing is reported
// before it, and the rent page turns it off again.

export const rentReportOn: ActionHandler = {
  id: "rent.report_on",
  on: "open",
  async run({ userId, action, client, now }) {
    try {
      await setRentReporting(userId, true, { client, now });
    } catch (error) {
      throw error instanceof RentingError ? new ChatActionError("failed", error.message) : error;
    }
    return {
      answeredWith: action.label,
      note: "Done: your rent will be reported to the credit bureaus through the reporting partner. You can turn it off any time on your rent page.",
    };
  },
};
