import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { SENDING_LABEL, refreshDue } from "./scan-refresher";

// During the first scan the open chat reloads every few seconds. It must not while a typed
// question is being answered, or the question shows twice (the draft and the stored one).
describe("refreshDue", () => {
  const page = (sending: boolean) => ({
    querySelector: (selector: string) =>
      sending && selector === `[aria-label="${SENDING_LABEL}"]` ? ({} as Element) : null,
  });

  it("reloads while nothing is being answered", () => {
    expect(refreshDue(page(false))).toBe(true);
  });

  it("waits while a typed question is being answered", () => {
    expect(refreshDue(page(true))).toBe(false);
  });
});
