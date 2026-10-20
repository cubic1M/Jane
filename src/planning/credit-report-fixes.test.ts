import { describe, expect, it } from "vitest";
import {
  BUREAU_INVESTIGATION_DAYS,
  CREDIT_RULES,
  VALIDATION_WINDOW_DAYS,
} from "@/config/credit-report-fixes";
import type { ReportItem } from "@/lib/credit/partner";
import { addDays, fixItems } from "./credit-report-fixes";

const collection: ReportItem = {
  id: "c1",
  kind: "collection",
  creditor: "Northstar Recovery",
  originalCreditor: "CareFirst Medical Group",
  amountCents: 74_200,
  firstSeenOn: "2026-10-07",
  detail: "A medical collection for $742.00.",
  medical: true,
};
const error: ReportItem = {
  id: "e1",
  kind: "error",
  creditor: "Demo Credit Card",
  originalCreditor: null,
  amountCents: null,
  firstSeenOn: "2026-09-09",
  detail: "Shows a payment 30 days late that was on time.",
  medical: false,
};

describe("the letters for a collection", () => {
  const [validation, dispute] = fixItems(collection, "Sam Rivera");

  it("writes a validation letter citing the Fair Debt Collection Practices Act and its 30 days", () => {
    expect(validation.kind).toBe("validation");
    expect(validation.body).toContain(CREDIT_RULES.validation.text);
    expect(validation.body).toContain("section 809(b) of the Fair Debt Collection Practices Act");
    expect(validation.windowEndsOn).toBe(addDays("2026-10-07", VALIDATION_WINDOW_DAYS));
    expect(validation.windowEndsOn).toBe("2026-11-06");
    expect(validation.body).toContain("Nov 6, 2026");
    expect(validation.body).toContain("$742.00");
    expect(validation.body).toContain("CareFirst Medical Group");
    expect(validation.body.endsWith("Sincerely,\nSam Rivera")).toBe(true);
    expect(validation.answerByIfSentOn("2026-10-19")).toBe("2026-11-18");
  });

  it("writes a bureau dispute citing the Fair Credit Reporting Act and its 30 days", () => {
    expect(dispute.kind).toBe("dispute");
    expect(dispute.body).toContain(CREDIT_RULES.dispute.text);
    expect(dispute.body).toContain("section 611 of the Fair Credit Reporting Act");
    expect(dispute.body).toContain("Equifax, Experian and TransUnion");
    expect(dispute.windowEndsOn).toBeNull();
    expect(dispute.answerByIfSentOn("2026-10-19")).toBe(
      addDays("2026-10-19", BUREAU_INVESTIGATION_DAYS),
    );
  });
});

describe("the letters for an error", () => {
  it("is a dispute only, saying what's wrong, with a placeholder when the name isn't known", () => {
    const letters = fixItems(error, "");
    expect(letters.map((l) => l.kind)).toEqual(["dispute"]);
    expect(letters[0].body).toContain(
      "Why it's wrong: Shows a payment 30 days late that was on time.",
    );
    expect(letters[0].body.endsWith("Sincerely,\n[Your name]")).toBe(true);
  });
});

describe("dates", () => {
  it("adds days across months and years", () => {
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
    expect(addDays("2026-02-01", 30)).toBe("2026-03-03");
  });
});
