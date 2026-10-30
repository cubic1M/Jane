import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PERSON_IDS } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { CONTROLLER_DETECTORS } from "./controller";

// Phase AP (spec steps 238–244): Jane running the money, brought to the person unasked.
const detector = (topic: string) => CONTROLLER_DETECTORS.find((d) => d.topic === topic)!;
const run = (topic: string, data: ProfileInput) =>
  detector(topic).detect({ profile: buildProfile(data), data });
const withBooks = (id: string, books: NonNullable<ProfileInput["extras"]>["books"]) => {
  const data = inputFor(id);
  return { ...data, extras: { householdMembers: 0, ...data.extras, books } };
};

describe("books that balance (step 238)", () => {
  it("brings the Reyes family's twice-linked savings, with the balance at stake", () => {
    const data = inputFor("family");
    const s = run("data_problems", data);
    const savings = data.accounts.find((a) => a.id === "demo-seedfamily-savings")!;
    expect(savings).toBeDefined();
    expect(s?.worthCents).toBe(Math.abs(savings.balanceCents));
    expect(s?.worthKind).toBe("risk");
    expect(s?.urgency).toBe("soon");
    expect(s?.why).toMatch(/linked twice/);
    expect(s?.confidence.percent).toBeGreaterThanOrEqual(50);
    expect(s?.confidence.reason).toMatch(/data problem/);
    expect(s?.action.href).toBe("/net-worth");
  });

  it("finds nothing for people whose data adds up", () => {
    for (const id of PERSON_IDS.filter((p) => p !== "family")) {
      expect(run("data_problems", inputFor(id)), id).toBeNull();
    }
  });

  it("asks at once about a link that needs a sign-in", () => {
    const s = run(
      "data_problems",
      withBooks("renter", [
        { kind: "broken", words: "Chase needs you to sign in again.", accountId: null },
      ]),
    );
    expect(s?.urgency).toBe("now");
    expect(s?.worthCents).toBe(0);
    expect(s?.headline).toBe("Check your accounts: something doesn't add up");
  });

  it("doesn't count a transfer with no other side as a problem", () => {
    expect(
      run(
        "data_problems",
        withBooks("renter", [{ kind: "transfer", words: "A $600 transfer out.", accountId: null }]),
      ),
    ).toBeNull();
  });

  it("is quiet when the books check wasn't loaded", () => {
    const data = inputFor("family");
    expect(run("data_problems", { ...data, extras: undefined })).toBeNull();
  });
});

describe("the monthly close (step 244)", () => {
  it("asks Sam to confirm WeWork and Adobe so September can close", () => {
    const s = run("month_close", inputFor("freelancer"));
    expect(s?.title).toBe("Confirm 2 charges so September 2026 can close");
    expect(s?.short).toMatch(/^Wework \$285\.00, Adobe Creative Cloud \$59\.99/);
    expect(s?.worthCents).toBe(34_499);
    expect(s?.action.href).toBe("/monthly#close");
    // Night QA 10-30: "4 unsure charge in 3 months of data".
    expect(s?.confidence.reason).toMatch(/^2 unsure charges in /);
  });

  it("is quiet once the month is closed, and for people with nothing unsure", () => {
    const data = inputFor("freelancer");
    expect(
      run("month_close", { ...data, extras: { ...data.extras!, lastCloseStatus: "closed" } }),
    ).toBeNull();
    for (const id of PERSON_IDS.filter((p) => p !== "freelancer")) {
      expect(run("month_close", inputFor(id)), id).toBeNull();
    }
  });
});
