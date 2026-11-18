import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { CONTROLLER_DETECTORS } from "./controller";
import { runDetectors } from "./index";

// Debugger 11-18 (r350, one month of Chase checking with one ChatGPT charge in a catch-all
// category, on a phone): the month-close card said "In October 2026, Openai $20.00 sit in a
// catch-all category". One charge sits.

describe("one charge keeping a month from closing", () => {
  it("sits, singular", () => {
    // The sample's last month has WeWork and Adobe in a catch-all category: Adobe alone stays.
    const base = inputFor("freelancer");
    const data = {
      ...base,
      transactions: base.transactions.filter((t) => !/WEWORK/i.test(t.description)),
    };
    const s = runDetectors({ profile: buildProfile(data), data }, CONTROLLER_DETECTORS).find(
      (x) => x.topic === "month_close",
    );
    expect(s?.why).toMatch(/ sits in a catch-all category/);
  });
});
