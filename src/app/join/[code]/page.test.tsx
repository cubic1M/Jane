import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { headerGet, after } = vi.hoisted(() => ({ headerGet: vi.fn(), after: vi.fn() }));

vi.mock("next/headers", () => ({ headers: async () => ({ get: headerGet }) }));
vi.mock("next/server", () => ({ after, connection: async () => {} }));
vi.mock("@/lib/share-invites", () => ({ inviteLanding: vi.fn(), recordInviteOpened: vi.fn() }));

import { inviteLanding, recordInviteOpened } from "@/lib/share-invites";
import JoinPage, { generateMetadata } from "./page";

const LANDING = {
  inviteId: "inv_1",
  code: "ABCD-EFGH-JKMN",
  card: { kind: "found" as const, dollars: 1200 },
  open: true,
};
const params = Promise.resolve({ code: "abcd-efgh-jkmn" });

// The Suspense child that loads the invite.
async function renderJoin() {
  const page = JoinPage({ params }) as ReactElement<{ children: ReactElement }>;
  const join = page.props.children as ReactElement<{ children: ReactElement }>;
  const inner = join.props.children as ReactElement<{ params: typeof params }>;
  return (inner.type as (p: { params: typeof params }) => Promise<ReactElement>)(inner.props);
}

describe("/join/[code]", () => {
  beforeEach(() => {
    headerGet
      .mockReset()
      .mockImplementation((name: string) =>
        name === "host" ? "jane.test" : name === "user-agent" ? "Mozilla/5.0 (iPhone)" : null,
      );
    after.mockReset();
    vi.mocked(inviteLanding).mockReset().mockResolvedValue(LANDING);
  });

  it("previews as the person's card, and isn't indexed", async () => {
    const meta = await generateMetadata({ params });
    expect(meta.title).toBe("Jane found me $1,200/yr");
    expect(meta.robots).toEqual({ index: false });
    expect(meta.metadataBase?.toString()).toBe("https://jane.test/");
    expect(meta.openGraph?.images).toEqual([
      { url: "/api/share/card?kind=found&value=1200", width: 1200, height: 630 },
    ]);
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("previews as Jane's plain card for a wrong link", async () => {
    vi.mocked(inviteLanding).mockResolvedValue(null);
    const meta = await generateMetadata({ params });
    expect(meta.title).toBe("You're invited to Jane");
    expect(meta.openGraph?.images).toEqual([{ url: "/api/share/card", width: 1200, height: 630 }]);
  });

  it("counts the open after the page is sent, with who's asking", async () => {
    await renderJoin();
    expect(after).toHaveBeenCalledTimes(1);
    await after.mock.calls[0][0]();
    expect(recordInviteOpened).toHaveBeenCalledWith("inv_1", "Mozilla/5.0 (iPhone)");
  });

  it("counts nothing for a wrong link", async () => {
    vi.mocked(inviteLanding).mockResolvedValue(null);
    await renderJoin();
    expect(after).not.toHaveBeenCalled();
  });
});
