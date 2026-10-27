import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));

import { recordActivity } from "@/lib/activity/record";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/activity", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

const BATCH = { visitId: "visit12345", events: [{ kind: "page_view", path: "/home", at: 1 }] };

describe("POST /api/activity", () => {
  beforeEach(() => {
    vi.mocked(limitOrNull).mockReset().mockResolvedValue(null);
    vi.mocked(getCurrentUser).mockReset().mockResolvedValue(null);
    vi.mocked(recordActivity)
      .mockReset()
      .mockResolvedValue({ ok: true, recording: "anonymous", stored: 0 });
  });

  it("records a signed-in person's batch and tells the browser to keep going", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user_1", role: "user" } as never);
    vi.mocked(recordActivity).mockResolvedValue({ ok: true, recording: "user", stored: 1 });

    const response = await post(BATCH);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recording: true });
    expect(recordActivity).toHaveBeenCalledWith({ id: "user_1", role: "user" }, BATCH);
  });

  it("tells a signed-out browser to send page views only", async () => {
    const response = await post(BATCH);
    expect(await response.json()).toEqual({ recording: false });
    expect(recordActivity).toHaveBeenCalledWith(null, BATCH);
  });

  it("tells an admin's or a trial person's browser to stop", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "trial_x", role: "user" } as never);
    vi.mocked(recordActivity).mockResolvedValue({ ok: true, recording: "none", stored: 0 });
    expect(await (await post(BATCH)).json()).toEqual({ recording: false });
  });

  it("is rate-limited per IP", async () => {
    vi.mocked(limitOrNull).mockResolvedValue(
      NextResponse.json({ error: "Too many requests" }, { status: 429 }),
    );
    const response = await post(BATCH);
    expect(response.status).toBe(429);
    expect(limitOrNull).toHaveBeenCalledWith("activity", "ip");
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it("rejects bad JSON, a body that isn't a batch, and one too large", async () => {
    expect((await post("{not json")).status).toBe(400);
    vi.mocked(recordActivity).mockResolvedValue({ ok: false });
    expect((await post({ nope: 1 })).status).toBe(400);
    expect((await post({ ...BATCH, pad: "x".repeat(70_000) })).status).toBe(413);
  });
});
