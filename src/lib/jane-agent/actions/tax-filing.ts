import { FilingError, startReturn } from "@/lib/tax-filing";
import { balancePhrase } from "@/planning/tax-estimate-copy";
import { ChatActionError, type ActionHandler } from "./handler";

// "Start my return" from the chat (spec step 126): hands the year over to the filing
// partner, through src/lib/tax-filing.ts. It files nothing: the person reviews and signs on
// /taxes/file.

export const taxFileStart: ActionHandler = {
  id: "tax.file_start",
  on: "open",
  async run({ userId, action, client, now }) {
    try {
      const ret = await startReturn(userId, { client, now, via: "chat" });
      return {
        answeredWith: action.label,
        note: `Started: your ${ret.year} return is ready to review (federal, ${balancePhrase(ret.preview.federalRefundCents)}). Sign it on the page when you're happy with it.`,
        actions: [{ id: "open", label: "Review and sign", kind: "link", href: "/taxes/file" }],
      };
    } catch (error) {
      if (error instanceof FilingError) throw new ChatActionError("failed", error.message);
      throw error;
    }
  },
};
