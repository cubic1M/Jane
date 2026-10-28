import { describe, expect, it } from "vitest";
import { closedBody } from "@/lib/jane-agent/replies-close";
import type { CloseView } from "@/lib/month-close";
import { closeNetWorth } from "@/planning/month-close";

// The CSV bench's skipped-balance path (round 24): a month closed while no balance is known shows
// no figure, and one closed while a card's balance is unknown says so beside it. Never a silent $0.
describe("net worth at the month close", () => {
  const card = { id: "c", name: "Citi card", type: "credit", currentBalanceCents: null };
  const checking = { id: "k", name: "Wells Fargo checking", type: "depository" };

  it("is not known, not $0, when no balance is", () => {
    expect(closeNetWorth([{ ...checking, currentBalanceCents: null }, card], [], 0)).toEqual({
      netWorthCents: null,
      netWorthNotCounting:
        "Not counting your Citi card or Wells Fargo checking balances: the files don't say them yet.",
    });
  });

  it("says what it leaves out beside the figure", () => {
    expect(closeNetWorth([{ ...checking, currentBalanceCents: 250_000 }, card], [], 0)).toEqual({
      netWorthCents: 250_000,
      netWorthNotCounting: "Not counting your Citi card balance: the file doesn't say it yet.",
    });
  });

  it("is complete with nothing to say when every balance is known", () => {
    expect(
      closeNetWorth(
        [
          { ...checking, currentBalanceCents: 250_000 },
          { ...card, currentBalanceCents: 50_000 },
        ],
        [],
        0,
      ),
    ).toEqual({ netWorthCents: 200_000, netWorthNotCounting: null });
  });

  it("tells the chat the same", () => {
    const view = (netWorthCents: number | null, netWorthNotCounting: string | null) =>
      ({
        month: "2026-09",
        figures: {
          month: "2026-09",
          incomeCents: 400_000,
          spendingCents: 300_000,
          topCategories: [],
          netWorthCents,
          netWorthNotCounting,
          booksOpen: 0,
          paidDownCents: null,
          plan: null,
          worked: null,
          confirmed: false,
        },
      }) as unknown as CloseView;
    expect(
      closedBody(view(null, "Not counting your Citi card balance: the file doesn't say it yet.")),
    ).toContain("Net worth at the close isn't known: Not counting your Citi card balance");
    expect(
      closedBody(
        view(250_000, "Not counting your Citi card balance: the file doesn't say it yet."),
      ),
    ).toContain("Net worth at the close: $2,500.00. Not counting your Citi card balance");
  });
});
