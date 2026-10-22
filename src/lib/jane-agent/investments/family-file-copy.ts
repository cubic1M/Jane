import { BENEFICIARY_EVENTS, ESTATE_FACTS, ESTATE_POINTER } from "@/config/family-file";
import type { FamilyFileView } from "@/lib/investments/family-file";
import type { AccountCheck } from "@/planning/family-file";
import type { MessageAction } from "../types";

// The family looked after in the chat (spec step 237): shared words and buttons. Facts about
// beneficiaries; for wills and trusts only the reviewed sentences in src/config/family-file.ts.

export const FILE_LINK: MessageAction = {
  id: "open",
  label: "Check my accounts",
  kind: "link",
  href: "/investments/family-file",
};

const problemWords = (c: AccountCheck) =>
  c.problems
    .map((p) =>
      p === "missing"
        ? "has nobody named"
        : p === "shares"
          ? "has shares that don't add up to 100"
          : `hasn't been confirmed since a ${c.because ? BENEFICIARY_EVENTS[c.because].toLowerCase() : "life change"}`,
    )
    .join(" and ");

export function attentionLine(attention: readonly AccountCheck[]): string {
  const list = attention.map((c) => `${c.accountName} ${problemWords(c)}`).join("; ");
  return `Your beneficiaries need a look: ${list}. An account with a named beneficiary passes to that person whatever your will says, so it's worth keeping current. The form is with the account's company; I can note who you name.`;
}

export function familyFileReply(view: Pick<FamilyFileView, "attention" | "checks">): {
  body: string;
  actions: MessageAction[];
  refs: Record<string, never>;
} {
  const lead =
    view.attention.length > 0
      ? attentionLine(view.attention)
      : view.checks.length > 0
        ? "Every account that takes a beneficiary has names that look current."
        : "I don't see accounts to check yet.";
  return {
    body: `${lead} ${ESTATE_FACTS[2]} ${ESTATE_POINTER} I can also keep a file of what your family would need, and you choose which parts go in it.`,
    actions: [FILE_LINK],
    refs: {},
  };
}
