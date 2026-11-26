// Runs before every test file (vitest.config.mts, setupFiles). The chat now fails closed when the
// payee mask can't be built (CodeRabbit part 2: names must not reach Claude unmasked), and many
// chat tests hand the chat an empty `{}` as its database client. For that one stand-in, and only
// it, the mask is empty, as it is for a person with no payment-app payees. A client with anything
// on it, a real one or a deliberately broken one, goes through the real lookup.
import { vi } from "vitest";

vi.mock("@/lib/jane-agent/payee-mask", async (original) => {
  const real = await original<typeof import("@/lib/jane-agent/payee-mask")>();
  return {
    ...real,
    payeeMask: (userId: string, client: object) =>
      Object.keys(client).length === 0
        ? Promise.resolve(real.NO_MASK)
        : real.payeeMask(userId, client as never),
  };
});
