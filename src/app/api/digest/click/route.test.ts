import { describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/system-db", () => ({
  systemDb: () => ({ digest: { findUnique: database.findUnique } }),
}));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: () => ({ digests: { updateMany: database.updateMany } }),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(async () => {}) }));

import { track } from "@/lib/analytics";
import { GET } from "./route";

const click = () => GET(new Request("https://jane.test/api/digest/click?d=abc123&to=report"));

describe("GET /api/digest/click", () => {
  it.each([
    ["finding the digest", () => database.findUnique.mockRejectedValue(new Error("down"))],
    ["noting the open", () => database.updateMany.mockRejectedValue(new Error("down"))],
    ["counting the click", () => vi.mocked(track).mockRejectedValue(new Error("down"))],
  ])("still takes the reader to the page when %s fails", async (_, fail) => {
    database.findUnique.mockReset().mockResolvedValue({ id: "abc123", userId: "u1" });
    database.updateMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(track).mockReset();
    fail();
    const response = await click();
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).origin).toBe("https://jane.test");
  });
});
