import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  whyCantConnect: vi.fn(),
  connectionView: vi.fn(),
}));
vi.mock("@/lib/robinhood/connection", () => mocks);

import { RobinhoodPanel } from "./robinhood-panel";

const CONNECTED = { status: "active", lastUpdated: null, failing: false, twins: [] };

const render = async (notice?: string) => {
  const element = await RobinhoodPanel({ userId: "person", notice });
  return element === null ? "" : renderToStaticMarkup(element);
};

describe("what the Robinhood box says", () => {
  beforeEach(() => {
    vi.stubEnv("ROBINHOOD_LINK", "1");
    mocks.whyCantConnect.mockResolvedValue(null);
    mocks.connectionView.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // Anyone can send a link with these in it.
  it("doesn't say it's gone while it's connected", async () => {
    mocks.connectionView.mockResolvedValue(CONNECTED);
    const html = await render("disconnected");
    expect(html).not.toContain('role="status"');
    expect(html).toContain("Connected.");
  });

  it("doesn't say it's connected when it isn't", async () => {
    expect(await render("connected")).not.toContain('role="status"');
  });

  it("says each when it's true", async () => {
    expect(await render("disconnected")).toContain("Disconnected.");
    mocks.connectionView.mockResolvedValue(CONNECTED);
    expect(await render("connected")).toContain("Robinhood is connected.");
  });

  it("still offers Disconnect to someone refused a new connection who has one", async () => {
    mocks.whyCantConnect.mockResolvedValue("demo");
    mocks.connectionView.mockResolvedValue(CONNECTED);
    expect(await render()).toContain("Yes, disconnect");
  });
});
