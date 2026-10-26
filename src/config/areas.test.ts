import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DETECTORS } from "@/detectors";
import { CAPABILITIES } from "@/lib/jane-agent/capabilities";
import { AREA_KEYS, AREA_OF_CAPABILITY, areaOfCapability } from "./areas";
import { AREA_TABS } from "./navigation";

// Every capability belongs to an area or to Jane itself, and every detector to an area, so
// the hub's health dots and the feature map miss nothing (docs/design/home-hub.md).
describe("areas", () => {
  it("are the area tabs after Home, in the same order", () => {
    expect(AREA_KEYS).toEqual(AREA_TABS.slice(1).map((t) => t.key));
  });

  it("place every capability in the chat's registry", () => {
    for (const c of CAPABILITIES) expect(Object.keys(AREA_OF_CAPABILITY), c.id).toContain(c.id);
  });

  it("place every detector in an area", () => {
    for (const d of DETECTORS) expect(areaOfCapability(d.capability), d.topic).not.toBeNull();
  });

  it("leave unknown capabilities out", () => {
    expect(areaOfCapability("nothing_like_this")).toBeNull();
  });
});
