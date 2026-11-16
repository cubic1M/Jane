import { describe, expect, it } from "vitest";
import { PlaidRequestError } from "./client";
import { backoffMs, retryablePlaidError } from "./retry";

// Rate limits and outages are tried again after a wait that doubles; a sign-in needed isn't.
describe("Plaid retries", () => {
  it("knows which failures pass", () => {
    expect(retryablePlaidError(new PlaidRequestError("RATE_LIMIT", 429))).toBe(true);
    expect(retryablePlaidError(new PlaidRequestError("TRANSACTIONS_SYNC_LIMIT", 429))).toBe(true);
    expect(retryablePlaidError(new PlaidRequestError("INSTITUTION_DOWN", 400))).toBe(true);
    expect(retryablePlaidError(new PlaidRequestError("INSTITUTION_NOT_RESPONDING", 400))).toBe(
      true,
    );
    expect(retryablePlaidError(new PlaidRequestError("INTERNAL_SERVER_ERROR", 500))).toBe(true);
    expect(retryablePlaidError(new PlaidRequestError("NETWORK_ECONNRESET", null))).toBe(true);
    expect(retryablePlaidError(new PlaidRequestError(null, 503))).toBe(true);
    expect(retryablePlaidError(new PlaidRequestError("ITEM_LOGIN_REQUIRED", 400))).toBe(false);
    expect(retryablePlaidError(new PlaidRequestError("INVALID_ACCESS_TOKEN", 400))).toBe(false);
    expect(retryablePlaidError(new Error("not Plaid"))).toBe(false);
  });

  it("waits twice as long each time, with a little randomness", () => {
    expect(backoffMs(0, 500, () => 0)).toBe(500);
    expect(backoffMs(1, 500, () => 0)).toBe(1000);
    expect(backoffMs(2, 500, () => 1)).toBe(2500);
  });
});
