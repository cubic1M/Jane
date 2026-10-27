import { headers as requestHeaders } from "next/headers";
import { ACCESS_USER_AGENT_MAX } from "@/config/access-log";
import { clientIp } from "@/lib/rate-limit";

// Where a request came from, for the access log: its IP address, browser, and the city and
// country Vercel works out from the IP (free, no lookup service). Never a cookie, a header
// holding a credential, or the query string.

export type RequestDetails = {
  ip: string | null;
  user_agent: string | null;
  city: string | null;
  country: string | null;
};

const NONE: RequestDetails = { ip: null, user_agent: null, city: null, country: null };

function decoded(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value).slice(0, 80);
  } catch {
    return null;
  }
}

export function detailsFrom(headers: Headers): RequestDetails {
  return {
    ip: clientIp(headers)?.slice(0, 64) ?? null,
    user_agent: headers.get("user-agent")?.trim().slice(0, ACCESS_USER_AGENT_MAX) || null,
    city: decoded(headers.get("x-vercel-ip-city")),
    country: headers.get("x-vercel-ip-country")?.slice(0, 2) ?? null,
  };
}

// The current request's details, or nothing outside a request (cron jobs, scripts, tests).
export async function currentRequestDetails(): Promise<RequestDetails> {
  try {
    return detailsFrom(await requestHeaders());
  } catch {
    return NONE;
  }
}
