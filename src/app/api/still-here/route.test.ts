import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/system-db", () => ({
  systemDb: () => ({ $queryRaw: () => database.query() }),
}));

import { getCurrentUser } from "@/lib/session";
import { GET } from "./route";

describe("/api/still-here", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset();
    database.query.mockReset();
  });

  it("answers 401 with no session or a code still owed", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    database.query.mockResolvedValue([{ "?column?": 1 }]);
    expect((await GET()).status).toBe(401);
  });

  // Auth.js answers "no session" when the database failed, and a 401 empties every tab: a database
  // having a bad moment must not sign anyone out of what they're looking at.
  it("answers 503 when the database can't say", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    database.query.mockRejectedValue(new Error("connection refused"));
    expect((await GET()).status).toBe(503);
  });

  it("says whose session it is, and nothing else, uncached", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1", email: "a@x.test" } as never);
    const response = await GET();
    expect(await response.json()).toEqual({ id: "u1" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
