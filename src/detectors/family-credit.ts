import { FILE_START } from "@/config/family-credit";
import { formatCents } from "@/lib/money";
import { authorizedUser, fileStartSavingCents } from "@/planning/family-credit";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, weakest } from "./helpers";

// Detectors for helping family with credit (spec step 249): starting a child's file through a
// low-use card, and the exposure from a loan co-signed for someone. Pure; see ./contract.ts.

// A parent with a card used well under its limit, who hasn't recorded adding their child.
const authorizedUserIdea: Detector = {
  capability: "debt",
  topic: "family_credit",
  covers: ["family_credit"],
  needs: ["has_children"],
  detect({ profile, data }) {
    const kids = profile.facts.has_children;
    if (kids.value !== true || (data.familyCredit?.helped ?? 0) > 0) return null;
    const cards = data.accounts
      .filter((a) => a.type === "credit" && a.limitCents)
      .map((a) => ({
        a,
        au: authorizedUser({
          balanceCents: Math.max(0, a.balanceCents),
          limitCents: a.limitCents ?? null,
        }),
      }))
      .filter((c) => c.au.safe)
      .sort((x, y) => (x.au.utilisation ?? 1) - (y.au.utilisation ?? 1));
    if (cards.length === 0) return null;
    const best = cards[0];
    const worth = fileStartSavingCents();
    return {
      id: suggestionId("debt", "family_credit"),
      capability: "debt",
      topic: "family_credit",
      title: "Start your child's credit by adding them to a low-use card",
      worthCents: worth,
      worthKind: "earns",
      confidence: weakest([
        factEvidence(kids),
        evidence("seen", profile.months, cards.length, "cards used under 30%"),
        {
          percent: 55,
          reason: "I can't tell how old your child is or whether a loan is coming",
        },
      ]),
      urgency: "later",
      why: `One of your cards is only ${Math.round((best.au.utilisation ?? 0) * 100)}% used and you have children. Adding one as an authorized user gives them its on-time history, which can save about ${formatCents(worth)} on a first loan later (${FILE_START.note}). Its late payments would show on their report too.`,
      action: { label: "See how it works", href: "/loans/helping" },
    };
  },
};

// A loan the person co-signed for someone, which is theirs in full if the other misses.
const cosignRisk: Detector = {
  capability: "debt",
  topic: "cosign_risk",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const f = data.familyCredit;
    if (!f || f.cosignedOwedCents <= 0) return null;
    return {
      id: suggestionId("debt", "cosign_risk"),
      capability: "debt",
      topic: "cosign_risk",
      title:
        f.cosignedMissed > 0
          ? "A loan you co-signed has a missed payment"
          : "A loan you co-signed is yours too",
      worthCents: f.cosignedOwedCents,
      worthKind: "risk",
      confidence: evidence("told", profile.months, 1, "co-signed loans"),
      urgency: f.cosignedMissed > 0 ? "now" : "later",
      why:
        f.cosignedMissed > 0
          ? `You told me a payment was missed on a loan you co-signed. It's on your credit report too, and ${formatCents(f.cosignedOwedCents)} is still owed. Paying it keeps your credit clean.`
          : `You co-signed ${formatCents(f.cosignedOwedCents)} for someone. If payments aren't made, you owe it and your credit takes the hit.`,
      action: { label: "See what it means for you", href: "/loans/helping" },
    };
  },
};

export const FAMILY_CREDIT_DETECTORS: readonly Detector[] = [authorizedUserIdea, cosignRisk];
