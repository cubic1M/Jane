import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/detection/engine", () => ({ isFirstDetectionComplete: vi.fn() }));
vi.mock("@/lib/scan", () => ({ scanReady: vi.fn() }));

import { isFirstDetectionComplete } from "@/detection/engine";
import { scanReady } from "@/lib/scan";
import { getCurrentUser } from "@/lib/session";
import { GET } from "./route";

const signedIn = { id: "user_1", email: "a@example.com", role: "user" as const };

describe("GET /api/detection/status", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(isFirstDetectionComplete).mockReset();
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(isFirstDetectionComplete).not.toHaveBeenCalled();
  });

  // Spec step 138: "ready" (accounts and transactions in) is what opens the chat.
  it.each([true, false])(
    "reports complete: %s and ready for the signed-in user",
    async (complete) => {
      vi.mocked(getCurrentUser).mockResolvedValue(signedIn as never);
      vi.mocked(isFirstDetectionComplete).mockResolvedValue(complete);
      vi.mocked(scanReady).mockResolvedValue(true);

      const response = await GET();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ complete, ready: true });
      expect(isFirstDetectionComplete).toHaveBeenCalledWith("user_1");
    },
  );
});
