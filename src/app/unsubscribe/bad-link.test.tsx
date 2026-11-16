import { prerenderToNodeStream } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { unsubscribeToken } from "@/lib/digest/unsubscribe";
import { POST } from "@/app/api/unsubscribe/route";
import UnsubscribePage from "./page";

// An unsubscribe link cut short by a mail app, or from an email sent before a key changed: pressing
// Unsubscribe showed the raw text {"error":"Invalid link"}, with no way onward (debug 3, 11-16).

async function html(query: Record<string, string>): Promise<string> {
  const { prelude } = await prerenderToNodeStream(
    UnsubscribePage({ searchParams: Promise.resolve(query) } as never),
  );
  let out = "";
  for await (const chunk of prelude) out += chunk;
  return out;
}

describe("an unsubscribe link that doesn't work", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret"));

  it("says so on the page and points to the setting, with no button that can't work", async () => {
    const page = await html({ token: "abc.def" });
    expect(page).toContain("This link doesn&#x27;t work");
    expect(page).toContain('href="/settings#email"');
    expect(page).not.toContain(">Unsubscribe<");
  });

  it("points alert and chat links to their own setting", async () => {
    expect(await html({ token: "abc.def", what: "alerts" })).toContain('href="/settings#alerts"');
    expect(await html({ what: "chat" })).toContain('href="/settings#jane-messages"');
  });

  it("still offers the button for a good link", async () => {
    const page = await html({ token: unsubscribeToken("u1") });
    expect(page).toContain(">Unsubscribe<");
    expect(page).not.toContain("doesn&#x27;t work");
  });

  it("sends the page's own press of a bad link back to the page, in words", async () => {
    const response = await POST(
      new Request("https://app.example.com/api/unsubscribe?token=abc.def&what=alerts&from=page", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/unsubscribe?what=alerts",
    );
  });

  it("still answers a mail app's one-click post with the error", async () => {
    const response = await POST(
      new Request("https://app.example.com/api/unsubscribe?token=abc.def", { method: "POST" }),
    );
    expect(response.status).toBe(400);
  });
});
