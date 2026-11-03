import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/error-log", () => ({
  describeError: vi.fn(() => ({ message: "Error: nope" })),
  recordError: vi.fn(),
}));
vi.mock("@/lib/error-alerts", () => ({ alertError: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ hit: vi.fn() }));

import { alertError } from "@/lib/error-alerts";
import { recordError } from "@/lib/error-log";
import { hit } from "@/lib/rate-limit";
import { onRequestError } from "./instrumentation";

const report = () =>
  onRequestError!(
    new Error("nope"),
    { path: "/x", method: "POST", headers: {} },
    { routerKind: "App Router", routePath: "/x", routeType: "action" },
  );

describe("onRequestError", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.mocked(recordError).mockReset();
    vi.mocked(alertError).mockReset();
  });

  it("keeps and reports an error under the hour's ceiling", async () => {
    vi.mocked(hit).mockResolvedValue({ ok: true, remaining: 1, retryAfterSeconds: 0 });
    await report();
    expect(recordError).toHaveBeenCalledOnce();
    expect(alertError).toHaveBeenCalledOnce();
  });

  it("keeps nothing past the ceiling, so a flood can't fill the database", async () => {
    vi.mocked(hit).mockResolvedValue({ ok: false, remaining: 0, retryAfterSeconds: 60 });
    await report();
    expect(recordError).not.toHaveBeenCalled();
    expect(alertError).not.toHaveBeenCalled();
  });

  it("still keeps the error when the count itself fails", async () => {
    vi.mocked(hit).mockRejectedValue(new Error("database down"));
    await report();
    expect(recordError).toHaveBeenCalledOnce();
  });
});
