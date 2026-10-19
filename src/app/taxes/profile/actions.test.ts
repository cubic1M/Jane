import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/tax-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-profile")>()),
  saveTaxAnswers: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { TaxProfileError, saveTaxAnswers } from "@/lib/tax-profile";
import { saveTaxProfile } from "./actions";
import { answersFrom } from "./answers";

// Spec step 118: the tax profile page saves only what was filled in.

const form = (fields: [string, string][]) => {
  const data = new FormData();
  for (const [k, v] of fields) data.append(k, v);
  return data;
};

describe("the tax profile form", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads every field that was filled in", () => {
    expect(
      answersFrom(
        form([
          ["incomeKinds", "investment"],
          ["incomeKinds", "w2"],
          ["filingStatus", "head_of_household"],
          ["childrenUnder17", "2"],
          ["otherDependants", ""],
          ["state", "WA"],
        ]),
      ),
    ).toEqual([
      { field: "incomeKinds", value: ["w2", "investment"] },
      { field: "filingStatus", value: "head_of_household" },
      { field: "dependants", childrenUnder17: 2, otherDependants: 0 },
      { field: "state", value: "WA" },
    ]);
  });

  it("leaves empty fields unanswered, and None of these means no income", () => {
    expect(answersFrom(form([]))).toEqual([]);
    expect(answersFrom(form([["noIncome", "1"]]))).toEqual([{ field: "incomeKinds", value: [] }]);
  });

  it("refuses a filing status or number that isn't one", () => {
    expect(() => answersFrom(form([["filingStatus", "widow"]]))).toThrow(TaxProfileError);
    expect(answersFrom(form([["childrenUnder17", "two"]]))).toEqual([
      { field: "dependants", childrenUnder17: NaN, otherDependants: 0 },
    ]);
  });

  it("saves for the signed-in person and says so", async () => {
    expect(await saveTaxProfile(null, form([["state", "WA"]]))).toEqual({
      ok: true,
      message: "Saved. I'll use these for your taxes.",
    });
    expect(saveTaxAnswers).toHaveBeenCalledWith("u1", [{ field: "state", value: "WA" }], {
      via: "page",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/taxes");
  });

  it("says what's wrong instead of saving", async () => {
    expect(await saveTaxProfile(null, form([]))).toEqual({
      ok: false,
      message: "Fill in at least one answer.",
    });
    vi.mocked(saveTaxAnswers).mockRejectedValueOnce(
      new TaxProfileError("Pick a state from the list."),
    );
    expect(await saveTaxProfile(null, form([["state", "ZZ"]]))).toEqual({
      ok: false,
      message: "Pick a state from the list.",
    });
  });
});
