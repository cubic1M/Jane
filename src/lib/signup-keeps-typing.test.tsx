import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Debugger 11-12: a student who mistyped their invite code was sent back to /signup with "That
// invite code isn't valid", and every field empty: code, email and the Terms box. What they
// typed comes back with the error, so only the wrong part needs fixing.

const { cookieSet, AuthError } = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  AuthError: class AuthError extends Error {
    type = "Configuration";
  },
}));
vi.mock("next-auth", () => ({ AuthError }));

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("@/lib/auth-events", () => ({ recordFailedSignIn: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ set: cookieSet })),
}));
vi.mock("@/lib/invites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invites")>()),
  invitesRequired: () => true,
  redeemInvite: vi.fn(async () => "invalid"),
  checkCode: vi.fn(),
  joinWaitlist: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  googleEnabled: false,
}));
vi.mock("@/lib/session", () => ({ HOME_PATH: "/home" }));
vi.mock("@/lib/trial-delete", () => ({ deleteTrialPerson: vi.fn(async () => true) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

import { AuthForm } from "@/components/auth-form";
import { signInWithEmail } from "./auth-actions";

const signupForm = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
};

const kept = () => cookieSet.mock.calls.find(([name]) => name === "fc_signup_draft");

describe("sent back to /signup", () => {
  beforeEach(() => cookieSet.mockClear());

  it("keeps the code and email typed when the code isn't valid", async () => {
    const form = signupForm({
      invite: "abcd efgh jkmm",
      email: "r207-maya@example.test",
      consent: "on",
    });
    await expect(signInWithEmail(form)).rejects.toThrow("redirect:/signup?error=InvalidInvite");
    expect(kept(), "what they typed is kept").toBeDefined();
    const [, value, options] = kept() ?? [];
    expect(JSON.parse(String(value))).toEqual({
      email: "r207-maya@example.test",
      invite: "abcd efgh jkmm",
    });
    // Only for the sign-up page, out of reach of scripts, and short-lived.
    expect(options).toMatchObject({ httpOnly: true, path: "/signup", maxAge: 600 });
  });

  it("keeps them when the Terms box was left empty", async () => {
    const form = signupForm({ invite: "ABCD-EFGH-JKMM", email: "r207-maya@example.test" });
    await expect(signInWithEmail(form)).rejects.toThrow("redirect:/signup?error=ConsentRequired");
    expect(kept(), "what they typed is kept").toBeDefined();
    expect(JSON.parse(String(kept()?.[1]))).toMatchObject({ email: "r207-maya@example.test" });
  });

  it("fills the email back into the form", () => {
    const html = renderToStaticMarkup(
      <AuthForm
        signUp
        submitLabel="Email me a sign-up link"
        invite="ABCD EFGH JKMM"
        email="r207-maya@example.test"
      />,
    );
    expect(html).toContain('value="r207-maya@example.test"');
    expect(html).toContain('value="ABCD EFGH JKMM"');
  });
});
