import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/agent/run", () => ({ runAgentNow: vi.fn() }));
vi.mock("@/lib/jane-agent/reply-links", () => {
  class ReplyLinkError extends Error {}
  return { ReplyLinkError, redeemReplyLink: vi.fn() };
});
vi.mock("@/lib/jane-agent/actions", async () => {
  const { ChatActionError } = await import("@/lib/jane-agent/actions/handler");
  return { ChatActionError };
});

import { ChatActionError } from "@/lib/jane-agent/actions";
import { redeemReplyLink, ReplyLinkError } from "@/lib/jane-agent/reply-links";
import { getCurrentUser } from "@/lib/session";
import { confirmReply } from "./actions";

// Spec step 85: the confirm button on a one-tap link from Jane's email.

const form = (token: string) => {
  const data = new FormData();
  data.set("token", token);
  return data;
};

describe("confirmReply", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset().mockResolvedValue(null);
    vi.mocked(redeemReplyLink).mockReset();
  });

  it("answers with the link's token, with no session needed", async () => {
    vi.mocked(redeemReplyLink).mockResolvedValue({
      message: { answeredWith: "Yes", refs: { note: "I'm on it." } },
      agentJobIds: [],
      userId: "u1",
    } as never);
    expect(await confirmReply(null, form("tok"))).toEqual({ ok: true, message: "I'm on it." });
    expect(redeemReplyLink).toHaveBeenCalledWith("tok", { signedInAs: null });
  });

  it("passes who is signed in, so another person's link is refused", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u2" } as never);
    vi.mocked(redeemReplyLink).mockRejectedValue(
      new ReplyLinkError("This link is for a different account."),
    );
    expect(await confirmReply(null, form("tok"))).toEqual({
      ok: false,
      message: "This link is for a different account.",
    });
    expect(redeemReplyLink).toHaveBeenCalledWith("tok", { signedInAs: "u2" });
  });

  it("explains a used link or a message already answered", async () => {
    vi.mocked(redeemReplyLink).mockRejectedValueOnce(
      new ReplyLinkError("This link was already used."),
    );
    expect(await confirmReply(null, form("tok"))).toMatchObject({ ok: false });
    vi.mocked(redeemReplyLink).mockRejectedValueOnce(
      new ChatActionError("not_open", "This one's already been answered."),
    );
    expect(await confirmReply(null, form("tok"))).toEqual({
      ok: false,
      message: "This one's already been answered.",
    });
  });
});
