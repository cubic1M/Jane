import { afterEach, describe, expect, it, vi } from "vitest";
import { clickLink, landingPath } from "./links";

describe("digest links", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("go through click tracking on the app's own domain", () => {
    vi.stubEnv("APP_URL", "https://app.example.com/");

    expect(clickLink("d1", "/jane")).toBe(
      "https://app.example.com/api/digest/click?d=d1&to=%2Fjane",
    );
  });

  it("land on known pages with UTM parameters, never anywhere else", () => {
    expect(landingPath("/jane")).toBe(
      "/jane?utm_source=digest&utm_medium=email&utm_campaign=weekly",
    );
    // A page that's gone (/alerts) or hidden lands on the report.
    expect(landingPath("/alerts")).toMatch(/^\/report\?/);
    expect(landingPath("https://evil.example.com")).toMatch(/^\/report\?/);
    expect(landingPath("//evil.example.com")).toMatch(/^\/report\?/);
    expect(landingPath(null)).toMatch(/^\/report\?/);
  });
});
