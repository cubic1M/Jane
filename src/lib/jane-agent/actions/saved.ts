import { shareSavedTotal } from "@/lib/savings-proof";
import { formatCents } from "@/lib/money";
import type { ActionHandler } from "./handler";

// "Share it" on Jane's savings milestone (spec step 139): a link to a page with only the
// confirmed total, through the same code as What Jane saved you.
export const savedShare: ActionHandler = {
  id: "saved.share",
  on: "open",
  async run({ userId, action, client, now }) {
    const { token, totalCents } = await shareSavedTotal(userId, { client, now });
    return {
      answeredWith: action.label,
      note: `Here's your link to ${formatCents(totalCents)}: only the total is on it. Stop sharing anytime on What Jane saved you.`,
      actions: [
        { id: "open", label: "Open your link", kind: "link", href: `/s/${token}` },
        { id: "open", label: "See the receipts", kind: "link", href: "/saved" },
      ],
    };
  },
};
