import { describe, expect, it } from "vitest";
import { cronAuthorized } from "./cron-auth";

const asking = (authorization?: string) =>
  new Request("http://x/api/cron/digest", { headers: authorization ? { authorization } : {} });

describe("cronAuthorized", () => {
  it("lets only the exact secret through", () => {
    expect(cronAuthorized(asking("Bearer right"), "right")).toBe(true);
    for (const wrong of ["Bearer wrong", "Bearer righ", "Bearer rightt", "right", undefined]) {
      expect(cronAuthorized(asking(wrong), "right")).toBe(false);
    }
  });

  it("lets nobody through when no secret is set", () => {
    for (const secret of [undefined, ""]) {
      expect(cronAuthorized(asking("Bearer "), secret)).toBe(false);
      expect(cronAuthorized(asking(), secret)).toBe(false);
    }
  });
});
