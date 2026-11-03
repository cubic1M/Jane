import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordRun } from "@/lib/health";
import { heartbeat, heartbeatUrl } from "@/lib/heartbeat";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const KEY = { HEALTHCHECKS_PING_KEY: "pingkey123" };
const ok = (_url: RequestInfo | URL) => Promise.resolve(new Response("OK"));

describe("heartbeatUrl", () => {
  it("is off without a key, whatever else is set", () => {
    expect(heartbeatUrl("digest", "start", {})).toBeNull();
    expect(heartbeatUrl("digest", "start", { HEALTHCHECKS_PING_KEY: "  " })).toBeNull();
    expect(heartbeatUrl("digest", "start", { HEALTHCHECKS_URL: "http://x" })).toBeNull();
  });

  it("makes the check on first use, with a path per signal", () => {
    expect(heartbeatUrl("digest", "success", KEY)).toBe(
      "https://hc-ping.com/pingkey123/jane-digest?create=1",
    );
    expect(heartbeatUrl("digest", "start", KEY)).toBe(
      "https://hc-ping.com/pingkey123/jane-digest/start?create=1",
    );
    expect(heartbeatUrl("digest", "fail", KEY)).toBe(
      "https://hc-ping.com/pingkey123/jane-digest/fail?create=1",
    );
    expect(
      heartbeatUrl("digest", "fail", { ...KEY, HEALTHCHECKS_URL: "http://localhost:9/" }),
    ).toBe("http://localhost:9/pingkey123/jane-digest/fail?create=1");
  });
});

describe("heartbeat", () => {
  it("sends nothing when it's off", async () => {
    const fetcher = vi.fn(ok);
    await heartbeat("digest", "start", { fetcher, env: {} });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never throws and never logs the key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const down = vi.fn(() => Promise.reject(new TypeError("fetch failed pingkey123")));
    await expect(heartbeat("digest", "fail", { fetcher: down, env: KEY })).resolves.toBeUndefined();
    const refused = vi.fn(() => Promise.resolve(new Response("no", { status: 429 })));
    await heartbeat("digest", "start", { fetcher: refused, env: KEY });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("pingkey123");
  });
});

describe("recordRun", () => {
  const client = () =>
    ({
      cronRun: { create: vi.fn(async () => ({ id: "r1" })), update: vi.fn(async () => ({})) },
      healthNotice: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    }) as unknown as PrismaClient;

  it("pings start then success around a job that works", async () => {
    vi.stubEnv("HEALTHCHECKS_PING_KEY", "pingkey123");
    const fetcher = vi.fn(ok);
    vi.stubGlobal("fetch", fetcher);
    await recordRun("digest", async () => 1, { client: client() });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://hc-ping.com/pingkey123/jane-digest/start?create=1",
      "https://hc-ping.com/pingkey123/jane-digest?create=1",
    ]);
  });

  it("pings fail for a job that throws, and still throws", async () => {
    vi.stubEnv("HEALTHCHECKS_PING_KEY", "pingkey123");
    const fetcher = vi.fn(ok);
    vi.stubGlobal("fetch", fetcher);
    await expect(
      recordRun(
        "digest",
        async () => {
          throw new Error("boom");
        },
        { client: client() },
      ),
    ).rejects.toThrow("boom");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://hc-ping.com/pingkey123/jane-digest/start?create=1",
      "https://hc-ping.com/pingkey123/jane-digest/fail?create=1",
    ]);
  });

  it("calls nobody when no key or DSN is set", async () => {
    vi.stubEnv("HEALTHCHECKS_PING_KEY", "");
    vi.stubEnv("SENTRY_DSN", "");
    const fetcher = vi.fn(ok);
    vi.stubGlobal("fetch", fetcher);
    await expect(
      recordRun(
        "digest",
        async () => {
          throw new Error("boom");
        },
        { client: client() },
      ),
    ).rejects.toThrow("boom");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("every scheduled job", () => {
  it("goes through recordRun, so each one pings", () => {
    const { crons } = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string }[];
    };
    expect(crons).toHaveLength(7);
    for (const { path } of crons) {
      expect(readFileSync(`src/app${path}/route.ts`, "utf8"), path).toContain("recordRun(");
    }
  });
});
