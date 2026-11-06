import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "@/detectors";
import { TAX_DETECTORS } from "@/detectors/taxes";
import { ipPinMessage } from "@/lib/jane-agent/tax-identity-message";
import { IP_PIN_TOOL_DOWN, inIpPinSeason, ipPinToolOpen } from "./tax-identity";

// Connectors roadmap round 16 (ip_pin_window): the IRS's IP PIN tool is off from mid-November to
// mid-January, so in early January Jane says so instead of sending people to a tool that's off.

describe("the IP PIN tool's window", () => {
  it("is off from November 15 to January 14, on either side of the new year", () => {
    expect(ipPinToolOpen("2026-11-14")).toBe(true);
    expect(ipPinToolOpen("2026-11-15")).toBe(false);
    expect(ipPinToolOpen("2026-12-31")).toBe(false);
    expect(ipPinToolOpen("2027-01-14")).toBe(false);
    expect(ipPinToolOpen("2027-01-15")).toBe(true);
    // The season still starts January 1: the reminder can be set before the tool opens.
    expect(inIpPinSeason("2027-01-05")).toBe(true);
  });

  const card = (today: string) => {
    const data = { ...inputFor("renter"), today };
    return runDetectors({ profile: buildProfile(data), data }, TAX_DETECTORS).find(
      (s) => s.topic === "identity_ip_pin",
    );
  };

  it("says the tool is off on the card in early January, and not once it's open", () => {
    expect(card("2027-01-05")?.why).toContain(IP_PIN_TOOL_DOWN);
    expect(card("2027-01-20")?.why).not.toContain("mid-January");
  });

  it("says so in the chat too", () => {
    const view = {
      year: 2027,
      season: true,
      havePin: false,
      reminded: false,
      case: null,
      candidates: [],
    };
    expect(ipPinMessage({ ...view, toolOpen: false }, false).body).toContain(IP_PIN_TOOL_DOWN);
    expect(ipPinMessage({ ...view, toolOpen: true }, false).body).not.toContain("mid-January");
  });
});
