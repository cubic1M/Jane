import { describe, expect, it } from "vitest";
import { inactivityWords } from "./inactive-words";

// The inactivity warning's words for every mix of what a person may have linked. The three without
// a mailbox are copied from src/lib/plaid/inactive.ts as it was before mailboxes, and must stay
// exactly that.

const SEVEN = [
  { banks: true, robinhood: false, mailboxes: false },
  { banks: false, robinhood: true, mailboxes: false },
  { banks: true, robinhood: true, mailboxes: false },
  { banks: false, robinhood: false, mailboxes: true },
  { banks: true, robinhood: false, mailboxes: true },
  { banks: false, robinhood: true, mailboxes: true },
  { banks: true, robinhood: true, mailboxes: true },
];

const BEFORE_MAILBOXES_AFTER =
  "That removes their accounts and transactions and what was worked out from them, and while Jane is in beta you may not be able to link them again.";

const MAILBOXES_TOO =
  "Disconnecting your mailboxes deletes what Jane read from them and ends Jane's permission at Google. You can connect the mailboxes again later.";

describe("the inactivity warning's words", () => {
  it.each([
    [{ banks: true, robinhood: false }, "your linked banks"],
    [{ banks: false, robinhood: true }, "your Robinhood connection"],
    [{ banks: true, robinhood: true }, "your linked banks and Robinhood"],
  ])("are today's words, byte for byte, without a mailbox (%o)", (linked, what) => {
    expect(inactivityWords({ ...linked, mailboxes: false })).toEqual({
      subject: "We'll disconnect your banks soon | Jane",
      what,
      after: BEFORE_MAILBOXES_AFTER,
    });
  });

  it("tell a person with only mailboxes what disconnecting a mailbox does, and nothing about banks", () => {
    expect(inactivityWords({ banks: false, robinhood: false, mailboxes: true })).toEqual({
      subject: "We'll disconnect your mailboxes soon | Jane",
      what: "your Gmail mailboxes",
      after:
        "That deletes what Jane read from them and ends Jane's permission at Google. You can connect them again later.",
    });
  });

  it.each([
    [
      { banks: true, robinhood: false },
      {
        subject: "We'll disconnect your banks and mailboxes soon | Jane",
        what: "your linked banks and your Gmail mailboxes",
        after: `Disconnecting your banks removes their accounts and transactions and what was worked out from them. While Jane is in beta you may not be able to link them again. ${MAILBOXES_TOO}`,
      },
    ],
    [
      { banks: false, robinhood: true },
      {
        subject: "We'll disconnect Robinhood and your mailboxes soon | Jane",
        what: "your Robinhood connection and your Gmail mailboxes",
        after: `Disconnecting Robinhood removes its accounts and transactions and what was worked out from them. While Jane is in beta you may not be able to link it again. ${MAILBOXES_TOO}`,
      },
    ],
    [
      { banks: true, robinhood: true },
      {
        subject: "We'll disconnect your banks, Robinhood and mailboxes soon | Jane",
        what: "your linked banks, Robinhood and your Gmail mailboxes",
        after: `Disconnecting your banks and Robinhood removes their accounts and transactions and what was worked out from them. While Jane is in beta you may not be able to link them again. ${MAILBOXES_TOO}`,
      },
    ],
  ])(
    "name each thing with its own consequence when mailboxes sit beside it (%o)",
    (linked, words) => {
      expect(inactivityWords({ ...linked, mailboxes: true })).toEqual(words);
    },
  );

  it("name exactly what the person has linked, and nothing they haven't", () => {
    for (const linked of SEVEN) {
      const { what } = inactivityWords(linked);
      expect([/banks/.test(what), /Robinhood/.test(what), /mailboxes/.test(what)]).toEqual([
        linked.banks,
        linked.robinhood,
        linked.mailboxes,
      ]);
    }
  });

  it("put mailboxes in the subject exactly when there are mailboxes", () => {
    for (const linked of SEVEN) {
      expect(inactivityWords(linked).subject.includes("mailboxes")).toBe(linked.mailboxes);
    }
  });

  it("say Google's permission ends only with mailboxes, and linking may not work again only with a bank or Robinhood", () => {
    for (const linked of SEVEN) {
      const { after } = inactivityWords(linked);
      expect(after.includes("ends Jane's permission at Google")).toBe(linked.mailboxes);
      expect(after.includes("may not be able to link")).toBe(linked.banks || linked.robinhood);
    }
  });

  it("promise connecting again only of mailboxes", () => {
    for (const linked of SEVEN) {
      const { after } = inactivityWords(linked);
      expect(/You can connect (them|the mailboxes) again later\.$/.test(after)).toBe(
        linked.mailboxes,
      );
      expect(after).not.toMatch(/link (them|it) again later/);
    }
  });

  it("give each of the seven its own words", () => {
    const whats = SEVEN.map((linked) => inactivityWords(linked).what);
    expect(new Set(whats).size).toBe(SEVEN.length);
  });
});
