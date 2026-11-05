import { DIGEST_LINK_PATHS, DIGEST_UTM } from "@/config/digest";
import { siteBase } from "@/lib/site-origin";

// Digest links go through /api/digest/click, which records the click (no tracking pixel)
// and then redirects to the page with UTM parameters.

export type DigestPath = (typeof DIGEST_LINK_PATHS)[number];

export const appBase = (): string => siteBase();

export function clickLink(digestId: string, path: DigestPath): string {
  const params = new URLSearchParams({ d: digestId, to: path });
  return `${appBase()}/api/digest/click?${params}`;
}

// Where a click lands: only known pages, so the link can't redirect anywhere else.
export function landingPath(to: string | null): string {
  const path = (DIGEST_LINK_PATHS as readonly string[]).includes(to ?? "") ? to : "/report";
  return `${path}?${new URLSearchParams(DIGEST_UTM)}`;
}
