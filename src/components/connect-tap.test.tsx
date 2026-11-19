import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/connectors/connect", () => ({ connectOffered: vi.fn() }));

import { renderToStaticMarkup } from "react-dom/server";
import { connectOffered } from "@/lib/connectors/connect";
import { ConnectTap } from "./connect-tap";

// The one tap a card shows to connect what it needs.

const tap = () =>
  ConnectTap({
    userId: "user_1",
    connectorIds: ["real_one", "sandbox_one"],
    from: "/investments",
    label: "Bring in the account itself",
  });

describe("ConnectTap", () => {
  afterEach(() => vi.mocked(connectOffered).mockReset());

  it("offers the first connector this person may use, opening the shared consent screen", async () => {
    vi.mocked(connectOffered).mockImplementation(async (_u, id) => id === "sandbox_one");
    const html = renderToStaticMarkup((await tap())!);
    expect(html).toContain('href="/settings/connections/sandbox_one?from=%2Finvestments"');
    expect(html).toContain("Bring in the account itself");
  });

  it("shows nothing when none is offered: off, not for them, connected or turned down", async () => {
    vi.mocked(connectOffered).mockResolvedValue(false);
    expect(await tap()).toBeNull();
  });
});
