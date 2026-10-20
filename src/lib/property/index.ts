import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { demoPropertyPartner } from "./demo";
import type { PropertyPartner } from "./types";

// Which property data partner a person's home is looked up with (spec step 221): the
// stand-in for people whose data is all the demo bank's (the same test as demo advice
// mode); nobody else until a real partner is connected (then add it here).
export async function propertyPartnerFor(
  userId: string,
  { client }: { client?: PrismaClient } = {},
): Promise<PropertyPartner | null> {
  return (await adviceMode(userId, { client })) ? demoPropertyPartner : null;
}

export type { PropertyPartner, PropertyRecord } from "./types";
