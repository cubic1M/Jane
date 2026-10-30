import { describe, expect, it } from "vitest";
import { oldUploadNewest } from "./old-upload";

// Night QA 10-30: a statement from a year ago, uploaded by mistake, read as today's balance and
// "Nothing to fix right now"; /import now says the files are old before they're imported.
describe("oldUploadNewest", () => {
  it("names the newest day of files that end long ago", () => {
    expect(oldUploadNewest([{ to: "2025-10-23" }, { to: "2025-10-26" }], "2026-10-30")).toBe(
      "2025-10-26",
    );
  });

  it("is quiet for recent files, and for files with no dates", () => {
    expect(oldUploadNewest([{ to: "2026-10-23" }, { to: "2025-01-01" }], "2026-10-30")).toBeNull();
    expect(oldUploadNewest([{ to: "2026-09-20" }], "2026-10-30")).toBeNull();
    expect(oldUploadNewest([{ to: null }, {}], "2026-10-30")).toBeNull();
  });
});
