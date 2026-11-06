import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// Insurance referral partners by how they pay (connectors roadmap round 14), against a real,
// migrated Postgres, with counsel's answer turned on in this test only: an unpaid partner is
// offered, a flat fee only in a state approved for it, per policy sold never. Wyoming and Vermont
// keep these rows apart from other tests' partners.

vi.mock("@/config/referrals", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/referrals")>();
  return {
    ...original,
    COUNSEL_INSURANCE_REFERRALS: {
      ...original.COUNSEL_INSURANCE_REFERRALS,
      approved: true,
      approvedStates: { flat_click: ["VT"] },
    },
  };
});

import { PAY_DISCLOSURES } from "@/config/referrals";
import { partnerFor } from "./referrals";

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("insurance referral partners by pay model", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID().slice(0, 8);

  const partner = (key: string, payModel: string, states: string[]) =>
    client.referralPartner.create({
      data: {
        key: `${key}-${suffix}`,
        name: `Example ${key}`,
        actionType: "insurance_reshop",
        disclosure: "Example is a licensed insurance agency.",
        referralUrl: "https://example.com/compare",
        allowedStates: states,
        payModel,
        lines: ["auto"],
        active: true,
      },
    });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    // Keys sort per-policy first, so it would win if it weren't refused.
    await partner("a-per-sale", "per_policy", ["WY", "VT"]);
    await partner("b-flat", "flat_click", ["WY", "VT"]);
    await partner("c-unpaid", "none", ["WY"]);
  });
  afterAll(async () => {
    await client.referralPartner.deleteMany({ where: { key: { endsWith: suffix } } });
    await client.$disconnect();
  });

  it("never offers a partner paid per policy sold", async () => {
    for (const state of ["WY", "VT"]) {
      expect((await partnerFor("insurance_reshop", state, { client }))?.key).not.toBe(
        `a-per-sale-${suffix}`,
      );
    }
  });

  it("offers a flat fee only where approved for it, and says how Jane is paid", async () => {
    const vt = await partnerFor("insurance_reshop", "VT", { client });
    expect(vt).toMatchObject({
      key: `b-flat-${suffix}`,
      payDisclosure: PAY_DISCLOSURES.flat_click,
    });
    const wy = await partnerFor("insurance_reshop", "WY", { client });
    expect(wy).toMatchObject({ key: `c-unpaid-${suffix}`, payDisclosure: PAY_DISCLOSURES.none });
  });
});
