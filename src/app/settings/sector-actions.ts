"use server";

import { revalidatePath } from "next/cache";
import { SECTOR_LABELS, type Sector } from "@/config/autopilot-sectors";
import { parseMoneyToCents } from "@/lib/money";
import { SectorAutopilotError, setSectorAutopilot } from "@/lib/sector-autopilot";
import { requireUser } from "@/lib/session";

// One autopilot, every sector (spec step 141): a sector's level and caps from Settings.

export type SectorState = { ok: boolean; message: string } | null;

const dollars = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const cents = parseMoneyToCents(text);
  return cents === null ? Number.NaN : cents;
};

export async function saveSector(_previous: SectorState, formData: FormData): Promise<SectorState> {
  const user = await requireUser();
  const sector = String(formData.get("sector") ?? "");
  try {
    const saved = await setSectorAutopilot(user.id, sector, {
      level: String(formData.get("level") ?? "") as never,
      actionCapCents: dollars(formData.get("actionCap")),
      monthlyCapCents: dollars(formData.get("monthlyCap")),
    });
    revalidatePath("/settings");
    return {
      ok: true,
      message: `Saved. ${SECTOR_LABELS[saved.sector as Sector]} is updated, from now on.`,
    };
  } catch (error) {
    if (error instanceof SectorAutopilotError) return { ok: false, message: error.message };
    throw error;
  }
}
