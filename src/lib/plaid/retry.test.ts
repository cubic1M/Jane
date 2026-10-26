import { describe, expect, it, vi } from "vitest";
import { PlaidRequestError } from "./client";
import { backoffMs, retryablePlaidError, withPlaidRetry } from "./retry";

// Rate limits and outages are tried again after a wait that doubles; a sign-in needed isn't.
describe("Plaid retries", () => {
  const sleep = vi.fn(async () => {});

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

  it("tries again after an outage, and gives the answer when it comes", async () => {
    sleep.mockClear();
    const call = vi
      .fn()
      .mockRejectedValueOnce(new PlaidRequestError("INSTITUTION_DOWN", 400))
      .mockRejectedValueOnce(new PlaidRequestError("RATE_LIMIT", 429))
      .mockResolvedValueOnce("ok");
    await expect(withPlaidRetry(call, { sleep, random: () => 0 })).resolves.toBe("ok");
    expect(call).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
  });

  it("stops after the last try, and never retries a sign-in", async () => {
    const down = vi.fn().mockRejectedValue(new PlaidRequestError("INSTITUTION_DOWN", 400));
    await expect(withPlaidRetry(down, { sleep })).rejects.toMatchObject({
      code: "INSTITUTION_DOWN",
    });
    expect(down).toHaveBeenCalledTimes(3);
    const login = vi.fn().mockRejectedValue(new PlaidRequestError("ITEM_LOGIN_REQUIRED", 400));
    await expect(withPlaidRetry(login, { sleep })).rejects.toMatchObject({
      code: "ITEM_LOGIN_REQUIRED",
    });
    expect(login).toHaveBeenCalledTimes(1);
  });
});
