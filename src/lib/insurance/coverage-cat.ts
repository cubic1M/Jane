import { requireGrant } from "@/lib/permission/gate";
import type { InsurancePartner, PartnerQuote, QuoteRequest } from "./partner";

// Quotes through Coverage Cat, a licensed broker with an API. **NEVER RUN against its API**: built
// from its docs, read 2026-11-02 (coveragecat.com/developers/sandbox, /api/consumer/openapi.yaml),
// and tested against a mock. Off: partnerFor (./partner.ts) gives only the demo partner, and
// COUNSEL_INSURANCE_REFERRALS.approved stays false. Jane holds no license and is a front end.
//
// Five states only (CA, FL, NY, TX, WA), umbrella and homeowners in its API. A quote is a conversation:
// a prefill, then questions the shopper answers on Coverage Cat's own page (resumeUrl), then offers,
// so `quote` returns whatever offers exist yet and `resumeUrl` is where the person goes. Everything
// else is the broker's: no cancel, endorsement, claim or life application is documented. Payment
// happens on its site, never here. Jane's words must never recommend a specific policy or carrier:
// California treats that as licensed activity.

export const COVERAGE_CAT_API = "https://www.coveragecat.com";
export const COVERAGE_CAT_STATES: readonly string[] = ["CA", "FL", "NY", "TX", "WA"];
const COVERAGE_CAT_KINDS: Readonly<Record<string, string>> = {
  umbrella: "umbrella",
  home: "homeowners",
};

export class BrokerHandles extends Error {
  constructor(what: string) {
    super(`The broker handles ${what}: Jane can't do this through it.`);
    this.name = "BrokerHandles";
  }
}

type Offer = {
  carrier?: unknown;
  annual_price?: unknown;
  coverage_limit?: unknown;
  selection_token?: unknown;
  quote_number?: unknown;
};

// Its offers as Jane's quotes. It gives a yearly price; umbrella carriers don't offer installments.
export function quotesOf(
  offers: readonly Offer[],
  request: Pick<QuoteRequest, "kind" | "coverage" | "deductibleCents">,
  now: Date,
): PartnerQuote[] {
  return offers.flatMap((o) => {
    if (typeof o.carrier !== "string" || typeof o.annual_price !== "number") return [];
    if (typeof o.selection_token !== "string") return [];
    const cents = Math.round(o.annual_price * 100);
    return [
      {
        partnerQuoteId: o.selection_token,
        carrier: {
          id: o.carrier.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name: o.carrier,
          rating: "",
          ratingScore: 0,
          claimsPhone: "",
          claimsUrl: "",
        },
        kind: request.kind,
        annualPremiumCents: cents,
        premiumCents: cents,
        premiumFrequency: "yearly" as const,
        termMonths: 12,
        deductibleCents: request.deductibleCents,
        coverage: request.coverage,
        // It doesn't say here: a day, so an old offer is never shown as current.
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        demo: false,
      },
    ];
  });
}

export function coverageCatPartner({
  fetcher,
  shopper,
  sandbox = true,
  onHandoff,
}: {
  // Given, never the global fetch: nothing here can reach the network unless a caller means it to.
  fetcher: typeof fetch;
  shopper: { fullName: string; email: string; address: Record<string, string> };
  sandbox?: boolean;
  // Where the person goes next, on Coverage Cat's own page.
  onHandoff?: (resumeUrl: string) => void;
}): InsurancePartner {
  const refuse = (what: string) => async (): Promise<never> => {
    throw new BrokerHandles(what);
  };
  return {
    name: "Coverage Cat",
    demo: false,
    async quote(request, { now }) {
      const line = COVERAGE_CAT_KINDS[request.kind];
      if (!line || !request.state || !COVERAGE_CAT_STATES.includes(request.state)) return [];
      requireGrant("insurance");
      const response = await fetcher(`${COVERAGE_CAT_API}/api/consumer/${line}/prefill`, {
        method: "POST",
        headers: { "content-type": "application/json", "coverage-cat-api-version": "v1" },
        body: JSON.stringify({
          ...(sandbox ? { sandbox: true } : {}),
          intake: {
            full_name: shopper.fullName,
            email: shopper.email,
            address: shopper.address,
          },
        }),
      });
      if (!response.ok) throw new Error(`Coverage Cat answered ${response.status} to a quote`);
      const body = (await response.json()) as { resume_url?: unknown; offers?: Offer[] };
      if (typeof body.resume_url === "string") onHandoff?.(body.resume_url);
      return quotesOf(body.offers ?? [], request, now);
    },
    bind: refuse("binding, on its own page") as InsurancePartner["bind"],
    paymentStatus: refuse("payments") as InsurancePartner["paymentStatus"],
    cancel: refuse("cancelling") as InsurancePartner["cancel"],
    applyLife: refuse("life applications") as InsurancePartner["applyLife"],
    endorse: refuse("policy changes") as InsurancePartner["endorse"],
    negotiateRenewal: refuse("renewals") as InsurancePartner["negotiateRenewal"],
    fileClaim: refuse("claims") as InsurancePartner["fileClaim"],
    claimStatus: refuse("claims") as InsurancePartner["claimStatus"],
    applySaving: refuse("policy changes") as InsurancePartner["applySaving"],
  };
}
