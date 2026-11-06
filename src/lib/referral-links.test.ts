import { describe, expect, it } from "vitest";
import { ReferralLinkError, buildReferralLink, referralSubId } from "./referral-links";

// Referral links carry nothing about the person (connectors roadmap round 14). Fake partner ids.

const KEY = "test-subid-key";
const subId = referralSubId("act_123", KEY);

describe("referralSubId", () => {
  it("is 16 hex, stable per action, different per action, and not the id", () => {
    expect(subId).toMatch(/^[0-9a-f]{16}$/);
    expect(referralSubId("act_123", KEY)).toBe(subId);
    expect(referralSubId("act_124", KEY)).not.toBe(subId);
    expect(subId).not.toContain("123");
    expect(() => referralSubId("act_123", "")).toThrow(ReferralLinkError);
  });
});

describe("buildReferralLink", () => {
  it("puts the sub-ID where each network takes it", () => {
    const at = (
      network: "impact" | "cj" | "awin" | "flexoffers",
      template: string,
      param: string,
    ) => new URL(buildReferralLink({ network, template, subId })).searchParams.get(param);
    expect(at("impact", "https://partner-link.example/c/0000000/000000/0000", "subId1")).toBe(
      subId,
    );
    expect(at("cj", "https://www.anrdoezrs.net/click-0000000-0000000", "sid")).toBe(subId);
    expect(
      at("awin", "https://www.awin1.com/cread.php?awinmid=00000&awinaffid=000000", "clickref"),
    ).toBe(subId);
    expect(at("flexoffers", "https://api.flexoffers.com/deeplink?AdvertiserId=0", "fobs")).toBe(
      subId,
    );
  });

  it("deep links only to the partner's allowed domain, encoded once", () => {
    const link = buildReferralLink({
      network: "awin",
      template: "https://www.awin1.com/cread.php?awinmid=00000&awinaffid=000000",
      subId,
      deepLink: "https://www.example-insurer.com/compare/renters",
      allowedDomains: ["example-insurer.com"],
    });
    expect(new URL(link).searchParams.get("ued")).toBe(
      "https://www.example-insurer.com/compare/renters",
    );
    for (const deepLink of [
      "https://evil.example/compare",
      "http://www.example-insurer.com/compare",
      "https://example-insurer.com.evil.example/",
      "https://www.example-insurer.com/compare?email=a@b.com",
    ]) {
      expect(
        () =>
          buildReferralLink({
            network: "awin",
            template: "https://www.awin1.com/cread.php?awinmid=1",
            subId,
            deepLink,
            allowedDomains: ["example-insurer.com"],
          }),
        deepLink,
      ).toThrow(ReferralLinkError);
    }
  });

  it("refuses a template that could carry the person, or isn't https", () => {
    for (const template of [
      "https://partner-link.example/c/1/2/3?p.email=a@b.com",
      "https://partner-link.example/c/1/2/3?sharedid=abc",
      "https://partner-link.example/c/1/2/3?zip=94110",
      "https://partner-link.example/c/1/2/3?userId=u_1",
      "https://partner-link.example/c/1/2/3?utm_content=a%40b.com",
      "https://partner-link.example/c/1/2/3?utm_term=415-555-0100",
      "http://partner-link.example/c/1/2/3",
      "not a url",
    ]) {
      expect(() => buildReferralLink({ network: "impact", template, subId }), template).toThrow(
        ReferralLinkError,
      );
    }
    expect(() =>
      buildReferralLink({ network: "impact", template: "https://x.example/c/1", subId: "u_1" }),
    ).toThrow(ReferralLinkError);
  });

  it("carries nothing but the template and the sub-ID", () => {
    const link = buildReferralLink({
      network: "impact",
      template: "https://partner-link.example/c/0000000/000000/0000?campaign=renewal",
      subId,
    });
    expect([...new URL(link).searchParams.keys()].sort()).toEqual(["campaign", "subId1"]);
  });
});
