import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));
vi.mock("@/lib/practice/preferences", () => ({
  practiceProfileOf: vi.fn(async () => ({
    level: 3,
    strategyChoice: "level",
    catalog: null,
    crypto: null,
    dayTrade: null,
  })),
}));

import { adviceMode } from "@/lib/advice-mode";
import { getCurrentUser } from "@/lib/session";
import type { Board } from "@/lib/investments/strategy-board";
import { GET } from "./route";

const get = (query: string) =>
  GET(new Request(`http://localhost/api/investments/strategies${query}`));

describe("GET /api/investments/strategies", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(adviceMode).mockResolvedValue(true);
  });

  it("refuses visitors who aren't signed in, and real accounts", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await get("?level=4")).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(adviceMode).mockResolvedValue(false);
    expect((await get("?level=4")).status).toBe(403);
  });

  it("needs a level from 1 to 5", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user_1" } as never);
    expect((await get("")).status).toBe(400);
    expect((await get("?level=6")).status).toBe(400);
  });

  it("sends that level's strategies, read against the person's own level, never cached", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user_1" } as never);
    const res = await get("?level=5");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const board = (await res.json()) as Board;
    expect(board.level).toBe(5);
    expect(board.yours).toBe(false);
    expect(board.rows.some((r) => r.key.startsWith("intraday:"))).toBe(true);
  });
});
