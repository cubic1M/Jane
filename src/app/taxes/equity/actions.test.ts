import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/equity-tax", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/equity-tax")>()),
  addEquityEvent: vi.fn(),
  removeEquityEvent: vi.fn(),
  startSetAside: vi.fn(),
}));

import { EquityTaxError, addEquityEvent, removeEquityEvent, startSetAside } from "@/lib/equity-tax";
import { equityAction } from "./actions";

// Spec step 219: adding and removing an equity event, and the set-aside goal.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("equity actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds an event from dollars and dates, removes one, and starts the goal", async () => {
    expect(
      await equityAction(
        null,
        form({
          intent: "add",
          kind: "espp",
          company: "Acme",
          shares: "200",
          occurredOn: "2025-03-01",
          fmv: "100.00",
          price: "85",
          soldOn: "2026-06-01",
          soldPrice: "120",
        }),
      ),
    ).toEqual({ ok: true, message: "Added. Your estimate uses it now." });
    expect(addEquityEvent).toHaveBeenCalledWith(
      "u1",
      {
        kind: "espp",
        company: "Acme",
        shares: 200,
        occurredOn: "2025-03-01",
        grantedOn: null,
        priceCents: 8_500,
        fmvCents: 10_000,
        withheldCents: null,
        soldOn: "2026-06-01",
        soldPriceCents: 12_000,
        grantDiscountCents: null,
      },
      { via: "page" },
    );
    expect(await equityAction(null, form({ intent: "remove", id: "e1" }))).toMatchObject({
      ok: true,
    });
    expect(removeEquityEvent).toHaveBeenCalledWith("u1", "e1");
    expect(await equityAction(null, form({ intent: "aside" }))).toMatchObject({ ok: true });
    expect(startSetAside).toHaveBeenCalledWith("u1", { via: "page" });
  });

  it("says what's wrong", async () => {
    expect(
      await equityAction(
        null,
        form({
          intent: "add",
          kind: "rsu",
          company: "A",
          shares: "1",
          occurredOn: "2026-01-01",
          fmv: "lots",
        }),
      ),
    ).toEqual({
      ok: false,
      message: "Prices must be dollars and cents.",
    });
    vi.mocked(addEquityEvent).mockRejectedValueOnce(new EquityTaxError("Pick RSUs, ESPP or ISOs."));
    expect(await equityAction(null, form({ intent: "add", kind: "x" }))).toEqual({
      ok: false,
      message: "Pick RSUs, ESPP or ISOs.",
    });
    expect(await equityAction(null, form({ intent: "nope" }))).toMatchObject({ ok: false });
  });
});
