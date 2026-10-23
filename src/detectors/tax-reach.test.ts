import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { TOOL_EXEMPT } from "@/config/detector-exempt";
import { TAX_TOPIC_MONTH } from "@/config/tax-calendar";
import { CAPABILITIES } from "@/lib/jane-agent/capabilities";
import { DETECTORS } from "./index";
import { TAX_REACH_NEEDS_PERSON, taxReach, yearOfDates } from "./tax-reach";

// Spec step 273: every tax capability has a detector or a reasoned exemption, and the reach
// scoreboard shows each tax tool reaching the right sample people through the year.

const tools = CAPABILITIES.find((c) => c.id === "taxes")!.tools;
const reach = taxReach(tools);
const of = (tool: string) => reach.find((r) => r.tool === tool)!;
const who = (tool: string) =>
  of(tool)
    .reached.map((r) => r.person)
    .sort();

describe("the tax reach scoreboard", () => {
  it("walks the sample year month by month", () => {
    expect(yearOfDates("2026-10-17")).toEqual([
      "2026-10-17",
      "2026-11-17",
      "2026-12-17",
      "2027-01-17",
      "2027-02-17",
      "2027-03-17",
      "2027-04-17",
      "2027-05-17",
      "2027-06-17",
      "2027-07-17",
      "2027-08-17",
      "2027-09-17",
    ]);
  });

  it("has every tax tool reach a sample person, or say why it can't", () => {
    for (const t of reach) {
      const why = t.exempt ?? t.needsPerson;
      expect(
        t.reached.length > 0 || Boolean(why),
        `${t.tool} reaches no one and says nothing`,
      ).toBe(true);
      // A tool with a detector isn't exempt: it reaches someone, or needs the person first.
      if (t.detectors.length > 0 && !t.needsPerson)
        expect(t.reached.length, `${t.tool} has a detector but reaches no one`).toBeGreaterThan(0);
    }
    for (const tool of Object.keys(TAX_REACH_NEEDS_PERSON)) expect(tools).toContain(tool);
    for (const t of reach.filter((r) => r.exempt)) expect(TOOL_EXEMPT[t.tool]).toBeTruthy();
  });

  it("reaches the right people with this round's tax tools", () => {
    expect(who("tax_health")).toEqual(["equity", "freelancer", "retiree"]);
    expect(who("tax_disaster")).toEqual(["family"]);
    expect(who("tax_retirement")).toEqual(["preretire", "retiree"]);
    expect(who("tax_business")).toEqual(["freelancer", "owner"]);
    expect(who("tax_inherited")).toEqual(["preretire"]);
    // Seasonal: the IP PIN only from January to April.
    const pin = of("tax_identity").reached[0];
    expect(pin.months.every((m) => ["Jan", "Feb", "Mar", "Apr"].includes(m))).toBe(true);
  });

  it("puts every tax detector on the calendar", () => {
    for (const d of DETECTORS.filter((x) => x.capability === "taxes"))
      expect(TAX_TOPIC_MONTH[d.topic], d.topic).toBeGreaterThanOrEqual(1);
  });
});
