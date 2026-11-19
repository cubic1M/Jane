// The contract run (`npm run connectors:contract`, section C3's contract mode) calls only these test
// hosts. Every request goes through guardedFetch, which refuses anything else before it leaves.
export const CONTRACT_HOSTS = [
  // Method's Development (mocked data); its "Sandbox" is live data and is never on this list.
  "https://dev.methodfi.com",
  "https://api-sandbox.dwolla.com",
  // SnapTrade has one host; only a test key is used against it (the run says so).
  "https://api.snaptrade.com",
  "https://broker-api.sandbox.alpaca.markets",
  "https://www.signwell.com",
  "https://api.postgrid.com",
  "https://sandbox.getpinwheel.com",
] as const;

export class HostRefused extends Error {
  constructor(readonly host: string) {
    super(`Not a test host: ${host}`);
    this.name = "HostRefused";
  }
}

export function guardedFetch(send: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (!(CONTRACT_HOSTS as readonly string[]).includes(url.origin))
      throw new HostRefused(url.origin);
    return send(input, init);
  }) as typeof fetch;
}
