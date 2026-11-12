import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/today", () => ({ timezoneOf: vi.fn() }));

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

  // Plaid's PENDING_DISCONNECT: still working, gone on the day unless they sign in (update mode).
  it("asks for a sign-in by Plaid's date when a disconnect is coming, and not after it", () => {
    const by = new Date("2026-11-02T08:00:00Z");
    expect(bankNotices([bank({ reconnectBy: by })], NOW)).toEqual([
      {
        itemId: "i1",
        kind: "reconnect_soon",
        title: "Sign in to First Platypus Bank again by Nov 2",
        words:
          "The bank asks you to sign in again, or sharing stops on that day. It takes a minute, and everything keeps updating until then.",
        action: "Sign in again",
      },
    ]);
    expect(bankNotices([bank({ reconnectBy: ago(1) })], NOW)).toEqual([]);
  });

  // 03:00 UTC on Nov 2 is still Nov 1 in Los Angeles: saying Nov 2 there would be a day late.
  it("names the disconnect's day in the person's own timezone", () => {
    const by = new Date("2026-11-02T03:00:00Z");
    const [notice] = bankNotices([bank({ reconnectBy: by })], NOW, "America/Los_Angeles");
    expect(notice.title).toBe("Sign in to First Platypus Bank again by Nov 1");
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
