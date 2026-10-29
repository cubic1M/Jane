import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { isDemoOnly, whyNoDigest, type DigestCandidate } from "./recipients";

const person = (overrides: Partial<DigestCandidate> = {}): DigestCandidate => ({
  id: "user1",
  email: "sam@example.com",
  digestEnabled: true,
  deletedAt: null,
  plaidItemIds: ["item-real-bank"],
  csvAccounts: 0,
  accounts: 2,
  ...overrides,
});

describe("whyNoDigest", () => {
  it("sends to a real person with a real bank or an upload", () => {
    expect(whyNoDigest(person())).toBeNull();
    expect(whyNoDigest(person({ plaidItemIds: [], csvAccounts: 1, accounts: 1 }))).toBeNull();
  });

  it("never sends to a trial person, by id or by address, whatever their settings say", () => {
    expect(whyNoDigest(person({ id: "trial_abc" }))).toBe("trial");
    expect(whyNoDigest(person({ email: "x@try.jane.invalid" }))).toBe("trial");
  });

  it("never sends to someone who turned it off", () => {
    expect(whyNoDigest(person({ digestEnabled: false }))).toBe("opted_out");
  });

  it("never sends to a deleted account or one with no accounts", () => {
    expect(whyNoDigest(person({ deletedAt: new Date() }))).toBe("deleted");
    expect(whyNoDigest(person({ accounts: 0, plaidItemIds: [] }))).toBe("no_accounts");
  });

  it("never sends to someone whose only bank is the demo bank", () => {
    expect(whyNoDigest(person({ plaidItemIds: ["demo-seed1"] }))).toBe("demo_only");
    expect(whyNoDigest(person({ plaidItemIds: ["demo-seed1", "demo-seed1-second"] }))).toBe(
      "demo_only",
    );
  });

  it("sends when a real bank or an upload sits next to the demo bank", () => {
    expect(whyNoDigest(person({ plaidItemIds: ["demo-seed1", "item-real"] }))).toBeNull();
    expect(whyNoDigest(person({ plaidItemIds: ["demo-seed1"], csvAccounts: 1 }))).toBeNull();
  });
});

describe("isDemoOnly", () => {
  it("needs at least one bank login", () => {
    expect(isDemoOnly([], 0)).toBe(false);
  });
});
