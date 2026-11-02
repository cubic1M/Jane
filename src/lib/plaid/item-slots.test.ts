import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn() }));

import {
  PLAID_ITEMS_PER_PERSON,
  PLAID_TRIAL_ITEM_LIMIT,
  plaidItemLimit,
  plaidItemsPerPerson,
  plaidItemWarnAt,
} from "@/config/plaid-items";
import { scopedFor } from "@/lib/db-scoped";
import { bankConnectionsLine, linkAvailability, linkClosedAnswer } from "./item-slots";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the limits", () => {
  it("are the Trial plan's: 10 in all, 1 each, with a warning at 8", () => {
    expect(PLAID_TRIAL_ITEM_LIMIT).toBe(10);
    expect(PLAID_ITEMS_PER_PERSON).toBe(1);
    expect(plaidItemLimit()).toBe(10);
    expect(plaidItemsPerPerson()).toBe(1);
    expect(plaidItemWarnAt(10)).toBe(8);
  });

  it("change with the environment, after an upgrade", () => {
    vi.stubEnv("PLAID_TRIAL_ITEM_LIMIT", "200");
    vi.stubEnv("PLAID_ITEMS_PER_PERSON", " 3 ");
    expect(plaidItemLimit()).toBe(200);
    expect(plaidItemsPerPerson()).toBe(3);
    expect(plaidItemWarnAt(200)).toBe(160);
  });

  it("stay the Trial plan's on a typo, so nothing can mean no limit", () => {
    for (const typo of ["unlimited", "-1", "1e3", "ten", "10.5"]) {
      vi.stubEnv("PLAID_TRIAL_ITEM_LIMIT", typo);
      expect(plaidItemLimit()).toBe(10);
    }
  });
});

describe("the words", () => {
  it("are plain, with no raw error, and say what to do instead", () => {
    const answer = { error: "Bank linking is full for now. Upload a statement instead." };
    expect(linkClosedAnswer("full")).toEqual({ ...answer, code: "linking_full" });
    expect(linkClosedAnswer("person")).toEqual({ ...answer, code: "linking_full" });
    expect(linkClosedAnswer("trial").error).not.toMatch(/upload/i);
    expect(bankConnectionsLine({ used: 3, limit: 10 })).toBe("3 of 10 bank connections used");
  });
});

describe("Sandbox", () => {
  it("is always open, without reading the database", async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    await expect(linkAvailability("user_1")).resolves.toEqual({ open: true });
    expect(scopedFor).not.toHaveBeenCalled();
  });
});
