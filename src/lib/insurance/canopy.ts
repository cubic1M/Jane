// A person's own policies through Canopy Connect: read-only, with their consent. **NEVER RUN against
// its API**: built from its docs, read 2026-11-02 (docs.usecanopy.com/openapi/documentation.json),
// and tested against a mock. Off, and not needed for the beta: uploading a declarations page already
// works. Jane never handles the person's insurer login: they connect on Canopy's own widget, and Jane
// only reads the pull. No FCRA uses, no sharing with third parties (its terms for developers).
// The get-a-pull path is read from its sibling routes: confirm it in the sandbox.

export const CANOPY_API = "https://app.usecanopy.com/api/v1.0.0";

export type PulledPolicy = {
  carrier: string;
  policyNumber: string | null;
  type: string;
  premiumCents: number | null;
  effectiveOn: string | null;
  expiresOn: string | null;
};

type CanopyPolicy = {
  carrier_friendly_name?: unknown;
  carrier_name?: unknown;
  carrier_policy_number?: unknown;
  policy_type?: unknown;
  total_premium_cents?: unknown;
  effective_date?: unknown;
  expiry_date?: unknown;
};

const day = (value: unknown) => (typeof value === "string" ? value.slice(0, 10) : null);

export function policiesOf(pull: { policies?: CanopyPolicy[] }): PulledPolicy[] {
  return (pull.policies ?? []).map((p) => ({
    carrier: String(p.carrier_friendly_name ?? p.carrier_name ?? "Your insurer"),
    policyNumber: typeof p.carrier_policy_number === "string" ? p.carrier_policy_number : null,
    type: String(p.policy_type ?? "other"),
    premiumCents: typeof p.total_premium_cents === "number" ? p.total_premium_cents : null,
    effectiveOn: day(p.effective_date),
    expiresOn: day(p.expiry_date),
  }));
}

export async function readCanopyPull(
  { teamId, pullId }: { teamId: string; pullId: string },
  {
    clientId,
    clientSecret,
    fetcher,
  }: {
    clientId: string;
    clientSecret: string;
    // Given, never the global fetch: nothing here can reach the network unless a caller means it to.
    fetcher: typeof fetch;
  },
): Promise<PulledPolicy[]> {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetcher(
    `${CANOPY_API}/teams/${encodeURIComponent(teamId)}/pulls/${encodeURIComponent(pullId)}`,
    { headers: { authorization: `Basic ${auth}` } },
  );
  if (!response.ok) throw new Error(`Canopy answered ${response.status} to a pull`);
  const body = (await response.json()) as { pull?: { policies?: CanopyPolicy[] } } & {
    policies?: CanopyPolicy[];
  };
  return policiesOf(body.pull ?? body);
}
