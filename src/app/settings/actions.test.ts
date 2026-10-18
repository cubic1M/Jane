import { beforeEach, describe, expect, it, vi } from "vitest";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { update } } }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));

import { DEFAULT_ALERT_DELIVERY } from "@/config/alerts";
import { saveAlertPreferences, saveEmailPreferences } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("saveEmailPreferences", () => {
  beforeEach(() => update.mockReset());

  it("saves the signed-in person's digest choice and timezone", async () => {
    expect(await saveEmailPreferences(null, form({ timezone: "America/New_York" }))).toEqual({
      ok: true,
      message: "Saved.",
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { digestEnabled: false, timezone: "America/New_York" },
    });

    await saveEmailPreferences(null, form({ timezone: "UTC", digest: "on" }));
    expect(update).toHaveBeenLastCalledWith({
      where: { id: "u1" },
      data: { digestEnabled: true, timezone: "UTC" },
    });
  });

  it("only accepts timezones from the list", async () => {
    expect(await saveEmailPreferences(null, form({ timezone: "Mars/Olympus" }))).toMatchObject({
      ok: false,
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("saveAlertPreferences", () => {
  beforeEach(() => update.mockReset());

  it("saves a choice for every alert type, falling back to defaults", async () => {
    expect(
      await saveAlertPreferences(
        null,
        form({
          large_charge: "off",
          fee_charged: "email",
          low_balance: "app",
          price_increase: "x",
        }),
      ),
    ).toEqual({ ok: true, message: "Saved." });

    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        alertPrefs: {
          ...DEFAULT_ALERT_DELIVERY,
          large_charge: "off",
          // Only urgent alerts can be emailed right away.
          fee_charged: "app",
          low_balance: "app",
        },
      },
    });
  });
});
