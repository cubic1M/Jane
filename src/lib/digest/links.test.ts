import { afterEach, describe, expect, it, vi } from "vitest";
import { clickLink, landingPath } from "./links";

describe("digest links", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("go through click tracking on the app's own domain", () => {
    vi.stubEnv("APP_URL", "https://app.example.com/");

    expect(clickLink("d1", "/actions")).toBe(
      "https://app.example.com/api/digest/click?d=d1&to=%2Factions",
    );
  });

  it("land on known pages with UTM parameters, never anywhere else", () => {
    expect(landingPath("/actions")).toBe(
      "/actions?utm_source=digest&utm_medium=email&utm_campaign=weekly",
    );
    expect(landingPath("https://evil.example.com")).toMatch(/^\/report\?/);
    expect(landingPath("//evil.example.com")).toMatch(/^\/report\?/);
    expect(landingPath(null)).toMatch(/^\/report\?/);
  });
});
