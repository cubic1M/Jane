import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { snoozeButton, type MessageSource } from "./source";

// Things you own (spec step 83): a mortgage or car loan with no home or car linked to it
// gets "Add your home's value" (or car's), opening the add form prefilled with the loan
// (src/lib/owned-assets.ts promptHref). Jane never estimates a value. Once per loan.

const WHAT = { home: "home", vehicle: "car" } as const;

export const thingsSource: MessageSource = {
  key: "things",
  gather: (snapshot) =>
    snapshot.assetPrompts.map((p) => ({
      kind: "heads_up" as const,
      body: `Your ${p.loanName} has no ${WHAT[p.kind]} linked to it. Add your ${WHAT[p.kind]}'s value and I'll show what you own of it, in your net worth too.`,
      refs: {},
      actions: [
        {
          id: "open",
          label: `Add your ${WHAT[p.kind]}'s value`,
          kind: "link",
          href: p.href,
        } as const,
        snoozeButton(),
      ],
      dedupeKey: `asset:${p.loanId}`,
      priority: MESSAGE_PRIORITY.asset_prompt,
    })),
};
