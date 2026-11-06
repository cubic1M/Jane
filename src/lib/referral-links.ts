import { createHmac } from "node:crypto";

// Referral links through an affiliate network (connectors roadmap round 14), built so nothing about
// the person rides along: the only thing Jane adds is a sub-ID worked out from the action, never a
// user id, name, email, phone, zip, date of birth or VIN, and never Impact's "p." parameters,
// which pass data straight to the brand. A deep link may only point at a domain the partner was
// allow-listed for. Pure: the networks' own formats, from their public docs.

export type ReferralNetwork = "impact" | "cj" | "awin" | "flexoffers";

// Where each network takes the sub-ID and a deep link.
const PARAMS: Record<ReferralNetwork, { subId: string; deepLink: string }> = {
  impact: { subId: "subId1", deepLink: "u" },
  cj: { subId: "sid", deepLink: "url" },
  awin: { subId: "clickref", deepLink: "ued" },
  flexoffers: { subId: "fobs", deepLink: "URL" },
};

// A parameter that could carry the person, whatever the network calls it.
const PERSONAL =
  /^(?:p\..*|sharedid|e?mail|email_?address|(?:first|last|full)_?name|name|phone|tel|mobile|zip|zipcode|postal(?:_?code)?|dob|birth(?:_?date)?|vin|ssn|user(?:_?id)?|uid|customer(?:_?id)?|address|state|city)$/i;
const LOOKS_PERSONAL = /@|\+?\d[\d\s().-]{8,}\d/;

export class ReferralLinkError extends Error {
  constructor(reason: string) {
    super(`Referral link refused: ${reason}`);
    this.name = "ReferralLinkError";
  }
}

// The sub-ID for one action: the first 16 hex of an HMAC of its id, so the network's report can be
// matched back to the action and to nothing else. Stable for the same action and key.
export function referralSubId(actionId: string, key: string): string {
  if (!key) throw new ReferralLinkError("no sub-ID key");
  return createHmac("sha256", key).update(actionId).digest("hex").slice(0, 16);
}

const allowedHost = (host: string, domains: readonly string[]) =>
  domains.some((d) => host === d || host.endsWith(`.${d}`));

export function buildReferralLink({
  network,
  template,
  subId,
  deepLink = null,
  allowedDomains = [],
}: {
  network: ReferralNetwork;
  // The network link the partner gave, with no personal data in it.
  template: string;
  subId: string;
  deepLink?: string | null;
  // Domains the partner may be deep-linked to (its own site).
  allowedDomains?: readonly string[];
}): string {
  let url: URL;
  try {
    url = new URL(template);
  } catch {
    throw new ReferralLinkError("not a URL");
  }
  if (url.protocol !== "https:") throw new ReferralLinkError("not https");
  if (!/^[0-9a-f]{16}$/.test(subId)) throw new ReferralLinkError("sub-ID isn't an HMAC sub-ID");
  for (const [name, value] of url.searchParams) {
    if (PERSONAL.test(name) || LOOKS_PERSONAL.test(value)) {
      throw new ReferralLinkError(`"${name}" could carry the person`);
    }
  }
  const params = PARAMS[network];
  url.searchParams.set(params.subId, subId);
  if (deepLink !== null) {
    let target: URL;
    try {
      target = new URL(deepLink);
    } catch {
      throw new ReferralLinkError("deep link isn't a URL");
    }
    if (target.protocol !== "https:" || !allowedHost(target.hostname, allowedDomains)) {
      throw new ReferralLinkError("deep link to a domain the partner wasn't allowed");
    }
    if ([...target.searchParams].some(([n, v]) => PERSONAL.test(n) || LOOKS_PERSONAL.test(v))) {
      throw new ReferralLinkError("deep link could carry the person");
    }
    // URLSearchParams encodes it once, which is what Awin's ued and the others expect.
    url.searchParams.set(params.deepLink, target.toString());
  }
  return url.toString();
}
