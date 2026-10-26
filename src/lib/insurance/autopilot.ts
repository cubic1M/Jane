import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { mayAct, recordAct } from "@/lib/sector-autopilot";
import { acceptShop, AcceptShopError } from "./accept";
import { openShops } from "./shop";

// Insurance's autopilot (spec step 141). Only when the person set Insurance to "Everything
// allowed": Jane says yes to its own pick on its own (the switch of spec step 105, same
// cover, no gap) when its monthly premium fits the sector's caps. Anything over a cap waits
// for the person's tap, as before. Every yes is recorded against the caps.

type Options = { client?: PrismaClient; now?: Date };

export async function insuranceAutopilot(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  let switched = 0;
  for (const shop of await openShops(userId, { client, now })) {
    if (!shop.pick || shop.savingCents === null || shop.savingCents <= 0) continue;
    const monthlyCents = Math.round(shop.pick.annualPremiumCents / 12);
    const allowed = await mayAct(
      userId,
      "insurance",
      { needs: "all", cents: monthlyCents },
      { client, now },
    );
    if (!allowed.ok) continue;
    try {
      await acceptShop(userId, shop.id, { client, now, by: "autopilot" });
    } catch (error) {
      if (error instanceof AcceptShopError) continue;
      throw error;
    }
    await recordAct(
      userId,
      "insurance",
      monthlyCents,
      `Switched to ${shop.pick.carrier.name}, the same cover for about ${formatCents(monthlyCents)} a month`,
      { client, now },
    );
    switched += 1;
  }
  return switched;
}
