import { writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { runSweep } from "./detector-sweep";

vi.mock("@/categorize/llm", () => ({ classifyMerchants: async () => new Map() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(), getCurrentUser: vi.fn() }));

// DETECTOR_SWEEP=<file> vitest run src/accuracy/csv/detector-sweep.cli.test.ts writes the table.
it.runIf(process.env.DETECTOR_SWEEP)(
  "writes which detectors fire on uploaded statements",
  { timeout: 3_000_000 },
  async () => {
    const sweep = await runSweep();
    writeFileSync(process.env.DETECTOR_SWEEP!, JSON.stringify(sweep, null, 2));
    expect(sweep.people).toBeGreaterThan(0);
  },
);
