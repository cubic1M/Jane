import { beforeEach, describe, expect, it, vi } from "vitest";

const { afterCallbacks } = vi.hoisted(() => ({ afterCallbacks: [] as (() => Promise<void>)[] }));

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn((callback: () => Promise<void>) => afterCallbacks.push(callback)),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/plaid/link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plaid/link")>()),
  createLinkToken: vi.fn(),
  exchangePublicToken: vi.fn(),
}));
vi.mock("@/lib/plaid/sync", () => ({ syncItem: vi.fn(), ITEM_STATUS: { active: "active" } }));
vi.mock("@/lib/plaid/webhook-verify", () => ({ verifyPlaidWebhook: vi.fn() }));
vi.mock("@/lib/plaid/webhooks", () => ({ planWebhook: vi.fn() }));

import { PlaidRequestError } from "@/lib/plaid/client";
import { ItemNotFoundError, createLinkToken, exchangePublicToken } from "@/lib/plaid/link";
import { syncItem } from "@/lib/plaid/sync";
import { verifyPlaidWebhook } from "@/lib/plaid/webhook-verify";
import { planWebhook } from "@/lib/plaid/webhooks";
import { getCurrentUser } from "@/lib/session";
import { POST as exchange } from "./exchange/route";
import { POST as linkToken } from "./link-token/route";
import { POST as webhook } from "./webhook/route";

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv("PLAID_CLIENT_ID", "client");
  vi.stubEnv("PLAID_SECRET", "secret");
  vi.mocked(getCurrentUser)
    .mockReset()
    .mockResolvedValue({ id: "user_1" } as never);
  vi.mocked(createLinkToken).mockReset().mockResolvedValue("link-sandbox-1");
  vi.mocked(exchangePublicToken).mockReset().mockResolvedValue("item_row_1");
  vi.mocked(syncItem).mockReset();
  vi.mocked(verifyPlaidWebhook).mockReset();
  vi.mocked(planWebhook).mockReset();
  afterCallbacks.length = 0;
});

describe("POST /api/plaid/link-token", () => {
  const post = (body: unknown = {}) =>
    linkToken(json("http://localhost/api/plaid/link-token", body));

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await post()).status).toBe(401);
  });

  it("answers 503 until Plaid keys are set", async () => {
    vi.stubEnv("PLAID_SECRET", "");
    expect((await post()).status).toBe(503);
  });

  it("returns only a link token, for a new item or update mode", async () => {
    const response = await post();
    expect(await response.json()).toEqual({ linkToken: "link-sandbox-1" });
    expect(createLinkToken).toHaveBeenCalledWith("user_1", null);

    await post({ itemId: "item1" });
    expect(createLinkToken).toHaveBeenLastCalledWith("user_1", "item1");
  });

  it("rejects a malformed item id and answers 404 for someone else's item", async () => {
    expect((await post({ itemId: "../x" })).status).toBe(400);

    vi.mocked(createLinkToken).mockRejectedValue(new ItemNotFoundError());
    expect((await post({ itemId: "item1" })).status).toBe(404);
  });

  it("hides Plaid's error behind a plain message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createLinkToken).mockRejectedValue(new PlaidRequestError("INVALID_FIELD", 400));

    const response = await post();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Couldn't start linking. Try again." });
  });
});

describe("POST /api/plaid/exchange", () => {
  const post = (body: unknown) => exchange(json("http://localhost/api/plaid/exchange", body));

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await post({ publicToken: "public-sandbox-1" })).status).toBe(401);
  });

  it("saves the item, returns only its id and syncs after responding", async () => {
    const response = await post({ publicToken: "public-sandbox-1", institutionName: "Platypus" });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ itemId: "item_row_1" });
    expect(JSON.stringify(body)).not.toMatch(/access/);
    expect(exchangePublicToken).toHaveBeenCalledWith("user_1", "public-sandbox-1", "Platypus");
    expect(syncItem).not.toHaveBeenCalled();
    for (const callback of afterCallbacks) await callback();
    expect(syncItem).toHaveBeenCalledWith("item_row_1");
  });

  it("rejects anything that isn't a public token", async () => {
    expect((await post({ publicToken: "access-sandbox-1" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(exchangePublicToken).not.toHaveBeenCalled();
  });

  it("answers 502 when Plaid refuses the token", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(exchangePublicToken).mockRejectedValue(
      new PlaidRequestError("INVALID_PUBLIC_TOKEN", 400),
    );

    expect((await post({ publicToken: "public-sandbox-1" })).status).toBe(502);
  });
});

describe("POST /api/plaid/webhook", () => {
  const BODY = JSON.stringify({
    webhook_type: "TRANSACTIONS",
    webhook_code: "SYNC_UPDATES_AVAILABLE",
    item_id: "p1",
  });
  const post = (body = BODY, signature = "jwt") =>
    webhook(json("http://localhost/api/plaid/webhook", body, { "plaid-verification": signature }));

  it("rejects a forged webhook before reading or changing anything", async () => {
    vi.mocked(verifyPlaidWebhook).mockResolvedValue(false);

    const response = await post();

    expect(response.status).toBe(401);
    expect(verifyPlaidWebhook).toHaveBeenCalledWith(BODY, "jwt");
    expect(planWebhook).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  it("syncs the item after acknowledging a verified webhook", async () => {
    vi.mocked(verifyPlaidWebhook).mockResolvedValue(true);
    vi.mocked(planWebhook).mockResolvedValue({ itemId: "item_row_1", sync: true });

    const response = await post();

    expect(response.status).toBe(200);
    expect(planWebhook).toHaveBeenCalledWith(JSON.parse(BODY));
    for (const callback of afterCallbacks) await callback();
    expect(syncItem).toHaveBeenCalledWith("item_row_1");
  });

  it("acknowledges events that need no sync", async () => {
    vi.mocked(verifyPlaidWebhook).mockResolvedValue(true);
    vi.mocked(planWebhook).mockResolvedValue(null);

    expect((await post()).status).toBe(200);
    expect(afterCallbacks).toHaveLength(0);
  });
});
