import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { ACTION_BODY_MAX_BYTES, RATE_LIMITS } from "@/config/rate-limits";
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

  it("counts a sample session's page views, each hundreds of queries, by session and IP", () => {
    const page = request("/home", { token: "trial_abc", ip: IP });
    expect(edgeKind(page)).toBe("page");
    expect(edgeChecks(page).map((c) => c.name)).toEqual(["trialPagesIp", "trialPages"]);
    expect(edgeChecks(page).map((c) => c.subject)).not.toContain("trial_abc");
    expect(refusal("page", { ok: false, remaining: 0, retryAfterSeconds: 9 }).status).toBe(429);
  });

  it("counts a form posted with no JavaScript, and refuses it when it's too big", async () => {
    const post = request("/taxes", { method: "POST", ip: IP });
    expect(edgeKind(post)).toBe("action");
    post.headers.set("content-length", String(ACTION_BODY_MAX_BYTES + 1));
    expect((await edgeLimit(post))?.status).toBe(413);
  });

  it("isn't fooled by half a prefetch, a HEAD, or a session cookie split in two", async () => {
    const half = request("/home", { token: "trial_abc" });
    half.headers.set("next-router-prefetch", "1");
    expect(edgeKind(half)).toBe("page");
    expect(edgeKind(request("/home", { method: "HEAD", token: "trial_abc" }))).toBe("page");
    for (const cookie of [
      "__Secure-authjs.session-token.0=trial_abc",
      "a=b; authjs.session-token.1=x",
    ]) {
      const split = request("/home");
      split.headers.set("cookie", cookie);
      expect((await edgeLimit(split))?.status).toBe(400);
    }
    const ordinary = request("/home");
    ordinary.headers.set("cookie", "a=b; __Secure-authjs.session-token=abc");
    expect(await edgeLimit(ordinary, { hit: vi.fn() })).toBeNull();
  });

  it("doesn't count a sample session's prefetches, or a real person's page views", () => {
    const prefetch = request("/home", { token: "trial_abc" });
    prefetch.headers.set("next-router-prefetch", "1");
    prefetch.headers.set("rsc", "1");
    expect(edgeKind(prefetch)).toBeNull();
    expect(edgeKind(request("/home", { token: "someone-real" }))).toBeNull();
  });

  it("leaves cron routes (CRON_SECRET guards them) and plain page views alone", () => {
    expect(edgeKind(request("/api/cron/plaid-sync"))).toBeNull();
    expect(edgeKind(request("/home"))).toBeNull();
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

// The rule: every API route is limited, except cron routes, which check CRON_SECRET instead (the
// hourly probe has its own secret, so it stays off until a founder sets it).
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
      expect(readFileSync(join(apiDir, route), "utf8")).toMatch(/CRON_SECRET|PROBE_SECRET/);
    } else {
      expect(edgeChecks(request(pathname, { ip: IP })).length).toBeGreaterThan(0);
    }
  });
});

describe("how much a server action may send", () => {
  const big = String(ACTION_BODY_MAX_BYTES + 1);
  const hit = vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 }));
  const posted = (pathname: string, length: string | null) => {
    const req = request(pathname, { method: "POST", ip: "1.2.3.4", action: true });
    if (length !== null) req.headers.set("content-length", length);
    return req;
  };

  it("refuses a request too big to be a form, on a page that takes no files", async () => {
    const answer = await edgeLimit(posted("/taxes", big), { hit });
    expect(answer?.status).toBe(413);
  });

  it("lets a form's size through", async () => {
    const fits = String(ACTION_BODY_MAX_BYTES);
    expect(await edgeLimit(posted("/taxes", fits), { hit })).toBeNull();
  });

  it.each(["/", "/import", "/import/investments", "/documents"])(
    "leaves %s, which uploads files, to its own limits",
    async (page) => {
      expect(await edgeLimit(posted(page, big), { hit })).toBeNull();
    },
  );

  it("doesn't take a page that only starts the same for an upload page", async () => {
    expect((await edgeLimit(posted("/imports", big), { hit }))?.status).toBe(413);
  });

  it("only looks at server actions", async () => {
    const api = request("/api/chat/send", { method: "POST", ip: "1.2.3.4" });
    api.headers.set("content-length", big);
    expect(await edgeLimit(api, { hit })).toBeNull();
  });

  it("lets through a request that doesn't say how big it is", async () => {
    expect(await edgeLimit(posted("/taxes", null), { hit })).toBeNull();
  });
});
