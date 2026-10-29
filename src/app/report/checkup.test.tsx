import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CheckLine } from "@/detection/checkup";
import { Checkup, checkupSummary } from "./checkup";

const LINES: CheckLine[] = [
  {
    type: "bank_fees",
    label: "Bank fees",
    status: "found",
    line: "1 found",
    detail: "$34.00 in fees.",
  },
  {
    type: "card_interest",
    label: "Card interest",
    status: "passed",
    line: "None in 6 months",
    detail: "Jane checked 1 card for interest charges.",
  },
  {
    type: "insurance_reshop",
    label: "Insurance",
    status: "not_enough_data",
    line: "Not enough data yet",
    detail: "No insurance bill in your statements yet.",
  },
];

describe("Checkup", () => {
  it("counts only the checks that passed", () => {
    expect(checkupSummary(LINES)).toBe("1 of 3 checks passed");
  });

  it("shows one line per check, its detail behind a tap", () => {
    const html = renderToStaticMarkup(<Checkup lines={LINES} />);
    expect(html.match(/<li /g)).toHaveLength(3);
    expect(html.match(/<details>/g)).toHaveLength(3);
    expect(html).toContain('data-check="not_enough_data"');
    expect(html).toContain("Passed:</span>");
    expect(html).toMatch(/<summary[^>]*>.*Card interest.*None in 6 months.*<\/summary>/);
  });

  it("shows nothing when no check ran", () => {
    expect(renderToStaticMarkup(<Checkup lines={[]} />)).toBe("");
  });
});
