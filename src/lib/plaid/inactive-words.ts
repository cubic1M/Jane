// The words of the inactivity warning (src/lib/plaid/inactive.ts) that change with what a person
// has linked: the subject, what will be disconnected, and what that does. Pure: it sends nothing
// and has no say in who is warned. Without a mailbox they are the words the email has always had.
// A mailbox says what disconnecting it does in its own words: only what Jane read from it goes,
// and it can be connected again, which a bank may not be while Jane is in beta.

export type InactivityWords = { subject: string; what: string; after: string };

type Linking = "banks" | "robinhood" | "both";

const BANKS_SUBJECT = "We'll disconnect your banks soon | Jane";

const LINKED_AFTER =
  "That removes their accounts and transactions and what was worked out from them, and while Jane is in beta you may not be able to link them again.";

// As the email has always said it. A person with no bank here has Robinhood.
const WITHOUT_MAILBOXES: Record<Linking, InactivityWords> = {
  banks: { subject: BANKS_SUBJECT, what: "your linked banks", after: LINKED_AFTER },
  robinhood: { subject: BANKS_SUBJECT, what: "your Robinhood connection", after: LINKED_AFTER },
  both: { subject: BANKS_SUBJECT, what: "your linked banks and Robinhood", after: LINKED_AFTER },
};

// Google is asked to end the permission, never promised to: it may not answer, and nothing is sent
// for a mailbox another Jane account holds now (src/lib/gmail/mailbox.ts).
const MAILBOXES_ONLY: InactivityWords = {
  subject: "We'll disconnect your mailboxes soon | Jane",
  what: "your Gmail mailboxes",
  after:
    "That deletes what Jane read from them and asks Google to end Jane's permission. You can connect them again later.",
};

const MAILBOXES_TOO =
  "Disconnecting your mailboxes deletes what Jane read from them and asks Google to end Jane's permission. You can connect the mailboxes again later.";

// Banks or Robinhood beside mailboxes: each is named, with what disconnecting it does.
const BESIDE_MAILBOXES: Record<Linking, InactivityWords> = {
  banks: {
    subject: "We'll disconnect your banks and mailboxes soon | Jane",
    what: "your linked banks and your Gmail mailboxes",
    after: `Disconnecting your banks removes their accounts and transactions and what was worked out from them. While Jane is in beta you may not be able to link them again. ${MAILBOXES_TOO}`,
  },
  robinhood: {
    subject: "We'll disconnect Robinhood and your mailboxes soon | Jane",
    what: "your Robinhood connection and your Gmail mailboxes",
    after: `Disconnecting Robinhood removes its accounts and transactions and what was worked out from them. While Jane is in beta you may not be able to link it again. ${MAILBOXES_TOO}`,
  },
  both: {
    subject: "We'll disconnect your banks, Robinhood and mailboxes soon | Jane",
    what: "your linked banks, Robinhood and your Gmail mailboxes",
    after: `Disconnecting your banks and Robinhood removes their accounts and transactions and what was worked out from them. While Jane is in beta you may not be able to link them again. ${MAILBOXES_TOO}`,
  },
};

export function inactivityWords({
  banks,
  robinhood,
  mailboxes,
}: {
  banks: boolean;
  robinhood: boolean;
  mailboxes: boolean;
}): InactivityWords {
  if (mailboxes && !banks && !robinhood) return MAILBOXES_ONLY;
  const linking: Linking = !banks ? "robinhood" : robinhood ? "both" : "banks";
  return (mailboxes ? BESIDE_MAILBOXES : WITHOUT_MAILBOXES)[linking];
}
