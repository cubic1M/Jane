// Who opened the /try link (src/app/try/route.ts). A chat app's link preview or a browser's
// prefetch must never make a sample person: only someone actually opening it.

// Link previews (Slack, iMessage, WhatsApp, LinkedIn, X and the like) and crawlers, by their
// user agent. No user agent at all counts too.
const PREVIEW_AGENT =
  /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|embedly|whatsapp|telegram|skypeuripreview|vkshare|pinterest|linkedin|preview/i;

export function isLinkPreview(headers: Headers): boolean {
  const agent = headers.get("user-agent");
  return !agent || PREVIEW_AGENT.test(agent);
}

// A browser fetching the page ahead of a click, which may never come.
export function isPrefetch(headers: Headers): boolean {
  return [headers.get("sec-purpose"), headers.get("purpose"), headers.get("x-moz")].some((v) =>
    /prefetch|prerender/i.test(v ?? ""),
  );
}
