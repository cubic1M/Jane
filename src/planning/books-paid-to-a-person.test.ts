import { describe, expect, it } from "vitest";
import { unmatchedToSay, type Tx } from "./books";
import { booksSource } from "@/lib/jane-agent/sources/books";
import type { Snapshot } from "@/lib/jane-agent/snapshot";

// Debugger 11-16 (a student's one month of Chase checking): the chat said "A transfer of $900.00 on
// Nov 1, 2026 ("Zelle payment to Sam Lee JPM99abc1234") left one of your accounts with no matching
// deposit in another. If it went to an account I can't see, that's fine; add that account to count
// it. Figures that rely on it are marked until it's fixed." It was rent, sent to a roommate. Money
// sent to someone through a payment app has no other side to find, and an unmatched transfer
// never marks a figure.

const out = (id: string, description: string, cents = 90_000): Tx => ({
  id,
  accountId: "a",
  date: "2026-11-01",
  amountCents: cents,
  description,
  pfcPrimary: "TRANSFER_OUT",
});

describe("money sent to someone", () => {
  it("isn't a transfer with a missing side", () => {
    const sent = [
      out("z", "Zelle payment to Sam Lee JPM99abc1234"),
      out("v", "VENMO PAYMENT 1023456789 WEB ID: 3264681992"),
      out("c", "CASH APP*SAM LEE"),
      out("p", "PAYPAL INST XFER"),
    ];
    expect(unmatchedToSay(sent, [])).toEqual([]);
  });

  it("still says a transfer to an account Jane can't see", () => {
    const sent = [out("t", "ONLINE TRANSFER TO ALLY SAVINGS")];
    expect(unmatchedToSay(sent, [])).toEqual(sent);
  });
});

describe("an unmatched transfer in the chat", () => {
  it("doesn't say figures are marked", () => {
    const snapshot = {
      books: {
        open: [
          {
            id: "i1",
            kind: "transfer",
            words: "A transfer of $900.00 on Nov 1, 2026 left one of your accounts.",
          },
        ],
      },
    } as unknown as Snapshot;
    const [message] = booksSource.gather(snapshot, {
      now: new Date("2026-11-16T05:00:00Z"),
      local: {} as never,
      trigger: "open",
    });
    expect(message?.body).toBe("A transfer of $900.00 on Nov 1, 2026 left one of your accounts.");
  });
});
