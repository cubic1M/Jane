import { randomBytes } from "node:crypto";
import type { PlaidApi } from "plaid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { scoped } = vi.hoisted(() => ({
  scoped: { plaidItems: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn(() => scoped) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { ItemNotFoundError, createLinkToken, exchangePublicToken, markItemRepaired } from "./link";

const linkTokenCreate = vi.fn();
const itemPublicTokenExchange = vi.fn();
const itemRemove = vi.fn();
const api = { linkTokenCreate, itemPublicTokenExchange, itemRemove } as unknown as PlaidApi;

describe("Plaid Link", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("APP_URL", "https://app.example.com");
    linkTokenCreate.mockReset().mockResolvedValue({ data: { link_token: "link-sandbox-1" } });
    itemPublicTokenExchange.mockReset();
    itemRemove.mockReset().mockResolvedValue({ data: {} });
    scoped.plaidItems.findFirst.mockReset();
    scoped.plaidItems.create.mockReset().mockResolvedValue({ id: "item_row_1" });
    scoped.plaidItems.updateMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(track).mockReset();
    vi.mocked(logAudit).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("when saving a new bank fails", () => {
    const madeUp = { access_token: "access-sandbox-only-copy", item_id: "plaid_item_9" };

    beforeEach(() => {
      itemPublicTokenExchange.mockResolvedValue({ data: madeUp });
    });

    it("ends the Item at Plaid, since nothing else could without the token", async () => {
      const failure = new Error("the database went away");
      scoped.plaidItems.create.mockRejectedValue(failure);
      await expect(exchangePublicToken("user_1", "public-1", "Bank", { api })).rejects.toBe(
        failure,
      );
      expect(itemRemove).toHaveBeenCalledWith({ access_token: madeUp.access_token });
    });

    it("makes nothing when the token couldn't be encrypted", async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
      await expect(exchangePublicToken("user_1", "public-1", "Bank", { api })).rejects.toThrow();
      expect(api.itemPublicTokenExchange).not.toHaveBeenCalled();
    });

    it("tells the person about the failure even if Plaid can't remove it, without the token", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const failure = new Error("the database went away");
      scoped.plaidItems.create.mockRejectedValue(failure);
      itemRemove.mockRejectedValue(new Error("no answer"));
      await expect(exchangePublicToken("user_1", "public-1", "Bank", { api })).rejects.toBe(
        failure,
      );
      expect(logged).toHaveBeenCalled();
      expect(JSON.stringify(logged.mock.calls)).not.toContain(madeUp.access_token);
      logged.mockRestore();
    });

    it("leaves an Item whose row already exists: it's in use", async () => {
      scoped.plaidItems.create.mockRejectedValue(
        Object.assign(new Error("unique"), { code: "P2002" }),
      );
      await expect(exchangePublicToken("user_1", "public-1", "Bank", { api })).rejects.toThrow();
      expect(itemRemove).not.toHaveBeenCalled();
    });
  });

  it("asks for Investments only once PLAID_INVESTMENTS is on", async () => {
    await createLinkToken("user_1", null, { api });
    expect(linkTokenCreate.mock.calls[0][0].optional_products).toEqual(["liabilities"]);

    itemPublicTokenExchange.mockResolvedValue({
      data: { access_token: "access-sandbox-secret", item_id: "plaid_item_1" },
    });
    await exchangePublicToken("user_1", "public-sandbox-1", "First Platypus Bank", { api });
    expect(scoped.plaidItems.create.mock.calls[0][0].data.investments).toBe(false);
  });

  it("asks for Transactions, Liabilities and Investments where supported, a year of history and our webhook", async () => {
    vi.stubEnv("PLAID_INVESTMENTS", "1");
    expect(await createLinkToken("user_1", null, { api })).toBe("link-sandbox-1");

    expect(linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        products: ["transactions"],
        optional_products: ["liabilities", "investments"],
        transactions: { days_requested: 365 },
        user: { client_user_id: "user_1" },
        country_codes: ["US"],
        webhook: "https://app.example.com/api/plaid/webhook",
      }),
    );
    expect(track).toHaveBeenCalledWith("user_1", "link_started", { update_mode: false });
  });

  it("opens update mode with the item's own access token", async () => {
    scoped.plaidItems.findFirst.mockResolvedValue({
      accessTokenEncrypted: encrypt("access-sandbox-item"),
    });

    await createLinkToken("user_1", "item_row_1", { api });

    const request = linkTokenCreate.mock.calls[0][0];
    expect(request.access_token).toBe("access-sandbox-item");
    expect(request.products).toBeUndefined();
    expect(request.optional_products).toBeUndefined();
  });

  it("lets the person pick new accounts to share when the bank has some", async () => {
    scoped.plaidItems.findFirst.mockResolvedValue({
      accessTokenEncrypted: encrypt("access-sandbox-item"),
      newAccountsAvailable: true,
    });
    await createLinkToken("user_1", "item_row_1", { api });
    expect(linkTokenCreate.mock.calls[0][0]).toMatchObject({
      access_token: "access-sandbox-item",
      update: { account_selection_enabled: true },
    });
    // A plain sign-in doesn't ask about accounts.
    scoped.plaidItems.findFirst.mockResolvedValue({
      accessTokenEncrypted: encrypt("access-sandbox-item"),
      newAccountsAvailable: false,
    });
    await createLinkToken("user_1", "item_row_1", { api });
    expect(linkTokenCreate.mock.calls[1][0].update).toBeUndefined();
  });

  it("stops asking once update mode is done, and says so in the audit log", async () => {
    await markItemRepaired("user_1", "item_row_1");
    expect(scoped.plaidItems.updateMany).toHaveBeenCalledWith({
      where: { id: "item_row_1" },
      data: {
        status: "active",
        newAccountsAvailable: false,
        lastErrorCode: null,
        lastErrorAt: null,
        // A pending disconnect (PENDING_DISCONNECT) is answered too.
        reconnectBy: null,
      },
    });
    expect(logAudit).toHaveBeenCalledWith({ type: "user", id: "user_1" }, "item_relinked", {
      type: "plaid_item",
      id: "item_row_1",
    });
    scoped.plaidItems.updateMany.mockResolvedValue({ count: 0 });
    await expect(markItemRepaired("user_1", "item_x")).rejects.toBeInstanceOf(ItemNotFoundError);
  });

  it("refuses update mode for an item the user doesn't have", async () => {
    scoped.plaidItems.findFirst.mockResolvedValue(null);

    await expect(createLinkToken("user_1", "item_x", { api })).rejects.toBeInstanceOf(
      ItemNotFoundError,
    );
  });

  it("stores the access token encrypted and never in the audit log", async () => {
    vi.stubEnv("PLAID_INVESTMENTS", "1");
    itemPublicTokenExchange.mockResolvedValue({
      data: { access_token: "access-sandbox-secret", item_id: "plaid_item_1" },
    });

    const id = await exchangePublicToken("user_1", "public-sandbox-1", "First Platypus Bank", {
      api,
    });

    expect(id).toBe("item_row_1");
    const saved = scoped.plaidItems.create.mock.calls[0][0].data;
    expect(saved.accessTokenEncrypted).not.toContain("access-sandbox-secret");
    expect(decrypt(saved.accessTokenEncrypted)).toBe("access-sandbox-secret");
    expect(saved.liabilities).toBe(true);
    expect(saved.investments).toBe(true);
    expect(JSON.stringify(vi.mocked(logAudit).mock.calls)).not.toContain("access-sandbox");
    expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toContain("access-sandbox");
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: "user_1" },
      "item_linked",
      { type: "plaid_item", id: "item_row_1" },
      { institution: "First Platypus Bank" },
    );
  });
});
