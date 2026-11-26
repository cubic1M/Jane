import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { ACTIVITY } from "@/config/activity";

vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null), ipKey: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/lib/activity/record", () => ({
  recordActivity: vi.fn(async () => ({ ok: true, recording: "anonymous", stored: 0 })),
}));

import { recordActivity } from "@/lib/activity/record";
import { POST } from "./route";

describe("the activity log's size limit", () => {
  it("is in bytes, so characters of several bytes can't pass it three times over", async () => {
    // Fewer characters than the limit, more bytes.
    const body = JSON.stringify({ pad: "€".repeat(Math.ceil(ACTIVITY.maxBodyBytes / 2)) });
    expect(body.length).toBeLessThan(ACTIVITY.maxBodyBytes);
    const response = await POST(
      new NextRequest("http://localhost/api/activity", { method: "POST", body }),
    );
    expect(response.status).toBe(413);
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it("stops reading once past it, rather than taking in the whole body first", async () => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ === 1_000) return controller.close();
        controller.enqueue(new Uint8Array(1_024).fill(32));
      },
    });
    const response = await POST(
      new NextRequest("http://localhost/api/activity", { method: "POST", body, duplex: "half" }),
    );
    expect(response.status).toBe(413);
    expect(sent).toBeLessThan((ACTIVITY.maxBodyBytes / 1_024) * 2);
  });
});
