import { prerenderToNodeStream } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/components/redirect-if-signed-in", () => ({ RedirectIfSignedIn: () => null }));
vi.mock("@/auth", () => ({ googleEnabled: false }));
vi.mock("@/lib/auth-actions", () => ({
  joinTheWaitlist: vi.fn(),
  signInWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

import { uploadTooBig } from "@/config/import";
import SignupPage from "./page";

// Sign-up with an invite that won't work (debug 3, 11-16): "That invite code has been used up. Ask
// for a new one." and right under it "Jane is in private beta. Ask a founder for an invite.": the
// same thing twice. The error says who to ask; the note is for someone who came with no code.

async function html(query: Record<string, string>): Promise<string> {
  const { prelude } = await prerenderToNodeStream(
    SignupPage({ searchParams: Promise.resolve(query) } as never),
  );
  let out = "";
  for await (const chunk of prelude) out += chunk;
  return out;
}

const NOTE = "Jane is in private beta. Ask a founder for an invite.";

describe("the sign-up page after an invite that won't work", () => {
  it.each(["InvalidInvite", "InviteUsedUp", "InviteExpired", "InviteRevoked", "InviteWrongEmail"])(
    "says who to ask once, for %s",
    async (error) => {
      const page = await html({ error });
      expect(page).toContain('role="alert"');
      expect(page).not.toContain(NOTE);
    },
  );

  it("still has the note for someone who came with no code, and after another error", async () => {
    expect(await html({})).toContain(NOTE);
    expect(await html({ error: "ConsentRequired" })).toContain(NOTE);
  });
});

// The upload's size message (same walk): one file isn't "these files".
describe("a statement upload that's too big", () => {
  it("talks about the one file when there is one", () => {
    expect(uploadTooBig(4.5 * 1024 * 1024, 1)).toBe(
      "This file is 4.5 MB. Upload at most 4 MB at a time: download fewer months.",
    );
    expect(uploadTooBig(5 * 1024 * 1024, 2)).toBe(
      "These files add up to 5.0 MB. Upload at most 4 MB at a time: fewer files, or fewer months in each.",
    );
  });
});
