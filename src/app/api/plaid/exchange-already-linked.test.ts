import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/ops-switches", () => ({ freshSwitches: vi.fn(async () => undefined) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/plaid/link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plaid/link")>()),
  exchangePublicToken: vi.fn(),
}));
vi.mock("@/lib/plaid/sync", () => ({ syncItem: vi.fn() }));
vi.mock("@/lib/plaid/webhooks", () => ({ syncFromWebhook: vi.fn() }));

import { after } from "next/server";
import { TERMS_VERSION } from "@/config/legal";
import { AlreadyLinkedError, exchangePublicToken } from "@/lib/plaid/link";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./exchange/route";

// The same bank linked again (debug 3, 11-16): Link's button shows the error the route answers,
// so it says the bank is linked already, and no first sync starts.
describe("POST /api/plaid/exchange for a bank that's already linked", () => {
  it("answers 409 with what to tell the person, and syncs nothing", async () => {
    vi.stubEnv("PLAID_CLIENT_ID", "client");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "user_1",
      termsVersion: TERMS_VERSION,
    } as never);
    vi.mocked(exchangePublicToken).mockRejectedValue(new AlreadyLinkedError("First Platypus Bank"));
    const response = await POST(
      new Request("http://localhost/api/plaid/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicToken: "public-sandbox-2",
          institutionName: "First Platypus Bank",
        }),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "You've already linked First Platypus Bank, so nothing new was added.",
    });
    expect(after).not.toHaveBeenCalled();
  });
});
