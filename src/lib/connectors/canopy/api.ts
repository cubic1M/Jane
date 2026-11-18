import { CANOPY } from "@/config/connectors";

// Canopy Connect's API, the parts Jane reads (built from docs.usecanopy.com/reference and its
// OpenAPI definition, docs.usecanopy.com/openapi/documentation.json, both read 2026-11-17):
// GET /teams/{teamId}/pulls/{pullId}, with Basic auth (the client id as the username, the client
// secret as the password). A "pull" is one person's sign-in to one insurer through Canopy's hosted
// link; its policies are what Jane saves. Only the fields Jane uses are typed here.

export type CanopyCoverage = {
  name: string;
  per_person_limit_cents?: number | null;
  per_incident_limit_cents?: number | null;
  deductible_cents?: number | null;
  is_declined?: boolean | null;
};

export type CanopyPolicy = {
  policy_id: string;
  policy_type: string | null;
  carrier_name: string;
  carrier_friendly_name?: string | null;
  // ACTIVE, CANCELLED, EXPIRED, UNVERIFIED, PENDING_ACTIVATION, PENDING_CANCELLATION, RESCINDED, QUOTE.
  status: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  // The new term's effective date; often null, when the expiry is the renewal.
  renewal_date: string | null;
  // The term's total premium, in cents.
  total_premium_cents: number | null;
  deductible_cents?: number | null;
  vehicles?: { coverages?: CanopyCoverage[] }[];
  dwellings?: { coverages?: CanopyCoverage[] }[];
};

export type CanopyPull = {
  pull_id: string;
  status: string;
  insurance_provider_name?: string | null;
  insurance_provider_friendly_name?: string | null;
  policies: CanopyPolicy[];
};

export interface CanopyApi {
  getPull(pullId: string): Promise<CanopyPull>;
}

// A refusal from Canopy (its error code: NOT_FOUND, VALIDATION_ERROR, UNAUTHORIZED,
// SUBSCRIPTION_INACTIVE) or keys that aren't set. Never carries a key or the response body.
export class CanopyError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
  ) {
    super(`Canopy request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "CanopyError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HttpOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

// The real client. Keys come from env (CANOPY_CLIENT_ID, CANOPY_CLIENT_SECRET, CANOPY_TEAM_ID);
// sandbox keys reach only sandbox pulls, production keys only production ones.
export function canopyHttp({
  env = process.env,
  fetch: send = fetch,
}: HttpOptions = {}): CanopyApi {
  return {
    async getPull(pullId) {
      const id = env[CANOPY.clientIdEnv];
      const secret = env[CANOPY.clientSecretEnv];
      const team = env[CANOPY.teamIdEnv];
      if (!id || !secret || !team) throw new CanopyError(null, "NOT_CONFIGURED");
      if (!UUID.test(pullId) || !UUID.test(team)) throw new CanopyError(null, "BAD_ID");
      const response = await send(`${CANOPY.baseUrl}/teams/${team}/pulls/${pullId}`, {
        headers: {
          authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
          accept: "application/json",
        },
      });
      const body = (await response.json().catch(() => null)) as {
        pull?: CanopyPull;
        error?: unknown;
      } | null;
      if (!response.ok || !body?.pull) {
        const code = typeof body?.error === "string" ? body.error : "UNEXPECTED";
        throw new CanopyError(response.status, code);
      }
      return body.pull;
    },
  };
}
