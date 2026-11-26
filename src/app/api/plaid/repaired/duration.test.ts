import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));

import * as webhook from "../webhook/route";
import * as repaired from "./route";

describe("the sync after a repaired bank", () => {
  it("gets as long as the same sync after a webhook", () => {
    expect((repaired as { maxDuration?: number }).maxDuration).toBe(webhook.maxDuration);
  });
});
