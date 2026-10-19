import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxPack } from "@/lib/tax-pack";
import { loadTaxForms, loadTaxTags } from "@/lib/tax-organizer";
import { loadWorkingProfile } from "@/lib/tax-profile";
import { defaultTaxYear } from "@/planning/tax-pack";
import { merchantKeyOf, payeeOf } from "@/planning/tax-tags";
import type { Reply } from "./replies";
import type { TaxIntent } from "./tax-intents";
import {
  bracketReply,
  estimateMessage,
  formsReply,
  packReply,
  setFilingReply,
  setKidsReply,
  setStateReply,
  tagReply,
  tagTotalReply,
  tagsReply,
  taxProfileReply,
} from "./tax-replies";

// Answers a typed tax question by rules (spec steps 118–127), with the same loaders as
// /taxes, scoped to the person.

type Options = { client: PrismaClient; now: Date };

// The merchant the person named, among the year's charges: the most charged one whose
// name contains what they typed.
async function findMerchant(userId: string, year: number, target: string, { client }: Options) {
  const words = target.toLowerCase();
  const rows = await scopedFor(userId, client).transactions.findMany({
    where: {
      pending: false,
      amountCents: { gt: 0 },
      date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      OR: [
        { description: { contains: words, mode: "insensitive" } },
        { merchantName: { contains: words, mode: "insensitive" } },
      ],
    },
    select: { amountCents: true, description: true, merchantName: true },
  });
  const byKey = new Map<
    string,
    { merchantKey: string; payee: string; count: number; totalCents: number }
  >();
  for (const r of rows) {
    const key = merchantKeyOf(r);
    if (!key) continue;
    const m = byKey.get(key) ?? { merchantKey: key, payee: payeeOf(r), count: 0, totalCents: 0 };
    m.count += 1;
    m.totalCents += r.amountCents;
    byKey.set(key, m);
  }
  return (
    [...byKey.values()].sort((a, b) => b.count - a.count || b.totalCents - a.totalCents)[0] ?? null
  );
}

export async function answerTaxIntent(
  userId: string,
  intent: TaxIntent,
  options: Options,
): Promise<Reply> {
  const { client, now } = options;
  const year = defaultTaxYear(now.toISOString().slice(0, 10));
  switch (intent.ask) {
    case "profile": {
      const { view, autopilot } = await loadWorkingProfile(userId, { client, now });
      return taxProfileReply(view, autopilot);
    }
    case "set_filing":
      return setFilingReply(intent.status);
    case "set_kids":
      return setKidsReply(intent.count);
    case "set_state":
      return setStateReply(intent.state);
    case "tags":
      return tagsReply(await loadTaxTags(userId, year, { client }));
    case "tag_total":
      return tagTotalReply(await loadTaxTags(userId, year, { client }), intent.tag);
    case "tag": {
      const view = await loadTaxTags(userId, year, { client });
      return tagReply(
        view,
        await findMerchant(userId, year, intent.target, options),
        intent.target,
        intent.tag,
      );
    }
    case "forms":
      return formsReply(await loadTaxForms(userId, year, { client, now }));
    case "pack":
      return packReply(await loadTaxPack(userId, year, { client, now }));
    case "estimate":
      return estimateMessage(await loadTaxEstimate(userId, { client, now }));
    case "bracket":
      return bracketReply(await loadTaxEstimate(userId, { client, now }));
  }
}
