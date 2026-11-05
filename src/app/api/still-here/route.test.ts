import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));

import { getCurrentUser } from "@/lib/session";
import { GET } from "./route";

describe("/api/still-here", () => {
  beforeEach(() => vi.mocked(getCurrentUser).mockReset());

  it("answers 401 with no session or a code still owed", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("says whose session it is, and nothing else, uncached", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1", email: "a@x.test" } as never);
    const response = await GET();
    expect(await response.json()).toEqual({ id: "u1" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
