import { describe, expect, it } from "vitest";
import { callMode } from "./provider";
import { checkCall, type CallCheck } from "./gate";

// Connectors roadmap round 19: the gate a real AI call must pass first.

const OPENER =
  "Hi, this is Jane, an AI assistant acting for Alex Doe, the account holder, with their written permission. This call is recorded.";
// 2026-11-06 18:00 UTC is 10am in Los Angeles, 1pm in New York.
const call: CallCheck = {
  lineType: "toll_free",
  calleeState: "CA",
  personState: "NY",
  calleeTimeZone: "America/Los_Angeles",
  now: new Date("2026-11-06T18:00:00Z"),
  personName: "Alex Doe",
  opener: OPENER,
};

describe("checkCall", () => {
  it("lets a business line through in hours with a full opener, and says California needs the notice", () => {
    expect(checkCall(call)).toEqual({ allowed: true, recordingNoticeRequired: true });
    expect(checkCall({ ...call, calleeState: "TX", personState: "TX" })).toEqual({
      allowed: true,
      recordingNoticeRequired: false,
    });
  });

  it("never calls a person's mobile or home line, or a number whose state is unknown", () => {
    expect(checkCall({ ...call, lineType: "mobile" })).toMatchObject({
      allowed: false,
      reasons: ["not a business line"],
    });
    expect(checkCall({ ...call, lineType: "residential" }).allowed).toBe(false);
    expect(checkCall({ ...call, calleeState: null })).toMatchObject({
      reasons: ["the number's state is unknown"],
    });
  });

  it("never calls into, or for someone in, a state that bars AI calls", () => {
    for (const state of ["IN", "LA", "MN", "MT", "NE"]) {
      expect(checkCall({ ...call, calleeState: state }).allowed, state).toBe(false);
      expect(checkCall({ ...call, personState: state }).allowed, state).toBe(false);
    }
  });

  it("calls only 9am to 8pm where the company is", () => {
    // 16:59 UTC is 8:59am in Los Angeles; 04:00 UTC the next day is 8pm.
    expect(checkCall({ ...call, now: new Date("2026-11-06T16:59:00Z") })).toMatchObject({
      reasons: ["outside 9am-8pm where the company is"],
    });
    expect(checkCall({ ...call, now: new Date("2026-11-06T17:00:00Z") }).allowed).toBe(true);
    expect(checkCall({ ...call, now: new Date("2026-11-07T03:59:00Z") }).allowed).toBe(true);
    expect(checkCall({ ...call, now: new Date("2026-11-07T04:00:00Z") }).allowed).toBe(false);
    expect(checkCall({ ...call, calleeTimeZone: "Not/AZone" })).toMatchObject({
      reasons: ["the company's time zone is unknown"],
    });
  });

  it("needs the opener to say AI assistant, the account holder's name, written permission and recording", () => {
    expect(checkCall({ ...call, opener: "Hi, this is Jane calling for Alex Doe." })).toMatchObject({
      allowed: false,
      reasons: [
        "the opener doesn't say it's an AI assistant",
        "the opener doesn't mention written permission",
        "the opener doesn't say the call is recorded",
      ],
    });
    expect(checkCall({ ...call, personName: "Sam Roe" })).toMatchObject({
      reasons: ["the opener doesn't name the account holder"],
    });
  });

  it("guards a path that doesn't exist yet: calls are simulated or off today", () => {
    expect(["simulated", "off"]).toContain(callMode("user_real"));
  });
});
