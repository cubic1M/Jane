import { beforeEach, describe, expect, it, vi } from "vitest";

const { afterCallbacks } = vi.hoisted(() => ({ afterCallbacks: [] as (() => Promise<void>)[] }));

vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn((callback: () => Promise<void>) => afterCallbacks.push(callback)),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/ops-switches", () => ({ freshSwitches: vi.fn(async () => undefined) }));
vi.mock("@/lib/plaid/replace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plaid/replace")>()),
  replaceWithFullHistory: vi.fn(),
}));
vi.mock("@/lib/plaid/webhooks", () => ({ syncFromWebhook: vi.fn() }));
vi.mock("@/categorize/categorize", () => ({ categorizeLeftovers: vi.fn(async () => 0) }));
vi.mock("@/lib/suggestions", () => ({ scanSuggestions: vi.fn(async () => undefined) }));
vi.mock("@/lib/jane-agent/messages", () => ({ closeSettled: vi.fn(async () => 0) }));

import { TERMS_VERSION } from "@/config/legal";
import { PlaidRequestError } from "@/lib/plaid/client";
import { LinkingClosedError } from "@/lib/plaid/item-slots";
import { ReplaceRefused, replaceWithFullHistory } from "@/lib/plaid/replace";
import { syncFromWebhook } from "@/lib/plaid/webhooks";
import { getCurrentUser } from "@/lib/session";
import { categorizeLeftovers } from "@/categorize/categorize";
import { closeSettled } from "@/lib/jane-agent/messages";
import { scanSuggestions } from "@/lib/suggestions";
import { POST } from "./route";

const call = (body: unknown) =>
  POST(
    new Request("http://localhost/api/plaid/full-history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const good = { publicToken: "public-sandbox-1", itemId: "item1", institutionName: "Bank" };

beforeEach(() => {
  vi.stubEnv("PLAID_CLIENT_ID", "client");
  vi.stubEnv("PLAID_SECRET", "secret");
  afterCallbacks.length = 0;
  vi.mocked(getCurrentUser)
    .mockReset()
    .mockResolvedValue({ id: "user_1", termsVersion: TERMS_VERSION } as never);
  vi.mocked(replaceWithFullHistory).mockReset();
  vi.mocked(syncFromWebhook).mockReset();
});

describe("POST /api/plaid/full-history", () => {
  it("needs a signed-in person who accepted the Terms", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await call(good)).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u", termsVersion: "old" } as never);
    expect((await call(good)).status).toBe(403);
    expect(replaceWithFullHistory).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a public token and a link id", async () => {
    expect((await call({ ...good, publicToken: "access-sandbox-x" })).status).toBe(400);
    expect((await call({ ...good, itemId: "../x" })).status).toBe(400);
    expect(replaceWithFullHistory).not.toHaveBeenCalled();
  });

  it("moves the history, then syncs the new link after the answer", async () => {
    vi.mocked(replaceWithFullHistory).mockResolvedValue({
      itemId: "new1",
      accounts: 1,
      twins: 3,
      dropped: 0,
      added: 4,
      kept: 0,
      oldRemoved: true,
    });
    const res = await call(good);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, transactions: 7 });
    expect(vi.mocked(replaceWithFullHistory).mock.calls[0].slice(0, 4)).toEqual([
      "user_1",
      "item1",
      "public-sandbox-1",
      "Bank",
    ]);
    await afterCallbacks[0]();
    expect(syncFromWebhook).toHaveBeenCalledWith("new1");
    // The cards are worked out again from the imported history, whatever that sync found.
    expect(scanSuggestions).toHaveBeenCalledWith("user_1");
    expect(closeSettled).toHaveBeenCalledWith("user_1");
    // Rows saved without a category (the move gave up waiting for Claude) are sorted after the answer.
    expect(categorizeLeftovers).toHaveBeenCalled();
  });

  it("still works out the cards when the follow-up sync fails", async () => {
    vi.mocked(replaceWithFullHistory).mockResolvedValue({
      itemId: "new1",
      accounts: 1,
      twins: 1,
      dropped: 0,
      added: 0,
      kept: 0,
      oldRemoved: true,
    });
    vi.mocked(syncFromWebhook).mockRejectedValueOnce(new Error("Plaid is down"));
    vi.mocked(scanSuggestions).mockClear();
    afterCallbacks.length = 0;
    await call(good);
    await afterCallbacks[0]();
    expect(scanSuggestions).toHaveBeenCalledWith("user_1");
  });

  it("says in plain words that nothing changed when it refuses, and never leaks Plaid's error", async () => {
    vi.mocked(replaceWithFullHistory).mockRejectedValue(new ReplaceRefused("accounts_differ"));
    const refused = await call(good);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain("nothing was changed");

    vi.mocked(replaceWithFullHistory).mockRejectedValue(
      new PlaidRequestError("INSTITUTION_DOWN", 500),
    );
    const broken = await call(good);
    expect(broken.status).toBe(502);
    expect(JSON.stringify(await broken.json())).not.toContain("INSTITUTION_DOWN");

    vi.mocked(replaceWithFullHistory).mockRejectedValue(new LinkingClosedError("full"));
    expect((await call(good)).status).toBe(409);
  });
});
