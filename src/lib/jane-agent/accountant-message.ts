import { HIDDEN_PAGES } from "@/config/hidden-pages";
import type { AccountantPageView } from "@/lib/accountant";
import type { MessageAction, MessageRefs } from "./types";

// Working with an accountant in the chat (spec step 222): a situation people usually bring
// an accountant to (facts only), what the accountant wrote back, and the answer to "share
// this with my accountant".

const ACCOUNTANT_HREF = "/taxes/accountant";

// The page is hidden in the closed beta (src/config/hidden-pages.ts), and a link to it lands on
// /taxes with nothing to make. Until it's back, what there is to hand over is the tax-time pack.
const LINK_IS_HIDDEN = HIDDEN_PAGES.some((p) => p.path === ACCOUNTANT_HREF);
export const shareWithAccountant: MessageAction = LINK_IS_HIDDEN
  ? { id: "open", label: "Open your tax-time pack", kind: "link", href: "/tax-pack" }
  : { id: "open", label: "Share with my accountant", kind: "link", href: ACCOUNTANT_HREF };

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function complexMessage(v: AccountantPageView): Message | null {
  if (!v.complexity.text) return null;
  return {
    body: LINK_IS_HIDDEN
      ? `${v.complexity.text} If you have one, your tax-time pack gathers what they'll ask for, to hand over.`
      : `${v.complexity.text} If you have one, I can give them a read-only link to your tax pack, the forms I collected and my questions, and they can answer right on it. The link ends when you say and you can revoke it any time.`,
    refs: { taxYear: v.year },
    actions: [
      LINK_IS_HIDDEN
        ? shareWithAccountant
        : { ...shareWithAccountant, label: "Make a link for my accountant" },
    ],
  };
}

export function answersMessage(v: AccountantPageView): Message | null {
  const fresh = v.notes.filter((n) => !n.seen);
  if (fresh.length === 0) return null;
  const first = fresh[0];
  return {
    // Whoever holds the link typed that name: what they wrote, not who they are.
    body: `A note came in on your accountant link${fresh.length > 1 ? ` (${fresh.length} notes)` : ""}. Signed ${first.fromName}: "${first.body.length > 240 ? `${first.body.slice(0, 240)}…` : first.body}"${first.questionText ? ` (about: ${first.questionText})` : ""}`,
    refs: { taxYear: v.year },
    actions: [
      { id: "tax.accountant_seen", label: "Got it", kind: "primary" },
      { id: "open", label: "See what they wrote", kind: "link", href: ACCOUNTANT_HREF },
    ],
  };
}

export function accountantReply(v: AccountantPageView): Message {
  const lines: string[] = [];
  if (v.complexity.text) lines.push(v.complexity.text);
  // Someone with a live link from before the page was hidden still hears about it.
  if (LINK_IS_HIDDEN && v.activeCount === 0) {
    return {
      body: [
        ...lines,
        "Your tax-time pack gathers your charity gifts, spending, gig income and the forms to expect, to hand to whoever does your taxes.",
      ].join("\n"),
      refs: {},
      actions: [shareWithAccountant],
    };
  }
  lines.push(
    v.activeCount > 0
      ? `You have ${v.activeCount} live ${v.activeCount === 1 ? "link" : "links"} for an accountant. You can stop ${v.activeCount === 1 ? "it" : "them"} in Settings.`
      : "You haven't made a link for an accountant yet.",
  );
  if (v.questions.length > 0) {
    lines.push(
      `I have ${v.questions.length} ${v.questions.length === 1 ? "question" : "questions"} for them.`,
    );
  }
  if (v.unseen > 0) lines.push(`${v.unseen} new ${v.unseen === 1 ? "note" : "notes"} from them.`);
  return {
    body: `Here is where working with an accountant stands.\n${lines.map((l) => `• ${l}`).join("\n")}\nA link shows only your tax information, ends on the day you pick, and every time it is opened is logged.`,
    refs: {},
    actions: [{ ...shareWithAccountant, label: "Make a link for my accountant" }],
  };
}
