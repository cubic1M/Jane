import { describe, expect, it } from "vitest";
import { PLAID_TIMEOUT_MS } from "@/config/plaid";
import { plaid } from "./client";

// An answer that never comes must not hold the daily job until the function is killed.
describe("the Plaid client", () => {
  it("gives every call a time limit, well under the daily job's budget", () => {
    const { configuration } = plaid() as unknown as {
      configuration: { baseOptions: { timeout?: number } };
    };
    expect(configuration.baseOptions.timeout).toBe(PLAID_TIMEOUT_MS);
    expect(PLAID_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
