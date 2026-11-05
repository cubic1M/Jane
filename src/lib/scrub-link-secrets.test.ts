import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseCspReports } from "./csp-report";
import { safePath } from "./error-kind";
import { scrubPath } from "./scrub";

// A browser's report from an accountant's link kept the raw token in error_events and the server
// log, though the database holds only its hash. Anyone reading those could open the numbers.
describe("the secret in a link's address", () => {
  const token = randomBytes(32).toString("base64url");

  it.each([
    [`/accountant/${token}`, "/accountant/[secret]"],
    [`/s/${token}`, "/s/[secret]"],
    [`/gift/${token}`, "/gift/[secret]"],
    [`/api/calendar/${token}`, "/api/calendar/[secret]"],
    [`/household/join/${token}?x=1`, "/household/join/[secret]"],
    ["/join/ABCD-EFGH-JKMN", "/join/[secret]"],
  ])("isn't kept from %s", (path, kept) => {
    expect(scrubPath(path)).toBe(kept);
  });

  it("isn't kept from a browser's report, or sent to Sentry", () => {
    const report = JSON.stringify({
      "csp-report": {
        "document-uri": `https://example.test/accountant/${token}?t=1`,
        "blocked-uri": "https://evil.example/x",
        "violated-directive": "img-src",
      },
    });
    const [violation] = parseCspReports(report);
    expect(violation?.page).toBe("/accountant/[secret]");
    expect(safePath(`/accountant/${token}`)).not.toContain(token);
  });

  it("leaves the pages themselves readable", () => {
    expect(scrubPath("/taxes/calendar")).toBe("/taxes/calendar");
    expect(scrubPath("/insurance/cover-changes/new")).toBe("/insurance/cover-changes/new");
    expect(scrubPath("/")).toBe("/");
    expect(scrubPath(null)).toBeNull();
  });
});
