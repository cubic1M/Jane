import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("@/lib/error-log", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { recordError } from "@/lib/error-log";
import { limitOrNull } from "@/lib/rate-limit";
import { POST } from "./route";

const report = (blocked: string) =>
  new Request("http://localhost/api/csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report" },
    body: JSON.stringify({
      "csp-report": {
        "document-uri": "http://localhost/home?x=1",
        "effective-directive": "script-src-elem",
        "blocked-uri": blocked,
      },
    }),
  });

describe("POST /api/csp-report", () => {
  beforeEach(() => vi.mocked(recordError).mockReset());

  it("stores each blocked thing, scrubbed, for /admin/errors", async () => {
    const response = await POST(report("https://evil.example/a.js"));
    expect(response.status).toBe(204);
    expect(recordError).toHaveBeenCalledTimes(1);
    const [error, context] = vi.mocked(recordError).mock.calls[0];
    expect((error as Error).name).toBe("CspViolation");
    expect((error as Error).message).toBe("script-src-elem blocked https://evil.example");
    expect(context).toEqual({ path: "/home", method: "GET", routeType: "csp" });
  });

  it("answers 429 and stores nothing once an IP has sent too many", async () => {
    vi.mocked(limitOrNull).mockResolvedValueOnce(
      NextResponse.json({ error: "Too many requests" }, { status: 429 }),
    );
    const response = await POST(report("inline"));
    expect(response.status).toBe(429);
    expect(recordError).not.toHaveBeenCalled();
  });
});
