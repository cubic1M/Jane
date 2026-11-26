import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No DOM here: React's state hook is replaced by a recorder, and the component function is called
// directly, so the Plaid callbacks it hands to Link can be driven by hand.
const { states } = vi.hoisted(() => ({ states: [] as unknown[] }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = states.length;
      states.push(initial);
      return [initial, (value: unknown) => void (states[index] = value)];
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/lib/analytics-client", () => ({ sendEvent: vi.fn() }));

import { LinkButton } from "./link-button";

type Created = { onSuccess: (token: string, meta: object) => Promise<void> };

describe("the Link button when a request after Link fails", () => {
  let created: Created;
  beforeEach(() => {
    states.length = 0;
    vi.stubGlobal("window", {
      Plaid: {
        create: (config: Created) => {
          created = config;
          return { open: () => undefined };
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function press(itemId?: string) {
    // The button is the first element of the returned tree.
    const tree = LinkButton({ itemId, label: "Link", className: "x" }) as {
      props: { children: [{ props: { onClick: () => Promise<void> } }] };
    };
    await tree.props.children[0].props.onClick();
  }

  it("shows a message and frees the button when the exchange can't be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ linkToken: "link-1" }) })
        .mockRejectedValueOnce(new Error("offline")),
    );
    await press();
    await created.onSuccess("public-1", {});
    // states: busy, error, full
    expect(states[0]).toBe(false);
    expect(String(states[1])).toMatch(/try again/i);
  });

  it("shows a message when the repair answer is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ linkToken: "link-1" }) })
        .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Not yet." }) }),
    );
    await press("item_1");
    await created.onSuccess("public-1", {});
    expect(states[0]).toBe(false);
    expect(states[1]).toBe("Not yet.");
  });
});
