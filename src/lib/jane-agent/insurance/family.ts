import type { PrismaClient } from "@/generated/prisma/client";
import { POLICY_KINDS } from "@/config/insurance";
import { loadFamily } from "@/lib/insurance/family";
import type { Reply } from "../replies";

// "Who's covered on my car insurance?" (spec step 198): everyone in the household and the
// policies that cover them, the gaps for each person, and the health plans compared for the
// whole household when there are two. A partner's policy shows only if they shared it.

const INSURANCE = {
  id: "open",
  label: "Your household",
  kind: "link",
  href: "/insurance?focus=household",
} as const;

export async function familyAnswer(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const family = await loadFamily(userId, { client, now });
  const lines = family.rows.map(
    (row) =>
      `- ${row.name}: ${
        row.policies.length > 0
          ? row.policies
              .map(
                (p) =>
                  `${p.carrier} ${POLICY_KINDS[p.kind].toLowerCase()}${p.owner === "You" ? "" : ` (${p.owner}'s)`}`,
              )
              .join(", ")
          : "no policy on file"
      }`,
  );
  const alone = family.people.length === 0 && family.partners.length === 0;
  return {
    body: [
      alone
        ? "I only know about you so far, so here is what covers you."
        : "Here's who is covered by what in your household.",
      ...lines,
      ...family.gaps.slice(0, 2).map((g) => `${g.title}.`),
      ...(alone
        ? [
            "Add the people in your household on your insurance page and I'll match cover to each of them.",
          ]
        : []),
    ].join("\n"),
    actions: [INSURANCE],
    refs: {},
  };
}
