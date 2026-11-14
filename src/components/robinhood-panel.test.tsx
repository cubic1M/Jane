import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  whyCantConnect: vi.fn(),
  connectionView: vi.fn(),
}));
vi.mock("@/lib/robinhood/connection", () => mocks);
// The person is in Los Angeles: times are said in their own zone.
vi.mock("@/lib/today", () => ({ timezoneOf: async () => "America/Los_Angeles" }));

import { RobinhoodPanel } from "./robinhood-panel";

const render = async (notice?: string) => {
  const element = await RobinhoodPanel({ userId: "person", notice });
  return element === null ? null : renderToStaticMarkup(element);
};
const text = (html: string | null) =>
  (html ?? "").replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'");

describe("the Robinhood box on the Investing page", () => {
  beforeEach(() => {
    vi.stubEnv("ROBINHOOD_LINK", "1");
    mocks.whyCantConnect.mockResolvedValue(null);
    mocks.connectionView.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("is nothing at all with the switch off, without even reading", async () => {
    vi.stubEnv("ROBINHOOD_LINK", "");
    expect(await render()).toBeNull();
    expect(mocks.whyCantConnect).not.toHaveBeenCalled();
    expect(mocks.connectionView).not.toHaveBeenCalled();
  });

  it.each(["trial", "demo"])("is nothing for a %s person", async (why) => {
    mocks.whyCantConnect.mockResolvedValue(why);
    expect(await render()).toBeNull();
  });

  it("says what connecting does before they connect", async () => {
    const html = await render();
    const said = text(html);
    expect(said).toContain("Connect Robinhood");
    expect(html).toContain('href="/api/robinhood/connect"');
    expect(said).toMatch(/sign in on Robinhood's own page/);
    expect(said).toMatch(/Jane only reads/);
    expect(said).toMatch(/can trade if you open its agent account/);
    expect(said).toMatch(/don't open it for Jane/);
  });

  it("shows connected, last updated and Disconnect", async () => {
    mocks.connectionView.mockResolvedValue({
      status: "active",
      lastUpdated: new Date("2026-11-05T10:00:00Z"),
      failing: false,
      twins: [],
    });
    const html = await render();
    const said = text(html);
    expect(html).toContain('action="/api/robinhood/disconnect"');
    expect(said).toContain("Connected.");
    expect(said).toContain("Last updated Nov 5, 2:00 AM.");
    expect(said).toContain("Disconnect");
    expect(said).not.toContain("Connect Robinhood");
  });

  it("asks them to reconnect when Robinhood stopped accepting it", async () => {
    mocks.connectionView.mockResolvedValue({
      status: "reconnect",
      lastUpdated: new Date("2026-11-05T10:00:00Z"),
      failing: true,
      twins: [],
    });
    const said = text(await render());
    expect(said).toContain("Reconnect Robinhood");
    expect(said).toContain("Disconnect");
  });

  it("says when a read failed, and when Robinhood may be counted twice", async () => {
    mocks.connectionView.mockResolvedValue({
      status: "active",
      lastUpdated: null,
      failing: true,
      twins: ["Robinhood upload"],
    });
    const said = text(await render());
    expect(said).toContain("didn't work");
    expect(said).toContain("Robinhood upload also counts");
  });

  it("shows only its own fixed words from the address bar", async () => {
    mocks.connectionView.mockResolvedValueOnce({
      status: "active",
      lastUpdated: null,
      failing: false,
      twins: [],
    });
    expect(text(await render("connected"))).toContain("Robinhood is connected.");
    const forged = await render("<script>alert(1)</script>");
    expect(forged).not.toContain("alert(1)");
    expect(await render("constructor")).not.toContain("function ");
  });

  it("is honest about what disconnecting can't do at Robinhood", async () => {
    expect(text(await render("disconnected"))).toMatch(/no way to end the connection on its side/);
  });

  it("never tells them what to buy, sell or do with their money", async () => {
    for (const status of ["active", "reconnect"]) {
      mocks.connectionView.mockResolvedValue({
        status,
        lastUpdated: new Date(),
        failing: true,
        twins: [],
      });
      expect(text(await render())).not.toMatch(/\b(buy|sell|should)\b/i);
    }
    mocks.connectionView.mockResolvedValue(null);
    expect(text(await render())).not.toMatch(/\b(buy|sell|should)\b/i);
  });
});
