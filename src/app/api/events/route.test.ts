import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { track } from "@/lib/analytics";
import { POST } from "./route";

const EXISTING_ID = "2f1c8a54-7d6e-4b3a-9c21-5e8f0a7b6c4d";

function postEvent(body: unknown, cookie?: string) {
  return POST(
    new NextRequest("http://localhost/api/events", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
    }),
  );
}

describe("POST /api/events", () => {
  beforeEach(() => {
    vi.mocked(track).mockReset().mockResolvedValue(undefined);
  });

  it("records an allowed event and sets an anonymous id cookie", async () => {
    const response = await postEvent({ name: "landing_viewed" });

    expect(response.status).toBe(204);
    const cookie = response.cookies.get("fc_aid");
    expect(cookie?.value).toMatch(/^[0-9a-f-]{36}$/);
    expect(cookie?.httpOnly).toBe(true);
    expect(track).toHaveBeenCalledWith(null, "landing_viewed", { anonymous_id: cookie?.value });
  });

  it("reuses an existing anonymous id without resetting the cookie", async () => {
    const response = await postEvent({ name: "get_started_clicked" }, `fc_aid=${EXISTING_ID}`);

    expect(response.status).toBe(204);
    expect(response.cookies.get("fc_aid")).toBeUndefined();
    expect(track).toHaveBeenCalledWith(null, "get_started_clicked", { anonymous_id: EXISTING_ID });
  });

  it("replaces a malformed anonymous id", async () => {
    const response = await postEvent({ name: "landing_viewed" }, "fc_aid=not-a-uuid");

    const cookie = response.cookies.get("fc_aid");
    expect(cookie?.value).toMatch(/^[0-9a-f-]{36}$/);
    expect(cookie?.value).not.toBe("not-a-uuid");
  });

  it("rejects event names that are not on the allowlist", async () => {
    const response = await postEvent({ name: "decision_yes" });

    expect(response.status).toBe(400);
    expect(track).not.toHaveBeenCalled();
  });

  it("rejects a missing name", async () => {
    const response = await postEvent({});

    expect(response.status).toBe(400);
    expect(track).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const response = await postEvent("{not json");

    expect(response.status).toBe(400);
    expect(track).not.toHaveBeenCalled();
  });
});
