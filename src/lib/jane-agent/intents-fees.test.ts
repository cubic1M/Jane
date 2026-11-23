import { describe, expect, it } from "vitest";
import { dayAsked, parseIntent } from "./intents";

// Fees and charges asked of the backup chat (walk notes, phone passes 5 to 7 and desktop sweeps 7
// to 9): "why did I get charged $34?", "what fees have I paid?", "can I get my bank fee waived?" all
// read as nothing and got "I can't answer that one yet".

const AS_OF = "2026-11-20";

describe("asking about a charge or a fee", () => {
  it.each([
    ["Why did I get charged $34?", 3_400, null],
    ["Why was I charged $35 on Oct 28?", 3_500, "2026-10-28"],
    ["why do I pay $12 every month?", 1_200, null],
    ["what's this $20.00 charge", 2_000, null],
    ["why was I charged $1,240.50 on 9/3", 124_050, "2026-09-03"],
  ])("reads %s as a charge of its amount", (q, amountCents, day) => {
    expect(parseIntent(q, AS_OF)).toEqual({ kind: "charge_amount", amountCents, day });
  });

  it.each([
    ["What fees have I paid?", false],
    ["how much have I paid in bank fees", false],
    ["How much did I pay in late fees?", true],
  ])("reads %s as the fees paid", (q, late) => {
    expect(parseIntent(q, AS_OF)).toEqual({ kind: "fees_paid", late });
  });

  it.each(["Can I get my bank fee waived?", "how do I get the monthly fee waived", "waive my fee"])(
    "reads %s as the waiver",
    (q) => {
      expect(parseIntent(q, AS_OF)).toEqual({ kind: "fee_waiver" });
    },
  );

  it("leaves why fees are charged at a bank to its own answer", () => {
    expect(parseIntent("Why am I paying fees at Bank of America?", AS_OF)).toEqual({
      kind: "fee_why",
      amountCents: null,
      named: null,
    });
  });

  it("reads a day in the past year", () => {
    expect(dayAsked("on Dec 28", AS_OF)).toBe("2025-12-28");
    expect(dayAsked("on oct 28th", AS_OF)).toBe("2026-10-28");
    expect(dayAsked("on 13/40", AS_OF)).toBeNull();
    expect(dayAsked("why $35", AS_OF)).toBeNull();
  });
});
