import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/ops-switches", () => ({ freshSwitches: vi.fn(async () => undefined) }));
vi.mock("@/lib/plaid/client", async (actual) => ({
  ...(await actual<typeof import("@/lib/plaid/client")>()),
  plaidEnabled: () => false,
}));
vi.mock("@/lib/plaid/link", () => ({ createLinkToken: vi.fn(), exchangePublicToken: vi.fn() }));
vi.mock("@/lib/plaid/sync", () => ({ syncItem: vi.fn() }));
vi.mock("@/lib/plaid/item-slots", () => ({
  LinkingClosedError: class extends Error {},
  linkClosedAnswer: vi.fn(),
}));

import { getCurrentUser } from "@/lib/session";
import { POST as exchange } from "./exchange/route";
import { POST as linkToken } from "./link-token/route";

// A read of the promises against the code: every page sends someone to the Terms first, but these
// two routes read the session without asking, so a direct call could link a bank before agreeing.
const post = (path: string) =>
  new Request(`https://x.test/api/plaid/${path}`, { method: "POST", body: "{}" });

describe("linking a bank", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1", termsVersion: null } as never);
  });

  it("asks for the Terms first, on both routes", async () => {
    expect((await linkToken(post("link-token"))).status).toBe(403);
    expect((await exchange(post("exchange"))).status).toBe(403);
  });
});
