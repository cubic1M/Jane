import { describe, expect, it } from "vitest";
import { IP_PIN, SIGNS, STEPS } from "@/config/tax-identity";
import { NOTICE_KINDS } from "@/config/tax-notices";
import {
  caseView,
  inIpPinSeason,
  isSign,
  isStep,
  noticeLooksLikeTheft,
  stepsFor,
} from "./tax-identity";

// Spec step 218: each sign has a test; the steps are tracked to done.

describe("the IP PIN season", () => {
  it("runs from January 1 to the filing deadline", () => {
    expect(inIpPinSeason("2027-01-01")).toBe(true);
    expect(inIpPinSeason("2027-04-15")).toBe(true);
    expect(inIpPinSeason("2027-04-16")).toBe(false);
    expect(inIpPinSeason("2026-12-31")).toBe(false);
    expect(IP_PIN.url).toMatch(/^https:\/\/www\.irs\.gov\//);
  });
});

describe("the steps for each sign", () => {
  it("has every sign and step defined with a way to do it", () => {
    for (const key of Object.keys(SIGNS)) expect(isSign(key)).toBe(true);
    expect(isSign("lost_wallet")).toBe(false);
    for (const s of STEPS) {
      expect(isStep(s.key)).toBe(true);
      expect(s.url ?? s.phone ?? s.how, s.key).toBeTruthy();
    }
  });

  it("gives a rejected e-file the paper return step, and every sign the same core in order", () => {
    const core = ["report_ftc", "form_14039", "credit_freeze", "call_irs"];
    expect(stepsFor("efile_rejected").map((s) => s.key)).toEqual([
      ...core,
      "paper_return",
      "ip_pin",
    ]);
    expect(stepsFor("unknown_form").map((s) => s.key)).toEqual([...core, "ip_pin"]);
    expect(stepsFor("irs_letter").map((s) => s.key)).toEqual([...core, "ip_pin"]);
  });

  it("uses the credit pages for the freeze and the IRS line for the call", () => {
    expect(STEPS.find((s) => s.key === "credit_freeze")!.url).toBe("/loans/credit");
    expect(STEPS.find((s) => s.key === "call_irs")!.phone).toBe("800-908-4490");
    expect(STEPS.find((s) => s.key === "form_14039")!.url).toContain("f14039");
  });
});

describe("a case tracked to done", () => {
  it("shows the next step until every one is done", () => {
    const base = { sign: "unknown_form" as const, openedOn: "2027-02-01" };
    let v = caseView({ ...base, done: {} });
    expect(v.next).toBe("report_ftc");
    expect(v.complete).toBe(false);
    v = caseView({ ...base, done: { report_ftc: "2027-02-01", form_14039: "2027-02-02" } });
    expect(v.next).toBe("credit_freeze");
    expect(v.steps.filter((s) => s.doneOn).length).toBe(2);
    v = caseView({
      ...base,
      done: { report_ftc: "a", form_14039: "b", credit_freeze: "c", call_irs: "d", ip_pin: "e" },
    });
    expect(v).toMatchObject({ next: null, complete: true });
  });
});

describe("a letter that reads like theft", () => {
  it("is an identity verification letter, or one saying the return wasn't filed", () => {
    expect(NOTICE_KINDS.ID_VERIFY.source).toContain("irs.gov");
    expect(noticeLooksLikeTheft("ID_VERIFY", undefined)).toBe(true);
    expect(noticeLooksLikeTheft("CP2000", "We need you to verify your identity.")).toBe(true);
    expect(noticeLooksLikeTheft("OTHER", "A return you didn't file was received.")).toBe(true);
    expect(noticeLooksLikeTheft("CP14", "Balance due on your return.")).toBe(false);
    expect(noticeLooksLikeTheft("CP14", undefined)).toBe(false);
  });
});
