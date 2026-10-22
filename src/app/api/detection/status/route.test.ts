import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/scan", () => ({ scanProgress: vi.fn() }));

import { scanProgress, type ScanProgress } from "@/lib/scan";
import { getCurrentUser } from "@/lib/session";
import { GET } from "./route";

const signedIn = { id: "user_1", email: "a@example.com", role: "user" as const };
const progress = (over: Partial<ScanProgress> = {}): ScanProgress => ({
  accounts: true,
  months: 12,
  transactions: true,
  detection: false,
  suggestions: false,
  done: false,
  ...over,
});

describe("GET /api/detection/status", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(scanProgress).mockReset();
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(scanProgress).not.toHaveBeenCalled();
  });

  // Spec step 138: "ready" (accounts and transactions in) is what opens the chat.
  it.each([true, false])(
    "reports complete: %s and ready, with the stages, for the signed-in user",
    async (complete) => {
      vi.mocked(getCurrentUser).mockResolvedValue(signedIn as never);
      vi.mocked(scanProgress).mockResolvedValue(progress({ detection: complete }));

      const response = await GET();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        complete,
        ready: true,
        progress: progress({ detection: complete }),
      });
      expect(scanProgress).toHaveBeenCalledWith("user_1");
    },
  );
});
