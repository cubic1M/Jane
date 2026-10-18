import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("@/lib/calendar", () => ({
  userForCalendarToken: vi.fn(),
  calendarFeed: vi.fn(async () => "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"),
}));

import { calendarFeed, userForCalendarToken } from "@/lib/calendar";
import { limitOrNull } from "@/lib/rate-limit";
import { GET } from "./route";

const get = (token: string) =>
  GET(new Request(`http://localhost/api/calendar/${token}`), {
    params: Promise.resolve({ token }),
  });

describe("GET /api/calendar/[token]", () => {
  beforeEach(() => {
    vi.mocked(userForCalendarToken).mockReset();
    vi.mocked(limitOrNull).mockReset().mockResolvedValue(null);
  });

  it("serves the feed for a live link, with or without .ics", async () => {
    vi.mocked(userForCalendarToken).mockResolvedValue("u1");
    const response = await get("secret.ics");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    expect(userForCalendarToken).toHaveBeenCalledWith("secret");
    expect(calendarFeed).toHaveBeenCalledWith("u1");
  });

  it("answers 404 for a reset or unknown link", async () => {
    vi.mocked(userForCalendarToken).mockResolvedValue(null);
    expect((await get("old.ics")).status).toBe(404);
  });

  it("is rate limited", async () => {
    vi.mocked(limitOrNull).mockResolvedValue(new Response(null, { status: 429 }) as never);
    expect((await get("x")).status).toBe(429);
    expect(userForCalendarToken).not.toHaveBeenCalled();
  });
});
