import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/jane-agent/popup-stack", () => ({ loadPopupStack: vi.fn() }));

import { loadPopupStack } from "@/lib/jane-agent/popup-stack";
import { getCurrentUser } from "@/lib/session";
import { GET } from "./route";

describe("GET /api/chat/cards", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(loadPopupStack).mockReset();
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(loadPopupStack).not.toHaveBeenCalled();
  });

  it("returns the signed-in person's cards, and nobody else's, never cached", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(loadPopupStack).mockResolvedValue([{ id: "m1" }] as never);
    const response = await GET();
    expect(await response.json()).toEqual({ cards: [{ id: "m1" }] });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(loadPopupStack).toHaveBeenCalledWith("user_1");
  });
});
