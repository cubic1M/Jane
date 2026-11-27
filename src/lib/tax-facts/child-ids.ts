import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { PersonTx } from "@/lib/db-scoped";
import { withChildIds } from "@/planning/family-taxes";

// A child's id on the family form (tax roadmap 1.3, step T9): written once into the form's own JSON
// (tax_profiles.family_children), never changed, so the household record keys a member by who the
// child is and not by their place in the list.

export const newChildId = () => `c_${randomBytes(6).toString("hex")}`;

const TRIES = 3;

// The person's stored children with an id on each, writing the ids back to the row in the same
// transaction. The write only lands on the JSON that was read, so a family form saved a moment
// earlier is never overwritten with older children: it is read again. Returns the children as
// stored afterwards (null when the person has no tax profile row).
export async function ensureChildIds(
  tx: PersonTx,
  userId: string,
  make: () => string = newChildId,
): Promise<unknown> {
  let stored: unknown = null;
  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    const row = await tx.taxProfile.findFirst({
      where: { userId },
      select: { id: true, familyChildren: true },
    });
    if (!row) return null;
    stored = row.familyChildren;
    const { children, changed } = withChildIds(row.familyChildren, make);
    if (!changed) return stored;
    const { count } = await tx.taxProfile.updateMany({
      where: {
        id: row.id,
        userId,
        familyChildren: { equals: row.familyChildren as Prisma.InputJsonValue },
      },
      data: { familyChildren: children as Prisma.InputJsonValue },
    });
    if (count === 1) return children;
  }
  return stored;
}
