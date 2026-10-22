// Runs before every test file (vitest.config.mts, setupFiles). The unit and integration tests
// never call Anthropic (spec step 293: "a test proves zero Anthropic calls in the suite"; the
// shared budget is $10 a month). Any request to the Anthropic API from a test fails here and is
// counted, so a test that reaches the real API fails instead of spending. Claude paths are
// tested with fakes. The opt-in live runs (npm run checks:*, ASK_LIVE_TEST=1) turn it off.

export const LIVE_FLAGS = [
  "ANSWER_CHECKS",
  "CHAT_BASELINE",
  "CHAT_EVAL",
  "CHAT_NIGHTLY",
  "ASK_LIVE_TEST",
] as const;

export class AnthropicCallInTest extends Error {}

type Guarded = typeof globalThis & { __anthropicCallsInTests?: number };

const live = LIVE_FLAGS.some((flag) => process.env[flag] === "1");

function anthropicHosts(): Set<string> {
  const hosts = new Set(["api.anthropic.com"]);
  const base = process.env.ANTHROPIC_BASE_URL;
  if (base) {
    try {
      hosts.add(new URL(base).host);
    } catch {
      // Not a URL: only the real API host is guarded.
    }
  }
  return hosts;
}

function hostOf(input: Parameters<typeof fetch>[0]): string | null {
  try {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    return new URL(url).host;
  } catch {
    return null;
  }
}

if (!live) {
  const g = globalThis as Guarded;
  g.__anthropicCallsInTests = 0;
  const real = globalThis.fetch;
  const hosts = anthropicHosts();
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const host = hostOf(input);
    if (host && hosts.has(host)) {
      g.__anthropicCallsInTests = (g.__anthropicCallsInTests ?? 0) + 1;
      throw new AnthropicCallInTest(`A test tried to call the Anthropic API (${host}).`);
    }
    return real(input, init);
  }) as typeof fetch;
}
