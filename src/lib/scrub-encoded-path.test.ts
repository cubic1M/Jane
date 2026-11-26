import { describe, expect, it } from "vitest";
import { scrubPath } from "./scrub";

describe("a link's secret written with percent escapes", () => {
  it("is hidden like the plain one", () => {
    const token = "abcdefghijklmnopqrstuvwxyz012345";
    const encoded = `%61${token.slice(1)}`;
    expect(scrubPath(`/accountant/${encoded}`)).toBe("/accountant/[secret]");
    expect(scrubPath(`/accountant/${token}`)).toBe("/accountant/[secret]");
  });

  it("leaves ordinary paths, and ones that don't decode, as they are", () => {
    expect(scrubPath("/investments/family-file")).toBe("/investments/family-file");
    expect(scrubPath("/a/%E0%A4%A")).toBe("/a/%E0%A4%A");
  });
});
