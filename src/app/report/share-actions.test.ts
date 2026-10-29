import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/share-current", () => ({ currentCard: vi.fn() }));
vi.mock("@/lib/share-invites", () => ({ shareLinkFor: vi.fn(), recordInviteSent: vi.fn() }));

import { requireUser } from "@/lib/session";
import { currentCard } from "@/lib/share-current";
import { recordInviteSent, shareLinkFor } from "@/lib/share-invites";
import { prepareShare, shareSent } from "./share-actions";

const CARD = { kind: "found" as const, dollars: 1200 };

describe("the report's share actions", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(currentCard).mockReset().mockResolvedValue(CARD);
    vi.mocked(shareLinkFor)
      .mockReset()
      .mockResolvedValue({ code: "ABCD-EFGH-JKMN", path: "/join/ABCD-EFGH-JKMN", card: CARD });
    vi.mocked(recordInviteSent).mockReset().mockResolvedValue(true);
  });

  it("makes the link with the card worked out on the server", async () => {
    expect(await prepareShare()).toEqual({ path: "/join/ABCD-EFGH-JKMN", card: CARD });
    expect(currentCard).toHaveBeenCalledWith("user_1");
    expect(shareLinkFor).toHaveBeenCalledWith("user_1", CARD);
  });

  it("says so when there's nothing to share", async () => {
    vi.mocked(currentCard).mockResolvedValue(null);
    expect(await prepareShare()).toEqual({ error: "There's nothing to share yet." });
    expect(shareLinkFor).not.toHaveBeenCalled();
  });

  it("says so when sharing is off (a trial person, or a revoked code)", async () => {
    vi.mocked(shareLinkFor).mockResolvedValue(null);
    expect(await prepareShare()).toEqual({ error: "Sharing isn't on for this account." });
  });

  it("counts a send by how it went, and ignores anything else", async () => {
    await shareSent("copy");
    await shareSent("share_sheet");
    await shareSent("email" as never);
    expect(recordInviteSent).toHaveBeenCalledTimes(2);
    expect(recordInviteSent).toHaveBeenCalledWith("user_1", "copy");
    expect(recordInviteSent).toHaveBeenCalledWith("user_1", "share_sheet");
  });
});
