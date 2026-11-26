import { beforeEach, describe, expect, it, vi } from "vitest";
import { TERMS_VERSION } from "@/config/legal";

// A direct call isn't past the Terms just because the page would have been: the routes that act for
// a person refuse until the current ones are accepted, as the chat and bank linking do.

const done = vi.hoisted(() => ({
  chat: vi.fn(),
  decision: vi.fn(),
  diy: vi.fn(),
  suggestion: vi.fn(),
  repaired: vi.fn(),
  checkout: vi.fn(),
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "u1", termsVersion: null })),
}));
vi.mock("@/lib/jane-agent/actions", async (original) => ({
  ...(await original<typeof import("@/lib/jane-agent/actions")>()),
  takeChatAction: done.chat,
}));
vi.mock("@/lib/decisions", async (original) => ({
  ...(await original<typeof import("@/lib/decisions")>()),
  recordDecision: done.decision,
  markDiyDone: done.diy,
}));
vi.mock("@/lib/outcomes", async (original) => ({
  ...(await original<typeof import("@/lib/outcomes")>()),
  markSuggestionDone: done.suggestion,
}));
vi.mock("@/lib/plaid/link", async (original) => ({
  ...(await original<typeof import("@/lib/plaid/link")>()),
  markItemRepaired: done.repaired,
}));
vi.mock("@/lib/membership/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/membership/stripe")>()),
  createCheckoutSession: done.checkout,
}));

import { getCurrentUser } from "@/lib/session";
import { POST as chatAct } from "./chat/act/route";
import { POST as diyDone } from "./decisions/[decisionId]/diy-done/route";
import { POST as decisions } from "./decisions/route";
import { POST as checkout } from "./membership/checkout/route";
import { POST as repaired } from "./plaid/repaired/route";
import { POST as suggestionDone } from "./suggestions/[key]/done/route";

const json = (body: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const routes: [string, () => Promise<Response>][] = [
  ["a notification's button", () => chatAct(json({ messageId: "m1", actionId: "yes" }))],
  [
    "a decision",
    () => decisions(json({ findingId: "f1", choice: "yes", cardHash: "a".repeat(64) })),
  ],
  ["I did it", () => diyDone(json({}), { params: Promise.resolve({ decisionId: "d1" }) })],
  ["Mark done", () => suggestionDone(json({}), { params: Promise.resolve({ key: "k" }) })],
  ["a repaired bank's sync", () => repaired(json({ itemId: "item1" }))],
  ["a membership payment", () => checkout()],
];

describe("acting before the current Terms are accepted", () => {
  beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1"));

  it.each(routes)("%s is refused, and nothing happens", async (_, call) => {
    const response = await call();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Accept the Terms first." });
    for (const act of Object.values(done)) expect(act).not.toHaveBeenCalled();
  });

  it("older Terms count as not accepted", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({
      id: "u1",
      termsVersion: `old-${TERMS_VERSION}`,
    } as never);
    expect((await routes[1][1]()).status).toBe(403);
  });
});
