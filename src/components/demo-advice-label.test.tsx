import { describe, expect, it } from "vitest";
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { DemoAdviceLabel } from "./demo-advice-label";

// Spec step 98: every piece of demo advice carries the same words.
describe("DemoAdviceLabel", () => {
  it("says it's sample data, not financial advice", () => {
    expect(DEMO_ADVICE_LABEL).toBe("Demo advice: sample data, not financial advice");
    const label = DemoAdviceLabel({});
    expect(label.props).toMatchObject({ role: "note", children: DEMO_ADVICE_LABEL });
  });
});
