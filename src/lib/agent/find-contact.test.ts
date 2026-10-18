import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { acceptable, companyDomain, findSupportContact } from "./find-contact";

describe("finding support contacts", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("takes the company's domain from its own links", () => {
    expect(companyDomain([null, "https://secure.hulu.com/account"])).toBe("hulu.com");
    expect(companyDomain(["not a url", "https://www.netflix.com/cancelplan"])).toBe("netflix.com");
    expect(companyDomain([null, null])).toBeNull();
  });

  it("keeps only addresses and pages on the company's own domain", () => {
    const ok = { email: "help@netflix.com", sourceUrl: "https://help.netflix.com/contact" };
    expect(acceptable(ok, "netflix.com")).toBe(true);
    expect(acceptable({ ...ok, email: "help@mail.netflix.com" }, "netflix.com")).toBe(true);
    for (const bad of [
      { ...ok, email: "help@gmail.com" },
      { ...ok, email: "support@netflix.com.evil.example" },
      { ...ok, email: "help@notnetflix.com" },
      { ...ok, sourceUrl: "https://evil.example/netflix" },
      { ...ok, sourceUrl: "http://help.netflix.com/contact" },
      { ...ok, email: "not an email" },
    ]) {
      expect(acceptable(bad, "netflix.com"), JSON.stringify(bad)).toBe(false);
    }
  });

  it("does nothing without Claude", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await findSupportContact("m1")).toBeNull();
  });

  it("stores what Claude found on the company's site, resuming a paused search", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const update = vi.fn();
    const client = {
      merchant: {
        findUnique: vi.fn(async () => ({
          id: "m1",
          name: "Netflix",
          supportEmail: null,
          suggestedSupportEmail: null,
          supportUrl: null,
          cancelUrl: "https://www.netflix.com/cancelplan",
        })),
        update,
      },
    };
    const create = vi
      .fn()
      .mockResolvedValueOnce({ stop_reason: "pause_turn", content: [] })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              email: "Help@Netflix.com",
              sourceUrl: "https://help.netflix.com/contact",
            }),
          },
        ],
      });
    const found = await findSupportContact("m1", {
      client: client as never,
      claude: (() => ({ messages: { create } })) as never,
    });
    expect(found).toBe("help@netflix.com");
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].tools[0]).toMatchObject({
      type: "web_search_20260209",
      allowed_domains: ["netflix.com"],
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ suggestedSupportEmail: "help@netflix.com" }),
      }),
    );
  });

  it("keeps nothing found off the company's domain", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const update = vi.fn();
    const client = {
      merchant: {
        findUnique: vi.fn(async () => ({
          id: "m1",
          name: "Netflix",
          supportEmail: null,
          suggestedSupportEmail: null,
          supportUrl: null,
          cancelUrl: "https://www.netflix.com/cancelplan",
        })),
        update,
      },
    };
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: JSON.stringify({ email: "scam@evil.example", sourceUrl: "https://evil.example" }),
        },
      ],
    }));
    expect(
      await findSupportContact("m1", {
        client: client as never,
        claude: (() => ({ messages: { create } })) as never,
      }),
    ).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
