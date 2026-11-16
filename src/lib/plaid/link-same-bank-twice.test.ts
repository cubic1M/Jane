import { randomBytes } from "node:crypto";
import type { PlaidApi } from "plaid";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { scoped } = vi.hoisted(() => ({
  scoped: {
    plaidItems: { findFirst: vi.fn(), create: vi.fn() },
    accounts: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn(() => scoped) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { track } from "@/lib/analytics";
import { AlreadyLinkedError, exchangePublicToken } from "./link";

// A student linked First Platypus Bank a second time (debug 3, 11-16, Plaid sandbox): every one of
// its seven accounts was there twice, and the card's charges doubled as the second copy synced.
// A link whose accounts are all already linked from the same bank is ended at Plaid and refused.

const itemPublicTokenExchange = vi.fn();
const itemRemove = vi.fn();
const accountsGet = vi.fn();
const api = { itemPublicTokenExchange, itemRemove, accountsGet } as unknown as PlaidApi;

const LINKED = [
  { type: "depository", mask: "1000", name: "Plaid checking" },
  { type: "credit", mask: "2000", name: "Plaid credit card" },
];
const shared = (accounts: { type: string; mask: string | null; name: string }[]) => ({
  data: { accounts: accounts.map((a, i) => ({ account_id: `acc_${i}`, ...a })) },
});

describe("linking a bank that's already linked", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    itemPublicTokenExchange
      .mockReset()
      .mockResolvedValue({ data: { access_token: "access-sandbox-2", item_id: "plaid_item_2" } });
    itemRemove.mockReset().mockResolvedValue({ data: {} });
    accountsGet.mockReset().mockResolvedValue(shared(LINKED));
    // No row for this Plaid item yet; the same bank linked before.
    scoped.plaidItems.findFirst
      .mockReset()
      .mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        "plaidItemId" in where ? null : { id: "item_row_1" },
      );
    scoped.plaidItems.create.mockReset().mockResolvedValue({ id: "item_row_2" });
    scoped.accounts.findMany.mockReset().mockResolvedValue(LINKED);
    vi.mocked(track).mockReset();
  });

  it("ends the new link at Plaid, saves nothing, and says it's linked already", async () => {
    const linking = exchangePublicToken("user_1", "public-2", "First Platypus Bank", { api });
    await expect(linking).rejects.toBeInstanceOf(AlreadyLinkedError);
    await expect(linking).rejects.toThrow(
      "You've already linked First Platypus Bank, so nothing new was added.",
    );
    expect(itemRemove).toHaveBeenCalledWith({ access_token: "access-sandbox-2" });
    expect(scoped.plaidItems.create).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("user_1", "link_refused", {
      reason: "already_linked",
      at: "exchange",
    });
  });

  it("matches the bank's name whatever its case, and an account with no digits by its name", async () => {
    accountsGet.mockResolvedValue(shared([{ type: "loan", mask: null, name: "Student loan" }]));
    scoped.accounts.findMany.mockResolvedValue([
      { type: "loan", mask: null, name: "Student loan" },
    ]);
    await expect(
      exchangePublicToken("user_1", "public-2", "FIRST PLATYPUS BANK", { api }),
    ).rejects.toBeInstanceOf(AlreadyLinkedError);
  });

  it("links it when it shares an account that isn't linked yet", async () => {
    accountsGet.mockResolvedValue(
      shared([...LINKED, { type: "depository", mask: "3333", name: "Plaid saving" }]),
    );
    await expect(
      exchangePublicToken("user_1", "public-2", "First Platypus Bank", { api }),
    ).resolves.toBe("item_row_2");
    expect(itemRemove).not.toHaveBeenCalled();
  });

  it("links a different bank, and a second login at the same bank with other accounts", async () => {
    scoped.plaidItems.findFirst.mockImplementation(async () => null);
    await expect(exchangePublicToken("user_1", "public-2", "Chase", { api })).resolves.toBe(
      "item_row_2",
    );
    expect(accountsGet).not.toHaveBeenCalled();
    scoped.plaidItems.findFirst.mockImplementation(async ({ where }) =>
      "plaidItemId" in where ? null : { id: "item_row_1" },
    );
    accountsGet.mockResolvedValue(shared([{ type: "depository", mask: "4444", name: "Joint" }]));
    await expect(
      exchangePublicToken("user_1", "public-3", "First Platypus Bank", { api }),
    ).resolves.toBe("item_row_2");
  });

  it("links it as before when Plaid can't list the accounts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    accountsGet.mockRejectedValue(new Error("no answer"));
    await expect(
      exchangePublicToken("user_1", "public-2", "First Platypus Bank", { api }),
    ).resolves.toBe("item_row_2");
  });
});
