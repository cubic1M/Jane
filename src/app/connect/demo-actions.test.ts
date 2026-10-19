import { beforeEach, describe, expect, it, vi } from "vitest";

// "Link a demo bank" (spec step 75) ends in Jane's chat after the scan (spec step 82).

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/rate-limit", () => ({ hit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/plaid/sync", () => ({ syncItem: vi.fn() }));
vi.mock("@/lib/plaid/demo", () => {
  class DemoBankError extends Error {}
  return { DemoBankError, linkDemoBank: vi.fn() };
});

import { after } from "next/server";
import { DemoBankError, linkDemoBank } from "@/lib/plaid/demo";
import { linkDemo } from "./demo-actions";

describe("linkDemo", () => {
  beforeEach(() => vi.mocked(after).mockClear());

  it("links, syncs after the response, and scans on the way to the chat", async () => {
    vi.mocked(linkDemoBank).mockResolvedValue({ itemId: "demo-1", created: true });
    await expect(linkDemo()).rejects.toThrow("redirect:/scanning?then=chat");
    expect(linkDemoBank).toHaveBeenCalledWith("u1");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("goes back to Connect when the demo bank isn't offered", async () => {
    vi.mocked(linkDemoBank).mockRejectedValue(new DemoBankError("off"));
    await expect(linkDemo()).rejects.toThrow("redirect:/connect");
  });
});
