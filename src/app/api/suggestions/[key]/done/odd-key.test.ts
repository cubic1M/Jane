import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/session", async () => {
  const { TERMS_VERSION } = await import("@/config/legal");
  return { getCurrentUser: vi.fn(async () => ({ id: "u1", termsVersion: TERMS_VERSION })) };
});
vi.mock("@/lib/outcomes", async (original) => ({
  ...(await original<typeof import("@/lib/outcomes")>()),
  markSuggestionDone: vi.fn(async () => ({ status: "open" })),
}));

import { markSuggestionDone } from "@/lib/outcomes";
import { POST } from "./route";

describe("a suggestion key no suggestion has", () => {
  it.each(["%00", "a%00b", "%E0%A4%A"])("is not found for %s", async (key) => {
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ key }),
    });
    expect(response.status).toBe(404);
    expect(markSuggestionDone).not.toHaveBeenCalled();
  });
});
