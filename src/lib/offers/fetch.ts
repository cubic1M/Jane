import {
  OFFERS_FETCH_TIMEOUT_MS,
  OFFERS_MAX_PAGE_CHARS,
  OFFERS_ROBOTS_HOURS,
  OFFERS_USER_AGENT,
} from "@/config/offers";

// Reading a source gently: Jane's own user agent, a timeout, one request at a time, and never a
// path the site's robots.txt asks robots to leave alone.

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const robotsCache = new Map<string, { rules: string[]; until: number }>();

// The Disallow lines for every robot ("User-agent: *"), the only group that names Jane.
export function disallowedFor(robots: string): string[] {
  const rules: string[] = [];
  let mine = false;
  let sawRule = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const name = field?.trim().toLowerCase();
    if (name === "user-agent") {
      // A new group starts after a group's rules.
      if (sawRule) {
        mine = false;
        sawRule = false;
      }
      mine = mine || value === "*";
    } else if (name === "disallow" || name === "allow") {
      sawRule = true;
      if (mine && name === "disallow" && value) rules.push(value);
    }
  }
  return rules;
}

// Whether a path is disallowed: robots.txt prefixes, with * and a closing $.
export function blockedBy(rules: readonly string[], path: string): boolean {
  return rules.some((rule) => {
    const pattern = rule
      .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\\\$$|\$$/, "$");
    return new RegExp(`^${pattern}`).test(path);
  });
}

async function robotsAllow(
  url: string,
  { fetcher = fetch, now = Date.now() }: { fetcher?: Fetcher; now?: number } = {},
): Promise<boolean> {
  const target = new URL(url);
  // Only the real web's answers are kept: a stand-in fetcher (a test) asks every time.
  const cache =
    fetcher === fetch ? robotsCache : new Map<string, { rules: string[]; until: number }>();
  const cached = cache.get(target.origin);
  let rules = cached && cached.until > now ? cached.rules : null;
  if (!rules) {
    const response = await fetcher(`${target.origin}/robots.txt`, {
      headers: { "user-agent": OFFERS_USER_AGENT },
      signal: AbortSignal.timeout(OFFERS_FETCH_TIMEOUT_MS),
    }).catch(() => null);
    // No robots.txt is no rule; one that fails to load is treated the same as the site's silence.
    rules = response?.ok ? disallowedFor(await response.text()) : [];
    cache.set(target.origin, { rules, until: now + OFFERS_ROBOTS_HOURS * 3_600_000 });
  }
  return !blockedBy(rules, `${target.pathname}${target.search}`);
}

class SourceRefused extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "SourceRefused";
  }
}

// One read of a source: robots.txt first for a page, then the page or the API's answer as text.
export async function politeFetch(
  url: string,
  { fetcher = fetch, page = true }: { fetcher?: Fetcher; page?: boolean } = {},
): Promise<string> {
  if (page && !(await robotsAllow(url, { fetcher }))) throw new SourceRefused("robots");
  const response = await fetcher(url, {
    headers: {
      "user-agent": OFFERS_USER_AGENT,
      accept: page ? "text/html" : "application/json",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(OFFERS_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new SourceRefused(`http_${response.status}`);
  return (await response.text()).slice(0, OFFERS_MAX_PAGE_CHARS);
}
