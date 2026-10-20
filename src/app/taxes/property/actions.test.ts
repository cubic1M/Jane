import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/property-tax", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/property-tax")>()),
  savePropertyAnswers: vi.fn(),
  draftPropertyAppeal: vi.fn(),
  chooseFiler: vi.fn(),
  remindAppealWindow: vi.fn(async () => "2026-11-30"),
  remindExemption: vi.fn(async () => ({ name: "Homeowners' Exemption" })),
  markClaimed: vi.fn(),
}));

import {
  PropertyTaxError,
  chooseFiler,
  draftPropertyAppeal,
  markClaimed,
  remindAppealWindow,
  remindExemption,
  savePropertyAnswers,
} from "@/lib/property-tax";
import { propertyAction } from "./actions";

// Spec step 221: what's told about the home, the drafted appeal and who files it, the
// deadline and the exemptions.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("property tax actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves the answers in cents, drafts, hands the filing on, and sets reminders", async () => {
    expect(
      await propertyAction(
        null,
        form({
          intent: "answers",
          market: "500,000",
          assessed: "560000.50",
          assessedYear: "2026",
          noticeOn: "2026-08-10",
          age: "67",
          veteran: "yes",
          disabled: "",
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(savePropertyAnswers).toHaveBeenCalledWith(
      "u1",
      {
        marketCents: 50_000_000,
        assessedCents: 56_000_050,
        assessedYear: 2026,
        noticeOn: "2026-08-10",
        age: 67,
        veteran: true,
        disabled: null,
      },
      { via: "page" },
    );
    expect(await propertyAction(null, form({ intent: "draft" }))).toMatchObject({ ok: true });
    expect(draftPropertyAppeal).toHaveBeenCalledWith("u1", { via: "page" });
    expect(await propertyAction(null, form({ intent: "team" }))).toEqual({
      ok: true,
      message: "My team has it to file.",
    });
    expect(chooseFiler).toHaveBeenCalledWith("u1", "team");
    await propertyAction(null, form({ intent: "you" }));
    expect(chooseFiler).toHaveBeenLastCalledWith("u1", "you");
    expect(await propertyAction(null, form({ intent: "remind" }))).toEqual({
      ok: true,
      message: "The appeal deadline, 2026-11-30, is on your plan.",
    });
    expect(remindAppealWindow).toHaveBeenCalledWith("u1", { via: "page" });
    await propertyAction(null, form({ intent: "exemption_remind", key: "ca_homeowners" }));
    expect(remindExemption).toHaveBeenCalledWith("u1", "ca_homeowners");
    await propertyAction(null, form({ intent: "exemption_claimed", key: "ca_homeowners" }));
    expect(markClaimed).toHaveBeenCalledWith("u1", ["ca_homeowners"]);
  });

  it("says what's wrong", async () => {
    expect(await propertyAction(null, form({ intent: "answers", market: "lots" }))).toEqual({
      ok: false,
      message: "Values must be dollars and cents.",
    });
    expect(await propertyAction(null, form({ intent: "answers", age: "six" }))).toEqual({
      ok: false,
      message: "Give whole numbers for ages and years.",
    });
    vi.mocked(draftPropertyAppeal).mockRejectedValueOnce(
      new PropertyTaxError("An appeal is already drafted."),
    );
    expect(await propertyAction(null, form({ intent: "draft" }))).toEqual({
      ok: false,
      message: "An appeal is already drafted.",
    });
    expect(await propertyAction(null, form({ intent: "nope" }))).toMatchObject({ ok: false });
  });
});
