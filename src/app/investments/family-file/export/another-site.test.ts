import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportFamilyFile } from "@/lib/investments/family-file";
import { getCurrentUser } from "@/lib/session";
import { GET } from "./route";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/investments/family-file", () => ({ exportFamilyFile: vi.fn() }));

const ask = (site?: string) =>
  GET(
    new Request("https://jane.test/investments/family-file/export", {
      headers: site ? { "sec-fetch-site": site } : {},
    }),
  );

// Another site's link carries the session cookie, and would drop the person's family file into the
// downloads of whatever computer they're at, as /api/export already refuses.
describe("the family file download", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(exportFamilyFile).mockReset().mockResolvedValue("What my family would need");
  });

  it.each(["cross-site", "same-site"])(
    "sends a %s link to its page, with no file",
    async (site) => {
      const response = await ask(site);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("https://jane.test/investments/family-file");
      expect(exportFamilyFile).not.toHaveBeenCalled();
    },
  );

  it.each(["same-origin", "none", undefined])(
    "gives the file from Jane itself (%s)",
    async (site) => {
      const response = await ask(site);
      expect(await response.text()).toBe("What my family would need");
      expect(response.headers.get("content-disposition")).toContain("attachment");
    },
  );
});
