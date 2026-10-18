import { beforeEach, describe, expect, it, vi } from "vitest";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { update } } }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));

import { saveEmailPreferences } from "./actions";

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
