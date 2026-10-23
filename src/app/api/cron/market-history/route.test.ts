import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/market/history", async (original) => {
  const actual = await original<typeof import("@/lib/market/history")>();
  return { ...actual, loadHistory: vi.fn(async () => []) };
});

import { loadHistory } from "@/lib/market/history";
import { GET } from "./route";

// The daily history load: only Vercel Cron (with the secret) runs it, and it reads Alpaca's SIP
// feed (back to 2016) unless ALPACA_HISTORY_FEED says otherwise. No call out here.

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/market-history", {
      headers: authorization ? { authorization } : {},
    }),
  );
const feedOf = () => {
  const feed = vi.mocked(loadHistory).mock.calls.at(-1)![0] as unknown as { feed: string };
  return feed.feed;
};

describe("GET /api/cron/market-history", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("ALPACA_API_KEY_ID", "key-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "key-secret");
    vi.stubEnv("ALPACA_DATA_FEED", "iex");
    vi.mocked(loadHistory).mockClear();
  });

  it("refuses without the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect(loadHistory).not.toHaveBeenCalled();
  });

  it("loads from the SIP feed by default, and from ALPACA_HISTORY_FEED when set", async () => {
    expect((await call("Bearer cron-secret")).status).toBe(200);
    expect(feedOf()).toBe("sip");
    vi.stubEnv("ALPACA_HISTORY_FEED", "iex");
    await call("Bearer cron-secret");
    expect(feedOf()).toBe("iex");
  });
});
