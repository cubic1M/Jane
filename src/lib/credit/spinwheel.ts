import { demoCredit } from "./demo";
import type { CreditPartner, CreditReport, CreditRequest, ReportItem } from "./partner";

// A credit score and report through Spinwheel. **NEVER RUN against Spinwheel's API**: built from its
// docs, read 2026-11-02 (docs.spinwheel.io: fetch-debt-profile, multi-bureau-support, user-consent),
// and tested against a mock. Off: creditPartnerFor (src/lib/credit.ts) only ever gives the demo
// stand-in, and nothing is pulled for a real account.
//
// Before any live use: the person's consent has to be taken and kept first (Spinwheel leaves that to
// the integrator). Its docs say its scores "are not true vantage scores, but are indicative": ask.
// Its status conflicts (a consumer reporting agency in March 2026, "neither" in an addendum) are for
// counsel. Collections are listed only: don't act on them until counsel answers, since both Spinwheel
// and Array restrict credit repair.

export const SPINWHEEL_SANDBOX = "https://sandbox-api.spinwheel.io";

// Spinwheel gives no range: by model, from the models' own published scales.
const SCORE_RANGES: Readonly<Record<string, { low: number; high: number }>> = {
  VANTAGE_SCORE_3_0: { low: 300, high: 850 },
  FICO_SCORE_4: { low: 300, high: 850 },
  FICO_SCORE_8: { low: 300, high: 850 },
};

const AVERAGE_AGE = /average age of open tradelines/i;
const dollarsToCents = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : 0;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

type DebtProfile = {
  data?: {
    creditReports?: {
      creditScoreDetails?: { creditScore?: unknown; model?: unknown }[];
      creditAttributes?: { description?: unknown; value?: unknown }[];
      inquiries?: { inquiryDate?: unknown; purposeType?: unknown }[];
    }[];
    creditCards?: { cardProfile?: { creditLimit?: unknown } }[];
    miscellaneousLiabilities?: {
      displayName?: unknown;
      creditor?: { originalName?: unknown };
      balanceDetails?: { outstandingBalance?: unknown };
      liabilityProfile?: {
        liabilitySubtype?: unknown;
        collectionStatus?: unknown;
        accountOriginationDate?: unknown;
      };
    }[];
  };
};

// Pure, from its response. Field names as its reference gives them.
export function creditReportOf(profile: DebtProfile, now: Date): CreditReport {
  const report = profile.data?.creditReports?.[0];
  const score = report?.creditScoreDetails?.[0];
  if (typeof score?.creditScore !== "number") throw new Error("Spinwheel gave no credit score");
  const model = typeof score.model === "string" ? score.model : "Unknown model";
  const age = report?.creditAttributes?.find((a) => AVERAGE_AGE.test(String(a.description ?? "")));
  const yearAgo = now.getTime() - YEAR_MS;
  return {
    score: score.creditScore,
    model,
    range: SCORE_RANGES[model] ?? { low: 300, high: 850 },
    cardLimitCents: (profile.data?.creditCards ?? []).reduce(
      (sum, c) => sum + dollarsToCents(c.cardProfile?.creditLimit),
      0,
    ),
    averageAgeMonths: Math.round(Number(age?.value ?? 0)) || 0,
    hardInquiries: (report?.inquiries ?? []).filter(
      (i) =>
        i.purposeType === "HARD" &&
        typeof i.inquiryDate === "string" &&
        Date.parse(i.inquiryDate) >= yearAgo,
    ).length,
    demo: false,
  };
}

// Collections only. Errors would be Jane's own reading, and it has none on a real report yet.
export function collectionsOf(profile: DebtProfile, today: string): ReportItem[] {
  return (profile.data?.miscellaneousLiabilities ?? [])
    .filter(
      (l) =>
        l.liabilityProfile?.liabilitySubtype === "Collection" ||
        l.liabilityProfile?.collectionStatus === "IN_COLLECTION",
    )
    .map((l, i) => {
      const opened = l.liabilityProfile?.accountOriginationDate;
      return {
        id: `spinwheel-collection-${i}`,
        kind: "collection" as const,
        creditor: String(l.displayName ?? l.creditor?.originalName ?? "A collection agency"),
        originalCreditor:
          typeof l.creditor?.originalName === "string" ? l.creditor.originalName : null,
        amountCents: dollarsToCents(l.balanceDetails?.outstandingBalance) || null,
        firstSeenOn: typeof opened === "string" ? opened.slice(0, 10) : today,
        detail: "On your credit report as a collection.",
        medical: false,
      };
    });
}

export function spinwheelCredit({
  apiKey,
  userId,
  fetcher,
  now = () => new Date(),
  baseUrl = SPINWHEEL_SANDBOX,
}: {
  apiKey: string;
  // The person at Spinwheel (partner_links).
  userId: string;
  // Given, never the global fetch: nothing here can reach the network unless a caller means it to.
  fetcher: typeof fetch;
  now?: () => Date;
  baseUrl?: string;
}): CreditPartner {
  const pull = async (): Promise<DebtProfile> => {
    const response = await fetcher(
      `${baseUrl}/v1/users/${encodeURIComponent(userId)}/debtProfile`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          creditReport: { type: "1_BUREAU.FULL" },
          creditScore: { model: "VANTAGE_SCORE_3_0" },
        }),
      },
    );
    if (!response.ok) throw new Error(`Spinwheel answered ${response.status} to a credit pull`);
    return (await response.json()) as DebtProfile;
  };
  return {
    name: "Spinwheel",
    async softPull(_request: CreditRequest) {
      return creditReportOf(await pull(), now());
    },
    // Spinwheel has no simulator: Jane's own, which pulls nothing and changes nothing.
    estimate: (request, change) => demoCredit.estimate(request, change),
    async reportItems() {
      return collectionsOf(await pull(), now().toISOString().slice(0, 10));
    },
  };
}
