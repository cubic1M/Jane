import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "@/config/rate-limits";
import { SHARE_INVITE_MAX_USES } from "@/config/share";

describe("one address spending an invite code", () => {
  it("can't use up a share link in a day", () => {
    expect(RATE_LIMITS.inviteRedeem.limit).toBeLessThan(SHARE_INVITE_MAX_USES);
    expect(RATE_LIMITS.inviteRedeem.windowSeconds).toBe(24 * 60 * 60);
  });
});
