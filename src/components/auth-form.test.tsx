import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The sign-in and sign-up form shows "Continue with Google" only when Google is set up.
const google = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/auth", () => ({
  get googleEnabled() {
    return google.enabled;
  },
}));
vi.mock("@/lib/auth-actions", () => ({ signInWithEmail: vi.fn(), signInWithGoogle: vi.fn() }));
vi.mock("@/lib/invites", () => ({ invitesRequired: () => true }));

import { AuthForm } from "./auth-form";

const render = (signUp: boolean) =>
  renderToStaticMarkup(<AuthForm signUp={signUp} submitLabel="Email me a link" />);

describe("the Google button", () => {
  it("is hidden on /login and /signup without Google's keys", () => {
    google.enabled = false;
    expect(render(false)).not.toContain("Continue with Google");
    expect(render(true)).not.toContain("Continue with Google");
  });

  it("shows on both once AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are set", () => {
    google.enabled = true;
    expect(render(false)).toContain("Continue with Google");
    expect(render(true)).toContain("Continue with Google");
  });
});
