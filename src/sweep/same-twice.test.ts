import { describe, expect, it } from "vitest";
import { sameTwice } from "./same-twice";

// Two copies of one person read the same (./same-twice.ts).

const ID_A = "cmwdqhog000046u08dpxjaj33";
const ID_B = "cmwdqhog000836u08gohthbgf";

describe("one person made twice", () => {
  it("reads the same when only their ids differ", () => {
    expect(
      sameTwice(
        {
          [`detected.bank_fees:account:${ID_A}.title`]: "$130.00 in fees",
          user: "a-1@example.test",
        },
        {
          [`detected.bank_fees:account:${ID_B}.title`]: "$130.00 in fees",
          user: "a-2@example.test",
        },
      ),
    ).toEqual([]);
  });

  it("keeps two findings that differ only by their ids apart, in either order", () => {
    const one = {
      [`detected.bank_fees:account:${ID_A}.title`]: "$130.00 in fees on the card",
      [`detected.bank_fees:account:${ID_B}.title`]: "$270.00 in fees on checking",
    };
    const two = {
      [`detected.bank_fees:account:${ID_B}.title`]: "$270.00 in fees on checking",
      [`detected.bank_fees:account:${ID_A}.title`]: "$130.00 in fees on the card",
    };
    expect(sameTwice(one, two)).toEqual([]);
  });

  it("says what moved when a list comes back in another order (#2165's fee card)", () => {
    expect(
      sameTwice(
        { "watch.funds.0.ticker": "NSTDX", "watch.funds.1.ticker": "SLGFX" },
        { "watch.funds.0.ticker": "SLGFX", "watch.funds.1.ticker": "NSTDX" },
      ),
    ).toEqual([
      "first: watch.funds.0.ticker = NSTDX",
      "first: watch.funds.1.ticker = SLGFX",
      "second: watch.funds.0.ticker = SLGFX",
      "second: watch.funds.1.ticker = NSTDX",
    ]);
  });

  it("says what one shows and the other doesn't", () => {
    expect(sameTwice({ a: 1, b: "x" }, { a: 1 })).toEqual(["first: b = x"]);
  });
});
