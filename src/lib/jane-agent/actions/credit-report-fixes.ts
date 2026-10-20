import { CreditFixError, sendReportLetter } from "@/lib/credit-report-fixes";
import { dayLabel } from "@/lib/day-label";
import { ChatActionError, type ActionHandler } from "./handler";

// Sending a validation letter or a bureau dispute from the chat (spec step 181): only on the
// person's tap, one letter each time. The answer date goes on the deadlines list.
export const creditFixSend: ActionHandler = {
  id: "creditfix.send",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.creditFix;
    if (!target) {
      throw new ChatActionError("failed", "Something went wrong. Open your report fixes instead.");
    }
    try {
      const sent = await sendReportLetter(userId, target.id, { client, now });
      return {
        answeredWith: action.label,
        note: `Sent. ${sent.letter === "validation" ? "The collector" : "The bureaus"} must answer by ${dayLabel(sent.deadlineOn, { year: true })}; it's on your deadlines, and I'll tell you what they say.`,
      };
    } catch (error) {
      throw error instanceof CreditFixError ? new ChatActionError("failed", error.message) : error;
    }
  },
};
