import { describe, expect, it } from "vitest";
import type { CloseView } from "@/lib/month-close";
import { waitingBody } from "./replies-close";

// Debugger 11-01: closing October for a Capital One 360 file asked about "• Debit Card Purchase -
// BESTBUY.COM 888-237-8289 MN on 2026-10-22": the bank's raw line and a date no one writes.
describe("the close's question about unsure charges", () => {
  it("names each charge by its merchant, on a day people read", () => {
    const view = {
      month: "2026-10",
      status: "waiting",
      uncertain: [
        {
          id: "a",
          date: "2026-10-22",
          description: "Debit Card Purchase - BESTBUY.COM 888-237-8289 MN",
          name: "Bestbuy",
          amountCents: 48_999,
        },
        {
          id: "b",
          date: "2026-10-22",
          description: "Debit Card Purchase - QXT*ELECTRONICS HK",
          name: "Qxt",
          amountCents: 31_250,
        },
      ],
    } as unknown as CloseView;
    expect(waitingBody(view).split("\n").slice(1)).toEqual([
      "• Bestbuy on Oct 22: $489.99",
      "• Qxt on Oct 22: $312.50",
    ]);
  });
});
