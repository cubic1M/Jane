import { describe, expect, it, vi } from "vitest";

const { GET, findUnique } = vi.hoisted(() => ({ GET: vi.fn(), findUnique: vi.fn() }));

vi.mock("@/auth", () => ({ handlers: { GET, POST: vi.fn() } }));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null), ipKey: vi.fn() }));
vi.mock("@/lib/system-db", () => ({ systemDb: () => ({ session: { findUnique } }) }));

import * as route from "./route";

const RESET =
  "authjs.session-token=tok123; Path=/; Expires=Sun, 06 Dec 2026 05:40:36 GMT; Max-Age=2592000; HttpOnly; SameSite=Lax";

describe("GET /api/auth/session, when whose session it is can't be read", () => {
  // A statement try's cookie must end with the browser. Not knowing whose it is, the shorter one.
  it("sends the cookie without a lasting date", async () => {
    GET.mockResolvedValue(new Response("{}", { headers: { "set-cookie": RESET } }));
    findUnique.mockRejectedValue(new Error("database down"));
    const response = await route.GET(
      new Request("http://localhost/api/auth/session", {
        headers: { cookie: "authjs.session-token=tok123" },
      }),
    );
    const cookie = response.headers.getSetCookie()[0];
    expect(cookie).toMatch(/^authjs\.session-token=tok123/);
    expect(cookie).not.toMatch(/expires|max-age/i);
  });
});
