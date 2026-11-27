import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import type { ReadResult } from "../types";
import type { CanopyPull } from "./api";
import { policiesFromPull } from "./normalize";

// Saves a pull's policies as the person's cover (source "canopy"), so the renewal reshop, the
// checkup and the gaps read them. Canopy's own rows are updated in place on a new pull, so a higher
// premium at renewal reads as a price rise. A policy the person already has from somewhere else
// (typed, a document, found from payments) is left as it is, never doubled.

const sameName = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function savePull(
  userId: string,
  pull: CanopyPull,
  { client }: { client: PrismaClient },
): Promise<ReadResult> {
  const db = scopedFor(userId, client);
  const have = await db.insurancePolicies.findMany({
    where: { status: { in: ["active", "found", "pending"] } },
    select: { id: true, kind: true, carrier: true, source: true },
  });
  let saved = 0;
  const seen = new Set<string>();
  for (const policy of policiesFromPull(pull)) {
    const same = have.filter((h) => h.kind === policy.kind && sameName(h.carrier, policy.carrier));
    if (same.some((h) => h.source !== "canopy")) {
      for (const h of same) seen.add(h.id);
      continue;
    }
    const data = {
      kind: policy.kind,
      carrier: policy.carrier,
      premiumCents: policy.premiumCents,
      premiumFrequency: policy.premiumFrequency,
      termMonths: policy.termMonths,
      deductibleCents: policy.deductibleCents,
      coverage: policy.coverage,
      renewalDate: policy.renewalDate ? new Date(`${policy.renewalDate}T00:00:00Z`) : null,
    };
    const mine = same.find((h) => h.source === "canopy");
    if (mine) {
      await db.insurancePolicies.updateMany({ where: { id: mine.id }, data });
      seen.add(mine.id);
    } else {
      await db.insurancePolicies.create({
        data: { ...data, userId, source: "canopy", status: "active" },
      });
    }
    saved += 1;
  }
  // A policy an earlier pull saved for this insurer that this one no longer reports in force
  // (lapsed, cancelled, replaced) stops counting as cover. Other sources' rows are never touched.
  const insurer = pull.insurance_provider_friendly_name;
  if (insurer) {
    const gone = have.filter(
      (h) => h.source === "canopy" && sameName(h.carrier, insurer) && !seen.has(h.id),
    );
    if (gone.length > 0) {
      await db.insurancePolicies.updateMany({
        where: { id: { in: gone.map((h) => h.id) }, source: "canopy" },
        data: { status: "cancelled" },
      });
    }
  }
  return {
    saved,
    note:
      saved === 0
        ? "No new policies: the ones Canopy found are already in your insurance."
        : `${saved} ${saved === 1 ? "policy" : "policies"} from ${pull.insurance_provider_friendly_name ?? "your insurer"} added to your insurance.`,
  };
}
