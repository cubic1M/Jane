import { beforeEach, describe, expect, it, vi } from "vitest";
import { TERMS_VERSION } from "@/config/legal";

vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/ops-switches", () => ({ freshSwitches: vi.fn(async () => {}) }));
vi.mock("@/lib/plaid/client", async (original) => ({
  ...(await original<typeof import("@/lib/plaid/client")>()),
  plaidEnabled: () => true,
}));
vi.mock("@/lib/plaid/link", async (original) => ({
  ...(await original<typeof import("@/lib/plaid/link")>()),
  createLinkToken: vi.fn(async () => "link-token"),
}));

import { createLinkToken } from "@/lib/plaid/link";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./route";

const post = (body?: string) =>
  POST(new Request("https://jane.test/api/plaid/link-token", { method: "POST", body }));

describe("POST /api/plaid/link-token and its body", () => {
  beforeEach(() => {
    vi.mocked(createLinkToken).mockClear();
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "u1",
      termsVersion: TERMS_VERSION,
    } as never);
  });

  it("starts a new link with no body at all", async () => {
    for (const body of [undefined, "", "  "]) expect((await post(body)).status).toBe(200);
    expect(createLinkToken).toHaveBeenLastCalledWith("u1", null);
  });

  // A reconnect cut off on the way mustn't become a second link of the same bank.
  it.each(['{"itemId":', "null", "[]"])("answers 400 to %s and starts nothing", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(createLinkToken).not.toHaveBeenCalled();
  });
});
