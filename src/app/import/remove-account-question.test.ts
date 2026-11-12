import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { removeAccountQuestion } from "./upload-history";

// Debugger 11-12: removing an account left empty by "Remove this upload" asked "Remove Wells Fargo
// checking and all 0 transactions in it?".

describe("what Remove account asks", () => {
  it("doesn't count transactions that aren't there", () => {
    expect(removeAccountQuestion("Wells Fargo checking", 0)).toBe(
      "Remove Wells Fargo checking? There are no transactions in it.",
    );
    expect(removeAccountQuestion("Wells Fargo checking", 0)).not.toMatch(/all 0|0 transactions/);
  });

  it("says one transaction, or all of many", () => {
    expect(removeAccountQuestion("Chase card", 1)).toBe(
      "Remove Chase card and the 1 transaction in it?",
    );
    expect(removeAccountQuestion("Chase card", 29)).toBe(
      "Remove Chase card and all 29 transactions in it?",
    );
  });
});
