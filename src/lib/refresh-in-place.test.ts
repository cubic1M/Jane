import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));

import { refresh } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { refreshInPlace } from "./refresh-in-place";

describe("refreshing the page on screen in place", () => {
  beforeEach(() => {
    vi.mocked(refresh).mockClear();
  });

  it("makes the page again for someone signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user_1" } as never);
    await refreshInPlace();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does nothing for nobody", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await refreshInPlace();
    expect(refresh).not.toHaveBeenCalled();
  });
});
