import type { ReturnView } from "@/lib/tax-filing";
import type { TaxProfileView } from "@/planning/tax-profile";
import { balancePhrase } from "@/planning/tax-estimate-copy";
import { listOf } from "@/planning/tax-profile";
import { snoozeButton } from "./sources/source";
import type { MessageAction, MessageRefs } from "./types";

// Filing in the chat (spec step 126): the offer to start, the return ready to review (signed
// only on the page), and its status. Nothing is filed from the chat.

export type Said = { body: string; actions: MessageAction[]; refs: MessageRefs };
const FILE_HREF = "/taxes/file";

export function filingOffer(year: number, profile: TaxProfileView, formsWaiting: number): Said {
  const missing = [
    ...(profile.filingStatus.status !== "yours" ? ["how you file"] : []),
    ...(profile.dependants.status !== "yours" ? ["your dependants"] : []),
  ];
  const before =
    missing.length > 0 ? ` First, tell me ${listOf(missing)} on your tax profile.` : "";
  const waiting =
    formsWaiting > 0
      ? ` You're still waiting for ${formsWaiting} tax ${formsWaiting === 1 ? "form" : "forms"}; you can start now or wait.`
      : "";
  return {
    body: `It's time to file your ${year} taxes. I can hand your tax profile, income, tags and forms to the filing partner and have the return ready for you to review and sign.${before}${waiting}`,
    actions: [
      ...(missing.length === 0
        ? [{ id: "tax.file_start" as const, label: "Start my return", kind: "primary" as const }]
        : []),
      {
        id: "open",
        label: missing.length === 0 ? "See what I'd send" : "Finish my tax profile",
        kind: "link",
        href: missing.length === 0 ? FILE_HREF : "/taxes/profile",
      },
      snoozeButton(),
    ],
    refs: { taxYear: year },
  };
}

export function filingReady(ret: ReturnView): Said {
  return {
    body: `Your ${ret.year} return is ready to review: federal, ${balancePhrase(ret.preview.federalRefundCents)}. Check what I handed over and sign it on the page; nothing is filed until you do.`,
    actions: [{ id: "open", label: "Review and sign", kind: "link", href: FILE_HREF }],
    refs: { taxYear: ret.year },
  };
}

export function filingAccepted(ret: ReturnView): Said {
  return {
    body: `Your ${ret.year} return was accepted. ${ret.preview.federalRefundCents > 0 ? "I'll tell you when the refund lands." : "If you owe, pay by the deadline with IRS Direct Pay."}`,
    actions: [{ id: "open", label: "See your return", kind: "link", href: FILE_HREF }],
    refs: { taxYear: ret.year },
  };
}
