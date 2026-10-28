import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/import/background", () => ({ currentImportRun: vi.fn() }));

import { currentImportRun } from "@/lib/import/background";
import { getCurrentUser } from "@/lib/session";
import { GET } from "./route";

describe("GET /api/import/status", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "u1" } as never);
    vi.mocked(currentImportRun).mockReset();
  });

  it("says how the person's own latest upload is getting on, never cached", async () => {
    const run = {
      id: "r1",
      kind: "upload",
      rows: 172,
      stage: "looking",
      percent: 40,
      foundCents: null,
    } as const;
    vi.mocked(currentImportRun).mockResolvedValue(run);
    const response = await GET();
    expect(await response.json()).toEqual({ run });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(currentImportRun).toHaveBeenCalledWith("u1");
  });

  it("is null when there's nothing to show", async () => {
    vi.mocked(currentImportRun).mockResolvedValue(null);
    expect(await (await GET()).json()).toEqual({ run: null });
  });

  // The chip asks on signed-out pages too (/, /login, /goodbye): no error, nothing looked up.
  it("is null, not a 401, for someone who isn't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ run: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(currentImportRun).not.toHaveBeenCalled();
  });
});
