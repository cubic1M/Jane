import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listFacts, toldFromFacts } from "@/lib/memory/facts";
import { PROFILE_FACT_PREFIX } from "@/lib/profile";
import type { FactKey } from "@/profile/facts";

// What the person told Jane as a yes or a no, read the way the profile reads it (a correction made on
// the profile or by the question card wins over what Jane remembers from the chat). "unsure" and not
// said both read as null: unknown.
export async function loadToldYesNo(
  userId: string,
  key: FactKey,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<boolean | null> {
  const pref = await scopedFor(userId, client).janePreferences.findFirst({
    where: { kind: "fact", key: `${PROFILE_FACT_PREFIX}${key}` },
    select: { value: true },
  });
  const said = (pref?.value as { value?: unknown } | null)?.value;
  const value =
    typeof said === "string" ? said : toldFromFacts(await listFacts(userId, { client }))[key];
  return value === "yes" ? true : value === "no" ? false : null;
}

// Whether someone else can claim them as a dependent ("claimed_as_dependent"). The estimate's standard
// deduction is limited for a dependent (standardDeductionFor in src/planning/tax-estimate.ts).
export const loadToldDependency = (
  userId: string,
  options: { client?: PrismaClient } = {},
): Promise<boolean | null> => loadToldYesNo(userId, "claimed_as_dependent", options);

// Whether their spouse itemizes ("spouse_itemizes"), asked of a person who files married filing
// separately: the standard deduction is then zero for both (26 USC 63(c)(6)(A)).
export const loadToldSpouseItemizes = (
  userId: string,
  options: { client?: PrismaClient } = {},
): Promise<boolean | null> => loadToldYesNo(userId, "spouse_itemizes", options);
