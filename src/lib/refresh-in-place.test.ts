import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { refresh } from "next/cache";
import { requireUser } from "@/lib/session";
import { refreshInPlace } from "./refresh-in-place";

describe("refreshing the page on screen in place", () => {
  beforeEach(() => {
    vi.mocked(refresh).mockClear();
  });

  it("makes the page again for someone signed in", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user_1" } as never);
    await refreshInPlace();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("sends nobody to sign in, and makes nothing", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT /login"));
    await expect(refreshInPlace()).rejects.toThrow("NEXT_REDIRECT");
    expect(refresh).not.toHaveBeenCalled();
  });
});
