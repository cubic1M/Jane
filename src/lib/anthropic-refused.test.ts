import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops-switches", () => ({ freshSwitches: vi.fn(async () => undefined) }));
const recorded = vi.fn<(...a: unknown[]) => Promise<undefined>>(async () => undefined);
vi.mock("@/lib/ops-alerts", () => ({ recordOpsEvent: (...a: unknown[]) => recorded(...a) }));
const warned = vi.fn();
vi.mock("@/lib/log", () => ({
  log: { warn: (...a: unknown[]) => warned(...a), error: vi.fn(), info: vi.fn() },
}));

import { CLAUDE_REFUSED_PAUSE_MS, CLAUDE_REFUSED_PROBE_MS } from "@/config/outside-calls";
import { claudeFetch, resetClaudeRefusalForTests } from "./anthropic";

// A key the store refuses is refused on every call, and every chat turn used to ask, wait for the
// refusal and only then answer from Jane's own words. Now one refusal pauses the calls for a few
// minutes (the same refusal at once, no round trip), then one call tries again.

const ask = () =>
  claudeFetch("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" });
const refusedByStore = () => new Response("{}", { status: 401 });

describe("a refused Claude key", () => {
  let network: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-11-28T12:00:00Z") });
    resetClaudeRefusalForTests();
    recorded.mockClear();
    warned.mockClear();
    network = vi.fn(async () => refusedByStore());
    vi.stubGlobal("fetch", network);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("costs one call, not one per turn", async () => {
    expect((await ask()).status).toBe(401);
    for (let i = 0; i < 5; i++) {
      const again = await ask();
      expect(again.status).toBe(401);
      // The same shape the client library reads a real refusal in.
      expect(await again.json()).toMatchObject({ error: { type: "authentication_error" } });
    }
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("raises the alarm and logs once for the pause, and never the key", async () => {
    await ask();
    await ask();
    await ask();
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warned.mock.calls)).not.toMatch(/sk-ant|x-api-key/i);
  });

  it("tries once more when the pause is over, and again after a second refusal", async () => {
    await ask();
    vi.advanceTimersByTime(CLAUDE_REFUSED_PAUSE_MS + 1);
    await ask();
    expect(network).toHaveBeenCalledTimes(2);
    // The probe was refused too: paused again, with its own log line.
    await ask();
    expect(network).toHaveBeenCalledTimes(2);
    expect(warned).toHaveBeenCalledTimes(2);
  });

  it("goes back to asking at once when the key works again", async () => {
    await ask();
    vi.advanceTimersByTime(CLAUDE_REFUSED_PAUSE_MS + 1);
    network.mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(200);
    expect(network).toHaveBeenCalledTimes(3);
  });

  it("lets only one call through while the probe is out", async () => {
    await ask();
    vi.advanceTimersByTime(CLAUDE_REFUSED_PAUSE_MS + 1);
    let release: (r: Response) => void = () => undefined;
    network.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));
    const probe = ask();
    const others = await Promise.all([ask(), ask()]);
    expect(others.map((r) => r.status)).toEqual([401, 401]);
    expect(network).toHaveBeenCalledTimes(2);
    release(new Response("{}", { status: 200 }));
    expect((await probe).status).toBe(200);
  });

  it("keeps the probe alone however long it takes", async () => {
    await ask();
    vi.advanceTimersByTime(CLAUDE_REFUSED_PAUSE_MS + 1);
    let release: (r: Response) => void = () => undefined;
    network.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));
    const probe = ask();
    vi.advanceTimersByTime(CLAUDE_REFUSED_PROBE_MS * 5);
    expect((await ask()).status).toBe(401);
    expect(network).toHaveBeenCalledTimes(2);
    release(new Response("{}", { status: 200 }));
    await probe;
    network.mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await ask()).status).toBe(200);
  });

  it("tries again after a probe that got no answer", async () => {
    await ask();
    vi.advanceTimersByTime(CLAUDE_REFUSED_PAUSE_MS + 1);
    network.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(ask()).rejects.toThrow("socket hang up");
    expect((await ask()).status).toBe(401);
    vi.advanceTimersByTime(CLAUDE_REFUSED_PROBE_MS + 1);
    network.mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await ask()).status).toBe(200);
  });

  it("does not treat other failures as a refusal", async () => {
    network.mockResolvedValue(new Response("{}", { status: 500 }));
    await ask();
    await ask();
    expect(network).toHaveBeenCalledTimes(2);
    expect(recorded).not.toHaveBeenCalled();
  });
});
