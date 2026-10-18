import { beforeEach, describe, expect, it, vi } from "vitest";

const { GET, POST } = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  ipKey: vi.fn(() => "ip-hash"),
}));
vi.mock("@/auth", () => ({ handlers: { GET, POST } }));

import { limitOrNull } from "@/lib/rate-limit";
import * as route from "./route";

const request = () => new Request("http://localhost/api/auth/signin/resend", { method: "POST" });

describe("/api/auth/[...nextauth]", () => {
  beforeEach(() => {
    POST.mockReset().mockResolvedValue(new Response("ok"));
    vi.mocked(limitOrNull).mockReset().mockResolvedValue(null);
  });

  it("hands GET to Auth.js", () => {
    expect(route.GET).toBe(GET);
  });

  it("hands POST to Auth.js once the IP is within its limit", async () => {
    const req = request();
    await route.POST(req);

    expect(limitOrNull).toHaveBeenCalledWith("auth", "ip-hash");
    expect(POST).toHaveBeenCalledWith(req);
  });

  it("answers 429 without calling Auth.js when the IP is over its limit", async () => {
    vi.mocked(limitOrNull).mockResolvedValue(new Response(null, { status: 429 }) as never);

    expect((await route.POST(request())).status).toBe(429);
    expect(POST).not.toHaveBeenCalled();
  });
});
