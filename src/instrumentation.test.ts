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
    { routerKind: "App Router", routePath: "/x", routeType: "action", revalidateReason: undefined },
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

  // An independent read: a flood of these under one allowance would leave real errors unrecorded.
  it("gives refused cross-site actions their own allowance and one alert, not one per path", async () => {
    vi.mocked(hit).mockResolvedValue({ ok: true, remaining: 1, retryAfterSeconds: 0 });
    await onRequestError!(
      new Error("Invalid Server Actions request."),
      { path: "/made/up", method: "POST", headers: {} },
      {
        routerKind: "App Router",
        routePath: "/x",
        routeType: "action",
        revalidateReason: undefined,
      },
    );
    expect(hit).toHaveBeenCalledWith("refusedActionsKept", "all", expect.anything());
    expect(vi.mocked(alertError).mock.calls[0][0].path).toBeNull();
  });

  it("tells the team when real errors go past the ceiling, whatever the alert limit", async () => {
    vi.mocked(hit).mockResolvedValue({ ok: false, remaining: 0, retryAfterSeconds: 60 });
    await report();
    expect(recordError).not.toHaveBeenCalled();
    expect(alertError).toHaveBeenCalledOnce();
    expect(vi.mocked(alertError).mock.calls[0][1]).toMatchObject({ pastCeiling: true });
  });

  it("still keeps the error when the count itself fails", async () => {
    vi.mocked(hit).mockRejectedValue(new Error("database down"));
    await report();
    expect(recordError).toHaveBeenCalledOnce();
  });
});
