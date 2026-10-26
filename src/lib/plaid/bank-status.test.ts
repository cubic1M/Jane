import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { bankNotices, updatedAgo, type BankItem } from "./bank-status";

// A linked bank's trouble, told calmly and honestly, with how old the data is.
const NOW = new Date("2026-10-26T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
const bank = (over: Partial<BankItem> = {}): BankItem => ({
  id: "i1",
  name: "First Platypus Bank",
  status: "active",
  lastSyncedAt: ago(2),
  newAccountsAvailable: false,
  lastErrorCode: null,
  ...over,
});

describe("how old the data is", () => {
  it("says it in words", () => {
    expect(updatedAgo(ago(0.2), NOW)).toBe("just now");
    expect(updatedAgo(ago(1), NOW)).toBe("an hour ago");
    expect(updatedAgo(ago(5), NOW)).toBe("5 hours ago");
    expect(updatedAgo(ago(30), NOW)).toBe("yesterday");
    expect(updatedAgo(ago(74), NOW)).toBe("3 days ago");
    expect(updatedAgo(null, NOW)).toBe("not yet");
  });
});

describe("what a bank needs from the person", () => {
  it("is nothing when it's fine", () => {
    expect(bankNotices([bank()], NOW)).toEqual([]);
  });

  it("asks for a sign-in calmly, with how old the data is and the way to do it", () => {
    expect(bankNotices([bank({ status: "login_required", lastSyncedAt: ago(74) })], NOW)).toEqual([
      {
        itemId: "i1",
        kind: "sign_in",
        title: "Your bank needs you to sign in again",
        words:
          "First Platypus Bank paused sharing until you sign in. Nothing is wrong with your money. What you see from there was last updated 3 days ago.",
        action: "Sign in again",
      },
    ]);
  });

  it("offers new accounts to share", () => {
    expect(bankNotices([bank({ newAccountsAvailable: true })], NOW)[0]).toMatchObject({
      kind: "new_accounts",
      action: "Choose accounts",
    });
  });

  it("says an outage plainly, that the data is old, and that there's nothing to do", () => {
    const [down] = bankNotices(
      [bank({ lastErrorCode: "INSTITUTION_DOWN", lastSyncedAt: ago(50) })],
      NOW,
    );
    expect(down).toMatchObject({
      kind: "trouble",
      title: "First Platypus Bank isn't answering right now",
      action: null,
    });
    expect(down.words).toBe(
      "What you see from there was last updated 2 days ago. Jane tries again on its own; there's nothing you need to do.",
    );
    expect(bankNotices([bank({ lastErrorCode: "RATE_LIMIT" })], NOW)[0].title).toMatch(/slow down/);
  });
});
