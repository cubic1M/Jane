import { beforeEach, describe, expect, it, vi } from "vitest";

const { count } = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn(() => ({ janeMessages: { count } })) }));

import { scopedFor } from "@/lib/db-scoped";
import { getCurrentUser } from "@/lib/session";
import { GET } from "./route";

describe("GET /api/chat/pulse", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset();
    count.mockReset();
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(count).not.toHaveBeenCalled();
  });

  it("counts the signed-in person's visible messages, and nobody else's", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user_1" } as never);
    count.mockResolvedValue(4);
    const response = await GET();
    expect(await response.json()).toEqual({ count: 4 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(scopedFor).toHaveBeenCalledWith("user_1");
  });
});
