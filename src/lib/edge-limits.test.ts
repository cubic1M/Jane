import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { RATE_LIMITS } from "@/config/rate-limits";
import { edgeChecks, edgeKind, edgeLimit, refusal } from "./edge-limits";
import { TOO_MANY_MESSAGE, ipKey } from "./rate-limit";

type Init = { method?: string; ip?: string; token?: string; action?: boolean };

function request(pathname: string, { method = "GET", ip, token, action }: Init = {}) {
  const headers = new Headers();
  if (ip) headers.set("x-forwarded-for", `${ip}, 10.0.0.1`);
  if (action) headers.set("next-action", "abc123");
  return {
    method,
    pathname,
    headers,
    cookies: {
      get: (name: string) =>
        token && name === "__Secure-authjs.session-token" ? { value: token } : undefined,
    },
  };
}

const IP = "203.0.113.9";
const ipSubject = ipKey(new Headers({ "x-forwarded-for": IP }));

describe("which requests the edge limits", () => {
  it("covers every API route, every server action and the way back from sign-in", () => {
    expect(edgeKind(request("/api/chat/send", { method: "POST" }))).toBe("api");
    expect(edgeKind(request("/api/health"))).toBe("api");
    expect(edgeKind(request("/api/auth/callback/resend"))).toBe("authCallback");
    expect(edgeKind(request("/api/auth/callback/google"))).toBe("authCallback");
    expect(edgeKind(request("/settings", { method: "POST", action: true }))).toBe("action");
  });

  it("leaves cron routes (CRON_SECRET guards them) and plain page views alone", () => {
    expect(edgeKind(request("/api/cron/plaid-sync"))).toBeNull();
    expect(edgeKind(request("/home"))).toBeNull();
    expect(edgeKind(request("/login", { method: "POST" }))).toBeNull();
  });

  it("counts per IP and per signed-in session, never by the raw token", () => {
    const checks = edgeChecks(request("/api/chat/unread", { ip: IP, token: "secret-token" }));
    expect(checks).toEqual([
      { name: "api", subject: ipSubject },
      { name: "apiSession", subject: expect.stringMatching(/^[0-9a-f]{32}$/) },
    ]);
    expect(JSON.stringify(checks)).not.toContain("secret-token");
    expect(JSON.stringify(checks)).not.toContain(IP);
  });

  it("gives Try Jane's sample people their own, tighter limits", () => {
    const api = edgeChecks(request("/api/chat/send", { ip: IP, token: "trial_abc" }));
    expect(api.map((c) => c.name)).toEqual(["api", "trialApi"]);
    const action = edgeChecks(
      request("/chat", { method: "POST", action: true, token: "trial_abc" }),
    );
    expect(action.map((c) => c.name)).toEqual(["trialActions"]);
    expect(RATE_LIMITS.trialApi.limit).toBeLessThan(RATE_LIMITS.apiSession.limit);
    expect(RATE_LIMITS.trialActions.limit).toBeLessThan(RATE_LIMITS.actionsSession.limit);
  });

  it("limits server actions per IP and per session", () => {
    const checks = edgeChecks(
      request("/settings", { method: "POST", action: true, ip: IP, token: "t" }),
    );
    expect(checks.map((c) => c.name)).toEqual(["actions", "actionsSession"]);
  });

  it("limits sign-in links and Google's return per IP", () => {
    expect(edgeChecks(request("/api/auth/callback/resend", { ip: IP }))).toEqual([
      { name: "authCallback", subject: ipSubject },
    ]);
  });

  it("skips the IP counter only where there is no IP (local runs; Vercel always sets one)", () => {
    expect(edgeChecks(request("/api/health"))).toEqual([]);
    expect(edgeChecks(request("/api/health", { token: "t" })).map((c) => c.name)).toEqual([
      "apiSession",
    ]);
  });
});

describe("edgeLimit", () => {
  const over = { ok: false, remaining: 0, retryAfterSeconds: 42 };

  it("lets a request on while under every limit", async () => {
    const hit = vi.fn(async () => ({ ok: true, remaining: 5, retryAfterSeconds: 0 }));
    expect(await edgeLimit(request("/api/health", { ip: IP }), { hit })).toBeNull();
    expect(hit).toHaveBeenCalledWith([{ name: "api", subject: ipSubject }]);
  });

  it("answers an API call over the limit with a calm 429 and when to come back", async () => {
    const response = await edgeLimit(request("/api/health", { ip: IP }), {
      hit: vi.fn(async () => over),
    });
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("42");
    expect(await response?.json()).toEqual({ error: TOO_MANY_MESSAGE });
  });

  it("answers a server action in plain text, which the page shows as the message", async () => {
    const response = refusal("action", over);
    expect(response.status).toBe(429);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(await response.text()).toBe(TOO_MANY_MESSAGE);
  });

  it("never touches the database for a request it doesn't limit", async () => {
    const hit = vi.fn();
    expect(await edgeLimit(request("/api/cron/digest", { ip: IP }), { hit })).toBeNull();
    expect(hit).not.toHaveBeenCalled();
  });

  it("lets the request through if the counters can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hit = vi.fn(async () => {
      throw new Error("connection refused");
    });
    expect(await edgeLimit(request("/api/health", { ip: IP }), { hit })).toBeNull();
  });
});

// The rule: every API route is limited, except cron routes, which check CRON_SECRET instead.
describe("every API route", () => {
  const apiDir = join(process.cwd(), "src/app/api");
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "route.ts") routes.push(path);
    }
  };
  walk(apiDir);

  it.each(routes.map((r) => [relative(apiDir, r)]))("%s is limited or guarded", (route) => {
    const pathname = `/api/${route.replace(/\/route\.ts$/, "").replace(/\[\.*([^\]]+)\]/g, "x")}`;
    if (pathname.startsWith("/api/cron/")) {
      expect(readFileSync(join(apiDir, route), "utf8")).toContain("CRON_SECRET");
    } else {
      expect(edgeChecks(request(pathname, { ip: IP })).length).toBeGreaterThan(0);
    }
  });
});
