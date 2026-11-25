import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1b: the relief lookup ignored the home state, so a same-named county in
// another state could be the one shown.
const topics = (state: string | null) => {
  const d = { ...inputFor("family"), state };
  return runDetectors({ profile: buildProfile(d), data: d }).map((s) => s.topic);
};

describe("disaster relief by home state", () => {
  it("shows for the county's own state, and not for a person in another state", () => {
    expect(topics("TX")).toContain("disaster_relief");
    expect(topics("OR")).not.toContain("disaster_relief");
  });
});
