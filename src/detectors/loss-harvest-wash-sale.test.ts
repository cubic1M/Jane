import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c (det-05, 8): the wash-sale rule reaches 30 days before the sale as well as
// after it, so the card's saving holds only if neither side has a purchase of the same holding.
describe("the tax-loss card and the wash-sale rule", () => {
  const data = inputFor("equity");
  const s = runDetectors({ profile: buildProfile(data), data }).find(
    (x) => x.topic === "tax_loss_harvest",
  )!;

  it("says a purchase before the sale counts too", () => {
    expect(s.why).toContain("wash-sale");
    expect(s.why).toMatch(/30 days before the sale/);
    expect(s.why).toMatch(/30 days after/);
  });
  it("makes the saving conditional in its confidence", () => {
    expect(s.confidence.reason).toMatch(/30 days either side/);
  });
});
