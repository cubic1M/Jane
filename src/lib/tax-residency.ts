import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listFacts, toldFromFacts } from "@/lib/memory/facts";
import { PROFILE_FACT_PREFIX } from "@/lib/profile";
import { residencyKind, type ResidencyKind } from "@/planning/tax-engine/residency-gate";

// What the person told Jane about their status for US tax ("tax_residency"), read the way the
// profile reads it (src/lib/profile.ts: a correction made on the profile or by the question card
// wins over what Jane remembers from the chat), without building the whole profile. The Taxes
// pages, the estimate and the chat read it to hold back credits that are for residents only
// (src/planning/tax-engine/residency-gate.ts).

export type ToldResidency = { kind: ResidencyKind; allowed: boolean };

export async function loadToldResidency(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<ToldResidency> {
  const pref = await scopedFor(userId, client).janePreferences.findFirst({
    where: { kind: "fact", key: `${PROFILE_FACT_PREFIX}tax_residency` },
    select: { value: true },
  });
  const said = (pref?.value as { value?: unknown } | null)?.value;
  const value =
    typeof said === "string"
      ? said
      : toldFromFacts(await listFacts(userId, { client })).tax_residency;
  return { kind: residencyKind(value), allowed: value === "citizen" };
}
