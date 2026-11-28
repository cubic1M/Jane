import type { PlaidApi } from "plaid";
import { describe, expect, it, vi } from "vitest";
import { REPLACE_TOTAL_MS, REPLACE_WAIT_MS, REPLACING_STALE_MS } from "@/config/plaid";
import { PlaidDataSource, ReadDeadlineError } from "@/data-sources/plaid/plaid-source";
import { plaidAccount, syncPage } from "@/data-sources/plaid/__fixtures__/plaid";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));

describe("the replacement stays inside the route's time limit", () => {
  it("waits about two minutes, gives the whole move four, and the route allows five", async () => {
    const { maxDuration } = await import("@/app/api/plaid/full-history/route");
    expect(REPLACE_WAIT_MS).toBeLessThanOrEqual(120_000);
    // The commit and the removal at Plaid still fit after the budget, with margin.
    expect(REPLACE_TOTAL_MS + 30_000).toBeLessThanOrEqual(maxDuration * 1000);
    expect(REPLACE_WAIT_MS).toBeLessThan(REPLACE_TOTAL_MS);
    // A hidden row of a replacement still running is never taken: it is older than the route allows.
    expect(REPLACING_STALE_MS).toBeGreaterThan(maxDuration * 1000);
  });

  it("checks the deadline before every page of a read, not only between reads", async () => {
    const page = syncPage({
      accounts: [plaidAccount({ account_id: "a" })],
      added: [],
      next_cursor: "c1",
      status: "INITIAL_UPDATE_COMPLETE",
    });
    // Page one says there is more; the clock passes the deadline while it is read.
    let now = 1_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const transactionsSync = vi.fn(async () => {
      now += 500;
      return { data: { ...page.data, has_more: true } };
    });
    const api = { transactionsSync } as unknown as PlaidApi;
    await expect(
      new PlaidDataSource(api, "t", null, undefined, 1_300).load(),
    ).rejects.toBeInstanceOf(ReadDeadlineError);
    // The first page was read (the deadline had not passed); a second was never asked for.
    expect(transactionsSync).toHaveBeenCalledTimes(1);
    // A deadline already past asks Plaid for nothing.
    transactionsSync.mockClear();
    await expect(new PlaidDataSource(api, "t", null, undefined, 10).load()).rejects.toBeInstanceOf(
      ReadDeadlineError,
    );
    expect(transactionsSync).not.toHaveBeenCalled();
    dateNow.mockRestore();
  });
});
