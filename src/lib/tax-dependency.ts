import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listFacts, toldFromFacts } from "@/lib/memory/facts";
import { PROFILE_FACT_PREFIX } from "@/lib/profile";

// What the person told Jane about whether someone else can claim them as a dependent
// ("claimed_as_dependent"), read the way the profile reads it (a correction made on the profile or by
// the question card wins over what Jane remembers from the chat). The estimate's standard deduction
// is limited for a dependent (standardDeductionFor in src/planning/tax-estimate.ts). "unsure" and not
// said both read as null: unknown.

export async function loadToldDependency(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<boolean | null> {
  const pref = await scopedFor(userId, client).janePreferences.findFirst({
    where: { kind: "fact", key: `${PROFILE_FACT_PREFIX}claimed_as_dependent` },
    select: { value: true },
  });
  const said = (pref?.value as { value?: unknown } | null)?.value;
  const value =
    typeof said === "string"
      ? said
      : toldFromFacts(await listFacts(userId, { client })).claimed_as_dependent;
  return value === "yes" ? true : value === "no" ? false : null;
}
