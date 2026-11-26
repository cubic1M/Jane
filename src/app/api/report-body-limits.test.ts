import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null), ipKey: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/error-log", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/system-db", () => ({
  systemDb: vi.fn(() => ({ errorEvent: { create: vi.fn() } })),
}));

import { POST as clientError } from "./client-error/route";
import { POST as cspReport } from "./csp-report/route";

// A body of a megabyte in pieces, counting how many were taken.
function megabyte() {
  const taken = { pieces: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (taken.pieces++ === 1_024) return controller.close();
      controller.enqueue(new Uint8Array(1_024).fill(32));
    },
  });
  const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };
  return { taken, request: new Request("http://localhost/api/report", init) };
}

describe("a report anyone can send", () => {
  it.each([
    ["a page error", clientError],
    ["a blocked-content report", cspReport],
  ])("stops reading %s that is far too big", async (_, post) => {
    const { taken, request } = megabyte();
    expect((await post(request)).status).toBe(413);
    expect(taken.pieces).toBeLessThan(200);
  });
});
