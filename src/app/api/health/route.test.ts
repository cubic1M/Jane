import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns ok, and no commit when the build doesn't know its own", async () => {
    vi.stubEnv("BUILD_COMMIT", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, commit: null });
  });

  it("says which commit this build is, for the numbers page", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123");
    expect(await (await GET()).json()).toEqual({ ok: true, commit: "abc123" });
  });

  // The uptime workflow greps the raw body for this, so the words can't change.
  it('keeps the literal "ok":true the uptime check looks for', async () => {
    expect(await (await GET()).text()).toContain('"ok":true');
  });
});
