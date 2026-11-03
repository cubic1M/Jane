import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({ db: { errorEvent: { create } } }));
vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  ipKey: vi.fn(() => "ip"),
}));

import { limitOrNull } from "@/lib/rate-limit";
import { POST } from "./route";

const post = (body: string) =>
  POST(new Request("http://x/api/client-error", { method: "POST", body }));

describe("POST /api/client-error", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records a page that broke in the browser, scrubbed", async () => {
    const response = await post(
      JSON.stringify({
        name: "TypeError",
        message: "x is 'Oak Ridge'",
        stack: null,
        path: "/home",
      }),
    );
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: {
        message: "TypeError: x is [text]",
        stack: null,
        path: "/home",
        method: null,
        routeType: "client",
      },
    });
  });

  // A local build stored 200 made-up reports of 2.4 KB from one IP in seconds: about 1 GB a day
  // from one IP at the backstop's 300 a minute, and real errors buried on /admin/errors.
  it.each([
    ["clientError", "ip"],
    ["errorReportsEveryone", "client"],
  ])("stores nothing past the %s limit", async (name, subject) => {
    vi.mocked(limitOrNull).mockImplementation(async (asked, who) =>
      asked === name && who === subject ? (Response.json({}, { status: 429 }) as never) : null,
    );
    const response = await post(JSON.stringify({ message: "boom" }));
    expect(response.status).toBe(429);
    expect(create).not.toHaveBeenCalled();
    vi.mocked(limitOrNull).mockResolvedValue(null);
  });

  it("refuses what isn't an error, and anything too big", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ message: "" }))).status).toBe(400);
    expect((await post("x".repeat(9000))).status).toBe(413);
    expect(create).not.toHaveBeenCalled();
  });
});
