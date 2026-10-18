import { randomBytes } from "node:crypto";
import type { PlaidApi } from "plaid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { scoped } = vi.hoisted(() => ({
  scoped: { plaidItems: { findFirst: vi.fn(), create: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn(() => scoped) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { ItemNotFoundError, createLinkToken, exchangePublicToken } from "./link";

const linkTokenCreate = vi.fn();
const itemPublicTokenExchange = vi.fn();
const api = { linkTokenCreate, itemPublicTokenExchange } as unknown as PlaidApi;

describe("Plaid Link", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("APP_URL", "https://app.example.com");
    linkTokenCreate.mockReset().mockResolvedValue({ data: { link_token: "link-sandbox-1" } });
    itemPublicTokenExchange.mockReset();
    scoped.plaidItems.findFirst.mockReset();
    scoped.plaidItems.create.mockReset().mockResolvedValue({ id: "item_row_1" });
    vi.mocked(track).mockReset();
    vi.mocked(logAudit).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks for Transactions only, a year of history and our webhook", async () => {
    expect(await createLinkToken("user_1", null, { api })).toBe("link-sandbox-1");

    expect(linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        products: ["transactions"],
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
  });

  it("refuses update mode for an item the user doesn't have", async () => {
    scoped.plaidItems.findFirst.mockResolvedValue(null);

    await expect(createLinkToken("user_1", "item_x", { api })).rejects.toBeInstanceOf(
      ItemNotFoundError,
    );
  });

  it("stores the access token encrypted and never in the audit log", async () => {
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
