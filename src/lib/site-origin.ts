// The site's own address, from settings, never from a request. A link that goes out in an email
// must not take its address from request headers: a sign-in link carries a working token, so a
// forged X-Forwarded-Host would mail the person a link to someone else's site.

export function siteOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const base =
    env.APP_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

// The same link on the site's own address, with its way back there too. Without a configured
// address (local runs), the link as it came.
export function linkOnSite(link: string, env?: Record<string, string | undefined>): string {
  const origin = siteOrigin(env);
  if (!origin) return link;
  const from = new URL(link);
  const on = new URL(`${from.pathname}${from.search}`, origin);
  const back = on.searchParams.get("callbackUrl");
  if (back) {
    const path = URL.canParse(back) ? new URL(back) : null;
    on.searchParams.set("callbackUrl", path ? `${origin}${path.pathname}${path.search}` : origin);
  }
  return on.toString();
}
