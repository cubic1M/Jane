import { POSTGRID } from "@/config/connectors";

// PostGrid's letters, the part Jane uses, in test mode only (postgrid.readme.io, read 2026-11-19).
// - POST /print-mail/v1/letters { to, from (contacts), html, mailingClass, description, metadata },
//   header X-API-Key: 201 and the Letter, with `id`, `status` and `live`.
// - DELETE /print-mail/v1/letters/{id}: the Letter, `status: "cancelled"`, while it's still `ready`.
// "None of the orders made in test mode will be sent out." Only the test key is read, a key that says
// it's live is refused before any call, and a letter that comes back live is cancelled at once.

export type PostGridContact = {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  provinceOrState: string;
  postalOrZip: string;
  countryCode: "US";
};

export type NewLetter = {
  to: PostGridContact;
  from: PostGridContact;
  html: string;
  description: string;
  // Jane's idempotency key: PostGrid has none of its own, so a letter carries it for the team.
  janeKey: string;
};

export class PostGridError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
  ) {
    super(`PostGrid request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "PostGridError";
  }
}

const LETTER_ID = /^letter_[A-Za-z0-9]{4,60}$/;

type HttpOptions = { env?: Record<string, string | undefined>; fetch?: typeof fetch };

// The connector keeps one client from load, so its default fetch is looked up at each call.
export function postGridTestHttp({
  env = process.env,
  fetch: send = (input, init) => fetch(input, init),
}: HttpOptions = {}) {
  const key = () => {
    const value = env[POSTGRID.testApiKeyEnv];
    if (!value) throw new PostGridError(null, "NOT_CONFIGURED");
    if (/^live_/i.test(value)) throw new PostGridError(null, "NOT_TEST_MODE");
    return value;
  };
  const url = (id = "") => `${POSTGRID.baseUrl}${POSTGRID.lettersPath}${id ? `/${id}` : ""}`;

  async function cancel(id: string): Promise<boolean> {
    if (!LETTER_ID.test(id)) throw new PostGridError(null, "BAD_ID");
    const response = await send(url(id), { method: "DELETE", headers: { "x-api-key": key() } });
    const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
    if (response.ok) return body?.status === "cancelled";
    // Already past `ready` (printing or mailed), or not found.
    if (response.status === 400 || response.status === 404) return false;
    throw new PostGridError(response.status, "REFUSED");
  }

  return {
    // The new letter's id.
    async createLetter(letter: NewLetter): Promise<string> {
      const response = await send(url(), {
        method: "POST",
        headers: { "x-api-key": key(), "content-type": "application/json" },
        body: JSON.stringify({
          to: letter.to,
          from: letter.from,
          html: letter.html,
          mailingClass: POSTGRID.mailingClass,
          description: letter.description.slice(0, 200),
          metadata: { janeKey: letter.janeKey },
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        id?: unknown;
        live?: unknown;
      } | null;
      const id = typeof body?.id === "string" ? body.id : "";
      if (!response.ok || !LETTER_ID.test(id)) throw new PostGridError(response.status, "REFUSED");
      if (body?.live !== false) {
        // Never let a live letter stand: stop it while it's still ready, and say so.
        await cancel(id).catch(() => false);
        throw new PostGridError(null, "NOT_TEST_MODE");
      }
      return id;
    },
    cancel,
  };
}

// "P.O. Box 54170, Irvine, CA 92619": the company's documented address as PostGrid's contact fields.
export function usAddress(text: string): Omit<PostGridContact, "companyName"> | null {
  const parts = text.split(",").map((p) => p.trim());
  const last = /^([A-Z]{2}) (\d{5}(?:-\d{4})?)$/.exec(parts.at(-1) ?? "");
  if (!last || parts.length < 3 || parts.length > 4) return null;
  const [line1, ...rest] = parts.slice(0, -1);
  const city = rest.at(-1);
  if (!line1 || !city) return null;
  return {
    addressLine1: line1,
    ...(rest.length === 2 ? { addressLine2: rest[0] } : {}),
    city,
    provinceOrState: last[1]!,
    postalOrZip: last[2]!,
    countryCode: "US",
  };
}
