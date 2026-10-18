import { DIGEST_LINK_PATHS, DIGEST_UTM } from "@/config/digest";

// Digest links go through /api/digest/click, which records the click (no tracking pixel)
// and then redirects to the page with UTM parameters.

export type DigestPath = (typeof DIGEST_LINK_PATHS)[number];

export function appBase(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function clickLink(digestId: string, path: DigestPath): string {
  const params = new URLSearchParams({ d: digestId, to: path });
  return `${appBase()}/api/digest/click?${params}`;
}

// Where a click lands: only known pages, so the link can't redirect anywhere else.
export function landingPath(to: string | null): string {
  const path = (DIGEST_LINK_PATHS as readonly string[]).includes(to ?? "") ? to : "/report";
  return `${path}?${new URLSearchParams(DIGEST_UTM)}`;
}
