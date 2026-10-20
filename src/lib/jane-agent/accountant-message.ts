import type { AccountantPageView } from "@/lib/accountant";
import type { MessageAction, MessageRefs } from "./types";

// Working with an accountant in the chat (spec step 222): a situation people usually bring
// an accountant to (facts only), what the accountant wrote back, and the answer to "share
// this with my accountant".

export const ACCOUNTANT_HREF = "/taxes/accountant";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function complexMessage(v: AccountantPageView): Message | null {
  if (!v.complexity.text) return null;
  return {
    body: `${v.complexity.text} If you have one, I can give them a read-only link to your tax pack, the forms I collected and my questions, and they can answer right on it. The link ends when you say and you can revoke it any time.`,
    refs: { taxYear: v.year },
    actions: [
      {
        id: "open",
        label: "Make a link for my accountant",
        kind: "link",
        href: ACCOUNTANT_HREF,
      },
    ],
  };
}

export function answersMessage(v: AccountantPageView): Message | null {
  const fresh = v.notes.filter((n) => !n.seen);
  if (fresh.length === 0) return null;
  const first = fresh[0];
  return {
    body: `Your accountant wrote back${fresh.length > 1 ? ` (${fresh.length} notes)` : ""}. ${first.fromName} said: "${first.body.length > 240 ? `${first.body.slice(0, 240)}…` : first.body}"${first.questionText ? ` (about: ${first.questionText})` : ""}`,
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
  lines.push(
    v.activeCount > 0
      ? `You have ${v.activeCount} live ${v.activeCount === 1 ? "link" : "links"} for an accountant.`
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
    actions: [
      { id: "open", label: "Make a link for my accountant", kind: "link", href: ACCOUNTANT_HREF },
    ],
  };
}
