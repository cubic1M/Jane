import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  whyCantConnect: vi.fn(),
  connectionView: vi.fn(),
}));
vi.mock("@/lib/robinhood/connection", () => mocks);
vi.mock("@/lib/today", () => ({ timezoneOf: async () => "America/Los_Angeles" }));

import { RobinhoodPanel } from "./robinhood-panel";

const render = async (notice?: string) => {
  const element = await RobinhoodPanel({ userId: "person", notice });
  return element === null ? null : renderToStaticMarkup(element);
};
const stored = {
  status: "active",
  lastUpdated: new Date("2026-11-05T10:00:00Z"),
  failing: false,
  twins: [],
};

describe("the Robinhood box with the switch off", () => {
  beforeEach(() => {
    vi.stubEnv("ROBINHOOD_LINK", "");
    mocks.connectionView.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it.each(["active", "reconnect"])(
    "offers Disconnect, and nothing else, for a stored %s connection",
    async (status) => {
      mocks.connectionView.mockResolvedValue({ ...stored, status });
      const html = (await render()) ?? "";
      expect(html).toContain('action="/api/robinhood/disconnect"');
      expect(html).toContain("isn&#x27;t reading Robinhood");
      expect(html).toContain("Nov 5, 2:00 AM");
      expect(html).not.toContain("/api/robinhood/connect");
    },
  );

  it("says it's disconnected once it is", async () => {
    expect(await render("disconnected")).toContain("Jane deleted its access");
  });

  it("is nothing for someone with nothing stored, whatever the address says", async () => {
    expect(await render()).toBeNull();
    expect(await render("connected")).toBeNull();
    expect(mocks.whyCantConnect).not.toHaveBeenCalled();
  });
});
