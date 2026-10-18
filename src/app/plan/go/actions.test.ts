import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: vi.fn(() => ({ actions: { findMany: vi.fn(async () => []) } })),
}));
vi.mock("@/lib/agent/run", () => ({ runQueuedFor: vi.fn() }));
vi.mock("@/lib/plan-links", () => {
  class LinkError extends Error {}
  return {
    LinkError,
    useLink: vi.fn(async () => ({ approved: 2, skipped: 1, userId: "u1" })),
    takeBackLink: vi.fn(async () => 2),
  };
});

import { LinkError, takeBackLink, useLink } from "@/lib/plan-links";
import { goAhead, takeBack } from "./actions";

const form = (token: string) => {
  const data = new FormData();
  data.set("token", token);
  return data;
};

describe("one-tap link page", () => {
  it("goes ahead with the link's items, with no session needed", async () => {
    expect(await goAhead(null, form("tok"))).toMatchObject({
      ok: true,
      message: expect.stringContaining("Jane is on 2 things. 1 had changed"),
    });
    expect(useLink).toHaveBeenCalledWith("tok");
  });

  it("explains a used or expired link, and takes back on request", async () => {
    vi.mocked(useLink).mockRejectedValueOnce(new LinkError("This link was already used."));
    expect(await goAhead(null, form("tok"))).toEqual({
      ok: false,
      message: "This link was already used.",
    });
    expect(await takeBack(null, form("tok"))).toMatchObject({ ok: true });
    expect(takeBackLink).toHaveBeenCalledWith("tok");
  });
});
