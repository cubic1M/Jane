import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({ db: { errorEvent: { create } } }));

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

  it("refuses what isn't an error, and anything too big", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ message: "" }))).status).toBe(400);
    expect((await post("x".repeat(9000))).status).toBe(413);
    expect(create).not.toHaveBeenCalled();
  });
});
