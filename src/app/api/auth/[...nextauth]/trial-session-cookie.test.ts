import { beforeEach, describe, expect, it, vi } from "vitest";

const { GET, findUnique } = vi.hoisted(() => ({ GET: vi.fn(), findUnique: vi.fn() }));

vi.mock("@/auth", () => ({ handlers: { GET, POST: vi.fn() } }));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null), ipKey: vi.fn() }));
vi.mock("@/lib/system-db", () => ({ systemDb: () => ({ session: { findUnique } }) }));

import * as route from "./route";

// A statement try's cookie ends when the browser closes, so the next person at a shared computer
// doesn't find the statement. Auth.js sets the cookie again on a read of /api/auth/session, with 30
// days on it: a single link there made it last a month.

const RESET =
  "authjs.session-token=tok123; Path=/; Expires=Sun, 06 Dec 2026 05:40:36 GMT; Max-Age=2592000; HttpOnly; SameSite=Lax";

const read = () =>
  route.GET(
    new Request("http://localhost/api/auth/session", {
      headers: { cookie: "authjs.session-token=tok123" },
    }),
  );

describe("GET /api/auth/session, for someone trying Jane with their statement", () => {
  beforeEach(() => {
    GET.mockReset().mockImplementation(
      async () =>
        new Response("{}", {
          headers: { "set-cookie": RESET, "content-type": "application/json" },
        }),
    );
  });

  it("keeps their cookie ending when the browser closes", async () => {
    findUnique.mockResolvedValue({ userId: "trial_own_abc123" });
    const cookie = (await read()).headers.getSetCookie()[0];
    expect(cookie).toMatch(/^authjs\.session-token=tok123/);
    expect(cookie).not.toMatch(/expires|max-age/i);
    expect(cookie).toMatch(/HttpOnly/);
  });

  it("leaves everyone else's as Auth.js sets it", async () => {
    findUnique.mockResolvedValue({ userId: "cuser123" });
    expect((await read()).headers.getSetCookie()[0]).toBe(RESET);
  });
});
