import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { anthropic, resetAnthropicForTests } from "@/lib/anthropic";
import { sendEmail } from "@/lib/email";
import { feedEvents } from "@/lib/events/feeds";
import { fetchIntraday } from "@/lib/market/alpaca-intraday";
import { AlpacaMarketData } from "@/lib/market/alpaca";
import { EdgarMarketData } from "@/lib/market/edgar";
import { fetchYahooDaily } from "@/lib/market/yahoo";
import { createCheckoutSession } from "@/lib/membership/stripe";

// An independent read of what Jane calls: none of these had a limit, so one vendor hanging could
// hold a person's page or use up a nightly job's 300 seconds, and the people after it got nothing.
// The ones carrying a secret don't follow a redirect, which could carry it to another host.
type Init = { signal?: AbortSignal; redirect?: string };

function asked(answer: unknown = {}) {
  const inits: Init[] = [];
  const fetcher = vi.fn(async (_url: string, init: Init) => {
    inits.push(init);
    return { ok: true, status: 200, json: async () => answer, text: async () => "" };
  });
  return { fetcher, inits };
}

describe("a call to a vendor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("to Alpaca has a limit and follows no redirect", async () => {
    const { fetcher, inits } = asked({ bars: {}, news: [], next_page_token: null });
    const market = new AlpacaMarketData({ id: "k", secret: "s" }, fetcher as never);
    await market.prices("AAPL", "2026-01-01", "2026-01-02");
    await market.news(["AAPL"], "2026-01-01", "2026-01-02");
    await fetchIntraday({ id: "k", secret: "s" }, "AAPL", "2026-01-01", "2026-01-02", {
      fetcher: fetcher as never,
    });
    expect(inits).toHaveLength(3);
    for (const init of inits) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.redirect).toBe("error");
    }
  });

  it("to EDGAR and Yahoo has a limit", async () => {
    const { fetcher, inits } = asked({ filings: { recent: {} } });
    const edgar = new EdgarMarketData("test agent", { AAPL: "1" }, fetcher as never);
    await edgar.filings("AAPL", "2026-01-01", "2026-01-02").catch(() => []);
    await fetchYahooDaily("AAPL", "2026-01-01", "2026-01-02", fetcher as never).catch(() => []);
    expect(inits).toHaveLength(2);
    for (const init of inits) expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("to Resend and Stripe has a limit and follows no redirect", async () => {
    const { fetcher, inits } = asked({ id: "x", url: "https://stripe.example/x" });
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("RESEND_API_KEY", "fake-not-a-key");
    vi.stubEnv("EMAIL_FROM", "jane@example.test");
    vi.stubEnv("STRIPE_SECRET_KEY", "fake-not-a-key");
    await sendEmail({ to: "a@example.test", subject: "s", html: "h", text: "t" }).catch(() => {});
    await createCheckoutSession({ userId: "u", baseUrl: "https://x.test" } as never).catch(
      () => {},
    );
    expect(inits).toHaveLength(2);
    for (const init of inits) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.redirect).toBe("error");
    }
  });

  it("to Claude has a limit shorter than a function's, retries included", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "fake-not-a-key");
    resetAnthropicForTests();
    const client = anthropic();
    expect(client.timeout * (client.maxRetries + 1)).toBeLessThan(300_000);
    resetAnthropicForTests();
  });

  it("doesn't follow a feed's link off that feed's site", async () => {
    const xml = `<rss><channel><item><title>FOMC statement</title><link>http://169.254.169.254/x</link><pubDate>Wed, 04 Nov 2026 19:00:00 GMT</pubDate></item></channel></rss>`;
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, text: async () => xml };
    });
    await feedEvents({ fetcher: fetcher as never });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((u) => u.includes("169.254"))).toEqual([]);
  });
});
